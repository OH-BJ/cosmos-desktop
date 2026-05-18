import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { GPUPicker, encodePickColor, decodePickColor } from "./GPUPicker";

/**
 * GPUPicker 단위 테스트 (M7-2 Step 1).
 *
 * WebGL 호출(readPixels/render) 자체는 jsdom 에서 검증 불가 — 실제 렌더 검증은
 * 사용자 수동 시각 검증으로 위임하고, 여기서는 다음을 보장한다:
 *  1) 색상 인코딩/디코딩이 양방향 일관 (id ↔ RGB).
 *  2) miss 판정 (RGB 0,0,0 = -1) 이 id=0 인스턴스와 충돌하지 않음 (+1 오프셋 검증).
 *  3) GPUPicker 생성자가 RenderTarget / ShaderMaterial / uniforms 를 올바르게 셋업.
 *  4) setResolution 이 외부 uniforms 객체에 그대로 반영 (메인 셰이더와 같은 패턴).
 */
describe("GPUPicker", () => {
  describe("encodePickColor / decodePickColor", () => {
    it("id 0,1,255,256,65535 양방향 (id+1 오프셋 확인)", () => {
      // id=0 → +1=1 → [1,0,0]. decode 시 다시 0 으로 복원.
      const cases = [0, 1, 42, 255, 256, 65535, 65536, 1_000_000];
      for (const id of cases) {
        const [r, g, b] = encodePickColor(id);
        const decoded = decodePickColor(new Uint8Array([r, g, b, 255]));
        expect(decoded).toBe(id);
      }
    });

    it("clear color (0,0,0,0) 은 miss 로 디코드 → -1", () => {
      // RT clear 가 검정이라 id=0 이 +1 오프셋 없으면 miss 와 충돌. 그게 사라졌는지 확인.
      const miss = decodePickColor(new Uint8Array([0, 0, 0, 0]));
      expect(miss).toBe(-1);
    });

    it("id=0 은 R=1 로 인코드 → miss(0) 와 분리됨", () => {
      const [r, g, b] = encodePickColor(0);
      expect(r).toBe(1);
      expect(g).toBe(0);
      expect(b).toBe(0);
    });
  });

  describe("생성자", () => {
    it("기본 옵션으로 RenderTarget(1×1) + ShaderMaterial + uniforms 셋업", () => {
      const picker = new GPUPicker();

      const rt = picker.getRenderTarget();
      expect(rt.width).toBe(1);
      expect(rt.height).toBe(1);

      const mat = picker.getMaterial();
      expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
      // size attenuation 식 흔적 — 메인 셰이더와 동일한 분기를 사용했는지 확인.
      expect(mat.vertexShader).toContain("uMinPixelSize");
      expect(mat.vertexShader).toContain("uBaseRadius");
      expect(mat.vertexShader).toContain("gl_InstanceID");
      // (D15) 메인 셰이더와 같은 instance scale 식 — 시각/판정 일치 필수.
      expect(mat.vertexShader).toContain("instanceScale");
      expect(mat.vertexShader).toContain("length(instanceMatrix[0].xyz)");
      // (M7-2 Step 2 hotfix) projectionMatrix[1][1] 사용 금지 — setViewOffset 이 부풀리면
      //   pixelDiameter 가 폭증해 4px 클램프 비활성. uTanHalfFov 로 우회.
      expect(mat.vertexShader).toContain("uTanHalfFov");
      expect(mat.vertexShader).not.toMatch(/projectionMatrix\[1\]\[1\]/);

      const u = picker.getUniforms();
      expect(u.uMinPixelSize.value).toBe(4.0);
      // (D15) BASE_RADIUS=1 — instanceMatrix 의 uniform scale 이 실제 크기 담당.
      expect(u.uBaseRadius.value).toBe(1.0);
      // (M7-2 Step 2 hotfix) 기본 uTanHalfFov = tan(50°/2) — Scene fov 와 일치.
      expect(u.uTanHalfFov.value).toBeCloseTo(Math.tan((50 * Math.PI) / 360), 6);

      picker.dispose();
    });

    it("(M7-2) options.tanHalfFov 적용 + setTanHalfFov 로 갱신", () => {
      const picker = new GPUPicker({ tanHalfFov: 1.0 }); // fov=90° 가정
      const u = picker.getUniforms();
      expect(u.uTanHalfFov.value).toBeCloseTo(1.0);
      picker.setTanHalfFov(0.5);
      expect(u.uTanHalfFov.value).toBeCloseTo(0.5);
      // material 의 uniforms 와 외부 보유 객체가 같은 참조여야 셰이더에 반영됨.
      expect(picker.getMaterial().uniforms.uTanHalfFov).toBe(u.uTanHalfFov);
      picker.dispose();
    });

    it("setResolution 이 외부 uniforms 객체에 반영 (메인 셰이더와 동일 패턴)", () => {
      const picker = new GPUPicker({ resolution: [800, 600] });
      const u = picker.getUniforms();
      expect(u.uResolution.value.x).toBe(800);
      expect(u.uResolution.value.y).toBe(600);

      picker.setResolution(1920, 1080);
      expect(u.uResolution.value.x).toBe(1920);
      expect(u.uResolution.value.y).toBe(1080);

      // material 의 uniforms 객체와 외부 보유 객체가 동일 참조 — { value } 공유 패턴 확인.
      const matUniforms = picker.getMaterial().uniforms;
      expect(matUniforms.uResolution).toBe(u.uResolution);

      picker.dispose();
    });
  });
});
