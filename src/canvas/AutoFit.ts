import * as THREE from "three";
import type { NodeBuffer } from "../state/nodeBuffer";

/**
 * AutoFit — 별자리 전체가 화면에 들어오는 카메라 위치 계산 (M8 Step 3).
 *
 * 호출 시나리오:
 *   - 스캔 완료 (isLast 청크 도착) 직후 자동 실행 → CameraAnimator.start 로 부드럽게 이동.
 *   - 우상단 "홈" 버튼 클릭 → 동일 경로.
 *   - 사용자가 D5 까지 깊이 침투했다가 다시 전경으로 빠져나오고 싶을 때.
 *
 * 알고리즘:
 *   1) buffer.positions 의 [0, count) 범위를 한 번 순회 → AABB (min/max 6 값).
 *   2) center = 중간점, radius = AABB 의 대각 절반 (대각구 반지름).
 *   3) distance = (radius / tan(fov/2)) × padding — 수직 FOV 기준이라 가로폭은 자연히 포함.
 *   4) cameraPos = center + (현재 카메라 → center 방향) × distance.
 *      현재 시야 각도를 보존해 "급격한 회전" 없이 줌만 조정.
 *
 * 의존성 0 — 순수 함수, three.js Vector3 만 사용. 테스트 용이.
 */

export interface FitViewResult {
  /** OrbitControls.target 도착 위치 (AABB 중심). */
  target: THREE.Vector3;
  /** Camera position 도착 위치. */
  cameraPos: THREE.Vector3;
  /** 디버그/테스트용 — distance 와 radius 값. */
  distance: number;
  radius: number;
}

/** AABB 가 너무 작을 때 (모든 노드가 한 점) 폴백 최소 거리. 카메라가 점에 박히지 않게. */
const MIN_FIT_DISTANCE = 1.0;

/**
 * computeFitView — 별자리 AABB + FOV 기반 카메라 적정 위치 산출.
 *
 * @param buffer NodeBuffer (positions 가 채워진 상태). count=0 이면 null 반환.
 * @param camera PerspectiveCamera (fov 와 현재 position 사용).
 * @param padding 거리 곱 — 1.0 = 정확히 화면 가득, 1.1 = 10% 여백. 기본 1.1.
 *
 * @returns 도착 좌표 객체. buffer 가 비어 있으면 null.
 */
export function computeFitView(
  buffer: NodeBuffer,
  camera: THREE.PerspectiveCamera,
  padding: number = 1.1
): FitViewResult | null {
  if (buffer.count === 0) return null;

  // AABB 한 번 순회로 계산. instance scale 은 무시 — 위치 분포가 거리 결정 요인.
  //   (M9+ 후속) 거대한 D1 노드들이 시야 외곽으로 잘릴 수 있으면 scale 포함 검토.
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < buffer.count; i++) {
    const b = i * 3;
    const x = buffer.positions[b];
    const y = buffer.positions[b + 1];
    const z = buffer.positions[b + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  // 대각구 반지름 — AABB 의 모든 꼭짓점을 포함하는 가장 작은 구. 회전 무관한 보수적 측정.
  const hx = (maxX - minX) / 2;
  const hy = (maxY - minY) / 2;
  const hz = (maxZ - minZ) / 2;
  const radius = Math.sqrt(hx * hx + hy * hy + hz * hz);

  // distance 산출 — 수직 FOV 기준.
  //   radius / tan(fov/2) = 카메라가 그 radius 만큼의 영역을 시야 수직에 가득 담는 거리.
  const fovRad = (camera.fov * Math.PI) / 180;
  const rawDistance = (radius / Math.tan(fovRad / 2)) * padding;
  const distance = Math.max(MIN_FIT_DISTANCE, rawDistance);

  const target = new THREE.Vector3(cx, cy, cz);

  // 현재 시야 방향 보존 — 사용자가 보던 각도 그대로 줌만 조정. 카메라가 target 과
  //   거의 일치하는 극단 케이스는 (0, 0, 1) 폴백.
  const dir = new THREE.Vector3().subVectors(camera.position, target);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();

  const cameraPos = target.clone().add(dir.multiplyScalar(distance));

  return { target, cameraPos, distance, radius };
}
