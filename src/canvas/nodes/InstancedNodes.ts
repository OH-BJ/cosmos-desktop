import * as THREE from "three";
import { NodeBuffer } from "../../state/nodeBuffer";
import { useCosmosStore } from "../../state/store";

/**
 * InstancedNodes — 대용량 노드 렌더링 모듈 (M7-1 Step 2: Size Attenuation)
 *
 * 개별 THREE.Mesh 대신 THREE.InstancedMesh를 사용해 수만 개 노드를 GPU에서 한 번에 렌더.
 * 드로우콜 1회로 모든 노드를 그리므로, CPU-GPU 통신 오버헤드 제거.
 *
 * M7-1 Step 2 전환점 — 최소 4×4px Hit-Area 보장 (Size Attenuation):
 *   D1=100,000 거리 노드는 줌아웃 시 1px 미만으로 줄어 GPU 가 서브픽셀로 렌더 생략.
 *   → 거리 무관 최소 4px 클램프를 vertex shader 에서 적용해 별자리 윤곽을 항상 가시화.
 *
 * 셰이더 통합 방식:
 *   `MeshBasicMaterial.onBeforeCompile` 로 `<project_vertex>` 청크만 패치.
 *   - three.js 의 `USE_INSTANCING` define / `attribute mat4 instanceMatrix` 자동 주입 유지
 *   - `logarithmicDepthBuffer=true` (Scene) 가 의존하는 `<logdepthbuf_vertex>` 등 후속 청크 보존
 *   - 풀 ShaderMaterial 대비 학습 곡선 / 회귀 위험 최소
 *
 * 핵심 수식 (vertex shader):
 *   centerView    = modelViewMatrix * instanceCenter            // 인스턴스 중심의 view 공간 좌표
 *   pixelDiameter = baseRadius * projectionMatrix[1][1] * H / depth   // 화면상 지름 (px)
 *   scaleFactor   = max(1, minPixel / pixelDiameter)            // 최소 4px 보장
 *   mvPosition    = centerView + (vertexView - centerView) * scaleFactor
 *
 * projectionMatrix[1][1] = 1 / tan(fov/2) — 광학적 focal length 인자.
 * 화면 수직 픽셀 수(H) 와 view 공간 depth 로 화면 지름을 역산한다.
 *
 * 데이터 흐름은 M2 그대로:
 *   Zustand store → bridge.syncFromStore → NodeBuffer (Float32Array)
 *                                            ↓
 *   InstancedNodes.syncFromBuffer → InstancedMesh.instanceMatrix
 */

// BASE_RADIUS=500 — Fractal Orbital Packing 의 100K 거리 스케일에 맞춘 월드 반지름.
//   5.0 일 때 모든 깊이에서 pixelDiameter < 4 → 항상 4px 클램프만 발동 (별 크기 고정).
//   500 으로 키우면 D1 줌인(z≈10K)에서 입체 별로 보이고, 줌아웃 시 4px 클램프 자연 전이.
//   D5(≈10) 침투 시 화면 폭발 문제는 인지 — depth-aware instance scale 로 후속 마일스톤 해결.
//   uBaseRadius uniform 과 반드시 일치해야 함 (vertex shader pixelDiameter 계산 기준).
const BASE_RADIUS = 500.0;
const MIN_PIXEL_SIZE = 4.0; // 최소 화면 지름 (px). 4×4 Hit-Area 보장 (Step 2 목표).

export class InstancedNodes {
  private mesh: THREE.InstancedMesh;
  private capacity: number; // 최대 인스턴스 수 (생성자에서 고정)
  private material: THREE.MeshBasicMaterial;

  // M7-1 Step 2: 외부 보유 uniform 객체.
  //   onBeforeCompile 은 첫 렌더(WebGL) 시점에만 호출되므로 jsdom 테스트에서는 절대
  //   호출되지 않는다. 셰이더의 shader.uniforms 와 동일한 { value } 참조를 공유시켜
  //   - GPU 가 매 프레임 이 객체의 .value 를 읽어가고
  //   - setResolution() 같은 외부 API 가 .value 만 갱신하면 자동 반영되도록 한다.
  private readonly uniforms: {
    uResolution: { value: THREE.Vector2 };
    uMinPixelSize: { value: number };
    uBaseRadius: { value: number };
  };

  // M4 Step 2: 선택 하이라이트 구독 해제 함수 (bindSelectionHighlight 가 반환).
  private highlightUnsub: (() => void) | null = null;

