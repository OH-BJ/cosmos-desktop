import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { projectToScreen } from "./projection";

/**
 * projection 단위 테스트 (M7-2 Step 2).
 *
 * 검증 포인트:
 *  1) 카메라 정면 정중앙(0,0,0) 노드는 화면 중앙으로 투영.
 *  2) 카메라 뒤쪽 노드는 behindCamera=true.
 *  3) Y 반전 — 월드 +y 가 화면 위쪽(작은 screenY) 으로.
 *  4) 뷰포트 크기 변동에 비례.
 *
 * 카메라 사양 (간단한 숫자 보장):
 *   fov=90, aspect=1, near=0.1, far=10000, position.z=500 → 화면 중앙은 (W/2, H/2).
 */
describe("projectToScreen", () => {
  function makeCamera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 10000);
    cam.position.set(0, 0, 500);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    return cam;
  }

  it("원점 노드 → 화면 중앙으로 투영", () => {
    const cam = makeCamera();
    const result = projectToScreen({ x: 0, y: 0, z: 0 }, cam, 800, 600);
    expect(result.screenX).toBeCloseTo(400, 1);
    expect(result.screenY).toBeCloseTo(300, 1);
    expect(result.behindCamera).toBe(false);
  });

  it("월드 +y 방향 노드 → 화면 위쪽 (screenY < H/2) — Y 반전 확인", () => {
    const cam = makeCamera();
    const result = projectToScreen({ x: 0, y: 100, z: 0 }, cam, 800, 600);
    expect(result.screenX).toBeCloseTo(400, 1);
    expect(result.screenY).toBeLessThan(300);
    expect(result.behindCamera).toBe(false);
  });

  it("카메라 뒤쪽 노드 → behindCamera=true", () => {
    const cam = makeCamera();
    // 카메라가 z=500, lookAt(0,0,0) 이므로 시야는 -z 방향. z=+1000 은 카메라 뒤쪽.
    const result = projectToScreen({ x: 0, y: 0, z: 1000 }, cam, 800, 600);
    expect(result.behindCamera).toBe(true);
  });

  it("뷰포트 크기 변동에 비례 (원점 → W/2, H/2 유지)", () => {
    const cam = makeCamera();
    const small = projectToScreen({ x: 0, y: 0, z: 0 }, cam, 200, 100);
    expect(small.screenX).toBeCloseTo(100, 1);
    expect(small.screenY).toBeCloseTo(50, 1);
  });
});
