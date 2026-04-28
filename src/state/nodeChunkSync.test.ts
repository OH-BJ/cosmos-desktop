import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * nodeChunkSync 단위 테스트 (M6-2 Step 1)
 *
 * 검증 범위:
 *  - processNodeChunk: 청크의 노드들을 buffer/bridge 매핑에 점진 append
 *  - 중복 ID 방어
 *  - capacity 초과 시 거부
 *  - randomCoord 주입으로 결정론적 좌표 검증
 *  - setupNodeChunkSync: events.nodeChunkEvent.listen 이 호출되고 unsub 반환
 *
 * 모킹 전략:
 *  - bindings.events.nodeChunkEvent.listen 만 vi.fn 으로 교체.
 *  - bindings 의 다른 export(commands 등) 는 사용하지 않으므로 최소 stub.
 */
vi.mock("../lib/bindings", () => {
  return {
    events: {
      nodeChunkEvent: {
        listen: vi.fn(),
      },
    },
    // commands 는 이 테스트에서 호출되지 않지만 bindings 모듈 형태 유지.
    commands: {},
  };
});

import { events, type NodeChunkEvent } from "../lib/bindings";
import { allocateNodeBuffer, getNodePosition } from "./nodeBuffer";
import {
  syncFromStore,
  getIdToIndex,
  getIndexToId,
} from "./bridge";
import { processNodeChunk, setupNodeChunkSync } from "./nodeChunkSync";

const mockedListen = events.nodeChunkEvent.listen as unknown as ReturnType<
  typeof vi.fn
>;

/**
 * 결정론적 좌표 시퀀스를 만드는 헬퍼.
 *
 * randomCoord 는 노드당 3번 호출되므로 (x, y, z), 시퀀스를 한 줄로 깔끔하게 정의.
 * 끝에 도달해도 안전하게 0 을 반환 (테스트 디버깅 편의).
 */