  /**
   * @param capacity 최대 인스턴스 수 (NodeBuffer.capacity 와 맞추는 것이 안전).
   * @param options.resolution 초기 화면 해상도 [w, h]. 미지정 시 [1, 1] —
   *   App 측에서 mount 직후 `setResolution(window.innerWidth, window.innerHeight)` 호출 필수.
   *   node 테스트 환경에는 window 가 없어서 기본값을 안전한 더미로 둠.
   */
  constructor(
    capacity: number = 1024,
    options?: { resolution?: [number, number] }
  ) {
    // Geometry: 기본 작은 구형 (반지름 BASE_RADIUS).
    //   vertex shader 의 uBaseRadius 와 반드시 동일 — pixelDiameter 계산이 일치해야
    //   "가까울 땐 원본 크기, 멀 땐 4px" 의 자연스러운 전이가 성립한다.
    const geometry = new THREE.SphereGeometry(BASE_RADIUS, 16, 16);

    // uniforms 객체 — shader.uniforms 와 객체 참조를 공유한다.
    const [initW, initH] = options?.resolution ?? [1, 1];
    this.uniforms = {
      uResolution: { value: new THREE.Vector2(initW, initH) },
      uMinPixelSize: { value: MIN_PIXEL_SIZE },
      uBaseRadius: { value: BASE_RADIUS },
    };

    // Material: MeshBasicMaterial 베이스 + onBeforeCompile 패치.
    //   MeshPhongMaterial(M2) 에서 Basic 으로 다운그레이드 — 라이트 없이도 보이고
    //   셰이더 청크가 단순해져 패치 범위 최소.  나중에 호버/선택 색상 구분이 필요하면
    //   instanceColor 추가로 충분 (M7-2 Picking 단계에서 별도 material 분리 예정).
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // 핵심 패치: <project_vertex> 청크 전체를 교체해 size attenuation 클램프 적용.
    //   - <common> 직후에 uniform 선언 삽입
    //   - <project_vertex> 자리에 새 mvPosition / gl_Position 계산 삽입
    //   - 이후 <logdepthbuf_vertex> 가 gl_Position.z 를 읽는 흐름은 그대로 유지됨
    this.material.onBeforeCompile = (shader) => {
      // shader.uniforms 와 외부 보유 uniforms 의 { value } 참조를 공유.
      //   setResolution 으로 외부 .value 만 갱신해도 GPU 가 매 프레임 읽어감.
      shader.uniforms.uResolution = this.uniforms.uResolution;
      shader.uniforms.uMinPixelSize = this.uniforms.uMinPixelSize;
      shader.uniforms.uBaseRadius = this.uniforms.uBaseRadius;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform vec2 uResolution;
uniform float uMinPixelSize;
uniform float uBaseRadius;`
        )
        .replace(
          "#include <project_vertex>",
          `
// --- M7-1 Step 2: Size Attenuation (min 4px clamp) ---
// 인스턴스 중심 (object space (0,0,0)) 과 현재 vertex 를 각각 view 공간으로.
vec4 _instCenterLocal = vec4(0.0, 0.0, 0.0, 1.0);
vec4 _vertexLocal = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  _instCenterLocal = instanceMatrix * _instCenterLocal;
  _vertexLocal = instanceMatrix * _vertexLocal;
#endif
vec4 _centerView = modelViewMatrix * _instCenterLocal;
vec4 _vertexView = modelViewMatrix * _vertexLocal;

// 화면상 base sphere 의 지름 (px). projectionMatrix[1][1] = 1/tan(fov/2).
//   pixelRadius = r * P11 * (H/2) / depth → diameter = r * P11 * H / depth.
float _depth = max(-_centerView.z, 0.001);
float _pixelDiameter = uBaseRadius * projectionMatrix[1][1] * uResolution.y / _depth;
// 멀어서 4px 미만이면 scaleFactor>1 로 키움, 가까울 땐 1.0 으로 원본 크기 유지.
float _scaleFactor = max(1.0, uMinPixelSize / _pixelDiameter);

// 중심 기준으로 vertex 오프셋을 view 공간에서 균등 스케일.
//   mvPosition 변수명은 후속 청크 (<fog_vertex>, <worldpos_vertex>) 가 참조하므로 보존.
vec4 mvPosition = _centerView + (_vertexView - _centerView) * _scaleFactor;
gl_Position = projectionMatrix * mvPosition;
`
        );
    };
    // onBeforeCompile 을 쓰면 같은 source 가 서로 다른 인스턴스에서 캐시 충돌 가능 →
    //   고유 key 로 program 캐시를 격리.  (uniforms 가 같은 GLSL 을 공유하므로 단일 키 OK.)
    this.material.customProgramCacheKey = () => "cosmos-instanced-size-attenuation";

    // InstancedMesh(geometry, material, capacity)
    this.mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    this.capacity = capacity;

    // 초기 상태: count = 0 (렌더할 인스턴스 없음).
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * syncFromBuffer() — NodeBuffer의 TypedArray를 InstancedMesh로 복사
   *
   * bridge.syncFromStore가 NodeBuffer를 갱신한 직후 호출되는 단일 진입점.
   * Float32Array의 (x, y, z) 3-stride 좌표를 Matrix4로 읽어 setMatrixAt에 반영한다.
   *
   * 성능: 노드 N개에 대해 O(N) 행렬 쓰기.
   *
   * M6-2 Step 2 — 부분 업데이트 (addUpdateRange) 도입:
   *   options.startIndex 를 주면 [startIndex, renderCount) 범위만 setMatrixAt + GPU 업로드.
   *   청크 스트리밍 시 이전까지 동기화된 노드는 GPU 에 그대로 두고 신규 range 만
   *   bufferSubData 로 올린다. three.js r155+ 의
   *   `BufferAttribute.addUpdateRange(start, count)` API 사용.
   *   - start, count 단위는 typed array index (Float32Array 인덱스).
   *     instanceMatrix 는 itemSize=16 (Mat4) 이므로 인스턴스 i 는 [i*16, i*16+16).
   *
   *   기본값(startIndex 미지정): 전체 업로드 — 기존 store 전량 재작성 경로 호환.
   *
   * @param buffer 동기화 소스 (bridge가 먼저 갱신해야 함)
   * @param options.startIndex  부분 업데이트 시작 인덱스 (기본 0 = 전체).
   *   보통 호출 직전의 mesh.count 를 넘긴다 — 그 값이 "이전 sync 까지 GPU 에 올라간
   *   인스턴스 수" 이기 때문.
   */
  syncFromBuffer(
    buffer: NodeBuffer,
    options?: { startIndex?: number }
  ): void {
    // capacity 보호: NodeBuffer가 우리 InstancedMesh 용량을 넘으면 초과분은 버림.
    // (M2에서는 양쪽 capacity를 맞춰 호출하므로 실제로는 발생하지 않음)
    const renderCount = Math.min(buffer.count, this.capacity);
    // startIndex 음수/초과 방어. 0 으로 클램프 → 항상 [0, renderCount] 안.
    const rawStart = options?.startIndex ?? 0;
    const startIndex = Math.max(0, Math.min(rawStart, renderCount));

    // Matrix4 한 개를 재사용해 GC 부담 최소화.
    // setMatrixAt은 내부적으로 행렬을 복사하므로 매 인덱스마다 새 객체 불필요.
    const matrix = new THREE.Matrix4();

    for (let i = startIndex; i < renderCount; i++) {
      const base = i * 3; // stride 3
      const x = buffer.positions[base];
      const y = buffer.positions[base + 1];
      const z = buffer.positions[base + 2];

      matrix.makeTranslation(x, y, z);
      this.mesh.setMatrixAt(i, matrix);
    }

    // M6-2 Step 2: 부분 GPU 업로드 등록.
    //   매 호출마다 updateRanges 를 비운 뒤, partial 인 경우에만 신규 range 만 등록.
    //   비워두면 WebGLAttributes 가 자동 전체 bufferSubData (full upload) 수행.
    //   needsUpdate=true 는 두 경로 공통으로 필요 (디스패치 트리거).
    this.mesh.instanceMatrix.clearUpdateRanges();
    if (startIndex > 0 && renderCount > startIndex) {
      // start, count 는 typed array 인덱스. Mat4 itemSize=16 으로 곱한다.
      this.mesh.instanceMatrix.addUpdateRange(
        startIndex * 16,
        (renderCount - startIndex) * 16
      );
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // 실제로 그릴 인스턴스 수 (GPU 드로우콜이 이만큼 순회).
    // capacity가 아니라 renderCount로 설정해야 뒤에 남은 stale 데이터가 안 그려짐.
    this.mesh.count = renderCount;

    // M4 Step 1 수정: Raycaster 는 InstancedMesh.boundingSphere 로 broad-phase 컬링을 한다.
    //  - 이 sphere 는 모든 인스턴스 위치 + geometry 반지름을 감싼 구.
    //  - 반드시 matrices 를 다 쓰고 count/needsUpdate 를 세팅한 "뒤"에 계산해야 한다.
    //    그러지 않으면 (0,0,0) 주변의 작은 sphere 만 잡혀, 멀리 떨어진 노드 클릭 시
    //    광선이 sphere 를 스치지 못해 intersects 가 항상 0 이 된다 (Gemini 자문).
    //  - 비용은 O(count) 로 매우 작음 → 매 sync 마다 호출해도 무해.
    //  - 부분 업데이트 시에도 신규 노드 위치가 sphere 바깥일 수 있어 항상 재계산.
    //
    // 주의 (M7-1 Step 2): boundingSphere 는 *원본* geometry 반지름 기준이라 화면 클램프된
    //   distant 노드는 여전히 ray hit 가 어렵다. Raycaster 기반 클릭 정확도 문제는
    //   M7-2 GPU Color Picking 에서 본격 해결.
    this.mesh.computeBoundingSphere();
  }

  /**
   * setResolution() — 화면 해상도 uniform 갱신 (M7-1 Step 2).
   *
   * 픽셀 지름 계산이 viewport height (H) 에 의존하므로 resize 시 갱신 필수.
   * App.tsx 의 mount/resize 핸들러에서 호출. uniforms 객체는 onBeforeCompile 호출
   * 여부와 무관하게 항상 유효 (테스트 환경에서도 OK).
   */
  setResolution(width: number, height: number): void {
    this.uniforms.uResolution.value.set(width, height);
  }

  /**
   * getUniforms() — 셰이더 uniform 객체 노출 (테스트용).
   *
   * Resolution 갱신 / 초기값 검증 / pixelMinSize 정책 변경 같은 단위 테스트가
   * shader.uniforms 컴파일 이후 상태에 의존하지 않도록 외부 보유 객체를 그대로 노출.
   */
  getUniforms(): {
    uResolution: { value: THREE.Vector2 };
    uMinPixelSize: { value: number };
    uBaseRadius: { value: number };
  } {
    return this.uniforms;
  }

  /**
   * getMesh() — three.js InstancedMesh 객체 반환
   *
   * Scene에 add하거나, 히트테스트 Raycaster에 전달할 때 사용.
   */
  getMesh(): THREE.InstancedMesh {
    return this.mesh;
  }

  /**
   * bindSelectionHighlight() — store.selectedNodeId 구독 → highlightMesh 이동/토글.
   *
   * M4 Step 2:
   *   InstancedMesh 의 instanceColor/setColorAt 을 건드리지 않고, Scene 의 일반 Mesh
   *   하나를 "선택된 노드 위치로 텔레포트"시키는 방식. GPU 재업로드 없음 → O(1) 비용.
   *
   * 의존성 주입:
   *  - highlightMesh: Scene.getHighlightMesh() 결과물.
   *  - buffer:        노드 좌표가 들어있는 NodeBuffer (bridge 가 동기화한 것).
   *  - resolveIdToIndex: UUID → Buffer Index. 보통 bridge.getIdToIndex().get 을 람다로 감쌈.
   *
   * 구독 방식:
   *  - subscribeWithSelector 미들웨어가 이미 store 에 붙어 있으므로
   *    (state) => state.selectedNodeId 셀렉터로 "변경 시에만" 콜백 호출.
   *  - 생성 직후 현재 상태로 1회 수동 동기화 (초기 null → visible=false 보장).
   *
   * 반환값: unsubscribe 함수. dispose() 에서 호출되어 메모리 누수 방지.
   */
  bindSelectionHighlight(
    highlightMesh: THREE.Mesh,
    buffer: NodeBuffer,
    resolveIdToIndex: (id: string) => number | undefined
  ): () => void {
    const update = (selectedId: string | null): void => {
      if (selectedId === null) {
        highlightMesh.visible = false;
        return;
      }
      const index = resolveIdToIndex(selectedId);
      if (index === undefined || index < 0 || index >= buffer.count) {
        // 알 수 없는 ID (bridge 동기화 이전 race 등) → 보수적으로 숨김.
        highlightMesh.visible = false;
        return;
      }
      const base = index * 3;
      const x = buffer.positions[base];
      const y = buffer.positions[base + 1];
      const z = buffer.positions[base + 2];
      highlightMesh.position.set(x, y, z);
      highlightMesh.visible = true;
    };

    // 초기 동기화 (subscribe 는 "변경 시에만" 콜백 → 현재 상태 맞추려면 1회 수동 호출).
    update(useCosmosStore.getState().selectedNodeId);

    const unsub = useCosmosStore.subscribe(
      (state) => state.selectedNodeId,
      (id) => update(id)
    );
    this.highlightUnsub = unsub;
    return unsub;
  }

  /**
   * getCount() — 현재 렌더 중인 인스턴스 수 반환
   *
   * mesh.count와 동일. 테스트/디버그용.
   */
  getCount(): number {
    return this.mesh.count;
  }

  /**
   * getCapacity() — 최대 인스턴스 수 반환
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * dispose() — GPU 리소스 정리
   *
   * Geometry와 Material의 GPU 메모리 해제.
   */
  dispose(): void {
    // M4 Step 2: 선택 구독 해제 (누수 방지).
    //  store 가 여러 번 re-mount 되는 HMR 상황에서 unsub 을 빼먹으면
    //  과거 InstancedNodes 가 계속 콜백을 받게 됨.
    if (this.highlightUnsub) {
      this.highlightUnsub();
      this.highlightUnsub = null;
    }
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
