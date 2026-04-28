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

/**
 * storeNodesBoundary — syncFromStore 가 마지막으로 채운 store 노드의 경계 인덱스.
 *
 * indexToId 의 [0, boundary) 구간은 Zustand store 의 저빈도 노드 (하드코딩 3개 등),
 * [boundary, ∞) 구간은 appendChunkedNode 로 들어온 청크 노드.
 *
 * `clearChunkedNodes()` 가 boundary 까지만 남기고 나머지를 제거 → β 옵션 (새 스캔
 * 시작 시 청크만 리셋, 데모 노드는 보존).
 */
let storeNodesBoundary = 0;

/** idToIndex Map 읽기 전용 접근 (테스트/외부 모듈용) */
export function getIdToIndex(): ReadonlyMap<string, number> {
  return idToIndex;
}

/** indexToId 배열 읽기 전용 접근 (테스트/외부 모듈용) */
export function getIndexToId(): readonly string[] {
  return indexToId;
}

/** 현재 store-origin 노드 경계 (테스트용). 청크 노드 시작 인덱스 = 이 값. */
export function getStoreNodesBoundary(): number {
  return storeNodesBoundary;
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

  // M6-2 Step 3: store-origin 경계 갱신. 이후 appendChunkedNode 가 push 하는 항목은
  //   indexToId 의 boundary 이후 영역이라 clearChunkedNodes 로 제거 가능.
  //   중복 ID 가 거부됐을 수 있어 length 를 그대로 사용 (실제 등록된 store 노드 수).
  storeNodesBoundary = indexToId.length;
}

/**
 * clearChunkedNodes() — appendChunkedNode 로 들어온 청크 노드만 제거.
 *
 * M6-2 Step 3 (β 옵션):
 *   새 스캔 시작 시 호출. storeNodesBoundary 까지는 보존 (하드코딩 3개 등 데모 노드),
 *   그 뒤의 청크 노드는 indexToId/idToIndex 에서 제거하고 buffer.count 도 줄인다.
 *
 *   호출자(App.handleStartScan)는 이 함수 직후 InstancedNodes.syncFromBuffer 를
 *   호출해 mesh.count 를 갱신해야 한다 (count 만 줄여도 setMatrixAt 잔존 행렬은 안 그려짐).
 *
 * @param buffer 동기화 대상 NodeBuffer (App 의 단일 인스턴스).
 * @returns 제거된 노드 수 (디버그/로그용).
 */
export function clearChunkedNodes(buffer: NodeBuffer): number {
  const removed = indexToId.length - storeNodesBoundary;
  if (removed <= 0) return 0;

  // 뒤에서부터 제거 (idToIndex 도 함께). pop 은 O(1).
  while (indexToId.length > storeNodesBoundary) {
    const id = indexToId.pop()!;
    idToIndex.delete(id);
  }
  // buffer 잘라내기 — positions 의 stale Float32 는 남아있어도 count 가 줄어들면
  // pushNode 가 그 위에 덮어쓰고, InstancedMesh 도 mesh.count 만큼만 그림.
  buffer.count = storeNodesBoundary;
  return removed;
}

/**
 * appendChunkedNode() — 단일 노드를 버퍼와 매핑 테이블에 점진 append.
 *
 * M6-2 Step 1 (First Grounding 2/2):
 *   디렉토리 스캔 청크 (events.nodeChunkEvent) 수신 시 노드 1개씩 호출.
 *   syncFromStore 와 달리 기존 데이터를 보존한 채 1개씩 추가하므로 O(1).
 *
 *   syncFromStore 가 "Zustand 전량 → 버퍼 전량 재작성" 인 데 반해,
 *   이 함수는 Zustand 를 거치지 않고 바로 버퍼/매핑에 append.
 *   대량 청크가 들어와도 React 리렌더가 발생하지 않아야 60fps 유지에 유리.
 *
 *   주의: Zustand store.nodes 가 이후에 변경되면 syncFromStore 가 다시 돌면서
 *   여기서 append 한 청크 데이터를 모두 덮어쓴다. M6-2 단계에선 store 변경을
 *   유발하지 않는다는 전제에서 안전 (initial test 노드 3개 고정 + 스캔 청크 append).
 *
 * @returns 추가된 Buffer Index, 또는 중복/용량초과 시 -1.
 */
export function appendChunkedNode(
  buffer: NodeBuffer,
  id: string,
  x: number,
  y: number,
  z: number
): number {
  // 중복 ID 방어 (이미 등록된 ID 는 인덱스 안정성 위해 무시).
  if (idToIndex.has(id)) {
    console.warn(`appendChunkedNode: 중복 ID, 건너뜀: ${id}`);
    return -1;
  }
  // capacity 가드 (pushNode 가 throw 하기 전에 우리가 잡는다 — 청크 흐름 중단 방지).
  if (buffer.count >= buffer.capacity) {
    console.warn(
      `appendChunkedNode: capacity 초과 (${buffer.capacity}), 건너뜀: ${id}`
    );
    return -1;
  }
  const idx = pushNode(buffer, x, y, z);
  idToIndex.set(id, idx);
  indexToId.push(id);
  return idx;
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
