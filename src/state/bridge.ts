import { Node } from "./store";
import { NodeBuffer, pushNode } from "./nodeBuffer";

/**
 * bridge — 고빈도/저빈도 상태 동기화
 *
 * Zustand (저빈도)의 노드 배열을 TypedArray (고빈도)로 동기화.
 * 이중 상태 아키텍처에서 두 세계가 만나는 지점.
 *
 * 패턴:
 * 1) 사용자가 파일을 로드 → IPC로 Rust에서 노드 목록 받음
 * 2) useCosmosStore().setNodes(nodes) → Zustand 업데이트
 * 3) syncFromStore() → TypedArray로 변환, InstancedNodes와 동기화
 *
 * M2에서 고민: 고빈도 동기화(애니메이션 중 위치 갱신)는
 * 렌더 루프에서 직접 처리할 계획.
 */

/**
 * syncFromStore() — Zustand 노드 목록 → TypedArray 버퍼로 동기화
 *
 * @param nodes Zustand의 nodes 배열 (또는 직접 전달)
 * @param buffer 대상 NodeBuffer
 *
 * 구현은 단순 변환만 (M1).
 * M2에서 변경사항 추적(diff), 부분 업데이트 등으로 최적화할 예정.
 */
export function syncFromStore(nodes: Node[], buffer: NodeBuffer): void {
  // M1: 간단한 구현. 모든 노드를 한 번에 다시 쓴다.
  // (성능상 비효율적이지만, M1에서는 노드 1개라 문제 없음)

  // M2 이상에서는:
  // - 이전 count와 현재 nodes.length 비교해서 추가/삭제 감지
  // - 변경된 노드만 업데이트 (diff-based sync)
  // - 렌더 루프 안에서 호출 가능하도록 최적화

  if (nodes.length > buffer.capacity) {
    console.error(
      `syncFromStore: nodes.length (${nodes.length}) > buffer.capacity (${buffer.capacity})`
    );
    return;
  }

  // 버퍼 초기화
  buffer.count = 0;

  // 각 노드를 버퍼에 복사
  for (const node of nodes) {
    // 노드 ID를 숫자로 변환 (UUID 문자열은 나중에 hash 함수 필요)
    // M1: 인덱스를 ID로 대체 (임시)
    const numericId = node.id.charCodeAt(0); // 임시 변환

    try {
      pushNode(buffer, node.x, node.y, node.z, numericId);
    } catch (e) {
      console.error(`Failed to push node ${node.id}:`, e);
    }
  }
}

/**
 * setupStoreSynchronization() — Zustand 변경을 감시하고 TypedArray 동기화
 *
 * M1에서는 호출하지 않음 (기능 없음).
 * M2에서 구현: useCosmosStore의 subscribe() 이용해서
 * nodes 변경 → syncFromStore 자동 호출.
 *
 * 예:
 * useCosmosStore.subscribe(
 *   state => state.nodes,
 *   nodes => syncFromStore(nodes, buffer)
 * );
 */
export function setupStoreSynchronization(_buffer: NodeBuffer): () => void {
  // M1: 더미 함수 (리턴만). buffer 인자는 M2에서 구독 콜백이 사용.
  // M2: useCosmosStore.subscribe 로 nodes 변경 감시 → syncFromStore 호출

  return () => {
    // 정리 함수 (구독 해제)
  };
}
