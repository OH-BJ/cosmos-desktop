/**
 * nodeBuffer — 고빈도 상태용 TypedArray 구조
 *
 * 이중 상태 아키텍처의 "고빈도" 부분. React 리렌더를 우회하고,
 * 렌더 루프에서 직접 읽고 쓸 수 있는 메모리 레이아웃.
 *
 * 구조:
 * - Float32Array positions: [x0, y0, z0, x1, y1, z1, ...] stride=3
 * - Uint32Array ids: [id0, id1, id2, ...]
 *
 * 왜 TypedArray를 쓰나?
 * 1) JS 객체 배열 → 노드당 메모리 오버헤드 큼 (해시맵, 프로토타입 등)
 * 2) TypedArray → 연속 메모리 + SIMD 최적화 가능
 * 3) 렌더 루프에서 매 프레임 읽을 때, 가비지 수집 부담 0
 * 4) three.js BufferGeometry 업로드할 때 직접 전달 가능
 *
 * 성능: 초기 1024 capacity → 100k 노드까지 확장 가능,
 * 재할당 시에만 복사 (amortized O(1))
 */

export const INITIAL_CAPACITY = 1024;

/**
 * NodeBuffer — 노드 좌표/ID를 저장하는 저수준 버퍼
 *
 * @property positions Float32Array (stride 3: x, y, z)
 * @property ids Uint32Array
 * @property capacity 최대 수용 노드 수
 * @property count 현재 활성 노드 수
 */
export interface NodeBuffer {
  positions: Float32Array;
  ids: Uint32Array;
  capacity: number;
  count: number;
}

/**
 * allocateNodeBuffer() — 초기 버퍼 할당
 *
 * @param capacity 초기 용량 (기본값: INITIAL_CAPACITY=1024)
 * @returns NodeBuffer 인스턴스
 */
export function allocateNodeBuffer(
  capacity: number = INITIAL_CAPACITY
): NodeBuffer {
  return {
    // positions: stride=3 이므로 총 길이는 capacity * 3
    // 예: capacity=1024 → Float32Array 길이 3072
    // 액세스: node i의 x = positions[i*3], y = positions[i*3+1], z = positions[i*3+2]
    positions: new Float32Array(capacity * 3),

    // ids: 노드 인스턴스 ID. 나중에 Zustand 스토어와 매칭할 때 사용
    // (부동소수점 오버플로우 회피, 정수 ID 안전)
    ids: new Uint32Array(capacity),

    capacity,
    count: 0,
  };
}

/**
 * growNodeBuffer() — 용량 부족 시 버퍼 확장
 *
 * newCapacity = min(oldCapacity * 1.5, oldCapacity + 10000)
 * amortized cost O(1) per insertion
 *
 * @param buffer 기존 버퍼
 * @param newCapacity 새 용량
 * @returns 확장된 NodeBuffer (기존 데이터 복사됨)
 */
export function growNodeBuffer(
  buffer: NodeBuffer,
  newCapacity: number
): NodeBuffer {
  if (newCapacity <= buffer.capacity) {
    return buffer; // 이미 충분하면 아무것도 안 함
  }

  const newBuffer = allocateNodeBuffer(newCapacity);

  // 기존 데이터 복사
  newBuffer.positions.set(buffer.positions.subarray(0, buffer.count * 3));
  newBuffer.ids.set(buffer.ids.subarray(0, buffer.count));
  newBuffer.count = buffer.count;

  return newBuffer;
}

/**
 * pushNode() — 버퍼에 노드 한 개 추가
 *
 * @param buffer NodeBuffer
 * @param x, y, z 좌표
 * @param id 노드 ID
 */
export function pushNode(
  buffer: NodeBuffer,
  x: number,
  y: number,
  z: number,
  id: number
): void {
  if (buffer.count >= buffer.capacity) {
    throw new Error(
      `NodeBuffer overflow: count=${buffer.count}, capacity=${buffer.capacity}`
    );
  }

  const idx = buffer.count;
  buffer.positions[idx * 3] = x;
  buffer.positions[idx * 3 + 1] = y;
  buffer.positions[idx * 3 + 2] = z;
  buffer.ids[idx] = id;

  buffer.count++;
}

/**
 * getNodePosition() — 특정 노드의 좌표 읽기
 *
 * @param buffer NodeBuffer
 * @param nodeIndex 노드 인덱스
 * @returns [x, y, z]
 */
export function getNodePosition(
  buffer: NodeBuffer,
  nodeIndex: number
): [number, number, number] {
  if (nodeIndex < 0 || nodeIndex >= buffer.count) {
    throw new Error(`Node index out of bounds: ${nodeIndex}`);
  }
  const i = nodeIndex * 3;
  return [buffer.positions[i], buffer.positions[i + 1], buffer.positions[i + 2]];
}

/**
 * setNodePosition() — 특정 노드의 좌표 업데이트
 *
 * @param buffer NodeBuffer
 * @param nodeIndex 노드 인덱스
 * @param x, y, z 새 좌표
 */
export function setNodePosition(
  buffer: NodeBuffer,
  nodeIndex: number,
  x: number,
  y: number,
  z: number
): void {
  if (nodeIndex < 0 || nodeIndex >= buffer.count) {
    throw new Error(`Node index out of bounds: ${nodeIndex}`);
  }
  const i = nodeIndex * 3;
  buffer.positions[i] = x;
  buffer.positions[i + 1] = y;
  buffer.positions[i + 2] = z;
}
