import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * CameraAnimator — Fly-to (카메라 위치/타겟 보간) 모듈 (M8 Step 1).
 *
 * 설계 결정 (PLAN_M8.md):
 *  - **의존성 0**: gsap/TWEEN 미사용, 직접 lerp + rAF. lodash 금지 정책과 일치.
 *  - **camera.position + orbitControls.target 동시 보간** — 그래야 카메라가
 *    자연스럽게 회전하면서 도착. position 만 lerp 하면 도착해도 엉뚱한 방향 응시.
 *  - **OrbitControls 일시 비활성**: `orbitControls.enabled = false` 로 사용자 입력 차단.
 *    CameraController 의 pan/wheel 핸들러도 `enabled === false` 체크로 같이 차단됨.
 *  - 애니메이션 중 다시 start 호출되면 **이전 취소** 후 새 목적지로 시작.
 *
 * 외부 의존성: PerspectiveCamera + OrbitControls 두 객체만. Scene/Renderer 불필요.
 *
 * 라이프사이클:
 *   `start(opts)` 호출 → rAF 루프 시작 → 매 프레임 lerp + orbitControls.update()
 *   → t>=1 시 finish (orbitControls.enabled=true, onComplete 발사) 또는 `cancel()` 로 중단.
 *   `dispose()` 는 pending rAF 정리 (HMR / unmount 안전).
 */

/** 기본 fly-to 지속 시간 (ms). PLAN_M8 결정값. */
export const FLY_TO_DEFAULT_DURATION_MS = 800;

/**
 * easeInOutCubic — 가속/감속 보간 함수.
 *
 * - t ∈ [0, 1], 반환 ∈ [0, 1]
 * - t=0 → 0, t=0.5 → 0.5, t=1 → 1
 * - 초반/후반 부드럽게, 중반은 빠르게 (시각적 만족도 ↑)
 *
 * 수식: t<0.5 → 4t³ / t>=0.5 → 1 - (-2t+2)³/2.
 *   gsap/TWEEN 의 easing 도 동일 공식 사용. 외부 라이브러리 없이 한 줄로 구현 가능.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface FlyToOptions {
  /** 출발 카메라 위치 (Vector3 복제됨 — 외부에서 수정해도 안전). */
  fromPos: THREE.Vector3;
  /** 도착 카메라 위치. */
  toPos: THREE.Vector3;
  /** 출발 시점 OrbitControls.target. */
  fromTarget: THREE.Vector3;
  /** 도착 시점 OrbitControls.target. */
  toTarget: THREE.Vector3;
  /** ms. 기본 800. */
  duration?: number;
  /** 완료 시 1회 호출. cancel 된 경우엔 호출 안 됨. */
  onComplete?: () => void;
}

export class CameraAnimator {
  private camera: THREE.PerspectiveCamera;
  private orbitControls: OrbitControls;

  private rafId: number | null = null;
  private startTime = 0;
  private duration = 0;

  // 출발/도착 벡터는 매 start 마다 .copy() 로 갱신 — 한 번 할당해두고 재사용.
  private readonly fromPos = new THREE.Vector3();
  private readonly toPos = new THREE.Vector3();
  private readonly fromTarget = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();

  private onComplete: (() => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera, orbitControls: OrbitControls) {
    this.camera = camera;
    this.orbitControls = orbitControls;
  }

  /**
   * start() — Fly-to 시작. 이전 애니메이션 진행 중이면 취소 후 새 시작.
   *
   * orbitControls.enabled 를 false 로 만들어 사용자 입력 차단.
   * 도착 시 (또는 cancel 시) 다시 true 로 복원.
   */
  start(opts: FlyToOptions): void {
    // 이전 진행 중이면 정리. 새 onComplete 가 이전 onComplete 를 대체.
    if (this.rafId !== null) {
      this.cancelRaf();
      // 단, orbitControls.enabled 복원은 새 애니메이션이 다시 false 로 설정할 거라 skip.
    }

    this.fromPos.copy(opts.fromPos);
    this.toPos.copy(opts.toPos);
    this.fromTarget.copy(opts.fromTarget);
    this.toTarget.copy(opts.toTarget);
    this.duration = Math.max(1, opts.duration ?? FLY_TO_DEFAULT_DURATION_MS);
    this.onComplete = opts.onComplete ?? null;
    this.startTime = performance.now();

    this.orbitControls.enabled = false;

    // 즉시 1프레임 진행값(t=0) 로 카메라 셋업 — render 가 다음 vsync 까지 못 기다리는 케이스 대비.
    this.applyAt(0);
    this.scheduleTick();
  }

  /**
   * cancel() — 진행 중 애니메이션 중단. orbitControls 복원 + onComplete 미발사.
   *   start() 가 다시 호출되면 동일 효과를 내므로, 외부에서 강제 종료 용도.
   */
  cancel(): void {
    if (this.rafId === null) return;
    this.cancelRaf();
    this.orbitControls.enabled = true;
    this.onComplete = null;
  }

  /** 진행 중 여부 — 테스트/외부 가드에서 사용. */
  isAnimating(): boolean {
    return this.rafId !== null;
  }

  /** HMR/unmount 시 pending rAF 정리. orbitControls 도 안전 복원. */
  dispose(): void {
    this.cancel();
  }

  /**
   * applyAt() — 정규화된 시간 t ∈ [0,1] 에서 카메라/타겟 보간.
   *   eased = easeInOutCubic(t). lerpVectors 는 NaN 입력 안전 (t 가 NaN 이면 결과도 NaN — 호출자 책임).
   */
  private applyAt(t: number): void {
    const eased = easeInOutCubic(t);
    this.camera.position.lerpVectors(this.fromPos, this.toPos, eased);
    this.orbitControls.target.lerpVectors(this.fromTarget, this.toTarget, eased);
    // orbitControls 의 내부 매트릭스 갱신 — target 변경 즉시 반영.
    this.orbitControls.update();
  }

  private scheduleTick(): void {
    if (typeof requestAnimationFrame !== "function") return;
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    this.rafId = null;
    const now = performance.now();
    const elapsed = now - this.startTime;
    const t = Math.min(1, Math.max(0, elapsed / this.duration));
    this.applyAt(t);

    if (t >= 1) {
      // 완료 — orbitControls 복원 + 콜백 발사. 콜백이 다시 start 호출할 수도 있으니 null 처리 먼저.
      this.orbitControls.enabled = true;
      const cb = this.onComplete;
      this.onComplete = null;
      cb?.();
    } else {
      this.scheduleTick();
    }
  }

  private cancelRaf(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }
}
