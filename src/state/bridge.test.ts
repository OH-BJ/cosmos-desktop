import { describe, it, expect } from "vitest";
import { syncFromStore, getIdToIndex, getIndexToId } from "./bridge";
import { allocateNodeBuffer, getNodePosition } from "./nodeBuffer";
import { Node } from "./store";

/**
 * bridge 단위 테스트
 *
 * syncFromStore의 UUID v7 → Buffer Index 매핑 검증.
 * Zustand subscribe 연동(setupStoreSynchronization)은
 * React 환경 필요하므로 여기서는 syncFromStore만 직접 테스트.
 */

/** 테스트용 노드 생성 헬퍼 */
function makeNode(id: string, x: number, y: number, z: number): Node {
  return { id, path: `/test/${id}`, x, y, z };
}

describe("syncFromStore", () => {
  it("노드 3개 동기화 → 매핑 테이블 + TypedArray 일관성", () => {
    const buffer = allocateNodeBuffer(8);
    const nodes: Node[] = [
      makeNode("aaa-001", 1, 2, 3),
      makeNode("bbb-002", 4, 5, 6),
      makeNode("ccc-003", 7, 8, 9),
    ];

    syncFromStore(nodes, buffer);

    // 버퍼 상태 검증
    expect(buffer.count).toBe(3);
    expect(getNodePosition(buffer, 0)).toEqual([1, 2, 3]);
    expect(getNodePosition(buffer, 1)).toEqual([4, 5, 6]);
    expect(getNodePosition(buffer, 2)).toEqual([7, 8, 9]);

    // 매핑 테이블 검증
    const idMap = getIdToIndex();
    expect(idMap.get("aaa-001")).toBe(0);
    expect(idMap.get("bbb-002")).toBe(1);
    expect(idMap.get("ccc-003")).toBe(2);

    const idArr = getIndexToId();
    expect(idArr[0]).toBe("aaa-001");
    expect(idArr[1]).toBe("bbb-002");
    expect(idArr[2]).toBe("ccc-003");
  });

  it("빈 배열 동기화 → 버퍼 + 매핑 모두 초기화", () => {
    const buffer = allocateNodeBuffer(8);

    // 먼저 노드를 넣고
    syncFromStore([makeNode("x", 1, 1, 1)], buffer);
    expect(buffer.count).toBe(1);

    // 빈 배열로 동기화
    syncFromStore([], buffer);
    expect(buffer.count).toBe(0);
    expect(getIdToIndex().size).toBe(0);
    expect(getIndexToId().length).toBe(0);
  });

  it("중복 ID → 경고 후 건너뜀, 나머지 정상 처리", () => {
    const buffer = allocateNodeBuffer(8);
    const nodes: Node[] = [
      makeNode("dup-id", 1, 2, 3),
      makeNode("dup-id", 4, 5, 6), // 중복
      makeNode("unique", 7, 8, 9),
    ];

    syncFromStore(nodes, buffer);

    // 중복은 건너뛰므로 2개만 등록
    expect(buffer.count).toBe(2);
    expect(getIdToIndex().size).toBe(2);
    expect(getIdToIndex().get("dup-id")).toBe(0);
    expect(getIdToIndex().get("unique")).toBe(1);
  });

  it("capacity 초과 → 에러 로그, 동기화 중단", () => {
    const buffer = allocateNodeBuffer(1);
    const nodes: Node[] = [
      makeNode("a", 1, 1, 1),
      makeNode("b", 2, 2, 2),
    ];

    // capacity=1인데 노드 2개 → 동기화 거부
    syncFromStore(nodes, buffer);
    expect(buffer.count).toBe(0); // 아무것도 쓰이지 않음
  });
});
