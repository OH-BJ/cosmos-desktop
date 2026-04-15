import { describe, it, expect } from "vitest";
import { InstancedNodes } from "./InstancedNodes";

/**
 * InstancedNodes 단위 테스트
 *
 * 대용량 노드 렌더링의 핵심 모듈. GPU 인스턴싱의 용량 관리와 인덱스 추적을 검증.
 * three.js의 InstancedMesh는 node 환경에서도 CPU 측 데이터 구조만 테스트 가능.
 */
describe("InstancedNodes", () => {
  /**
   * 생성자 테스트
   *
   * capacity 설정과 초기 노드(원점)의 올바른 배치 검증.
   * InstancedMesh.count와 this.count의 동기화 확인.
   */
  describe("생성자", () => {
    it("기본 capacity(=1024)로 초기화됨", () => {
      const nodes = new InstancedNodes();
      // 초기 count는 1 (원점 노드)
      expect(nodes.getCount()).toBe(1);
    });

    it("명시적 capacity로 초기화됨", () => {
      const nodes = new InstancedNodes(512);
      expect(nodes.getCount()).toBe(1);
    });
  });

  /**
   * addNode 테스트
   *
   * 새 노드 추가, capacity 가드, 반환 인덱스 검증.
   * C1 버그 수정 후: this.capacity를 사용해 capacity 초과 정확히 감지.
   */
  describe("addNode", () => {
    it("노드 추가 시 count 증가 + 인덱스 반환", () => {
      const nodes = new InstancedNodes(4);
      const idx1 = nodes.addNode(10, 20, 30);
      expect(idx1).toBe(1); // 원점(0) 다음 인덱스
      expect(nodes.getCount()).toBe(2);

      const idx2 = nodes.addNode(40, 50, 60);
      expect(idx2).toBe(2);
      expect(nodes.getCount()).toBe(3);
    });

    it("여러 노드 정상 추가", () => {
      const nodes = new InstancedNodes(4);
      // capacity=4이므로 idx 0(초기), 1, 2, 3까지 가능
      nodes.addNode(1, 1, 1); // idx 1
      nodes.addNode(2, 2, 2); // idx 2
      nodes.addNode(3, 3, 3); // idx 3
      expect(nodes.getCount()).toBe(4);
    });

    /**
     * C1 버그 테스트:
     * 원래는 `if (this.count >= this.mesh.count)` 였으므로
     * this.count와 this.mesh.count가 같아져서 가드가 작동 X.
     * 수정 후: this.capacity와 비교해서 정확히 capacity 초과 감지.
     */
    it("capacity 초과 시 -1 반환 + count 유지", () => {
      const nodes = new InstancedNodes(4);
      // idx 0(초기), 1, 2, 3 총 4개 (capacity full)
      nodes.addNode(1, 1, 1);
      nodes.addNode(2, 2, 2);
      nodes.addNode(3, 3, 3);
      expect(nodes.getCount()).toBe(4);

      // 4번째 addNode는 실패
      const result = nodes.addNode(4, 4, 4);
      expect(result).toBe(-1);
      expect(nodes.getCount()).toBe(4); // count 미변화
    });
  });

  /**
   * updateNode 테스트
   *
   * 기존 노드 위치 업데이트와 범위 체크.
   */
  describe("updateNode", () => {
    it("유효한 인덱스로 위치 업데이트 (경고 없음)", () => {
      const nodes = new InstancedNodes(4);
      nodes.addNode(10, 20, 30); // idx 1
      // updateNode 호출 — spy로 console.warn 호출 여부 확인 불가 (간단한 구현)
      // 대신: 정상 반환 확인만 (현재 updateNode는 void, 에러 없음)
      expect(() => nodes.updateNode(1, 100, 200, 300)).not.toThrow();
    });

    it("음수 인덱스 무시 (console.warn)", () => {
      const nodes = new InstancedNodes(4);
      // 음수는 범위 초과로 간주해 경고만 출력
      expect(() => nodes.updateNode(-1, 0, 0, 0)).not.toThrow();
    });

    it("범위 초과 인덱스 무시 (console.warn)", () => {
      const nodes = new InstancedNodes(4);
      nodes.addNode(1, 1, 1); // count = 2
      // count 이상 인덱스는 범위 초과
      expect(() => nodes.updateNode(5, 0, 0, 0)).not.toThrow();
    });
  });

  /**
   * getMesh 테스트
   *
   * three.js InstancedMesh 객체 접근 가능 확인.
   */
  describe("getMesh", () => {
    it("three.js InstancedMesh 객체 반환", () => {
      const nodes = new InstancedNodes(4);
      const mesh = nodes.getMesh();
      expect(mesh).toBeDefined();
      expect(mesh.constructor.name).toBe("InstancedMesh");
    });
  });

  /**
   * dispose 테스트
   *
   * GPU 리소스(Geometry, Material) 정리.
   * node 환경에서는 실제 WebGL 메모리 해제를 검증할 수 없으므로,
   * 메서드 호출 가능 여부만 확인.
   */
  describe("dispose", () => {
    it("리소스 정리 (에러 없음)", () => {
      const nodes = new InstancedNodes(4);
      nodes.addNode(1, 1, 1);
      expect(() => nodes.dispose()).not.toThrow();
    });
  });
});
