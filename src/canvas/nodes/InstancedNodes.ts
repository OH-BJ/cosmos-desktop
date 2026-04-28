import * as THREE from "three";
import { NodeBuffer } from "../../state/nodeBuffer";
import { useCosmosStore } from "../../state/store";

/**
 * InstancedNodes — 대용량 노드 렌더링 모듈 (M2: bridge 연동 버전)
 *
 * 개별 THREE.Mesh 대신 THREE.InstancedMesh를 사용해 수만 개 노드를 GPU에서 한 번에 렌더.
 * 드로우콜 1회로 모든 노드를 그리므로, CPU-GPU 통신 오버헤드 제거.
 *
 * M2 전환점 — bridge의 단방향 데이터 흐름:
 *   Zustand store → bridge.syncFromStore → NodeBuffer (Float32Array)
 *                                            ↓
 *   InstancedNodes.syncFromBuffer → InstancedMesh.instanceMatrix
 *
 * 이 클래스는 NodeBuffer의 positions 배열을 **읽기 전용**으로 소비한다.
 * 직접 addNode/updateNode 같은 쓰기 API는 제공하지 않는다. (단일 진입점 원칙)
 *
 * 성능 설계: instanceMatrix.needsUpdate는 syncFromBuffer 호출 시에만 true가 되며,
 * 매 프레임 갱신하지 않는다. 노드 좌표가 바뀔 때만 GPU로 업로드.
 */
export class InstancedNodes {
  private mesh: THREE.InstancedMesh;
  private capacity: number; // 최대 인스턴스 수 (생성자에서 고정)

  // M4 Step 2: 선택 하이라이트 구독 해제 함수 (bindSelectionHighlight 가 반환).
  private highlightUnsub: (() => void) | null = null;

