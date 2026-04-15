import * as THREE from "three";

/**
 * Scene — three.js 렌더 엔진 중추
 *
 * 무한 우주 공간을 표현하는 Scene, OrthographicCamera(카메라 잠금),
 * WebGLRenderer를 관리한다. resize 이벤트 감시, requestAnimationFrame 루프,
 * 리소스 정리를 담당.
 *
 * 초기 카메라는 orthographic top-down 잠금 (z 축으로 xy 평면 내려다봄).
 * 나중에 Perspective/3D 확장 시 카메라만 토글하면 됨.
 */
export class Scene {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private animationId: number | null = null;
  private onRender: (() => void) | null = null;
  private resizeHandler: (() => void) | null = null; // C2 버그 수정: resize 리스너 참조 저장

  constructor() {
    // three.js의 Scene 개념: 렌더링할 모든 오브젝트(메시, 라이트, 카메라)를 담는 컨테이너
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000); // 검은 우주 배경

    // OrthographicCamera: 투영 거리에 관계없이 물체 크기가 일정함.
    // 초기 뷰포트: 1920x1080 기준 width=1920, height=1080, near=0.1, far=10000
    // (나중에 resize 핸들러가 동적 조정)
    this.camera = new THREE.OrthographicCamera(
      -960,
      960,
      540,
      -540,
      0.1,
      10000
    );
    this.camera.position.set(0, 0, 100); // z축 위쪽에서 xy 평면을 내려다봄
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.camera);

    // WebGLRenderer: 실제 렌더링 엔진. antialias는 성능 vs 화질 트레이드오프
    // (M2에서 성능 최적화 시 끌 수도 있음)
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * mount() — renderer DOM에 마운트 + resize 리스너 등록
   *
   * @param container 렌더러를 붙일 HTMLElement (보통 #root div)
   */
  mount(container: HTMLElement): void {
    container.appendChild(this.renderer.domElement);

    // 창 리사이즈 시 카메라/렌더러 동기화
    // (고성능: debounce 없이 매번 실행. 나중에 필요하면 throttle 추가)
    // C2 버그 수정: 리스너 함수를 클래스 멤버에 저장해야 dispose에서 제거 가능.
    // window.addEventListener와 removeEventListener는 참조 동일성으로 매칭하므로,
    // 클로저나 화살표 함수를 쓰면 참조가 달라져서 리스너 제거 불가능.
    this.resizeHandler = () => this.handleResize();
    window.addEventListener("resize", this.resizeHandler);

    // requestAnimationFrame 루프 시작
    this.startAnimationLoop();
  }

  /**
   * handleResize() — 창 크기 변화에 따라 카메라 뷰포트 업데이트
   *
   * OrthographicCamera는 left/right/top/bottom 경계값을 직접 지정하므로,
   * 창 비율 변화에 맞춰 갱신 필수.
   */
  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;

    // 기준 높이 1080 기준, 가로만 aspect에 맞춰 확장
    const halfHeight = 540;
    const halfWidth = halfHeight * aspect;

    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
  }

  /**
   * startAnimationLoop() — requestAnimationFrame 루프 시작
   *
   * 매 프레임마다 콜백을 실행 (onRender), Scene을 렌더링.
   * 성능: 60fps @ 모니터 주사율에 동기화됨.
   */
  private startAnimationLoop(): void {
    const loop = () => {
      this.animationId = requestAnimationFrame(loop);

      // 사용자 지정 렌더 콜백 (노드 위치 갱신, 애니메이션 등)
      if (this.onRender) {
        this.onRender();
      }

      // three.js가 현재 Scene을 camera 시점으로 렌더링해서 canvas에 그림
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /**
   * getScene() — three.js Scene 객체 반환
   *
   * 외부에서 메시/라이트/기타 객체를 추가할 때 사용.
   */
  getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * getCamera() — OrthographicCamera 객체 반환
   *
   * Raycaster 히트테스트, 카메라 변환 등에 필요.
   */
  getCamera(): THREE.OrthographicCamera {
    return this.camera;
  }

  /**
   * getRenderer() — WebGLRenderer 객체 반환
   *
   * 렌더링 상태 쿼리, 캡처 등에 필요.
   */
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /**
   * setRenderCallback() — 매 프레임 렌더 전 호출할 콜백 등록
   *
   * 고빈도 상태 업데이트(카메라 움직임, 노드 애니메이션)를 이곳에서 처리.
   */
  setRenderCallback(callback: () => void): void {
    this.onRender = callback;
  }

  /**
   * dispose() — 리소스 정리
   *
   * React unmount 시 호출. three.js 객체를 GPU에서 해제해야 메모리 누수 방지.
   * (Geometry, Material, Texture, WebGLRenderer 모두)
   */
  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    // C2 버그 수정: resize 리스너 제거.
    // removeEventListener는 **정확히 같은 함수 참조**를 요구하므로,
    // mount()에서 저장한 this.resizeHandler를 명시적으로 제거.
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // Renderer 정리: WebGL 컨텍스트 해제
    this.renderer.dispose();

    // Scene의 모든 자식 객체(메시, 라이트) 정리는 InstancedNodes가 담당
    // (여기선 Scene 자체만 비움)
    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }

    // DOM에서 canvas 제거
    this.renderer.domElement.remove();
  }
}
