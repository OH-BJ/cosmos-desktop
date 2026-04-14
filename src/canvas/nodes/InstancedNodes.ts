import * as THREE from "three";

/**
 * InstancedNodes — 대용량 노드 렌더링 최적화 모듈
 *
 * 개별 THREE.Mesh 대신 THREE.InstancedMesh를 사용해 수만 개 노드를 GPU에서 한 번에 렌더.
 * 드로우콜 1회로 모든 노드를 그리므로, CPU-GPU 통신 오버헤드 제거.
 *
 * M1(초기): 노드 1개로 테스트. 이미 InstancedMesh 패턴 적용해
 * M2+ 확장 시 capacity만 키우면 됨. 아키텍처 재작성 불필요.
 * 성능: 이 구조로 100k 노드 @ 60fps 달성 가능 (LOD + 컬링 병행).
 */
export class InstancedNodes {
  private mesh: THREE.InstancedMesh;
  private count: number = 0; // 현재 활성 노드 개수

  constructor(capacity: number = 1024) {
    // three.js InstancedMesh 개념:
    // 동일한 Geometry와 Material을 여러 번 그리되, 위치/회전/스케일만 다름.
    // 이를 GPU 인스턴싱으로 처리하면 드로우콜 1회 → N개 노드 렌더링.

    // Geometry: 기본 작은 구형 (반지름 5)
    // 이 기하형을 InstancedMesh가 capacity번 복제해서 그림
    const geometry = new THREE.SphereGeometry(5, 16, 16);

    // Material: 기본 흰색 반사 재질
    // 나중에 MSDF 텍스트나 아이콘이 추가될 때 이를 ShaderMaterial로 교체
    const material = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      emissive: 0x333333,
    });

    // InstancedMesh(geometry, material, capacity)
    // capacity: 최대 몇 개까지 인스턴싱할지 (동적 확장은 나중)
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);

    // 초기 노드 1개를 원점 (0, 0, 0)에 배치
    const matrix = new THREE.Matrix4();
    matrix.setPosition(0, 0, 0); // x=0, y=0, z=0
    this.mesh.setMatrixAt(0, matrix);
    this.count = 1;

    // 인스턴스 데이터 변경 후 이 플래그를 true로 설정해야
    // three.js가 GPU 버퍼 업데이트를 알 수 있음
    this.mesh.instanceMatrix.needsUpdate = true;

    // 초기 숨김/보임 상태
    // 나중에 frustum culling으로 뷰포트 밖 노드는 false로 설정
    this.mesh.count = this.count;
  }

  /**
   * addNode() — 새 노드 인스턴스 추가
   *
   * @param x 월드 좌표 x
   * @param y 월드 좌표 y
   * @param z 월드 좌표 z
   * @returns 할당된 인스턴스 인덱스 (나중에 updateNode에서 사용)
   */
  addNode(x: number, y: number, z: number): number {
    if (this.count >= this.mesh.count) {
      console.warn("InstancedMesh capacity exceeded. Need to grow buffer.");
      return -1; // 오버플로우 (M2에서 동적 확장 구현)
    }

    const matrix = new THREE.Matrix4();
    matrix.setPosition(x, y, z);
    const idx = this.count;
    this.mesh.setMatrixAt(idx, matrix);
    this.count++;

    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = this.count;

    return idx;
  }

  /**
   * updateNode() — 기존 노드 위치 업데이트
   *
   * @param index addNode()에서 반환받은 인덱스
   * @param x 새 x 좌표
   * @param y 새 y 좌표
   * @param z 새 z 좌표
   */
  updateNode(index: number, x: number, y: number, z: number): void {
    if (index < 0 || index >= this.count) {
      console.warn(`Invalid node index: ${index}`);
      return;
    }

    const matrix = new THREE.Matrix4();
    matrix.setPosition(x, y, z);
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
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
   * getCount() — 현재 활성 노드 개수 반환
   */
  getCount(): number {
    return this.count;
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
