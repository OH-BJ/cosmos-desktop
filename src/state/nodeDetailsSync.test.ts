import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * setupNodeDetailsSync 테스트 — Stale Request Discard 패턴 검증 (M5 Step 2)
 *
 * vi.mock 은 ESM hoist 되므로 import 보다 위에서 모킹.
 * commands.getNodeDetails 만 vi.fn() 으로 교체하고, 나머지 bindings 타입은
 * import type 으로만 끌어쓴다 (런타임 영향 X).
 */
vi.mock("../lib/bindings", () => {
  return {
    commands: {
      getNodeDetails: vi.fn(),
    },
  };
});

import { commands } from "../lib/bindings";
import { useCosmosStore } from "./store";
import { setupNodeDetailsSync } from "./nodeDetailsSync";
import type { NodeDetails } from "../lib/bindings";

const mockedGetNodeDetails = commands.getNodeDetails as unknown as ReturnType<typeof vi.fn>;

const detailsA: NodeDetails = {
  id: "node-a",
  name: "a.txt",
  path: "/a.txt",
  kind: "file",
  sizeBytes: 100,
  createdAt: 1,
  modifiedAt: 2,
};

const detailsB: NodeDetails = {
  id: "node-b",
  name: "b.txt",
  path: "/b.txt",
  kind: "file",
  sizeBytes: 200,
  createdAt: 3,
  modifiedAt: 4,
};

/** 마이크로태스크 큐 비우기 */
function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("setupNodeDetailsSync", () => {
  beforeEach(() => {
    mockedGetNodeDetails.mockReset();
    // 매 테스트마다 store 를 깨끗하게 초기화 (Zustand 싱글톤 주의).
    useCosmosStore.setState({ selectedNodeId: null, selectedNodeDetails: null });
  });

  it("selectNode(id) → IPC 호출 + details 반영", async () => {
    mockedGetNodeDetails.mockResolvedValueOnce({ status: "ok", data: detailsA });

    const unsub = setupNodeDetailsSync();
    useCosmosStore.getState().selectNode("node-a");
    await flushMicrotasks();

    expect(mockedGetNodeDetails).toHaveBeenCalledWith("node-a");
    expect(useCosmosStore.getState().selectedNodeDetails).toEqual(detailsA);

    unsub();
  });

  it("selectNode(null) → IPC 호출 없음, details 즉시 null", async () => {
    // 먼저 어떤 details 를 박아두고 (이전 선택 잔재 시뮬레이션)
    useCosmosStore.setState({ selectedNodeDetails: detailsA });

    const unsub = setupNodeDetailsSync();
    // 초기 동기화에서 selectedNodeId === null 이므로 즉시 setSelectedNodeDetails(null) 발생.
    await flushMicrotasks();
    expect(useCosmosStore.getState().selectedNodeDetails).toBeNull();

    // 이후 mock 호출 카운트만 검증 (초기 동기화는 IPC 호출 안 함).
    expect(mockedGetNodeDetails).not.toHaveBeenCalled();

    unsub();
  });

  it("Stale Request Discard: A 응답이 늦게 도착해도 무시되고 B 응답만 반영", async () => {
    let resolveA!: (v: unknown) => void;
    let resolveB!: (v: unknown) => void;
    const promiseA = new Promise((r) => {
      resolveA = r;
    });
    const promiseB = new Promise((r) => {
      resolveB = r;
    });

    mockedGetNodeDetails
      .mockReturnValueOnce(promiseA)
      .mockReturnValueOnce(promiseB);

    const unsub = setupNodeDetailsSync();

    // A → B 빠른 연속 클릭. 둘 다 in-flight.
    useCosmosStore.getState().selectNode("node-a");
    useCosmosStore.getState().selectNode("node-b");

    // B 응답이 먼저 (정상 순서)
    resolveB({ status: "ok", data: detailsB });
    await flushMicrotasks();
    expect(useCosmosStore.getState().selectedNodeDetails).toEqual(detailsB);

    // A 응답이 뒤늦게 도착 — 현재 selectedNodeId 는 "node-b" 라 stale 로 판별, 무시되어야 함.
    resolveA({ status: "ok", data: detailsA });
    await flushMicrotasks();
    expect(useCosmosStore.getState().selectedNodeDetails).toEqual(detailsB);

    unsub();
  });

  it("IPC가 Ok(null) 반환 (없는 ID) → details 도 null", async () => {
    mockedGetNodeDetails.mockResolvedValueOnce({ status: "ok", data: null });

    const unsub = setupNodeDetailsSync();
    useCosmosStore.getState().selectNode("missing");
    await flushMicrotasks();

    expect(useCosmosStore.getState().selectedNodeDetails).toBeNull();
    unsub();
  });
});
