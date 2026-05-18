import * as THREE from "three";

/**
 * GPUPicker — Offscreen Color-Buffer 기반 노드 클릭 판정 (M7-2 Step 1).
 *
 * Why GPU Picking 인가:
 *   M7-1 Step 2 의 size attenuation (4×4px 클램프) 으로 distant 노드가 화면에 강제로
 *   확대돼 보이지만, Raycaster 는 *원본* geometry(반지름 500) 기준 boundingSphere 와
 *   삼각형 교차를 검사한다 → 화면에는 보이지만 ray hit 가 안 잡히는 모순 발생.
 *   해결: 사용자가 보는 그 픽셀을 그대로 GPU 가 칠한 색에서 ID 를 역추적 → 시각/판정 일치.
 *
 * 파이프라인:
 *   1) 1×1 WebGLRenderTarget 준비 (클릭 위치 1픽셀만 샘플링하면 충분).
 *   2) 별도 ShaderMaterial — vertex 는 메인 셰이더와 *동일한* size-attenuation 식,
 *      fragment 는 gl_InstanceID 를 RGB 로 인코딩.
 *   3) pickAtScreen(x, y):
 *      - camera.setViewOffset 으로 1×1 CSS 픽셀에 해당하는 절두체로 좁힘.
 *      - scene.overrideMaterial 로 임시 swap.
 *      - renderer.setRenderTarget(rt); renderer.render(scene, camera).
 *      - readRenderTargetPixels 로 RGBA 1바이트 추출 → ID 복원.
 *      - 모든 상태 원복 (overrideMaterial=null, target=null, clearViewOffset).
 *
 * 인코딩 규칙:
 *   id+1 을 24bit (R,G,B) 로 분해. id=0 vs miss(클리어색=검정) 가 충돌하지 않게 +1 오프셋.
 *   복원 시 0 이면 miss → -1 반환.
 *
 * 호환성:
 *   - gl_InstanceID 는 WebGL2 컨텍스트 필수. three.js r169 기본이 WebGL2 라 안전.
 *   - logarithmicDepthBuffer=true 와 ShaderMaterial 공존 시 frag_depth 패치가 따라붙어야
 *     깊이값이 일관되지만, picking 은 색만 읽으므로 깊이 정확도가 무관 — 무시 가능.
 *
 * 비용:
 *   1px 렌더는 fragment shader 호출 ~1회, readPixels 도 4바이트만 → 144fps 영향 거의 0.
 *   매 클릭 1회만 수행 (호버 throttle 은 Step 2).
 */

/** 노드 instance ID 를 24bit RGB 로 인코딩 (id+1 오프셋). 셰이더와 분리해 단위 테스트 가능. */
export function encodePickColor(id: number): [number, number, number] {
  const shifted = (id + 1) >>> 0; // uint32
  const r = shifted & 0xff;
  const g = (shifted >>> 8) & 0xff;
  const b = (shifted >>> 16) & 0xff;
  return [r, g, b];
}

/**
 * 4바이트 RGBA 버퍼에서 instance ID 복원.
 * 모든 채널 0 = 클리어색(검정) = miss → -1 반환.
 */
export function decodePickColor(rgba: Uint8Array | Uint8ClampedArray): number {
  const r = rgba[0];
  const g = rgba[1];
  const b = rgba[2];
  const v = r | (g << 8) | (b << 16);
  if (v === 0) return -1;
  return v - 1;
}

const PICK_TARGET_SIZE = 1; // 1×1 픽셀 RT — 클릭 1점만 샘플링

export interface GPUPickerOptions {
  /** 초기 화면 해상도 [width, height]. 메인 셰이더와 동일 식이므로 일치 필수. */
  resolution?: [number, number];
  /** 메인 InstancedNodes 의 BASE_RADIUS 와 일치해야 함 (D15 이후 기본 1). */
  baseRadius?: number;
  /** 메인과 동일 최소 픽셀 지름 (기본 4). */
  minPixelSize?: number;
  /**
   * (M7-2 Step 2 hotfix) tan(fov/2) — 1/uTanHalfFov 가 원래 P11.
   *   pickAtScreen 의 setViewOffset 이 projectionMatrix[1][1] 을 ~H 배 부풀리므로
   *   셰이더가 그 값을 직접 쓰면 4px 클램프가 비활성 됨 (작은 노드 picking 실패).
   *   대신 setViewOffset 영향과 독립인 fov 기반 값을 uniform 으로 받는다.
   *   App 이 camera.fov 에서 계산해 InstancedNodes 와 동일한 값을 주입.
   *   기본 = tan(50°/2) (Scene fov=50° 일치).
   */
  tanHalfFov?: number;
  /**
   * (M7.5 cleanup) Max Pixel Size 상한 비율 — 메인 셰이더와 동일 값 공유 필수.
   *   기본 0.1 (화면 H 의 10%).
   */
  maxPixelRatio?: number;
}

