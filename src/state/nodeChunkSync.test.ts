import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * nodeChunkSync 단위 테스트 (M6-2 Step 1 → M7-1 Step 1 갱신)
 *
 * 검증 범위:
 *  - processNodeChunk: 청크의 노드들을 buffer/bridge 매핑에 점진 append
 *  - 중복 ID 방어
 *  - capacity 초과 시 거부
 *  - **ScannedNode.position 직접 사용** (random 폴백 제거)
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
 * ScannedNode 형태의 stub 생성. (M7-1 Step 1) position 필수.
 * (D15) scale 기본 500 (D1 노드 대응). 명시 시 override.
 */
function makeScannedNode(
  id: string,
  position: [number, number, number] = [0, 0, 0],
  scale: number = 500
) {
  return {
    id,
    path: `/test/${id}`,
    name: id,
    kind: "file" as const,
    sizeBytes: 0,
    depth: 1,
    position,
    scale,
  };
}

function makeChunk(
  chunkId: number,
  nodes: Array<{
    id: string;
    position?: [number, number, number];
    scale?: number;
  }>,
  isLast = false
): NodeChunkEvent {
  return {
    chunkId,
    nodes: nodes.map((n) =>
      makeScannedNode(n.id, n.position ?? [0, 0, 0], n.scale ?? 500)
    ),
    isLast,
    totalScanned: nodes.length,
  };
}

