import { Node, useCosmosStore } from "./store";
import { NodeBuffer, pushNode } from "./nodeBuffer";

/**
 * bridge — 고빈도/저빈도 상태 동기화 (M2 재구현)
 *
 * Zustand (저빈도, UUID v7 String ID)의 노드 배열을
 * TypedArray (고빈도, Buffer Index)로 동기화하는 중간 다리.
 *
 * ID 전략 (M2_ENTER_CRITERIA 확정):
 * - 도메인 계층: Node.id = UUID v7 문자열 (Zustand store)
 * - 렌더링 계층: positions 배열의 인덱스 i = 렌더링 ID
 * - 이 모듈이 양방향 매핑을 관리:
 *   · idToIndex: UUID → Buffer Index (O(1) 조회)
 *   · indexToId: Buffer Index → UUID (O(1) 역조회)
 *
 * 동기화 흐름:
 * 1) Zustand store.nodes 변경 감지 (subscribe)
 * 2) syncFromStore() → TypedArray 전량 재작성 + 매핑 테이블 갱신
 * 3) InstancedMesh가 갱신된 TypedArray를 렌더
 *
 * M2에서는 전량 재작성(full rewrite). 노드 3~5개라 성능 문제 없음.
 * M3에서 1k 초과 시 diff 기반으로 전환 예정.
 */

// UUID → Buffer Index 매핑 (syncFromStore에서만 갱신, 렌더 루프에서 Map 조회 금지)
const idToIndex = new Map<string, number>();

// Buffer Index → UUID 역매핑 (인덱스 i의 노드가 어떤 UUID인지)
const indexToId: string[] = [];

/** idToIndex Map 읽기 전용 접근 (테스트/외부 모듈용) */
export function getIdToIndex(): ReadonlyMap<string, number> {
  return idToIndex;
}

/** indexToId 배열 읽기 전용 접근 (테스트/외부 모듈용) */
export function getIndexToId(): readonly string[] {
  return indexToId;
}

/**
 * syncFromStore() — Zustand 노드 목록 → TypedArray 버퍼로 동기화
 *
 * 전량 재작성 방식: 매핑 테이블 초기화 → 노드 순회 → pushNode + 매핑 등록.
 * 중복 ID가 있으면 경고 로그 후 건너뜀 (데이터 무결성 보호).
 *
 * @param nodes Zustand의 nodes 배열
 * @param buffer 대상 NodeBuffer
 */
export function syncFromStore(nodes: Node[], buffer: NodeBuffer): void {
  if (nodes.length > buffer.capacity) {
    console.error(
      `syncFromStore: nodes.length (${nodes.length}) > buffer.capacity (${buffer.capacity})`
    );
    return;
  }

  // 매핑 테이블 초기화
  idToIndex.clear();
  indexToId.length = 0;

  // 버퍼 초기화
  buffer.count = 0;

  // 각 노드를 버퍼에 복사 + 매핑 등록
  for (const node of nodes) {
    // 중복 ID 방어
    if (idToIndex.has(node.id)) {
      console.warn(`syncFromStore: 중복 ID 발견, 건너뜀: ${node.id}`);
      continue;
    }

    const bufferIndex = pushNode(buffer, node.x, node.y, node.z);
    idToIndex.set(node.id, bufferIndex);
    indexToId.push(node.id);
  }
}

/**
 * setupStoreSynchronization() — Zustand 변경을 감시하고 TypedArray 동기화
 *
 * useCosmosStore.subscribe로 nodes 변경을 감지,
 * 변경 시 syncFromStore를 자동 호출. 그 직후 onAfterSync 콜백을 실행해
 * 렌더 계층(예: InstancedNodes.syncFromBuffer)을 함께 갱신한다.
 *
 * ARCHITECTURE 원칙: bridge(버퍼 갱신) → 렌더(메시 갱신) 순서가 한 구독 안에서
 * 원자적으로 이뤄지도록 단일 진입점으로 묶는다.
 *
 * @param buffer 동기화 대상 NodeBuffer
 * @param onAfterSync 버퍼 갱신 직후 호출될 후속 훅 (예: InstancedMesh 업데이트)
 * @returns 구독 해제 함수 (cleanup용)
 */
export function setupStoreSynchronization(
  buffer: NodeBuffer,
  onAfterSync?: () => void
): () => void {
  const runSync = (nodes: Node[]) => {
    syncFromStore(nodes, buffer);
    onAfterSync?.();
  };

  // Zustand subscribe: nodes가 바뀔 때마다 sync → 렌더 갱신
  const unsub = useCosmosStore.subscribe((state) => state.nodes, runSync);

  // 초기 동기화 (subscribe는 변경 시에만 호출되므로, 현재 상태를 한 번 수동 동기화)
  runSync(useCosmosStore.getState().nodes);

  return unsub;
}
