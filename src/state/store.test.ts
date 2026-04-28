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

/**
 * M6-2 Step 3: scanProgress 슬라이스 테스트.
 *
 * 검증 포인트:
 *  - 초기값: isScanning=false, totalScanned=0, lastChunkId=null.
 *  - startScan: isScanning=true, 카운트 0 으로 초기화.
 *  - updateScanProgress: 청크 도착마다 totalScanned/lastChunkId 갱신, isLast=true 면
 *    isScanning=false 로 자동 전환.
 *  - resetScanProgress: 모든 값 초기 상태로 복귀 (실패/취소 복구용).
 */
describe("CosmosStore.scanProgress", () => {
  beforeEach(() => {
    useCosmosStore.getState().resetScanProgress();
  });

  it("초기값: isScanning=false, totalScanned=0, lastChunkId=null", () => {
    const p = useCosmosStore.getState().scanProgress;
    expect(p.isScanning).toBe(false);
    expect(p.totalScanned).toBe(0);
    expect(p.lastChunkId).toBeNull();
  });

  it("startScan → isScanning=true 로 전환, 카운트 0 초기화", () => {
    // 일단 진행 상태에서 시작
    useCosmosStore.getState().updateScanProgress(7, 1234, false);
    useCosmosStore.getState().startScan();

    const p = useCosmosStore.getState().scanProgress;
    expect(p.isScanning).toBe(true);
    expect(p.totalScanned).toBe(0);
    expect(p.lastChunkId).toBeNull();
  });

  it("updateScanProgress(isLast=false) → 카운트만 갱신, isScanning 유지", () => {
    useCosmosStore.getState().startScan();
    useCosmosStore.getState().updateScanProgress(0, 1000, false);
    useCosmosStore.getState().updateScanProgress(1, 2000, false);

    const p = useCosmosStore.getState().scanProgress;
    expect(p.isScanning).toBe(true);
    expect(p.totalScanned).toBe(2000);
    expect(p.lastChunkId).toBe(1);
  });

  it("updateScanProgress(isLast=true) → isScanning=false 자동 전환", () => {
    useCosmosStore.getState().startScan();
    useCosmosStore.getState().updateScanProgress(2, 3000, true);

    const p = useCosmosStore.getState().scanProgress;
    expect(p.isScanning).toBe(false);
    expect(p.totalScanned).toBe(3000);
    expect(p.lastChunkId).toBe(2);
  });

  it("resetScanProgress → 모든 필드 초기 상태", () => {
    useCosmosStore.getState().updateScanProgress(5, 9999, false);
    useCosmosStore.getState().resetScanProgress();

    const p = useCosmosStore.getState().scanProgress;
    expect(p.isScanning).toBe(false);
    expect(p.totalScanned).toBe(0);
    expect(p.lastChunkId).toBeNull();
  });
});
