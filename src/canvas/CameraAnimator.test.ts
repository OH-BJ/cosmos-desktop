import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { CameraAnimator, easeInOutCubic } from "./CameraAnimator";

/**
 * CameraAnimator 단위 테스트 (M8 Step 1).
 *
 * 검증 포인트:
 *  - easeInOutCubic 의 양 끝값 + 중간값 정확도
 *  - start() 가 orbitControls.enabled 를 false 로 만들고 t=0 카메라 셋업
 *  - tick() 진행에 따라 lerp 진행 (t=0.5 가 중간점)
 *  - 완료 시 orbitControls.enabled=true, onComplete 1회 호출
 *  - cancel() 이 진행을 중단하고 enabled 복원
 *  - 진행 중 start() 재호출은 이전 취소 후 새 목적지로
 *
 * 환경 제어:
 *  - performance.now 를 spy 로 고정 → t 계산 결정성 확보.
 *  - requestAnimationFrame 을 큐로 모킹 → flushRaf 로 수동 발사.
 *  - 실제 OrbitControls 는 의존성/DOM 필요 → enabled / target / update 만 가진 stub.
 */

interface OrbitStub {
  enabled: boolean;
  target: THREE.Vector3;
  update: ReturnType<typeof vi.fn>;
}

function makeOrbitStub(): OrbitStub {
  return {
    enabled: true,
    target: new THREE.Vector3(0, 0, 0),
    update: vi.fn(),
  };
}