describe("processNodeChunk", () => {
  beforeEach(() => {
    // bridge 모듈 레벨 매핑 초기화 (다른 테스트에서 남은 잔재 제거).
    // 임시 버퍼 + 빈 노드 배열로 syncFromStore 호출하면 idToIndex.clear + buffer.count=0.
    syncFromStore([], allocateNodeBuffer(8));
  });

  it("청크 1개 → buffer / 매핑 점진 append (position 그대로 사용)", () => {
    const buffer = allocateNodeBuffer(16);
    const chunk = makeChunk(0, [
      { id: "a", position: [1, 2, 3] },
      { id: "b", position: [4, 5, 6] },
      { id: "c", position: [7, 8, 9] },
    ]);

    const appended = processNodeChunk(chunk, buffer);

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
    processNodeChunk(
      makeChunk(0, [
        { id: "a", position: [1, 1, 1] },
        { id: "b", position: [2, 2, 2] },
      ]),
      buffer
    );
    processNodeChunk(
      makeChunk(1, [
        { id: "c", position: [3, 3, 3] },
        { id: "d", position: [4, 4, 4] },
      ]),
      buffer
    );

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
    processNodeChunk(
      makeChunk(0, [
        { id: "a", position: [1, 1, 1] },
        { id: "b", position: [2, 2, 2] },
      ]),
      buffer
    );
    // 둘째 청크: b(중복), c. b 는 거부되고 c 만 append.
    const appended = processNodeChunk(
      makeChunk(1, [
        { id: "b", position: [9, 9, 9] }, // 거부됨 (덮어쓰기 X)
        { id: "c", position: [3, 3, 3] },
      ]),
      buffer
    );

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
      makeChunk(0, [
        { id: "a", position: [1, 1, 1] },
        { id: "b", position: [2, 2, 2] },
        { id: "c", position: [9, 9, 9] },
      ]),
      buffer
    );

    // capacity 2 라 a, b 만 들어가고 c 는 거부.
    expect(appended).toBe(2);
    expect(buffer.count).toBe(2);
    expect(getIdToIndex().has("c")).toBe(false);
  });

  it("isLast 플래그는 처리에 영향 없음 (상태/카운트 무관)", () => {
    const buffer = allocateNodeBuffer(16);
    const chunk = makeChunk(0, [{ id: "solo", position: [0, 0, 0] }], true);
    const appended = processNodeChunk(chunk, buffer);
    expect(appended).toBe(1);
    expect(buffer.count).toBe(1);
    // isLast 는 종료 신호 (UI 표시 용) — 본 모듈에서는 추가 동작이 없어야 함.
  });

  it("(D15) ScannedNode.scale → buffer.scales 점진 append", () => {
    const buffer = allocateNodeBuffer(8);
    const chunk = makeChunk(0, [
      { id: "d1", position: [1, 2, 3], scale: 500 },
      { id: "d2", position: [4, 5, 6], scale: 50 },
      { id: "d5", position: [7, 8, 9], scale: 0.05 },
    ]);
    processNodeChunk(chunk, buffer);
    expect(buffer.scales[0]).toBeCloseTo(500);
    expect(buffer.scales[1]).toBeCloseTo(50);
    expect(buffer.scales[2]).toBeCloseTo(0.05);
  });

  it("Rust 가 보낸 position 을 그대로 신뢰 (frontend 변환 X)", () => {
    const buffer = allocateNodeBuffer(8);
    // M7-1: Fractal Orbital Packing 좌표 예시 (depth=1, root 직계 자식)
    // r ≈ 100,000. 단위 구면 위 한 점에 100,000 곱한 형태.
    const chunk = makeChunk(0, [
      { id: "deep-coord", position: [99999.5, -12345.6, 7890.1] },
    ]);
    processNodeChunk(chunk, buffer);
    const got = getNodePosition(buffer, 0);
    // Float32Array 라 정밀도 약간 손실되지만 1e-2 오차 이내.
    expect(got[0]).toBeCloseTo(99999.5, 0);
    expect(got[1]).toBeCloseTo(-12345.6, 0);
    expect(got[2]).toBeCloseTo(7890.1, 0);
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

  it("(fix m6-2) StrictMode race: Mount1 cancelled 플래그로 listener 즉시 unsub", async () => {
    // 시나리오 — React 19 StrictMode 더블 마운트 레이스 모사:
    //   1) Mount 1: setupNodeChunkSync 호출 → Promise 1 pending (listen 비동기)
    //   2) StrictMode cleanup: cancelled1 = true (Promise 1 의 unsub 은 아직 없음)
    //   3) Mount 2: setupNodeChunkSync 다시 호출 → Promise 2 pending
    //   4) Promise 1 resolve → cancelled1 검사 후 즉시 unsub → listener 1 제거
    //   5) Promise 2 resolve → 정상 보관 → listener 2 만 살아남음
    //
    // 가짜 event bus: 등록된 handler 들을 Set 로 관리, fire 시 살아있는 것만 호출.
    // 실제 Tauri 의 listen 동작 (unsub 호출 시 dispatcher 에서 제거) 을 모사.
    const liveHandlers = new Set<
      (event: { payload: NodeChunkEvent }) => void
    >();

    let resolve1!: () => void;
    let resolve2!: () => void;

    mockedListen
      .mockImplementationOnce(
        (handler: (event: { payload: NodeChunkEvent }) => void) =>
          new Promise<() => void>((resolve) => {
            resolve1 = () => {
              liveHandlers.add(handler);
              resolve(() => liveHandlers.delete(handler));
            };
          })
      )
      .mockImplementationOnce(
        (handler: (event: { payload: NodeChunkEvent }) => void) =>
          new Promise<() => void>((resolve) => {
            resolve2 = () => {
              liveHandlers.add(handler);
              resolve(() => liveHandlers.delete(handler));
            };
          })
      );

    const buffer = allocateNodeBuffer(16);
    const onAfterChunk = vi.fn();

    // Mount 1: 자기 전용 cancelled 클로저 (App.tsx useEffect 가 하는 패턴 그대로).
    let cancelled1 = false;
    setupNodeChunkSync(buffer, { onAfterChunk }).then((unsub) => {
      if (cancelled1) {
        unsub();
        return;
      }
    });

    // StrictMode 즉시 cleanup: Mount 1 의 effect 가 떼어짐.
    cancelled1 = true;

    // Mount 2: 새 effect 인스턴스 = 새 cancelled 클로저.
    let cancelled2 = false;
    setupNodeChunkSync(buffer, { onAfterChunk }).then((unsub) => {
      if (cancelled2) {
        unsub();
        return;
      }
    });

    // 두 listen 호출 모두 pending — handler 는 아직 bus 에 안 붙어 있다.
    expect(mockedListen).toHaveBeenCalledTimes(2);
    expect(liveHandlers.size).toBe(0);

    // Tauri 가 두 listen 모두 처리 → resolve. .then microtask 흐름 보장 위해 flush.
    resolve1();
    resolve2();
    await Promise.resolve();
    await Promise.resolve();

    // 핵심 검증: Mount 1 의 listener 는 cancelled1 가드로 즉시 unsub → bus 에서 제거.
    //   Mount 2 의 listener 만 살아남는다.
    expect(liveHandlers.size).toBe(1);

    // 청크 발사 — 살아있는 handler 들만 호출 (실제 Tauri 의 broadcast 모사).
    const chunk = makeChunk(
      0,
      [{ id: "live", position: [1, 1, 1] }],
      true
    );
    for (const h of liveHandlers) h({ payload: chunk });

    // 청크가 1번만 처리됨 — fix 없으면 onAfterChunk 가 2번 호출되고 buffer.count 도
    //   2 가 되어야 한다 (두 번째는 중복 ID 라 거부되지만 onAfterChunk 는 그대로 발화).
    expect(onAfterChunk).toHaveBeenCalledTimes(1);
    expect(buffer.count).toBe(1);
  });

  it("(fix m6-2) cancelled=false 면 정상 보관 — fix 가 정상 케이스를 깨뜨리지 않는다", async () => {
    // 회귀 방지: cancelled 플래그 도입 후에도 정상 마운트 1회 케이스에서
    // listener 가 살아있고 청크가 정확히 1번 처리되는지.
    const liveHandlers = new Set<
      (event: { payload: NodeChunkEvent }) => void
    >();
    mockedListen.mockImplementationOnce(
      async (handler: (event: { payload: NodeChunkEvent }) => void) => {
        liveHandlers.add(handler);
        return () => liveHandlers.delete(handler);
      }
    );

    const buffer = allocateNodeBuffer(16);
    const onAfterChunk = vi.fn();

    let cancelled = false;
    let savedUnsub: (() => void) | null = null;
    setupNodeChunkSync(buffer, { onAfterChunk }).then((unsub) => {
      if (cancelled) {
        unsub();
        return;
      }
      savedUnsub = unsub;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(liveHandlers.size).toBe(1);
    expect(savedUnsub).not.toBeNull();

    const chunk = makeChunk(0, [{ id: "x", position: [0, 0, 0] }], true);
    for (const h of liveHandlers) h({ payload: chunk });
    expect(onAfterChunk).toHaveBeenCalledTimes(1);
    expect(buffer.count).toBe(1);
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
    await setupNodeChunkSync(buffer, { onAfterChunk });

    expect(registeredHandler).not.toBeNull();
    const chunk = makeChunk(
      0,
      [
        { id: "a", position: [1, 1, 1] },
        { id: "b", position: [2, 2, 2] },
      ],
      true
    );
    // Tauri event handler 시그니처: { payload, event, id, ... } — 우리는 payload 만 사용.
    registeredHandler!({ payload: chunk });

    expect(buffer.count).toBe(2);
    expect(getIdToIndex().get("a")).toBe(0);
    expect(getIdToIndex().get("b")).toBe(1);
    expect(getNodePosition(buffer, 0)).toEqual([1, 1, 1]);
    expect(onAfterChunk).toHaveBeenCalledTimes(1);
    expect(onAfterChunk).toHaveBeenCalledWith(chunk);
  });
});
