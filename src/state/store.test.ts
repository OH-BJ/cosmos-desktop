import { describe, it, expect, beforeEach } from "vitest";
import { useCosmosStore } from "./store";
import type { NodeDetails } from "../lib/bindings";

/**
 * CosmosStore 단위 테스트 — selectedNodeDetails 슬라이스 (M5 Step 2)
 *
 * Zustand store 는 모듈 싱글톤이므로 각 it 시작 시 초기화 필요.
 */

const sampleDetails: NodeDetails = {
  id: "01900000-0000-7000-8000-000000000001",
  name: "documents.txt",
  path: "/Users/demo/documents.txt",
  kind: "file",
  sizeBytes: 2048,
  createdAt: 1_743_465_600_000,
  modifiedAt: 1_743_552_000_000,
};

describe("CosmosStore.selectedNodeDetails", () => {
  beforeEach(() => {
    useCosmosStore.setState({ selectedNodeDetails: null });
  });

  it("초기값은 null", () => {
    expect(useCosmosStore.getState().selectedNodeDetails).toBeNull();
  });

  it("setSelectedNodeDetails 로 NodeDetails 객체 저장", () => {
    useCosmosStore.getState().setSelectedNodeDetails(sampleDetails);
    expect(useCosmosStore.getState().selectedNodeDetails).toEqual(sampleDetails);
  });

  it("setSelectedNodeDetails(null) 로 다시 비울 수 있다", () => {
    useCosmosStore.getState().setSelectedNodeDetails(sampleDetails);
    useCosmosStore.getState().setSelectedNodeDetails(null);
    expect(useCosmosStore.getState().selectedNodeDetails).toBeNull();
  });
});