export class GPUPicker {
  private renderTarget: THREE.WebGLRenderTarget;
  private pickingMaterial: THREE.ShaderMaterial;
  private pixelBuffer = new Uint8Array(4);

  // 메인 셰이더 uniform 과 동일 의미 — setResolution 으로 외부에서 동기 갱신.
  private readonly uniforms: {
    uResolution: { value: THREE.Vector2 };
    uMinPixelSize: { value: number };
    uBaseRadius: { value: number };
    uTanHalfFov: { value: number };
    uMaxPixelRatio: { value: number };
  };

  constructor(options?: GPUPickerOptions) {
    const [w, h] = options?.resolution ?? [1, 1];
    // tanHalfFov 기본 = tan(50°/2) — Scene fov=50° 와 일치. App 이 카메라 인스턴스에서
    //   계산해 InstancedNodes 와 같은 값을 주입하는 것이 권장 (식 drift 방지).
    const initTan = options?.tanHalfFov ?? Math.tan((50 * Math.PI) / 360);
    const initMaxRatio = options?.maxPixelRatio ?? 0.1;
    this.uniforms = {
      uResolution: { value: new THREE.Vector2(w, h) },
      uMinPixelSize: { value: options?.minPixelSize ?? 4.0 },
      uBaseRadius: { value: options?.baseRadius ?? 1.0 },
      uTanHalfFov: { value: initTan },
      uMaxPixelRatio: { value: initMaxRatio },
    };

    // 1×1 RT — NearestFilter 로 보간 차단 (정수 색 보존), UnsignedByte/RGBA 가 readPixels 표준.
    this.renderTarget = new THREE.WebGLRenderTarget(PICK_TARGET_SIZE, PICK_TARGET_SIZE, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true, // 인스턴스 간 가림 처리에 필요 — 가까운 노드가 먼 노드를 덮음.
    });

