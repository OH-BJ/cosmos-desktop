import * as THREE from "three";

/**
 * Scene — three.js 렌더 엔진 중추 (M3 Step 1: PerspectiveCamera 전환)
 *
 * 무한 우주 공간을 표현하는 Scene, PerspectiveCamera(3D 투영),
 * WebGLRenderer를 관리한다. resize 이벤트 감시, requestAnimationFrame 루프,
 * 리소스 정리를 담당.
 *
 * M3 변경점:
 *  - OrthographicCamera → PerspectiveCamera (원근 + Parallax + 히트테스트 호환).
 *  - WebGLRenderer logarithmicDepthBuffer=true (Z-fighting 사전 방어).
 *  - resize 시 aspect 갱신만 하면 됨 (ortho 대비 간단).
 *
 * 초기 카메라 파라미터:
 *  - fov=50 (표준 광각/노멀 사이, 자연스러운 원근)
 *  - position.z=500 (노드 좌표 범위 ±250 기준, 전부 화면에 담기는 거리)
 *  - near=0.1, far=10000 (팬/줌 후 대부분의 장면 포함)
 *  - lookAt(0,0,0) 유지
 */
export class Scene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private animationId: number | null = null;
  private onRender: (() => void) | null = null;
  private resizeHandler: (() => void) | null = null; // C2 버그 수정: resize 리스너 참조 저장

  /**
   * 선택 하이라이트 메시 (M4 Step 2).
   *  - 일반 Mesh 1개를 Scene 에 추가해 선택된 노드 위에 "덮어" 보여준다.
   *  - InstancedMesh 의 setColorAt/instanceColor 를 건드리지 않아 매 클릭마다
   *    1.2MB@10k 수준의 GPU 재업로드가 발생하지 않는다 (Gemini Pro 자문).
   *  - 평소 visible=false, 선택 시 position 이동 + visible=true 토글.
   *  - wireframe 으로 해두면 안쪽 노드가 보여서 어떤 인스턴스가 선택됐는지 명확.
   */
  private highlightMesh: THREE.Mesh;

  constructor() {
    // three.js의 Scene 개념: 렌더링할 모든 오브젝트(메시, 라이트, 카메라)를 담는 컨테이너
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000); // 검은 우주 배경

    // PerspectiveCamera: 거리에 따라 물체 크기가 달라짐 (3D 원근감).
    // (fov, aspect, near, far). fov는 수직 FOV(°).
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 10000);
    this.camera.position.set(0, 0, 500); // z축 뒤로 물러나서 xy 평면을 바라봄
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.camera);

    // WebGLRenderer: 실제 렌더링 엔진.
    // logarithmicDepthBuffer: 큰 near/far 범위에서 Z-fighting을 줄여줌.
    // 줌인/줌아웃 범위가 넓어질 M3 이후를 대비해 미리 활성화.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // M4 Step 2: 선택 하이라이트 메시.
    //  - 반지름 6.5 (노드 반지름 5 × 1.3) → 노드를 살짝 감싸는 느낌.
    //  - MeshBasicMaterial(wireframe): 조명 계산 없이 선명한 색 + 격자로 시인성 ↑.
    //  - depthTest=true 유지: Log Depth Buffer 와 상호작용해도 일반 Mesh 라 Z-test 정상.
    const highlightGeo = new THREE.SphereGeometry(6.5, 16, 16);
    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      wireframe: true,
    });
    this.highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
    this.highlightMesh.visible = false;
    this.scene.add(this.highlightMesh);
  }

  /**
   * mount() — renderer DOM에 마운트 + resize 리스너 등록
   */
  mount(container: HTMLElement): void {
    container.appendChild(this.renderer.domElement);

    // C2 버그 수정: 리스너 참조를 멤버에 저장해야 dispose에서 제거 가능.
    this.resizeHandler = () => this.handleResize();
    window.addEventListener("resize", this.resizeHandler);

    this.startAnimationLoop();
  }

  /**
   * handleResize() — 창 크기 변화에 따라 카메라 aspect 갱신
   *
   * PerspectiveCamera는 aspect 하나만 맞추면 됨 (ortho의 left/right/top/bottom
   * 네 값 계산 대비 단순). 이후 updateProjectionMatrix로 내부 행렬 재계산.
   */
  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
  }

  /**
   * startAnimationLoop() — requestAnimationFrame 루프 시작
   */
  private startAnimationLoop(): void {
    const loop = () => {
      this.animationId = requestAnimationFrame(loop);
      if (this.onRender) {
        this.onRender();
      }
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * getCamera() — PerspectiveCamera 객체 반환
   *
   * Raycaster 히트테스트, 카메라 변환 등에 필요.
   * M3에서 Ortho → Perspective로 반환 타입이 바뀐 점 주의.
   */
  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /**
   * getHighlightMesh() — 선택 하이라이트 메시 반환 (M4 Step 2).
   * InstancedNodes.bindSelectionHighlight 에 주입해 selectedNodeId 구독과 연결.
   */
  getHighlightMesh(): THREE.Mesh {
    return this.highlightMesh;
  }

  setRenderCallback(callback: () => void): void {
    this.onRender = callback;
  }

  /**
   * dispose() — 리소스 정리
   */
  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    // C2 버그 수정: resize 리스너 제거 (참조 동일성 필요).
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    this.renderer.dispose();

    // M4 Step 2: 하이라이트 메시 리소스 정리 (geometry/material GPU 메모리 해제).
    // scene.remove 는 아래 루프에서 처리됨.
    (this.highlightMesh.geometry as THREE.BufferGeometry).dispose();
    (this.highlightMesh.material as THREE.Material).dispose();

    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }

    this.renderer.domElement.remove();
  }
}
