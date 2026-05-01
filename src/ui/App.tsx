import { useCallback, useEffect, useRef } from "react";
import Stats from "stats.js";
import { Scene } from "../canvas/Scene";
import { InstancedNodes } from "../canvas/nodes/InstancedNodes";
import { CameraController } from "../canvas/CameraController";
import { useCosmosStore } from "../state/store";
import { allocateNodeBuffer, NodeBuffer } from "../state/nodeBuffer";
import {
  setupStoreSynchronization,
  getIndexToId,
  getIdToIndex,
  clearChunkedNodes,
} from "../state/bridge";
import { setupNodeDetailsSync } from "../state/nodeDetailsSync";
import { setupNodeChunkSync } from "../state/nodeChunkSync";
import { commands } from "../lib/bindings";
import { NodeDetailsPanel } from "./NodeDetailsPanel";
import { ScanControl } from "./ScanControl";
import "./App.css";

/**
 * App — cosmos-desktop 메인 컴포넌트 (M2: bridge 배선)
 *
 * 역할:
 * 1) Canvas 마운트 (useRef)
 * 2) three.js Scene + InstancedNodes + NodeBuffer 초기화
 * 3) bridge.setupStoreSynchronization으로 store → buffer → mesh 단방향 동기화 구축
 * 4) Zustand 상태 구독 (UI 패널 업데이트)
 *
 * 데이터 흐름:
 *   store.nodes (Zustand)
 *     → bridge.syncFromStore (매핑 + NodeBuffer 갱신)
 *     → instancedNodes.syncFromBuffer (instanceMatrix 갱신)
 *     → GPU 렌더
 */