    // ShaderMaterial: 메인 onBeforeCompile 의 size attenuation 수식을 그대로 옮김.
    //   - USE_INSTANCING define 은 InstancedMesh 가 렌더 시 자동 주입.
    //   - instanceMatrix attribute / projectionMatrix / modelViewMatrix 도 three.js 가 inject.
    //   - gl_InstanceID 는 WebGL2 + ShaderMaterial 환경에서 직접 사용 가능.
    this.pickingMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: this.uniforms.uResolution,
        uMinPixelSize: this.uniforms.uMinPixelSize,
        uBaseRadius: this.uniforms.uBaseRadius,
        uTanHalfFov: this.uniforms.uTanHalfFov,
        uMaxPixelRatio: this.uniforms.uMaxPixelRatio,
      },
      vertexShader: `
        uniform vec2 uResolution;
        uniform float uMinPixelSize;
        uniform float uBaseRadius;
        uniform float uTanHalfFov;
        uniform float uMaxPixelRatio;
        varying vec3 vPickColor;

        void main() {
          // 인스턴스 중심 / 현 vertex 를 각각 view 공간으로 (메인 셰이더와 동일).
          vec4 instCenterLocal = vec4(0.0, 0.0, 0.0, 1.0);
          vec4 vertexLocal = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            instCenterLocal = instanceMatrix * instCenterLocal;
            vertexLocal = instanceMatrix * vertexLocal;
          #endif
          vec4 centerView = modelViewMatrix * instCenterLocal;
          vec4 vertexView = modelViewMatrix * vertexLocal;

          // (D15) instance uniform scale — column 0 길이. 시각/판정 일치 필수라
          //   메인 셰이더와 동일한 식을 사용한다.
          float instanceScale = length(instanceMatrix[0].xyz);
          float depth = max(-centerView.z, 0.001);
          // (M7-2 Step 2 hotfix) P11 직접 사용 금지 — pickAtScreen 의 setViewOffset 이
          //   P11 을 ~H 배 부풀려 pixelDiameter 폭증 → 4px 클램프 비활성 → 작은 노드 미발사.
          //   1/uTanHalfFov 는 setViewOffset 무관 (fov 만 의존) 이라 안전.
          float pixelDiameter = uBaseRadius * instanceScale * (1.0 / uTanHalfFov) * uResolution.y / depth;
          // (M7.5 cleanup) effective = clamp(pixelDiameter, min, max). 메인 셰이더와 동일.
          float maxPixel = uResolution.y * uMaxPixelRatio;
          float effectivePixel = clamp(pixelDiameter, uMinPixelSize, maxPixel);
          float scaleFactor = effectivePixel / pixelDiameter;

          vec4 mvPosition = centerView + (vertexView - centerView) * scaleFactor;
          gl_Position = projectionMatrix * mvPosition;

          // (id+1) 24bit RGB 분해. +1 오프셋으로 id=0 과 miss(클리어 검정) 충돌 회피.
          float id = float(gl_InstanceID) + 1.0;
          vPickColor = vec3(
            mod(id, 256.0) / 255.0,
            mod(floor(id / 256.0), 256.0) / 255.0,
            mod(floor(id / 65536.0), 256.0) / 255.0
          );
        }
      `,
      fragmentShader: `
        varying vec3 vPickColor;
        void main() {
          gl_FragColor = vec4(vPickColor, 1.0);
        }
      `,
    });
    // onBeforeCompile 기반 메인 머티리얼과 program 캐시가 섞이지 않도록 ShaderMaterial 은
    // 자체 key 를 갖는다 — 별도 처리 불필요.
  }

  /**
   * setResolution() — 메인 셰이더와 동일 값으로 갱신 필수 (size attenuation 결과 일치).
   */
  setResolution(width: number, height: number): void {
    this.uniforms.uResolution.value.set(width, height);
  }

  /**
   * setTanHalfFov() — fov 변경 시 갱신. InstancedNodes.setTanHalfFov 와 동일 값.
   *
   *   App 이 mount 시 `Math.tan(camera.fov * Math.PI / 360)` 으로 한 번 주입하면 충분.
   */
  setTanHalfFov(value: number): void {
    this.uniforms.uTanHalfFov.value = value;
  }

  /**
   * setMaxPixelRatio() — Max Pixel 상한 비율 갱신. 메인 셰이더와 동일 값.
   */
  setMaxPixelRatio(value: number): void {
    this.uniforms.uMaxPixelRatio.value = value;
  }

  /**
   * pickAtScreen — 1×1 RT 에 클릭 픽셀만 렌더하고 색→ID 복원.
   *
   * 좌표계: clientX/Y 는 캔버스 좌상단 원점 CSS 픽셀. viewportWidth/Height 도 CSS 픽셀.
   *   setViewOffset 은 비율만 보므로 devicePixelRatio 곱은 불필요 — CSS 픽셀 그대로.
   *
   * 반환: 노드 instance ID (>=0), miss 면 -1.
   */
  pickAtScreen(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    clientX: number,
    clientY: number,
    viewportWidth: number,
    viewportHeight: number
  ): number {
    // setViewOffset: 카메라 projection 을 (fullW × fullH) 가상 화면의 (x, y, w, h)
    //   부분창에 맞게 비대칭으로 좁힌다. 1×1 RT 와 결합 → 그 1 CSS 픽셀만 렌더링.
    camera.setViewOffset(
      viewportWidth,
      viewportHeight,
      Math.floor(clientX),
      Math.floor(clientY),
      1,
      1
    );

    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();

    scene.overrideMaterial = this.pickingMaterial;
    renderer.setRenderTarget(this.renderTarget);
    // clearColor=(0,0,0) 일 때만 decodePickColor 의 miss 판정이 성립. 기본 검정이지만 명시.
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.readRenderTargetPixels(this.renderTarget, 0, 0, 1, 1, this.pixelBuffer);

    // 원복: 다음 메인 프레임이 영향받지 않도록 모든 상태 해제.
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    camera.clearViewOffset();

    return decodePickColor(this.pixelBuffer);
  }

  /** 셰이더 uniform 객체 노출 (테스트용). */
  getUniforms(): {
    uResolution: { value: THREE.Vector2 };
    uMinPixelSize: { value: number };
    uBaseRadius: { value: number };
    uTanHalfFov: { value: number };
    uMaxPixelRatio: { value: number };
  } {
    return this.uniforms;
  }

  /** Picking material 노출 (테스트/검증용). */
  getMaterial(): THREE.ShaderMaterial {
    return this.pickingMaterial;
  }

  /** RenderTarget 노출 (테스트용). */
  getRenderTarget(): THREE.WebGLRenderTarget {
    return this.renderTarget;
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.pickingMaterial.dispose();
  }
}
