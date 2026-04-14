import { describe, it, expect } from "vitest";
import {
  allocateNodeBuffer,
  pushNode,
  getNodePosition,
  setNodePosition,
  growNodeBuffer,
  INITIAL_CAPACITY,
} from "./nodeBuffer";

/**
 * nodeBuffer 단위 테스트
 *
 * 이중 상태 아키텍처의 "고빈도" 레이어 검증.
 * 순수 TypedArray 조작 로직이라 브라우저/three.js 없이 node 환경에서 실행 가능.
 */
describe("allocateNodeBuffer", () => {
  it("기본 capacity(=1024)로 빈 버퍼 생성", () => {
    const buf = allocateNodeBuffer();
    expect(buf.capacity).toBe(INITIAL_CAPACITY);
    expect(buf.count).toBe(0);
    // stride 3 이므로 positions 길이는 capacity * 3
    expect(buf.positions.length).toBe(INITIAL_CAPACITY * 3);
    expect(buf.ids.length).toBe(INITIAL_CAPACITY);
  });

  it("명시적 capacity로 버퍼 생성", () => {
    const buf = allocateNodeBuffer(16);
    expect(buf.capacity).toBe(16);
    expect(buf.positions.length).toBe(48);
    expect(buf.ids.length).toBe(16);
  });
});

describe("pushNode", () => {
  it("노드 1개 추가 시 count 증가 + 좌표/id 저장", () => {
    const buf = allocateNodeBuffer(4);
    pushNode(buf, 1.5, -2.25, 3.0, 42);

    expect(buf.count).toBe(1);
    expect(buf.positions[0]).toBeCloseTo(1.5);
    expect(buf.positions[1]).toBeCloseTo(-2.25);
    expect(buf.positions[2]).toBeCloseTo(3.0);
    expect(buf.ids[0]).toBe(42);
  });

  it("여러 노드 순차 추가 시 stride 3으로 저장", () => {
    const buf = allocateNodeBuffer(4);
    pushNode(buf, 0, 0, 0, 1);
    pushNode(buf, 10, 20, 30, 2);
    pushNode(buf, -1, -2, -3, 3);

    expect(buf.count).toBe(3);
    expect(getNodePosition(buf, 1)).toEqual([10, 20, 30]);
    expect(getNodePosition(buf, 2)).toEqual([-1, -2, -3]);
  });

  it("capacity 초과 시 오버플로우 에러", () => {
    const buf = allocateNodeBuffer(2);
    pushNode(buf, 0, 0, 0, 1);
    pushNode(buf, 0, 0, 0, 2);
    expect(() => pushNode(buf, 0, 0, 0, 3)).toThrow(/overflow/);
  });
});

describe("setNodePosition", () => {
  it("기존 노드의 좌표를 업데이트", () => {
    const buf = allocateNodeBuffer(4);
    pushNode(buf, 1, 2, 3, 100);
    setNodePosition(buf, 0, 9, 8, 7);
    expect(getNodePosition(buf, 0)).toEqual([9, 8, 7]);
    // id 는 바뀌지 않아야 함
    expect(buf.ids[0]).toBe(100);
  });

  it("범위 밖 인덱스는 에러", () => {
    const buf = allocateNodeBuffer(4);
    pushNode(buf, 0, 0, 0, 1);
    expect(() => setNodePosition(buf, 5, 0, 0, 0)).toThrow(/out of bounds/);
  });
});

describe("growNodeBuffer", () => {
  it("기존 count 만큼 데이터 보존하며 capacity 확장", () => {
    const buf = allocateNodeBuffer(2);
    pushNode(buf, 1, 2, 3, 10);
    pushNode(buf, 4, 5, 6, 20);

    const grown = growNodeBuffer(buf, 8);
    expect(grown.capacity).toBe(8);
    expect(grown.count).toBe(2);
    expect(getNodePosition(grown, 0)).toEqual([1, 2, 3]);
    expect(getNodePosition(grown, 1)).toEqual([4, 5, 6]);
    expect(grown.ids[0]).toBe(10);
    expect(grown.ids[1]).toBe(20);
  });

  it("이미 충분한 capacity 이면 원본 그대로 반환", () => {
    const buf = allocateNodeBuffer(8);
    const same = growNodeBuffer(buf, 4);
    expect(same).toBe(buf);
  });
});