function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const instancedNodesRef = useRef<InstancedNodes | null>(null);
  const bufferRef = useRef<NodeBuffer | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  // Step 2: 카메라 팬 컨트롤러. Scene 이 만든 canvas(renderer.domElement) 에 이벤트 바인딩.
  const cameraControllerRef = useRef<CameraController | null>(null);
  // M6-2 Step 1: 디렉토리 스캔 청크 리스너 unsubscribe 보관.
  // setupNodeChunkSync 가 Promise<UnlistenFn> 을 반환하므로 .then 으로 ref 에 박는다.
  // cleanup 시점에 ref 가 null 이면 listen 이 아직 resolve 안 된 것 — 이 경우는 매우 드묾.
  const chunkUnsubRef = useRef<(() => void) | null>(null);

  // Zustand에서 노드 목록 + 선택 상태 구독 (UI 패널용).
  // 렌더링은 three.js가 담당 (이 훅은 React 리렌더 트리거만).
  const nodes = useCosmosStore((state) => state.nodes);
  const selectedNodeId = useCosmosStore((state) => state.selectedNodeId);
  // M5: 선택된 노드 메타데이터 (nodeDetailsSync 가 비동기 채움). 미선택/대기 중엔 null.
  const selectedNodeDetails = useCosmosStore((state) => state.selectedNodeDetails);
  // M6-2 Step 3: 스캔 진행 상태. 좌상단 동적 카운트 + ScanControl 진행 표시 양쪽에서 사용.
  const scanProgress = useCosmosStore((state) => state.scanProgress);

  /**
   * useEffect: 초기화 (마운트 시 한 번만 실행)
   *
   * 순서가 중요:
   *   1) Scene 생성
   *   2) NodeBuffer 할당 (store와 InstancedMesh의 공용 backing store)
   *   3) InstancedNodes 생성 + Scene에 add
   *   4) Scene.mount (DOM 부착 + renderLoop 시작)
   *   5) setupStoreSynchronization(buffer, onAfterSync) — store → buffer → mesh 배선
   *      (이 호출 시점에 초기 동기화가 즉시 실행되므로, 하드코딩 노드 3개가 바로 보임)
   *
   * React 19 StrictMode dev에서 mount → cleanup → mount가 2회 발생해도
   * sceneRef 가드와 cleanup 시 unsub/dispose가 정확히 이뤄지면 문제 없음.
   */
  useEffect(() => {
    // 중복 마운트 방지 가드 (M5에서 추가한 엣지 케이스 방어)
    if (sceneRef.current) return;

    if (!containerRef.current) {
      console.error("Container ref not available");
      return;
    }

    // (fix m6-2) 이 effect 인스턴스 전용 cancelled 플래그.
    //   React 19 StrictMode 더블 마운트에서 Promise 1 (Mount 1 의 setupNodeChunkSync)
    //   이 Mount 2 가 시작된 뒤에 resolve 하는 레이스가 발생.
    //   기존 sceneRef.current === null 가드는 Mount 2 가 sceneRef 를 다시 채워서
    //   무력화 → listener 1, 2 둘 다 살아남아 청크가 2번 처리됨.
    //   클로저 플래그는 effect 인스턴스마다 독립이라 Mount 1 cleanup 이 자기
    //   자신의 cancelled 만 true 로 만들 수 있다 (Mount 2 에 영향 X).
    let cancelled = false;

    // 1) Scene
    const scene = new Scene();
    sceneRef.current = scene;

    // 2) NodeBuffer — store와 InstancedMesh가 공유할 고빈도 버퍼
    //    M6-2 Step 1: capacity 1024 → 10000 으로 확장. 디렉토리 스캔 청크가 수천 개
    //    들어와도 재할당(growNodeBuffer) 없이 받아낼 수 있어야 한다.
    //    동적 확장 전략은 M7+ — 우선 정적 10000 으로 수만 노드 시나리오까지 커버.
    const buffer = allocateNodeBuffer(10000);
    bufferRef.current = buffer;

    // 3) InstancedNodes — 빈 상태로 시작. bridge가 곧 채워 넣음.
    //    capacity를 buffer와 동일하게 맞춰야 syncFromBuffer에서 truncation이 없음.
    const instancedNodes = new InstancedNodes(buffer.capacity);
    instancedNodesRef.current = instancedNodes;
    scene.getScene().add(instancedNodes.getMesh());

    // 4) DOM 마운트 + 렌더 루프 시작
    scene.mount(containerRef.current);

    // M6-2 Step 2: Stats.js (dev only) — 60fps 측정 패널.
    //   showPanel(0) = FPS, (1) = ms, (2) = MB. 0 으로 두고 클릭으로 전환 가능.
    //   Production 빌드에선 import.meta.env.DEV === false 라 dom 추가 자체가 스킵.
    //   stats.dom 은 fixed-position div 이므로 컨테이너에 append 만 하면 화면 좌상단 표시.
    let stats: Stats | null = null;
    if (import.meta.env.DEV) {
      stats = new Stats();
      stats.showPanel(0);
      // 좌상단 하드코딩 — 기존 ui-panel 과 겹치지 않게 우측으로 이동.
      stats.dom.style.position = "absolute";
      stats.dom.style.top = "0px";
      stats.dom.style.right = "0px";
      stats.dom.style.left = "auto";
      containerRef.current.appendChild(stats.dom);
    }

    // 렌더 콜백: OrbitControls damping 은 매 프레임 update() 호출 필수.
    // instanceMatrix는 bridge 동기화 시에만 needsUpdate=true가 되므로 여기서 안 건드림.
    //   stats.update() = end() + begin() 1쌍. 매 프레임 1회 호출하면 frame-to-frame 시간을
    //   잰다 → 표시되는 fps 가 곧 실제 렌더 fps.
    scene.setRenderCallback(() => {
      cameraControllerRef.current?.update();
      stats?.update();
    });

    // 5) 단방향 동기화 배선.
    //    setupStoreSynchronization 내부에서 초기 동기화가 즉시 실행됨 →
    //    하드코딩 3개 노드의 (x,y,z)가 buffer에 쓰이고, onAfterSync로
    //    instancedNodes.syncFromBuffer가 호출되어 InstancedMesh가 갱신됨.
    unsubRef.current = setupStoreSynchronization(buffer, () => {
      instancedNodes.syncFromBuffer(buffer);
    });

    // 5-b) M6-2 Step 1: 디렉토리 스캔 청크 리스너 부착.
    //   setupStoreSynchronization 직후에 mount — 초기 하드코딩 3 노드는 이미 buffer
    //   에 들어가 있고, 이후 도착하는 청크는 그 위에 append-only 로 쌓인다.
    //   listen 자체는 비동기(Promise)지만 backend 에서 청크가 emit 되기 전에 등록만
    //   완료되면 충분하므로 fire-and-forget. cleanup 안전을 위해 unsub 은 ref 보관.
    setupNodeChunkSync(buffer, {
      onAfterChunk: (chunk) => {
        // M6-2 Step 2: 부분 업데이트 적용.
        //   호출 직전의 mesh.count 가 "이전 sync 시 GPU 에 올라간 인스턴스 수" 이므로
        //   그 값을 startIndex 로 넘기면 신규 청크 영역만 setMatrixAt + bufferSubData.
        //   1,000개 청크 × 64bytes(Mat4) ≈ 64KB 만 GPU 에 보냄 (vs 풀 업로드 640KB@10k).
        //   초기 store 동기화는 setupStoreSynchronization 경로라 startIndex=0 (전체) 로 유지됨.
        const startIndex = instancedNodes.getCount();
        const t0 = performance.now();
        instancedNodes.syncFromBuffer(buffer, { startIndex });
        const dt = performance.now() - t0;
        if (import.meta.env.DEV) {
          // chunkId / 신규 노드 수 / 누적 / sync 시간 — 필요시 grep 으로 분석.
          console.log(
            `[chunk #${chunk.chunkId}] +${chunk.nodes.length} → total ${buffer.count} (sync ${dt.toFixed(2)}ms${chunk.isLast ? ", LAST" : ""})`
          );
        }
        // M6-2 Step 3: store.scanProgress 갱신 — 좌상단 카운트 / ScanControl 패널 동시 갱신.
        //   totalScanned 는 "청크로 도착한 누적 노드 수" 로 정의 → 좌상단의 "노드 N개"
        //   표시는 (store.nodes.length + scanProgress.totalScanned) 로 합산해 보여준다.
        useCosmosStore
          .getState()
          .updateScanProgress(chunk.chunkId, chunk.totalScanned, chunk.isLast);
      },
    })
      .then((unsub) => {
        // (fix m6-2) cancelled 플래그가 1차 방어선 — 이 effect 인스턴스의 cleanup
        //   이 이미 호출됐으면 listener 를 즉시 떼어낸다. StrictMode 더블 마운트
        //   레이스에서도 클로저 독립성 덕분에 Mount 1 의 cancelled 는 Mount 1 의
        //   .then 만 차단한다.
        // sceneRef.current === null 가드는 방어적 이중장치로 보존 — 향후 effect
        //   외부에서 dispose 가 일어나는 등 예외 경로에서도 listener 누수 방지.
        if (cancelled || sceneRef.current === null) {
          unsub();
          return;
        }
        chunkUnsubRef.current = unsub;
      })
      .catch((err) => {
        console.error("setupNodeChunkSync 실패:", err);
      });

    // 6) 카메라 팬 컨트롤러 장착 (Step 2 — First Interaction).
    //    이벤트를 canvas DOM(renderer.domElement) 에 바인딩해야 UI 패널 클릭과
    //    충돌하지 않는다. scene.mount 이후여야 renderer 가 DOM 에 붙어 있음.
    // M4 Step 1: onPick 콜백에서 store 의 selectNode 액션을 호출.
    //   CameraController 는 React/Zustand 와 무관하게 "hit 결과 UUID" 만 알면 되고,
    //   store 갱신 책임은 App 계층이 갖는다 (의존성 역전).
    //   useCosmosStore.getState() 로 매번 최신 액션을 조회 — subscribe 로 훅을 쓰면
    //   렌더 루프 밖이라 React 경고가 날 수 있어 getState() 가 안전.
    cameraControllerRef.current = new CameraController(
      scene.getCamera(),
      scene.getRenderer().domElement,
      {
        onPick: (id) => useCosmosStore.getState().selectNode(id),
      }
    );
    // 히트테스트 대상(InstancedMesh) + Buffer Index → UUID 역매핑 주입.
    cameraControllerRef.current.setPickTarget(instancedNodes.getMesh());
    cameraControllerRef.current.setIndexToIdResolver(getIndexToId);

    // M4 Step 2: 선택 하이라이트 메시 구독 연결.
    //  selectedNodeId 변화 시 Scene 의 highlightMesh 가 해당 노드 위치로 이동 + visible 토글.
    //  resolver 는 bridge 의 idToIndex Map 조회로 구현 (O(1)).
    instancedNodes.bindSelectionHighlight(
      scene.getHighlightMesh(),
      buffer,
      (id) => getIdToIndex().get(id)
    );

    // Cleanup: React unmount 시 리소스 해제 (순서 역순)
    return () => {
      // (fix m6-2) Promise pending 인 setupNodeChunkSync 가 있으면 늦게 resolve
      //   되더라도 자기 listener 를 즉시 떼어내도록 신호. chunkUnsubRef 는 아직
      //   null 일 수 있어서 ref 체크만으로는 부족 — 클로저 플래그가 진짜 차단 장치.
      cancelled = true;

      // 가장 먼저 구독 해제 (이후 store 변경이 죽은 참조를 건드리지 않도록)
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
      // M6-2 Step 1: 청크 리스너 unsub. .then 이 늦게 도착하는 케이스는 위 콜백에서
      // sceneRef 가 null 임을 보고 자체적으로 unsub 호출.
      if (chunkUnsubRef.current) {
        chunkUnsubRef.current();
        chunkUnsubRef.current = null;
      }
      // 카메라 컨트롤러 리스너 제거 (Scene.dispose 전이어야 domElement가 아직 살아있음)
      if (cameraControllerRef.current) {
        cameraControllerRef.current.dispose();
        cameraControllerRef.current = null;
      }
      if (sceneRef.current) {
        sceneRef.current.dispose();
        sceneRef.current = null;
      }
      if (instancedNodesRef.current) {
        instancedNodesRef.current.dispose();
        instancedNodesRef.current = null;
      }
      // M6-2 Step 2: Stats DOM 제거 (StrictMode 더블 마운트 시 두 개가 겹쳐 보이는 것 방지).
      if (stats && stats.dom.parentElement) {
        stats.dom.parentElement.removeChild(stats.dom);
      }
      bufferRef.current = null;
    };
  }, []);

  /**
   * handleStartScan — 정식 스캔 트리거 진입점 (M6-2 Step 3).
   *
   * ScanControl 의 "스캔 시작" 버튼과 Ctrl+S 단축키 두 경로가 공유한다.
   *
   * 호출 순서 (β 옵션 — 새 스캔 시 청크 노드만 리셋, 데모 노드 보존):
   *   1) clearChunkedNodes(buffer): bridge boundary 이후 매핑/buffer 절단.
   *   2) instancedNodes.syncFromBuffer(buffer): mesh.count 즉시 축소 — 잔존 청크 노드 사라짐.
   *      (전체 재업로드라 startIndex 미지정. count 가 작으니 비용 무시 가능.)
   *   3) store.startScan(): isScanning=true, totalScanned=0 — UI 동기화.
   *   4) commands.startDirectoryScan(): Rust 백그라운드 task 시작. ack 즉시 반환.
   *      이후 청크가 도착하면 setupNodeChunkSync 의 onAfterChunk 가 progress + mesh 갱신.
   *
   * useCallback 으로 안정화: ScanControl 이 이 함수를 prop 으로 받으므로 매 리렌더마다
   * 새 함수가 만들어져 React 가 컴포넌트를 불필요하게 다시 렌더하는 것을 막는다.
   */
  const handleStartScan = useCallback((path: string, maxDepth: number) => {
    if (bufferRef.current && instancedNodesRef.current) {
      const removed = clearChunkedNodes(bufferRef.current);
      // count 가 줄어들면 mesh.count 도 줄여야 잔존 인스턴스가 안 그려진다.
      // 부분 업데이트 옵션 없이 호출 → 전체 재업로드 (count 가 작아 부담 X).
      instancedNodesRef.current.syncFromBuffer(bufferRef.current);
      if (import.meta.env.DEV && removed > 0) {
        console.log(`[scan] 이전 청크 노드 ${removed}개 제거`);
      }
    }
    useCosmosStore.getState().startScan();

    if (import.meta.env.DEV) {
      console.log(`[scan] start: ${path} (depth ${maxDepth})`);
    }
    const t0 = performance.now();
    commands
      .startDirectoryScan(path, maxDepth)
      .then(() => {
        if (import.meta.env.DEV) {
          console.log(
            `[scan] ack ${(performance.now() - t0).toFixed(2)}ms (chunks 시작됨)`
          );
        }
      })
      .catch((err) => {
        console.error("[scan] startDirectoryScan 실패:", err);
        // 실패 시 진행 상태 정리 (isScanning=false 유지).
        useCosmosStore.getState().resetScanProgress();
      });
  }, []);

  /**
   * Ctrl+S 단축키 — 정식 UI 와 동일한 handleStartScan 호출 (dev only).
   *
   *  - 경로는 환경변수 VITE_SCAN_TARGET 우선, 없으면 Windows 사용자 홈 근사값.
   *  - 입력 필드 포커스 중에도 동작하도록 capture 단계가 아닌 평범한 listener 사용.
   *  - Production 빌드에서는 import.meta.env.DEV === false 라 listener 자체를 등록 안 함.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const handler = (e: KeyboardEvent) => {
      // Ctrl+S (Windows/Linux) 또는 Meta+S (mac). 브라우저 기본 동작(저장 다이얼로그) 차단.
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== "s") return;
      e.preventDefault();

      const target =
        (import.meta.env.VITE_SCAN_TARGET as string | undefined) ??
        "C:\\Users\\User\\Documents";
      handleStartScan(target, 5);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleStartScan]);

  /**
   * M5: 선택 → 메타데이터 IPC 동기화 useEffect.
   *
   * Scene/Buffer 라이프사이클과 무관하므로 별도 useEffect로 분리.
   *  - mount 시 setupNodeDetailsSync 1회 호출 (내부에서 초기 상태 동기화 + subscribe).
   *  - unmount 시 반환된 unsub 호출 (StrictMode 더블 마운트 안전).
   */
  useEffect(() => {
    const unsub = setupNodeDetailsSync();
    return () => {
      unsub();
    };
  }, []);

  return (
    <div className="app-root">
      {/* three.js canvas가 이 div 안에 마운트됨 */}
      <div className="canvas-container" ref={containerRef} />

      {/* UI 셸 — 노드 개수 표시.
          M6-2 Step 3: store.nodes (하드코딩 3개) + scanProgress.totalScanned (청크 누적) 합산.
          buffer.count 와 일치하는 단일 출처 — buffer 는 React 비의존이라 직접 미러링 X. */}
      <div className="ui-panel">
        <p>Cosmos Desktop — M6 First Grounding</p>
        <p>
          노드 {nodes.length + scanProgress.totalScanned}개 | 선택:{" "}
          {selectedNodeId ? selectedNodeId.slice(0, 8) : "없음"}
        </p>
      </div>

      {/* M5: 우측 상단 — 선택된 노드 메타데이터 (details === null 이면 자동 숨김) */}
      <NodeDetailsPanel details={selectedNodeDetails} />

      {/* M6-2 Step 3: 좌측 하단 — 정식 스캔 트리거 패널 */}
      <ScanControl onStartScan={handleStartScan} />
    </div>
  );
}

export default App;
