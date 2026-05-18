import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { computeFitView } from "./AutoFit";
import { allocateNodeBuffer, pushNode } from "../state/nodeBuffer";

/**
 * computeFitView 단위 테스트 (M8 Step 3).
 *
 * 검증:
 *  - 빈 buffer → null.
 *  - 3 노드 AABB → 중심점 정확 + 대각구 반지름 + distance 수식 일치.
 *  - 모든 노드가 한 점 → distance >= MIN_FIT_DISTANCE 폴백.
 *  - padding 파라미터가 distance 에 곱셈으로 반영.
 *
 * 수식: distance = max(MIN, (radius / tan(fov/2)) * padding).
 *   FOV=90° 가정 → tan(45°)=1 → distance = radius * padding.
 */

function makeCamera(fov: number, pos: [number, number, number]): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 100000);
  cam.position.set(pos[0], pos[1], pos[2]);
  return cam;
}

describe("computeFitView", () => {
  it("빈 buffer → null (카메라 이동 안 함)", () => {
    const buffer = allocateNodeBuffer(8);
    const cam = makeCamera(90, [0, 0, 100]);
    expect(computeFitView(buffer, cam)).toBeNull();
  });

  it("3 노드 AABB 중심 정확 + radius/distance 수식 일치", () => {
    const buffer = allocateNodeBuffer(8);
    pushNode(buffer, -10, 0, 0);
    pushNode(buffer, 10, 0, 0);
    pushNode(buffer, 0, 20, 0); // x: [-10, 10], y: [0, 20], z: [0, 0]
    const cam = makeCamera(90, [0, 0, 100]);

    const fit = computeFitView(buffer, cam, 1.0)!;
    expect(fit).not.toBeNull();

    // 중심점: x=(min+max)/2=0, y=10, z=0.
    expect(fit.target.x).toBeCloseTo(0, 3);
    expect(fit.target.y).toBeCloseTo(10, 3);
    expect(fit.target.z).toBeCloseTo(0, 3);

    // 대각구 반지름 = sqrt(10² + 10² + 0²) = sqrt(200) ≈ 14.142.
    expect(fit.radius).toBeCloseTo(Math.sqrt(200), 3);

    // FOV=90° → tan(45°)=1 → distance = radius * 1.0 = sqrt(200).
    expect(fit.distance).toBeCloseTo(Math.sqrt(200), 3);
  });

  it("padding 파라미터가 distance 에 곱셈으로 반영", () => {
    const buffer = allocateNodeBuffer(4);
    pushNode(buffer, -10, -10, 0);
    pushNode(buffer, 10, 10, 0);
    const cam = makeCamera(90, [0, 0, 100]);

    const tight = computeFitView(buffer, cam, 1.0)!;
    const loose = computeFitView(buffer, cam, 1.5)!;
    expect(loose.distance / tight.distance).toBeCloseTo(1.5, 3);
  });

  it("모든 노드가 한 점에 모여있음 → MIN_FIT_DISTANCE 폴백 (>=1.0) + center 정확", () => {
    const buffer = allocateNodeBuffer(4);
    pushNode(buffer, 5, 5, 5);
    pushNode(buffer, 5, 5, 5);
    const cam = makeCamera(90, [0, 0, 100]);
    const fit = computeFitView(buffer, cam, 1.0)!;
    // radius = 0 → rawDistance = 0 → MIN_FIT_DISTANCE=1.0 으로 클램프.
    expect(fit.distance).toBeGreaterThanOrEqual(1.0);
    expect(fit.target.x).toBeCloseTo(5, 3);
    expect(fit.target.y).toBeCloseTo(5, 3);
    expect(fit.target.z).toBeCloseTo(5, 3);
  });

  it("cameraPos = target + (현재 카메라→target 방향) × distance (시야 각도 보존)", () => {
    const buffer = allocateNodeBuffer(4);
    pushNode(buffer, 0, 0, 0);
    pushNode(buffer, 2, 0, 0); // 중심 (1, 0, 0), radius = 1.0.
    // 카메라가 +z 위에 있음 → 도착 카메라도 target 의 +z 쪽.
    const cam = makeCamera(90, [1, 0, 50]);
    const fit = computeFitView(buffer, cam, 1.0)!;

    // target = (1, 0, 0). 현재 카메라 - target = (0, 0, 50) 정규화 = (0,0,1).
    //   cameraPos = (1, 0, 0) + (0, 0, 1) × distance.
    expect(fit.cameraPos.x).toBeCloseTo(1, 3);
    expect(fit.cameraPos.y).toBeCloseTo(0, 3);
    expect(fit.cameraPos.z).toBeCloseTo(fit.distance, 3);
  });
});