function makeCoordSeq(values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

/**
 * ScannedNode 형태의 stub 생성. 이 테스트 범위에선 path/name/kind/sizeBytes/depth 는
 * 사용하지 않지만 타입 만족 위해 채움.
 */
function makeScannedNode(id: string) {
  return {
    id,
    path: `/test/${id}`,
    name: id,
    kind: "file" as const,
    sizeBytes: 0,
    depth: 1,
  };
}

function makeChunk(
  chunkId: number,
  ids: string[],
  isLast = false
): NodeChunkEvent {
  return {
    chunkId,
    nodes: ids.map(makeScannedNode),
    isLast,
    totalScanned: ids.length,
  };
}

describe("processNodeChunk", () => {
  beforeEach(() => {
    // bridge 모듈 레벨 매핑 초기화 (다른 테스트에서 남은 잔재 제거).
    // 임시 버퍼 + 빈 노드 배열로 syncFromStore 호출하면 idToIndex.clear + buffer.count=0.
    syncFromStore([], allocateNodeBuffer(8));
  });

  it("청크 1개 → buffer / 매핑 점진 append", () => {
    const buffer = allocateNodeBuffer(16);
    const chunk = makeChunk(0, ["a", "b", "c"]);
    // 결정론적 좌표: 노드 a=(1,2,3), b=(4,5,6), c=(7,8,9)
    const coords = makeCoordSeq([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const appended = processNodeChunk(chunk, buffer, coords);

    expect(appended).toBe(3);
    expect(buffer.count).toBe(3);
    expect(getNodePosition(buffer, 0)).toEqual([1, 2, 3]);
    expect(getNodePosition(buffer, 1)).toEqual([4, 5, 6]);
    expect(getNodePosition(buffer, 2)).toEqual([7, 8, 9]);

    const idMap = getIdToIndex();
    expect(idMap.get("a")).toBe(0);
    expect(idMap.get("b")).toBe(1);
    expect(idMap.get("c")).toBe(2);

    expect(getIndexToId()).toEqual(["a", "b", "c"]);
  });

  it("청크 2개 연속 → append-only (기존 매핑 보존)", () => {
    const buffer = allocateNodeBuffer(16);
    processNodeChunk(makeChunk(0, ["a", "b"]), buffer, makeCoordSeq([
      1, 1, 1, 2, 2, 2,
    ]));
    processNodeChunk(makeChunk(1, ["c", "d"]), buffer, makeCoordSeq([
      3, 3, 3, 4, 4, 4,
    ]));

    expect(buffer.count).toBe(4);
    // 첫 청크의 매핑이 그대로 살아있는지 — full-rewrite 가 아닌 append 임을 보장.
    expect(getIdToIndex().get("a")).toBe(0);
    expect(getIdToIndex().get("d")).toBe(3);
    expect(getNodePosition(buffer, 0)).toEqual([1, 1, 1]);
    expect(getNodePosition(buffer, 3)).toEqual([4, 4, 4]);
  });

  it("중복 ID → 건너뛰고 카운트 정확", () => {
    const buffer = allocateNodeBuffer(16);
    // 첫 청크: a, b
    processNodeChunk(makeChunk(0, ["a", "b"]), buffer, makeCoordSeq([
      1, 1, 1, 2, 2, 2,
    ]));
    // 둘째 청크: b(중복), c
    const appended = processNodeChunk(
      makeChunk(1, ["b", "c"]),
      buffer,
      // b 도 좌표를 소비하긴 한다 (appendChunkedNode 가 거부 전 randomCoord 가 미리 호출됨)
      // → 결정론적 시퀀스로 6개 (b=skip, c=실제 사용) 준비.
      makeCoordSeq([9, 9, 9, 3, 3, 3])
    );

    // b 는 거부되었으므로 1개만 append.
    expect(appended).toBe(1);
    expect(buffer.count).toBe(3);
    // b 의 인덱스는 첫 청크의 1 그대로 유지 (덮어쓰기 X).
    expect(getIdToIndex().get("b")).toBe(1);
    expect(getNodePosition(buffer, 1)).toEqual([2, 2, 2]);
    // c 만 새로 들어옴.
    expect(getIdToIndex().get("c")).toBe(2);
    expect(getNodePosition(buffer, 2)).toEqual([3, 3, 3]);
  });

  it("capacity 초과 → 초과분만 거부, 나머지는 정상 append", () => {
    const buffer = allocateNodeBuffer(2);
    const appended = processNodeChunk(
      makeChunk(0, ["a", "b", "c"]),
      buffer,
      makeCoordSeq([1, 1, 1, 2, 2, 2, 9, 9, 9])
    );

    // capacity 2 라 a, b 만 들어가고 c 는 거부.
    expect(appended).toBe(2);
    expect(buffer.count).toBe(2);
    expect(getIdToIndex().has("c")).toBe(false);
  });

  it("isLast 플래그는 처리에 영향 없음 (상태/카운트 무관)", () => {
    const buffer = allocateNodeBuffer(16);
    const chunk = makeChunk(0, ["solo"], true);
    const appended = processNodeChunk(
      chunk,
      buffer,
      makeCoordSeq([0, 0, 0])
    );
    expect(appended).toBe(1);
    expect(buffer.count).toBe(1);
    // isLast 는 종료 신호 (UI 표시 용) — 본 모듈에서는 추가 동작이 없어야 함.
  });
});

describe("setupNodeChunkSync", () => {
  beforeEach(() => {
    mockedListen.mockReset();
    syncFromStore([], allocateNodeBuffer(8));
  });

  it("listen 호출 + unsub 반환", async () => {
    const fakeUnsub = vi.fn();
    mockedListen.mockResolvedValueOnce(fakeUnsub);

    const buffer = allocateNodeBuffer(16);
    const unsub = await setupNodeChunkSync(buffer);

    expect(mockedListen).toHaveBeenCalledTimes(1);
    expect(typeof unsub).toBe("function");

    unsub();
    expect(fakeUnsub).toHaveBeenCalledTimes(1);
  });

  it("listener 발화 → buffer append + onAfterChunk 호출", async () => {
    let registeredHandler:
      | ((event: { payload: NodeChunkEvent }) => void)
      | null = null;
    mockedListen.mockImplementationOnce(async (handler) => {
      registeredHandler = handler;
      return vi.fn();
    });

    const buffer = allocateNodeBuffer(16);
    const onAfterChunk = vi.fn();
    await setupNodeChunkSync(buffer, {
      randomCoord: makeCoordSeq([1, 1, 1, 2, 2, 2]),
      onAfterChunk,
    });

    expect(registeredHandler).not.toBeNull();
    const chunk = makeChunk(0, ["a", "b"], true);
    // Tauri event handler 시그니처: { payload, event, id, ... } — 우리는 payload 만 사용.
    registeredHandler!({ payload: chunk });

    expect(buffer.count).toBe(2);
    expect(getIdToIndex().get("a")).toBe(0);
    expect(getIdToIndex().get("b")).toBe(1);
    expect(onAfterChunk).toHaveBeenCalledTimes(1);
    expect(onAfterChunk).toHaveBeenCalledWith(chunk);
  });
});
