import * as THREE from "three";

/**
 * projection — 월드 3D → 화면 픽셀 좌표 변환 유틸 (M7-2 Step 2).
 *
 * 호버 툴팁이 노드 3D 좌표 위에 DOM 박스를 띄우려면 매 프레임 화면 픽셀로 변환해야 한다.
 * three.js 의 Vector3.project(camera) 가 NDC([-1,1]) 좌표를 반환 → 뷰포트 크기로 픽셀화.
 *
 * 좌표계 메모:
 *   NDC.x: 좌(-1) → 우(+1)
 *   NDC.y: 하(-1) → 상(+1)
 *   화면 픽셀(CSS): 좌(0) → 우(W), 상(0) → 하(H)  ← y 반전 필요.
 *   NDC.z: 카메라 앞(-1~+1) → 카메라 뒤(z>1) 인 경우 화면 표시 X.
 *
 * 순수 함수 — 외부 상태 없음. 테스트 용이.
 */

export interface ProjectionResult {
  /** 화면 픽셀 X (CSS 단위, 캔버스 좌상단 기준 0). */
  screenX: number;
  /** 화면 픽셀 Y. */
  screenY: number;
  /** 카메라 뒤쪽이면 true — 호출 측에서 툴팁 숨김 처리 권장. */
  behindCamera: boolean;
}

/**
 * projectToScreen — 월드 좌표를 화면 CSS 픽셀로 투영.
 *
 * @param world 월드 좌표 (보통 NodeBuffer.positions 에서 읽음).
 * @param camera PerspectiveCamera (Scene.getCamera()).
 * @param viewportWidth CSS 픽셀 폭 (canvas.clientWidth).
 * @param viewportHeight CSS 픽셀 높이 (canvas.clientHeight).
 *
 * @returns { screenX, screenY, behindCamera }.
 */
export function projectToScreen(
  world: { x: number; y: number; z: number },
  camera: THREE.PerspectiveCamera,
  viewportWidth: number,
  viewportHeight: number
): ProjectionResult {
  // Vector3.project 는 카메라의 projectionMatrix × matrixWorldInverse 를 적용한다.
  //   매 프레임 호출되므로 GC 부담 최소화 위해 내부 임시 객체 재사용 (모듈 스코프).
  _tmpVec.set(world.x, world.y, world.z);
  _tmpVec.project(camera);

  const behindCamera = _tmpVec.z > 1;
  const screenX = (_tmpVec.x + 1) * 0.5 * viewportWidth;
  // Y 반전: NDC 위쪽=+1 → 화면 상단=0.
  const screenY = (1 - _tmpVec.y) * 0.5 * viewportHeight;
  return { screenX, screenY, behindCamera };
}

// 모듈 스코프 임시 Vector3 — 호출 빈도가 높아 GC 부담 회피.
const _tmpVec = new THREE.Vector3();
