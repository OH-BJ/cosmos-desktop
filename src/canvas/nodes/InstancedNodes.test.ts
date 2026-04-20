import { describe, it, expect, afterEach } from "vitest";
import * as THREE from "three";
import { InstancedNodes } from "./InstancedNodes";
import { allocateNodeBuffer, pushNode } from "../../state/nodeBuffer";
import { useCosmosStore } from "../../state/store";

/**
 * InstancedNodes 단위 테스트 (M2 재작성)
 *
 * bridge 단방향 데이터 흐름 전환 후 API:
 *   - 생성자는 빈 상태 (count=0)
 *   - syncFromBuffer(NodeBuffer)가 유일한 쓰기 경로
 *   - getMesh/getCount/getCapacity/dispose
 *
 * three.js InstancedMesh는 node 환경에서도 CPU 측 Matrix4 배열을 읽을 수 있으므로
 * 실제 GPU 없이 instanceMatrix 내용 검증이 가능하다.
 */
describe("InstancedNodes", () => {
  describe("생성자", () => {
    it("기본 capacity=1024로 빈 상태 초기화 (count=0)", () => {
      const nodes = new InstancedNodes();
      expect(nodes.getCount()).toBe(0);
      expect(nodes.getCapacity()).toBe(1024);
    });

    it("명시적 capacity로 빈 상태 초기화", () => {
      const nodes = new InstancedNodes(512);
      expect(nodes.getCount()).toBe(0);
      expect(nodes.getCapacity()).toBe(512);
    });
  });

  describe("syncFromBuffer", () => {
    it("버퍼의 노드 좌표를 instanceMatrix로 복사하고 count 갱신", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 10, 20, 30);
      pushNode(buffer, -5, 0, 7);

      nodes.syncFromBuffer(buffer);

      expect(nodes.getCount()).toBe(2);

      // instanceMatrix에서 각 인스턴스의 translation 좌표를 꺼내 검증
      const mesh = nodes.getMesh();
      const m0 = new THREE.Matrix4();
      mesh.getMatrixAt(0, m0);
      const p0 = new THREE.Vector3().setFromMatrixPosition(m0);
      expect(p0.x).toBeCloseTo(10);
      expect(p0.y).toBeCloseTo(20);
      expect(p0.z).toBeCloseTo(30);

      const m1 = new THREE.Matrix4();
      mesh.getMatrixAt(1, m1);
      const p1 = new THREE.Vector3().setFromMatrixPosition(m1);
      expect(p1.x).toBeCloseTo(-5);
      expect(p1.y).toBeCloseTo(0);
      expect(p1.z).toBeCloseTo(7);
    });

    it("빈 버퍼 동기화 시 count=0", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);

      nodes.syncFromBuffer(buffer);

      expect(nodes.getCount()).toBe(0);
    });

    it("재동기화 시 count가 덮어쓰기됨 (노드 감소 반영)", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 1, 1, 1);
      pushNode(buffer, 2, 2, 2);
      pushNode(buffer, 3, 3, 3);

      nodes.syncFromBuffer(buffer);
      expect(nodes.getCount()).toBe(3);

      // 버퍼 리셋 후 한 개만 재삽입 → count가 1로 줄어야 함
      buffer.count = 0;
      pushNode(buffer, 99, 99, 99);
      nodes.syncFromBuffer(buffer);
      expect(nodes.getCount()).toBe(1);
    });

    it("버퍼가 capacity를 초과하면 capacity만큼만 렌더", () => {
      const nodes = new InstancedNodes(2);
      // InstancedMesh capacity=2. 버퍼에 3개를 채워도 2개까지만 그려야 함.
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 1, 1, 1);
      pushNode(buffer, 2, 2, 2);
      pushNode(buffer, 3, 3, 3);

      nodes.syncFromBuffer(buffer);

      expect(nodes.getCount()).toBe(2);
    });
  });

  describe("getMesh", () => {
    it("three.js InstancedMesh 객체 반환", () => {
      const nodes = new InstancedNodes(4);
      const mesh = nodes.getMesh();
      expect(mesh).toBeDefined();
      expect(mesh.constructor.name).toBe("InstancedMesh");
    });
  });

  describe("dispose", () => {
    it("리소스 정리 (에러 없음)", () => {
      const nodes = new InstancedNodes(4);
      expect(() => nodes.dispose()).not.toThrow();
    });
  });

  /**
   * M4 Step 2: bindSelectionHighlight 테스트.
   *
   * 검증 포인트:
   *  - selectedNodeId=유효 id → highlightMesh.visible=true + position 일치
   *  - selectedNodeId=null → visible=false
   *  - 연속해서 다른 id 선택 → position 갱신
   *  - dispose 이후에는 store 변경이 highlightMesh 를 건드리지 않음 (unsub)
   *
   * store 는 모듈 스코프 전역이라 테스트 사이 격리를 위해 afterEach 에서 null 로 리셋.
   */
  describe("bindSelectionHighlight", () => {
    afterEach(() => {
      useCosmosStore.getState().selectNode(null);
    });

    /**
     * 테스트용 헬퍼: 버퍼 3개 노드 + InstancedNodes + highlightMesh + resolver 한 번에 준비.
     * id 는 bridge 실제 매핑과 무관하게 Map 으로 주입 (bridge 모킹 없이 단위 격리).
     */
    const setup = () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 10, 20, 30); // idx 0
      pushNode(buffer, -5, 0, 7); // idx 1
      pushNode(buffer, 100, -50, 0); // idx 2
      nodes.syncFromBuffer(buffer);

      const idToIndex = new Map<string, number>([
        ["id-a", 0],
        ["id-b", 1],
        ["id-c", 2],
      ]);
      const resolver = (id: string) => idToIndex.get(id);

      // highlightMesh 는 Scene 없이도 THREE.Mesh 단독으로 생성 가능.
      const highlightMesh = new THREE.Mesh(
        new THREE.SphereGeometry(6.5, 8, 8),
        new THREE.MeshBasicMaterial({ wireframe: true })
      );
      highlightMesh.visible = false;

      return { nodes, buffer, highlightMesh, resolver };
    };

    it("선택 시 visible=true + position 이 해당 노드 좌표와 일치", () => {
      const { nodes, buffer, highlightMesh, resolver } = setup();
      nodes.bindSelectionHighlight(highlightMesh, buffer, resolver);

      useCosmosStore.getState().selectNode("id-a");

      expect(highlightMesh.visible).toBe(true);
      expect(highlightMesh.position.x).toBeCloseTo(10);
      expect(highlightMesh.position.y).toBeCloseTo(20);
      expect(highlightMesh.position.z).toBeCloseTo(30);

      nodes.dispose();
    });

    it("선택 해제(null) 시 visible=false", () => {
      const { nodes, buffer, highlightMesh, resolver } = setup();
      nodes.bindSelectionHighlight(highlightMesh, buffer, resolver);

      useCosmosStore.getState().selectNode("id-b");
      expect(highlightMesh.visible).toBe(true);

      useCosmosStore.getState().selectNode(null);
      expect(highlightMesh.visible).toBe(false);

      nodes.dispose();
    });

    it("연속해서 다른 노드 선택 시 position 이 갱신됨", () => {
      const { nodes, buffer, highlightMesh, resolver } = setup();
      nodes.bindSelectionHighlight(highlightMesh, buffer, resolver);

      useCosmosStore.getState().selectNode("id-a");
      expect(highlightMesh.position.x).toBeCloseTo(10);

      useCosmosStore.getState().selectNode("id-c");
      expect(highlightMesh.position.x).toBeCloseTo(100);
      expect(highlightMesh.position.y).toBeCloseTo(-50);
      expect(highlightMesh.position.z).toBeCloseTo(0);
      expect(highlightMesh.visible).toBe(true);

      nodes.dispose();
    });

    it("dispose 이후에는 store 변경이 highlightMesh 를 건드리지 않음 (unsub 누수 방지)", () => {
      const { nodes, buffer, highlightMesh, resolver } = setup();
      nodes.bindSelectionHighlight(highlightMesh, buffer, resolver);

      useCosmosStore.getState().selectNode("id-a");
      const before = highlightMesh.position.clone();

      nodes.dispose();

      // dispose 후 다른 노드 선택해도 과거 메시 position 은 바뀌면 안 됨.
      useCosmosStore.getState().selectNode("id-c");
      expect(highlightMesh.position.x).toBeCloseTo(before.x);
      expect(highlightMesh.position.y).toBeCloseTo(before.y);
      expect(highlightMesh.position.z).toBeCloseTo(before.z);
    });
  });
});