describe("easeInOutCubic", () => {
  it("t=0,0.5,1 끝점/중간점 정확", () => {
    expect(easeInOutCubic(0)).toBeCloseTo(0, 6);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOutCubic(1)).toBeCloseTo(1, 6);
  });

  it("단조 증가: t1 < t2 면 eased1 <= eased2", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOutCubic(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("CameraAnimator", () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let origRaf: typeof requestAnimationFrame | undefined;
  let origCancel: typeof cancelAnimationFrame | undefined;
  let nowValue: number;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 0;
    nowValue = 1000;
    origRaf = (globalThis as any).requestAnimationFrame;
    origCancel = (globalThis as any).cancelAnimationFrame;
    (globalThis as any).requestAnimationFrame = (
      cb: FrameRequestCallback
    ): number => {
      nextRafId += 1;
      rafCallbacks.set(nextRafId, cb);
      return nextRafId;
    };
    (globalThis as any).cancelAnimationFrame = (id: number): void => {
      rafCallbacks.delete(id);
    };
    vi.spyOn(performance, "now").mockImplementation(() => nowValue);
  });

  afterEach(() => {
    (globalThis as any).requestAnimationFrame = origRaf;
    (globalThis as any).cancelAnimationFrame = origCancel;
    vi.restoreAllMocks();
  });

  function flushRaf(): void {
    const cbs = Array.from(rafCallbacks.values());
    rafCallbacks.clear();
    for (const cb of cbs) cb(performance.now());
  }

  it("start() → orbitControls.enabled=false + t=0 시점 카메라 = fromPos", () => {
    const cam = new THREE.PerspectiveCamera();
    const orbit = makeOrbitStub();
    const animator = new CameraAnimator(cam, orbit as unknown as any);

    animator.start({
      fromPos: new THREE.Vector3(100, 0, 500),
      toPos: new THREE.Vector3(0, 0, 10),
      fromTarget: new THREE.Vector3(0, 0, 0),
      toTarget: new THREE.Vector3(50, 0, 0),
      duration: 100,
    });

    // 즉시 applyAt(0) 호출 → camera.position 이 fromPos 와 동일.
    expect(cam.position.x).toBeCloseTo(100);
    expect(cam.position.y).toBeCloseTo(0);
    expect(cam.position.z).toBeCloseTo(500);
    expect(orbit.target.x).toBeCloseTo(0);
    expect(orbit.enabled).toBe(false);
    expect(animator.isAnimating()).toBe(true);
  });

  it("tick 진행에 따라 t=0.5 중간점, t=1 도착 → enabled=true + onComplete 1회", () => {
    const cam = new THREE.PerspectiveCamera();
    const orbit = makeOrbitStub();
    const animator = new CameraAnimator(cam, orbit as unknown as any);
    const onComplete = vi.fn();

    animator.start({
      fromPos: new THREE.Vector3(0, 0, 0),
      toPos: new THREE.Vector3(100, 0, 0),
      fromTarget: new THREE.Vector3(0, 0, 0),
      toTarget: new THREE.Vector3(10, 0, 0),
      duration: 100,
      onComplete,
    });

    // 중간 시점 — t=0.5, easeInOutCubic(0.5)=0.5 → camera.x=50, target.x=5.
    nowValue = 1050;
    flushRaf();
    expect(cam.position.x).toBeCloseTo(50);
    expect(orbit.target.x).toBeCloseTo(5);
    expect(animator.isAnimating()).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    // 도착 — t>=1.
    nowValue = 1100;
    flushRaf();
    expect(cam.position.x).toBeCloseTo(100);
    expect(orbit.target.x).toBeCloseTo(10);
    expect(orbit.enabled).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(animator.isAnimating()).toBe(false);
  });

  it("cancel() → 진행 중단, enabled 복원, onComplete 미호출", () => {
    const cam = new THREE.PerspectiveCamera();
    const orbit = makeOrbitStub();
    const animator = new CameraAnimator(cam, orbit as unknown as any);
    const onComplete = vi.fn();

    animator.start({
      fromPos: new THREE.Vector3(0, 0, 0),
      toPos: new THREE.Vector3(100, 0, 0),
      fromTarget: new THREE.Vector3(0, 0, 0),
      toTarget: new THREE.Vector3(0, 0, 0),
      duration: 100,
      onComplete,
    });
    expect(animator.isAnimating()).toBe(true);

    animator.cancel();
    expect(animator.isAnimating()).toBe(false);
    expect(orbit.enabled).toBe(true);

    // 뒤늦게 flush 해도 콜백 미호출 (rAF 큐 비워졌고 onComplete=null).
    nowValue = 1100;
    flushRaf();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("진행 중 start() 재호출 → 이전 취소, 새 목적지로 보간", () => {
    const cam = new THREE.PerspectiveCamera();
    const orbit = makeOrbitStub();
    const animator = new CameraAnimator(cam, orbit as unknown as any);
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();

    animator.start({
      fromPos: new THREE.Vector3(0, 0, 0),
      toPos: new THREE.Vector3(100, 0, 0),
      fromTarget: new THREE.Vector3(0, 0, 0),
      toTarget: new THREE.Vector3(0, 0, 0),
      duration: 100,
      onComplete: onCompleteA,
    });
    // 진행 중간에 새 start.
    nowValue = 1050;
    animator.start({
      fromPos: new THREE.Vector3(50, 0, 0),
      toPos: new THREE.Vector3(200, 0, 0),
      fromTarget: new THREE.Vector3(0, 0, 0),
      toTarget: new THREE.Vector3(0, 0, 0),
      duration: 100,
      onComplete: onCompleteB,
    });
    // t=0 새 출발 — camera.x=50.
    expect(cam.position.x).toBeCloseTo(50);

    // 새 도착.
    nowValue = 1150;
    flushRaf();
    expect(cam.position.x).toBeCloseTo(200);
    expect(onCompleteA).not.toHaveBeenCalled();
    expect(onCompleteB).toHaveBeenCalledTimes(1);
  });

  it("dispose() → pending rAF 정리 + enabled 복원 (HMR 안전)", () => {
    const cam = new THREE.PerspectiveCamera();
    const orbit = makeOrbitStub();
    const animator = new CameraAnimator(cam, orbit as unknown as any);

    animator.start({
      fromPos: new THREE.Vector3(0, 0, 0),
      toPos: new THREE.Vector3(100, 0, 0),
      fromTarget: new THREE.Vector3(0, 0, 0),
      toTarget: new THREE.Vector3(0, 0, 0),
      duration: 100,
    });
    expect(animator.isAnimating()).toBe(true);

    animator.dispose();
    expect(animator.isAnimating()).toBe(false);
    expect(orbit.enabled).toBe(true);
    expect(rafCallbacks.size).toBe(0);
  });
});