  constructor(capacity: number = 1024) {
    // three.js InstancedMesh 개념:
    // 동일한 Geometry와 Material을 여러 번 그리되, 위치/회전/스케일만 다름.
    // 이를 GPU 인스턴싱으로 처리하면 드로우콜 1회 → N개 노드 렌더링.

    // Geometry: 기본 작은 구형 (반지름 5)
    const geometry = new THREE.SphereGeometry(5, 16, 16);

    // Material: 기본 흰색 반사 재질
    // 나중에 MSDF 텍스트나 아이콘이 추가될 때 ShaderMaterial로 교체
    const material = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      emissive: 0x333333,
    });

    // InstancedMesh(geometry, material, capacity)
    // capacity: 최대 몇 개까지 인스턴싱할지 (동적 확장은 M3+)
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.capacity = capacity;

    // 초기 상태: count = 0 (렌더할 인스턴스 없음).
    // bridge가 syncFromBuffer로 실제 노드를 채워 넣을 때까지 아무것도 안 그림.
    // M1에서는 여기서 원점 노드를 기본 1개 넣었으나, M2부터는 bridge가 유일한 쓰기 경로.
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * syncFromBuffer() — NodeBuffer의 TypedArray를 InstancedMesh로 복사
   *
   * bridge.syncFromStore가 NodeBuffer를 갱신한 직후 호출되는 단일 진입점.
   * Float32Array의 (x, y, z) 3-stride 좌표를 Matrix4로 읽어 setMatrixAt에 반영한다.
   *
   * 성능: 노드 N개에 대해 O(N) 행렬 쓰기.
   *
   * M6-2 Step 2 — 부분 업데이트 (addUpdateRange) 도입:
   *   options.startIndex 를 주면 [startIndex, renderCount) 범위만 setMatrixAt + GPU 업로드.
   *   청크 스트리밍 시 이전까지 동기화된 노드는 GPU 에 그대로 두고 신규 range 만
   *   bufferSubData 로 올린다. three.js r155+ 의
   *   `BufferAttribute.addUpdateRange(start, count)` API 사용.
   *   - start, count 단위는 typed array index (Float32Array 인덱스).
   *     instanceMatrix 는 itemSize=16 (Mat4) 이므로 인스턴스 i 는 [i*16, i*16+16).
   *
   *   기본값(startIndex 미지정): 전체 업로드 — 기존 store 전량 재작성 경로 호환.
   *
   * @param buffer 동기화 소스 (bridge가 먼저 갱신해야 함)
   * @param options.startIndex  부분 업데이트 시작 인덱스 (기본 0 = 전체).
   *   보통 호출 직전의 mesh.count 를 넘긴다 — 그 값이 "이전 sync 까지 GPU 에 올라간
   *   인스턴스 수" 이기 때문.
   */
  syncFromBuffer(
    buffer: NodeBuffer,
    options?: { startIndex?: number }
  ): void {
    // capacity 보호: NodeBuffer가 우리 InstancedMesh 용량을 넘으면 초과분은 버림.
    // (M2에서는 양쪽 capacity를 맞춰 호출하므로 실제로는 발생하지 않음)
    const renderCount = Math.min(buffer.count, this.capacity);
    // startIndex 음수/초과 방어. 0 으로 클램프 → 항상 [0, renderCount] 안.
    const rawStart = options?.startIndex ?? 0;
    const startIndex = Math.max(0, Math.min(rawStart, renderCount));

    // Matrix4 한 개를 재사용해 GC 부담 최소화.
    // setMatrixAt은 내부적으로 행렬을 복사하므로 매 인덱스마다 새 객체 불필요.
    const matrix = new THREE.Matrix4();

    for (let i = startIndex; i < renderCount; i++) {
      const base = i * 3; // stride 3
      const x = buffer.positions[base];
      const y = buffer.positions[base + 1];
      const z = buffer.positions[base + 2];

      matrix.makeTranslation(x, y, z);
      this.mesh.setMatrixAt(i, matrix);
    }

    // M6-2 Step 2: 부분 GPU 업로드 등록.
    //   매 호출마다 updateRanges 를 비운 뒤, partial 인 경우에만 신규 range 만 등록.
    //   비워두면 WebGLAttributes 가 자동 전체 bufferSubData (full upload) 수행.
    //   needsUpdate=true 는 두 경로 공통으로 필요 (디스패치 트리거).
    this.mesh.instanceMatrix.clearUpdateRanges();
    if (startIndex > 0 && renderCount > startIndex) {
      // start, count 는 typed array 인덱스. Mat4 itemSize=16 으로 곱한다.
      this.mesh.instanceMatrix.addUpdateRange(
        startIndex * 16,
        (renderCount - startIndex) * 16
      );
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // 실제로 그릴 인스턴스 수 (GPU 드로우콜이 이만큼 순회).
    // capacity가 아니라 renderCount로 설정해야 뒤에 남은 stale 데이터가 안 그려짐.
    this.mesh.count = renderCount;

    // M4 Step 1 수정: Raycaster 는 InstancedMesh.boundingSphere 로 broad-phase 컬링을 한다.
    //  - 이 sphere 는 모든 인스턴스 위치 + geometry 반지름을 감싼 구.
    //  - 반드시 matrices 를 다 쓰고 count/needsUpdate 를 세팅한 "뒤"에 계산해야 한다.
    //    그러지 않으면 (0,0,0) 주변의 작은 sphere 만 잡혀, 멀리 떨어진 노드 클릭 시
    //    광선이 sphere 를 스치지 못해 intersects 가 항상 0 이 된다 (Gemini 자문).
    //  - 비용은 O(count) 로 매우 작음 → 매 sync 마다 호출해도 무해.
    //  - 부분 업데이트 시에도 신규 노드 위치가 sphere 바깥일 수 있어 항상 재계산.
    this.mesh.computeBoundingSphere();
  }

  /**
   * getMesh() — three.js InstancedMesh 객체 반환
   *
   * Scene에 add하거나, 히트테스트 Raycaster에 전달할 때 사용.
   */
  getMesh(): THREE.InstancedMesh {
    return this.mesh;
  }

  /**
   * bindSelectionHighlight() — store.selectedNodeId 구독 → highlightMesh 이동/토글.
   *
   * M4 Step 2:
   *   InstancedMesh 의 instanceColor/setColorAt 을 건드리지 않고, Scene 의 일반 Mesh
   *   하나를 "선택된 노드 위치로 텔레포트"시키는 방식. GPU 재업로드 없음 → O(1) 비용.
   *
   * 의존성 주입:
   *  - highlightMesh: Scene.getHighlightMesh() 결과물.
   *  - buffer:        노드 좌표가 들어있는 NodeBuffer (bridge 가 동기화한 것).
   *  - resolveIdToIndex: UUID → Buffer Index. 보통 bridge.getIdToIndex().get 을 람다로 감쌈.
   *
   * 구독 방식:
   *  - subscribeWithSelector 미들웨어가 이미 store 에 붙어 있으므로
   *    (state) => state.selectedNodeId 셀렉터로 "변경 시에만" 콜백 호출.
   *  - 생성 직후 현재 상태로 1회 수동 동기화 (초기 null → visible=false 보장).
   *
   * 반환값: unsubscribe 함수. dispose() 에서 호출되어 메모리 누수 방지.
   */
  bindSelectionHighlight(
    highlightMesh: THREE.Mesh,
    buffer: NodeBuffer,
    resolveIdToIndex: (id: string) => number | undefined
  ): () => void {
    const update = (selectedId: string | null): void => {
      if (selectedId === null) {
        highlightMesh.visible = false;
        return;
      }
      const index = resolveIdToIndex(selectedId);
      if (index === undefined || index < 0 || index >= buffer.count) {
        // 알 수 없는 ID (bridge 동기화 이전 race 등) → 보수적으로 숨김.
        highlightMesh.visible = false;
        return;
      }
      const base = index * 3;
      const x = buffer.positions[base];
      const y = buffer.positions[base + 1];
      const z = buffer.positions[base + 2];
      highlightMesh.position.set(x, y, z);
      highlightMesh.visible = true;
    };

    // 초기 동기화 (subscribe 는 "변경 시에만" 콜백 → 현재 상태 맞추려면 1회 수동 호출).
    update(useCosmosStore.getState().selectedNodeId);

    const unsub = useCosmosStore.subscribe(
      (state) => state.selectedNodeId,
      (id) => update(id)
    );
    this.highlightUnsub = unsub;
    return unsub;
  }

  /**
   * getCount() — 현재 렌더 중인 인스턴스 수 반환
   *
   * mesh.count와 동일. 테스트/디버그용.
   */
  getCount(): number {
    return this.mesh.count;
  }

  /**
   * getCapacity() — 최대 인스턴스 수 반환
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * dispose() — GPU 리소스 정리
   *
   * Geometry와 Material의 GPU 메모리 해제.
   */
  dispose(): void {
    // M4 Step 2: 선택 구독 해제 (누수 방지).
    //  store 가 여러 번 re-mount 되는 HMR 상황에서 unsub 을 빼먹으면
    //  과거 InstancedNodes 가 계속 콜백을 받게 됨.
    if (this.highlightUnsub) {
      this.highlightUnsub();
      this.highlightUnsub = null;
    }
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
