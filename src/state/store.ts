import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { NodeDetails } from "../lib/bindings";

/**
 * Node — 논리 노드 타입 (Zustand 저빈도 상태용)
 *
 * 이 타입은 src-tauri/src/ipc_types.rs의 Rust Node 구조체와 일치해야 함.
 * IPC 통신 시 serde로 자동 변환되므로, 필드명과 타입이 정확히 매칭되어야 함.
 *
 * @property id UUID v7 형식 문자열 (M2_ENTER_CRITERIA 확정)
 * @property path 파일 시스템 경로
 * @property x, y, z 우주 공간 좌표 (메타데이터용, 실제 렌더링은 TypedArray buffer 사용)
 */
export interface Node {
  id: string;
  path: string;
  x: number;
  y: number;
  z: number;
}

/**
 * M2 하드코딩 테스트 노드 3개 (PLAN_M2 Step 1 작업 7).
 *
 * UUID v7 형식 문자열을 결정론적으로 사용 (테스트/디버그 시 예측 가능).
 * 실제 M3에서 Rust IPC가 DB에서 노드를 로드하면 이 배열은 제거된다.
 *
 * 좌표는 Orthographic 카메라 뷰포트(±960 × ±540) 안쪽에 흩뿌림.
 */
const INITIAL_TEST_NODES: Node[] = [
  {
    id: "01900000-0000-7000-8000-000000000001",
    path: "/test/node-a",
    x: -200,
    y: 100,
    z: 0,
  },
  {
    id: "01900000-0000-7000-8000-000000000002",
    path: "/test/node-b",
    x: 0,
    y: -150,
    z: 0,
  },
  {
    id: "01900000-0000-7000-8000-000000000003",
    path: "/test/node-c",
    x: 250,
    y: 80,
    z: 0,
  },
];

/**
 * CosmosStore — Zustand 저빈도 상태 (선택, 메뉴, 설정 등)
 *
 * 이중 상태 아키텍처:
 * - 고빈도 (렌더 루프): TypedArray (src/state/nodeBuffer.ts)
 * - 저빈도 (React 컴포넌트): Zustand (여기)
 *
 * 주의: 렌더 루프에서 store.getState()를 호출하지 말 것.
 * 고빈도는 항상 TypedArray만 읽고, 필요시 이벤트로 Zustand와 동기화.
 */
/**
 * ScanProgress — 디렉토리 스캔 진행 상태 (M6-2 Step 3).
 *
 * 좌상단 정보 박스 + ScanControl 패널이 공유하는 단일 출처. 청크 도착마다
 * App 의 onAfterChunk 에서 updateScanProgress 가 호출된다.
 *
 * @property isScanning ack 후 isLast=true 청크 도착 전까지 true.
 * @property totalScanned 누적 청크 노드 수 (하드코딩 3개는 미포함).
 * @property lastChunkId 마지막 도착 청크의 chunk_id (없으면 null).
 */
export interface ScanProgress {
  isScanning: boolean;
  totalScanned: number;
  lastChunkId: number | null;
}

interface CosmosStore {
  // 노드 목록 (Rust에서 받은 초기 로드 + IPC 업데이트)
  nodes: Node[];
  setNodes: (nodes: Node[]) => void;

  // 선택된 노드 ID
  selectedNodeId: string | null;
  selectNode: (id: string | null) => void;

  // M7-2 Step 2: 호버 중인 노드 ID. 마우스가 노드 위에 있을 때만 non-null.
  //   - 선택과 별도 (selectedNodeId 와 동시 가능).
  //   - 마우스 이동 시 rAF + Dirty Flag throttle 로 GPU Picker 결과를 반영.
  //   - 캔버스 벗어나거나 빈 공간 위면 null.
  hoveredNodeId: string | null;
  setHoveredNode: (id: string | null) => void;

  // M5: 선택된 노드의 메타데이터 (Rust IPC `get_node_details` 응답).
  // null인 경우 = 미선택 또는 IPC 응답 대기 중 또는 조회 실패.
  // selectedNodeId 변경 시 nodeDetailsSync 모듈이 비동기로 채워준다.
  // (옵션 α — 단일 필드. 캐시는 Step3 이후 필요해지면 도입)
  selectedNodeDetails: NodeDetails | null;
  setSelectedNodeDetails: (details: NodeDetails | null) => void;

  // M6-2 Step 3: 스캔 진행 상태. 좌상단 카운트 + ScanControl 진행 표시 공유.
  scanProgress: ScanProgress;
  // 새 스캔 시작 — isScanning=true, 누적 카운트는 그대로 유지 X (β: 청크 리셋과 함께
  // 호출되므로 0 으로 초기화). 호출 측에서 clearChunkedNodes 와 짝.
  startScan: () => void;
  // 청크 1개 도착 후 카운트/마지막 chunkId 반영. isLast=true 면 isScanning=false.
  updateScanProgress: (chunkId: number, totalScanned: number, isLast: boolean) => void;
  // 안전한 재초기화 (테스트/이상 종료 복구용).
  resetScanProgress: () => void;
}

/**
 * useCosmosStore — Zustand 훅
 *
 * React 컴포넌트에서 호출:
 * const { nodes, selectedNodeId, selectNode } = useCosmosStore();
 *
 * 상태 변경 시 컴포넌트 리렌더 트리거됨.
 * 렌더 루프에서는 절대 이 훅을 호출하면 안 됨 (성능 저하).
 */
export const useCosmosStore = create<CosmosStore>()(subscribeWithSelector((set) => ({
  // 초기 상태: M2 하드코딩 테스트 노드 3개.
  // bridge.setupStoreSynchronization의 초기 동기화 호출 시점에 이 노드들이
  // NodeBuffer → InstancedMesh로 전파되어 화면에 보이게 된다.
  nodes: INITIAL_TEST_NODES,
  setNodes: (nodes: Node[]) => set({ nodes }),

  selectedNodeId: null,
  selectNode: (id: string | null) => set({ selectedNodeId: id }),

  hoveredNodeId: null,
  setHoveredNode: (id: string | null) => {
    // 동일 ID 재호출은 set 스킵 — Zustand 가 ref 비교로 noop 처리하지만 명시.
    if (useCosmosStore.getState().hoveredNodeId === id) return;
    set({ hoveredNodeId: id });
  },

  selectedNodeDetails: null,
  setSelectedNodeDetails: (details: NodeDetails | null) =>
    set({ selectedNodeDetails: details }),

  // 초기값: 미스캔 상태.
  scanProgress: { isScanning: false, totalScanned: 0, lastChunkId: null },
  startScan: () =>
    set({
      scanProgress: { isScanning: true, totalScanned: 0, lastChunkId: null },
    }),
  updateScanProgress: (chunkId, totalScanned, isLast) =>
    set({
      scanProgress: {
        isScanning: !isLast,
        totalScanned,
        lastChunkId: chunkId,
      },
    }),
  resetScanProgress: () =>
    set({
      scanProgress: { isScanning: false, totalScanned: 0, lastChunkId: null },
    }),
})));
