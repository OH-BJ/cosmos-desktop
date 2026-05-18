import type { UnlistenFn } from "@tauri-apps/api/event";
import { events, type NodeChunkEvent } from "../lib/bindings";
import type { NodeBuffer } from "./nodeBuffer";
import { appendChunkedNode } from "./bridge";

/**
 * nodeChunkSync — 디렉토리 스캔 청크 → 버퍼/매핑 점진 병합 (M6-2 Step 1)
 *
 * 데이터 흐름 (Backend → Frontend):
 *   Rust scanner → tokio::spawn → emit `node-chunk-event`
 *     → events.nodeChunkEvent.listen (이 모듈)
 *     → processNodeChunk → appendChunkedNode (bridge)
 *     → onAfterChunk (App 에서 InstancedNodes.syncFromBuffer 트리거)
 *     → GPU 렌더 갱신
 *
 * 설계 결정:
 *  - Zustand 우회: 청크가 수천 개 들어와도 React 리렌더 없음. 고빈도 레이어
 *    (NodeBuffer + bridge 매핑) 만 갱신. UI 카운터(노드 N개)는 하드코딩 3 그대로.
 *  - **(M7-1 Step 1) 좌표는 Rust 가 결정**: 더 이상 Frontend 에서 random 폴백을
 *    만들지 않는다. ScannedNode.position = [x, y, z] 가 Fractal Orbital Packing
 *    으로 계산된 결정성 있는 우주 좌표. 이 모듈은 그대로 buffer 에 기록.
 *  - 청크 순서: Rust 가 단일 task 로 직렬 emit 하므로 chunk_id 가 0,1,2,... 단조
 *    증가해야 정상. 어긋나면 경고만 — 처리 자체는 도착 순서대로 (append-only).
 */

/**
 * NodeChunkSyncOptions — listener 의존성 주입.
 *
 * @property onAfterChunk 청크 처리 직후 호출. InstancedMesh.syncFromBuffer 트리거 용도.
 */
export interface NodeChunkSyncOptions {
  onAfterChunk?: (chunk: NodeChunkEvent) => void;
}

/**
 * processNodeChunk() — 단일 청크 처리 (pure, 테스트 가능).
 *
 * 청크 내부 노드를 순회하며 ScannedNode.position 을 그대로 buffer + bridge 매핑에 push.
 *
 * 후속 InstancedMesh 갱신은 호출자(setupNodeChunkSync 의 onAfterChunk)가 담당.
 * 이 함수가 직접 InstancedNodes 를 모르도록 격리 → 단위 테스트에서 three.js 불필요.
 *
 * @returns 실제로 append 된 노드 수 (중복/overflow 로 거부된 항목 제외).
 */
export function processNodeChunk(
  chunk: NodeChunkEvent,
  buffer: NodeBuffer
): number {
  let appended = 0;
  for (const node of chunk.nodes) {
    const [x, y, z] = node.position;
    // (D15) ScannedNode.scale 을 buffer 에 함께 기록. InstancedMesh 가 compose 단계에서
    //   uniform scale 로 사용. scale 이 없는 (구버전 백엔드) 청크는 1 로 폴백.
    const scale = node.scale ?? 1;
    // (M7-2 Step 2) name 은 호버 툴팁이 사용. 없으면 id 폴백.
    const name = node.name ?? node.id;
    const idx = appendChunkedNode(buffer, node.id, x, y, z, scale, name);
    if (idx >= 0) appended++;
  }
  return appended;
}

/**
 * setupNodeChunkSync() — Tauri 청크 이벤트 리스너 부착.
 *
 * 비동기 함수인 이유: events.nodeChunkEvent.listen 이 Promise<UnlistenFn> 반환.
 * App.tsx 에선 .then 으로 unsub 을 ref 에 보관 → cleanup 에서 호출.
 *
 * 처리 순서:
 *  1) chunk_id 단조 증가 검증 (어긋나면 console.warn, 처리는 계속)
 *  2) processNodeChunk → 버퍼/매핑 갱신
 *  3) onAfterChunk(chunk) → InstancedMesh 갱신
 *
 * @param buffer 노드 좌표를 채울 NodeBuffer (App 이 allocate 한 인스턴스).
 * @param options onAfterChunk 후속 훅.
 * @returns Promise<unsubscribe>. await 후 cleanup 에서 호출.
 */
export async function setupNodeChunkSync(
  buffer: NodeBuffer,
  options: NodeChunkSyncOptions = {}
): Promise<UnlistenFn> {
  const { onAfterChunk } = options;
  // chunk_id 순서 추적. -1 로 시작 → 첫 정상 청크는 0 이어야 함.
  let lastChunkId = -1;

  const unsub = await events.nodeChunkEvent.listen((event) => {
    const chunk = event.payload;

    // Rust 가 직렬 emit 하므로 0, 1, 2, ... 단조 증가가 정상.
    // 어긋난다면 multi-task 분할 도입 등 backend 변경 신호 → 경고만, 차단은 안 함.
    if (chunk.chunkId !== lastChunkId + 1) {
      console.warn(
        `node-chunk-event: 순서 어긋남 (expected ${lastChunkId + 1}, got ${chunk.chunkId})`
      );
    }
    lastChunkId = chunk.chunkId;

    processNodeChunk(chunk, buffer);
    onAfterChunk?.(chunk);
  });

  return unsub;
}
