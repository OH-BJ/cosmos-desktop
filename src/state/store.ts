import { create } from "zustand";

/**
 * Node — 논리 노드 타입 (Zustand 저빈도 상태용)
 *
 * 이 타입은 src-tauri/src/ipc_types.rs의 Rust Node 구조체와 일치해야 함.
 * IPC 통신 시 serde로 자동 변환되므로, 필드명과 타입이 정확히 매칭되어야 함.
 *
 * @property id 고유 식별자 (파일 경로 또는 UUID)
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
 * CosmosStore — Zustand 저빈도 상태 (선택, 메뉴, 설정 등)
 *
 * 이중 상태 아키텍처:
 * - 고빈도 (렌더 루프): TypedArray (src/state/nodeBuffer.ts)
 * - 저빈도 (React 컴포넌트): Zustand (여기)
 *
 * 주의: 렌더 루프에서 store.getState()를 호출하지 말 것.
 * 고빈도는 항상 TypedArray만 읽고, 필요시 이벤트로 Zustand와 동기화.
 */
interface CosmosStore {
  // 노드 목록 (Rust에서 받은 초기 로드 + IPC 업데이트)
  nodes: Node[];
  setNodes: (nodes: Node[]) => void;

  // 선택된 노드 ID
  selectedNodeId: string | null;
  selectNode: (id: string | null) => void;
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
export const useCosmosStore = create<CosmosStore>((set) => ({
  nodes: [],
  setNodes: (nodes: Node[]) => set({ nodes }),

  selectedNodeId: null,
  selectNode: (id: string | null) => set({ selectedNodeId: id }),
}));
