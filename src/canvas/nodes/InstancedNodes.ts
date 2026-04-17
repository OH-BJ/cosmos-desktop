import * as THREE from "three";
import { NodeBuffer } from "../../state/nodeBuffer";

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
   * 성능: 노드 N개에 대해 O(N) 행렬 쓰기. M2(3~5개)에서는 무시할 수준.
   * M3에서 1k+ 전환 시 diff 기반 부분 업데이트로 교체 예정.
   *
   * @param buffer 동기화 소스 (bridge가 먼저 갱신해야 함)
   */
  syncFromBuffer(buffer: NodeBuffer): void {
    // capacity 보호: NodeBuffer가 우리 InstancedMesh 용량을 넘으면 초과분은 버림.
    // (M2에서는 양쪽 capacity를 맞춰 호출하므로 실제로는 발생하지 않음)
    const renderCount = Math.min(buffer.count, this.capacity);

    // Matrix4 한 개를 재사용해 GC 부담 최소화.
    // setMatrixAt은 내부적으로 행렬을 복사하므로 매 인덱스마다 새 객체 불필요.
    const matrix = new THREE.Matrix4();

    for (let i = 0; i < renderCount; i++) {
      const base = i * 3; // stride 3
      const x = buffer.positions[base];
      const y = buffer.positions[base + 1];
      const z = buffer.positions[base + 2];

      matrix.makeTranslation(x, y, z);
      this.mesh.setMatrixAt(i, matrix);
    }

    // three.js에 "인스턴스 행렬이 바뀌었다"고 알림 → 다음 render에서 GPU 버퍼 업로드
    this.mesh.instanceMatrix.needsUpdate = true;

    // 실제로 그릴 인스턴스 수 (GPU 드로우콜이 이만큼 순회).
    // capacity가 아니라 renderCount로 설정해야 뒤에 남은 stale 데이터가 안 그려짐.
    this.mesh.count = renderCount;
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
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
