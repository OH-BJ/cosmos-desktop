import { describe, it, expect } from "vitest";
import {
  syncFromStore,
  getIdToIndex,
  getIndexToId,
  appendChunkedNode,
  clearChunkedNodes,
  getStoreNodesBoundary,
} from "./bridge";
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

  it("syncFromStore 후 storeNodesBoundary 가 store 노드 수와 일치", () => {
    const buffer = allocateNodeBuffer(8);
    syncFromStore(
      [makeNode("a", 1, 1, 1), makeNode("b", 2, 2, 2)],
      buffer
    );
    // boundary = 등록된 store 노드 수 (중복/거부 후 실제 length).
    expect(getStoreNodesBoundary()).toBe(2);
  });
});

/**
 * M6-2 Step 3: clearChunkedNodes 테스트.
 *
 * 검증 포인트:
 *  - store 영역(boundary 이전)은 그대로 보존, 청크 영역만 제거.
 *  - 매핑(idToIndex/indexToId) 도 함께 제거 — 좀비 매핑 X.
 *  - buffer.count 가 boundary 로 축소.
 *  - 제거 후 다시 appendChunkedNode 가 정상 작동 (인덱스 boundary 부터 재시작).
 *  - 청크가 없는 상태에서 호출해도 안전 (no-op, 0 반환).
 */
describe("clearChunkedNodes (β: 청크만 리셋)", () => {
  it("store 영역 보존 + 청크 영역 제거", () => {
    const buffer = allocateNodeBuffer(16);
    syncFromStore(
      [makeNode("s1", 10, 10, 10), makeNode("s2", 20, 20, 20)],
      buffer
    );
    appendChunkedNode(buffer, "c1", 1, 2, 3);
    appendChunkedNode(buffer, "c2", 4, 5, 6);
    appendChunkedNode(buffer, "c3", 7, 8, 9);

    expect(buffer.count).toBe(5);

    const removed = clearChunkedNodes(buffer);
    expect(removed).toBe(3);
    expect(buffer.count).toBe(2);
    // store 영역 매핑 살아있음
    expect(getIdToIndex().get("s1")).toBe(0);
    expect(getIdToIndex().get("s2")).toBe(1);
    // 청크 영역 매핑 사라짐 (좀비 X)
    expect(getIdToIndex().has("c1")).toBe(false);
    expect(getIdToIndex().has("c3")).toBe(false);
    expect(getIndexToId()).toEqual(["s1", "s2"]);
    // store 좌표는 보존
    expect(getNodePosition(buffer, 0)).toEqual([10, 10, 10]);
  });

  it("clear 후 재append → boundary 부터 새로 쌓임", () => {
    const buffer = allocateNodeBuffer(16);
    syncFromStore([makeNode("s1", 0, 0, 0)], buffer);
    appendChunkedNode(buffer, "c1", 1, 1, 1);

    clearChunkedNodes(buffer);
    const idx = appendChunkedNode(buffer, "c2", 2, 2, 2);

    // 새 청크는 boundary(=1) 인덱스부터 재시작.
    expect(idx).toBe(1);
    expect(buffer.count).toBe(2);
    expect(getIdToIndex().get("c2")).toBe(1);
  });

  it("청크 없이 호출 → no-op (0 반환)", () => {
    const buffer = allocateNodeBuffer(8);
    syncFromStore([makeNode("s1", 0, 0, 0)], buffer);
    expect(clearChunkedNodes(buffer)).toBe(0);
    expect(buffer.count).toBe(1);
  });

  it("두 번 연속 clearChunkedNodes → 두 번째는 no-op", () => {
    const buffer = allocateNodeBuffer(16);
    syncFromStore([makeNode("s1", 0, 0, 0)], buffer);
    appendChunkedNode(buffer, "c1", 1, 1, 1);

    expect(clearChunkedNodes(buffer)).toBe(1);
    expect(clearChunkedNodes(buffer)).toBe(0);
    expect(buffer.count).toBe(1);
  });
});
