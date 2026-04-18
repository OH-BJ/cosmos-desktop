import { useEffect, useRef } from "react";
import { Scene } from "../canvas/Scene";
import { InstancedNodes } from "../canvas/nodes/InstancedNodes";
import { CameraController } from "../canvas/CameraController";
import { useCosmosStore } from "../state/store";
import { allocateNodeBuffer, NodeBuffer } from "../state/nodeBuffer";
import { setupStoreSynchronization } from "../state/bridge";
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

  // Zustand에서 노드 목록 + 선택 상태 구독 (UI 패널용).
  // 렌더링은 three.js가 담당 (이 훅은 React 리렌더 트리거만).
  const nodes = useCosmosStore((state) => state.nodes);
  const selectedNodeId = useCosmosStore((state) => state.selectedNodeId);

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

    // 1) Scene
    const scene = new Scene();
    sceneRef.current = scene;

    // 2) NodeBuffer — store와 InstancedMesh가 공유할 고빈도 버퍼
    const buffer = allocateNodeBuffer(1024);
    bufferRef.current = buffer;

    // 3) InstancedNodes — 빈 상태로 시작. bridge가 곧 채워 넣음.
    //    capacity를 buffer와 동일하게 맞춰야 syncFromBuffer에서 truncation이 없음.
    const instancedNodes = new InstancedNodes(buffer.capacity);
    instancedNodesRef.current = instancedNodes;
    scene.getScene().add(instancedNodes.getMesh());

    // 4) DOM 마운트 + 렌더 루프 시작
    scene.mount(containerRef.current);

    // 렌더 콜백: OrbitControls damping 은 매 프레임 update() 호출 필수.
    // instanceMatrix는 bridge 동기화 시에만 needsUpdate=true가 되므로 여기서 안 건드림.
    scene.setRenderCallback(() => {
      cameraControllerRef.current?.update();
    });

    // 5) 단방향 동기화 배선.
    //    setupStoreSynchronization 내부에서 초기 동기화가 즉시 실행됨 →
    //    하드코딩 3개 노드의 (x,y,z)가 buffer에 쓰이고, onAfterSync로
    //    instancedNodes.syncFromBuffer가 호출되어 InstancedMesh가 갱신됨.
    unsubRef.current = setupStoreSynchronization(buffer, () => {
      instancedNodes.syncFromBuffer(buffer);
    });

    // 6) 카메라 팬 컨트롤러 장착 (Step 2 — First Interaction).
    //    이벤트를 canvas DOM(renderer.domElement) 에 바인딩해야 UI 패널 클릭과
    //    충돌하지 않는다. scene.mount 이후여야 renderer 가 DOM 에 붙어 있음.
    cameraControllerRef.current = new CameraController(
      scene.getCamera(),
      scene.getRenderer().domElement
    );

    // Cleanup: React unmount 시 리소스 해제 (순서 역순)
    return () => {
      // 가장 먼저 구독 해제 (이후 store 변경이 죽은 참조를 건드리지 않도록)
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
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
      bufferRef.current = null;
    };
  }, []);

  /**
   * 선택 상태 변화 로그 (M2+ 하이라이트에서 실제 사용 예정)
   */
  useEffect(() => {
    if (selectedNodeId) {
      console.log(`[App] Selected node: ${selectedNodeId}`);
    }
  }, [selectedNodeId]);

  return (
    <div className="app-root">
      {/* three.js canvas가 이 div 안에 마운트됨 */}
      <div className="canvas-container" ref={containerRef} />

      {/* UI 셸 — 노드 개수 표시 */}
      <div className="ui-panel">
        <p>Cosmos Desktop — M2 다중 노드 렌더</p>
        <p>
          노드 {nodes.length}개 | 선택: {selectedNodeId || "없음"}
        </p>
      </div>
    </div>
  );
}

export default App;
