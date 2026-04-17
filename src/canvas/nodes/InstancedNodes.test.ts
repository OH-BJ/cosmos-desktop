import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { InstancedNodes } from "./InstancedNodes";
import { allocateNodeBuffer, pushNode } from "../../state/nodeBuffer";

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
});
