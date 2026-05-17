import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * 카메라 줌 범위 — Perspective z축. z=0 이 노드 평면.
 *  - MIN_ZOOM_Z: 너무 가까이 가면 노드 안쪽/뒤로 들어가 시야 깨짐.
 *  - MAX_ZOOM_Z: 너무 멀면 노드가 점으로 사라짐.
 */
// (M7-1 hotfix) Fractal Orbital Packing 거리 스케일에 맞춘 줌 범위.
//   MIN_ZOOM_Z=0.1 — D5 (≈10) 보다 더 가까이 가서 개별 파일 검사 가능.
//   MAX_ZOOM_Z=1e6 — D1 (100K) 별자리 군집을 멀리서 조망 가능. logarithmicDepthBuffer
//   덕분에 1e7 배수 차이도 z-fighting 없이 안전.
const MIN_ZOOM_Z = 0.1;
const MAX_ZOOM_Z = 1_000_000;
/**
 * 휠 한 눈금당 줌 배율. 지수적 스케일을 쓰는 이유:
 *  - 현재 z에 비례해서 z가 변하면 "같은 휠 동작=같은 체감 줌"이 된다.
 *  - 1.1^(deltaY/100) — 브라우저 표준 deltaY(100단위/줄) 기준 10% 변화.
 */
const ZOOM_FACTOR_BASE = 1.1;
const ZOOM_DELTA_DIVISOR = 100;

/**
 * 드래그와 클릭 구분 임계값 (맨해튼 거리, 픽셀 단위).
 * mousedown ~ mouseup 사이 총 이동 |dx|+|dy| 가 이 값 미만이면 "클릭"으로 판정.
 * 5px 은 deck.gl / Figma 등 업계 표준과 일치 (Gemini Pro 자문).
 */
const CLICK_DISTANCE_THRESHOLD = 5;

/**
 * CameraController 생성자 옵션.
 *
 * onPick: 노드가 클릭되어 hit 되면 해당 UUID, 빈 공간 클릭 시 null.
 *   Zustand 의 selectNode 를 직접 들이받지 않고 콜백으로 위임해
 *   CameraController 를 store 구현에서 독립시킨다 (테스트 용이성).
 */
export interface CameraControllerOptions {
  onPick?: (nodeId: string | null) => void;
}

/**
 * CameraController — 팬 + 휠 줌 + 우클릭 회전 카메라 컨트롤러
 * (M2 Step 2 팬 → M3 Step 1 Perspective → M3 Step 2 줌 → M3 Step 3 회전)
 *
 * 설계 원칙:
 *  - 직접 구현: 좌클릭 드래그 팬 (position.x/y), 휠 줌 (position.z).
 *  - OrbitControls 위임: 우클릭 드래그 회전 only. 팬/줌은 OrbitControls에선 비활성
 *    — 팬/줌 감각을 프로젝트 요구(지수 줌, distance-based 팬)에 맞게 직접 컨트롤.
 *  - mouseButtons.LEFT=null 로 OrbitControls가 좌클릭을 무시 → 우리 팬과 충돌 없음.
 *  - update()는 매 프레임 호출 필요. damping이 작동하려면 반드시 render loop에서 돌아야 함.
 *
 * 이벤트 바인딩:
 *  - mousedown/wheel → domElement (캔버스 안에서만)
 *  - mousemove/mouseup → window (드래그가 캔버스 밖까지 지속)
 *  - OrbitControls 내부 리스너(pointerdown/up/move, contextmenu 등) → domElement 자체 관리
 *
 * 스크린 → 월드 좌표 변환 (M3 Perspective 버전):
 *   Ortho와 달리 Perspective는 "픽셀당 월드 거리"가 카메라-대상 거리에 따라 달라진다.
 *   팬 대상 평면을 z=0 (노드가 놓인 xy 평면)으로 보면, 카메라에서 평면까지의
 *   거리 d = camera.position.z (카메라는 z>0에서 z=0을 내려다봄).
 *
 *   거리 d에서 보이는 수직 월드 높이: H = 2 * d * tan(fov/2)   (fov는 수직 FOV)
 *   픽셀당 월드 거리 (세로):          H / canvasHeight
 *   세로/가로 픽셀당 거리는 같다:
 *     - 수평 월드 폭 = H * aspect
 *     - aspect = canvasWidth / canvasHeight 이면 W/canvasWidth = H/canvasHeight.
 *   따라서 scaleX = scaleY = worldPerPixel 하나면 충분.
 *
 *   worldPerPixel = 2 * distance * tan(fov/2) / canvasHeight
 *
 * 카메라 이동 방향 (Ortho 때와 동일한 규칙):
 *   사용자가 마우스를 오른쪽으로 드래그 → 콘텐츠가 오른쪽으로 따라오는 느낌을 내기 위해
 *   카메라는 반대 방향으로 이동. x 축은 역방향 (cam.x -= worldDx).
 *   y 축은 screen y(아래=+) vs world y(위=+) 가 반대 + 카메라 역방향이 한 번 더 겹쳐서
 *   결과적으로 cam.y += worldDy (학습 노트: y축 2중 반전).
 *
 * 리소스 관리:
 *   dispose() 가 모든 리스너를 참조 동일성으로 제거한다 (C2 버그 교훈).
 */
export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  private isDragging = false;
  private lastClientX = 0;
  private lastClientY = 0;

  /**
   * mousedown 시점의 클라이언트 좌표. 드래그/클릭 구분을 위해
   * lastClientX/Y 와 별도로 유지 (lastClient* 는 mousemove 마다 갱신됨).
   */
  private downClientX = 0;
  private downClientY = 0;

  // M4 Step 1 수정: OrbitControls 가 pointer 이벤트로 동작하면서
  // 좌클릭 시 mouse compat 이벤트(mouseup)가 window 까지 도달하지 않는 증상이 있었음.
  // 같은 스트림(pointer)을 쓰도록 전환하면 OrbitControls 의 pointer capture 와도 공존.
  // (PointerEvent 는 MouseEvent 를 상속하므로 button/clientX/Y 는 그대로 사용 가능.)
  private readonly onMouseDown: (e: PointerEvent) => void;
  private readonly onMouseMove: (e: PointerEvent) => void;
  private readonly onMouseUp: (e: PointerEvent) => void;
  // pointercancel: 브라우저 기본 제스처(터치 스크롤, iOS 3-finger 등)가 발동해
  // 포인터가 취소될 때 발사. setPointerCapture 로 대부분 방어되지만 보험으로 상태 리셋.
  private readonly onPointerCancel: (e: PointerEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;
  // M4 Step 3: ESC 로 선택 해제. window 에 붙이는 이유는 canvas 가 포커스 받지 않는
  // <div> 기반이라 domElement.keydown 은 실제로 발사되지 않기 때문 (표준 동작).
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  // 캡처 중인 pointerId. dispose 시 release 에 사용.
  private capturedPointerId: number | null = null;

  private readonly orbitControls: OrbitControls;

  // 히트테스트용. Raycaster 는 재사용 가능(stateful 하지 않음) → 멤버로 하나만 보관.
  private readonly raycaster: THREE.Raycaster;
  private pickTarget: THREE.Object3D | null = null;
  private indexToIdResolver: (() => readonly string[]) | null = null;
  private readonly onPick: ((nodeId: string | null) => void) | null;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    options?: CameraControllerOptions
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.onPick = options?.onPick ?? null;
    this.raycaster = new THREE.Raycaster();

    this.onMouseDown = (e) => this.handleMouseDown(e);
    this.onMouseMove = (e) => this.handleMouseMove(e);
    this.onMouseUp = (e) => this.handleMouseUp(e);
    this.onPointerCancel = (e) => this.handlePointerCancel(e);
    this.onWheel = (e) => this.handleWheel(e);
    this.onKeyDown = (e) => this.handleKeyDown(e);

    // M4 Step 1 재설계: 모든 pointer 이벤트를 canvas 에 통일.
    //  - pointerdown 시 setPointerCapture 로 포인터를 canvas 에 잡아두면,
    //    pointermove/up/cancel 이 드래그가 캔버스 밖으로 나가더라도 canvas 로 계속 옴.
    //  - OrbitControls 도 canvas 의 pointerdown 핸들러에서 setPointerCapture 를
    //    호출하지만, 우리 리스너가 먼저 등록되어 있어 같은 이벤트를 양쪽 다 처리.
    //  - window 에 리스너를 붙이지 않으므로 HMR(Hot Reload) 시 잔존 리스너 누수 방지.
    this.domElement.addEventListener("pointerdown", this.onMouseDown);
    this.domElement.addEventListener("pointermove", this.onMouseMove);
    this.domElement.addEventListener("pointerup", this.onMouseUp);
    this.domElement.addEventListener("pointercancel", this.onPointerCancel);
    // wheel 도 canvas 위에서만. passive=false 여야 preventDefault() 로 페이지 스크롤 차단 가능.
    this.domElement.addEventListener("wheel", this.onWheel, { passive: false });
    // keydown 은 window 레벨 — canvas 가 포커스 대상이 아니기 때문.
    // HMR/unmount 시 dispose 에서 동일 참조로 remove 하여 리스너 누수 없음 (C2 패턴).
    window.addEventListener("keydown", this.onKeyDown);

    this.domElement.style.cursor = "grab";
    // touch-action: none — 터치/펜 입력 시 브라우저 기본 제스처(스크롤/핀치/텍스트 선택)가
    // 발동하며 pointercancel 을 쏘는 것을 원천 차단. 데스크톱 마우스에는 영향 없음.
    this.domElement.style.touchAction = "none";

    // OrbitControls: 우클릭 회전 전용. 팬/줌은 직접 구현한 것을 사용하므로 비활성.
    this.orbitControls = new OrbitControls(camera, domElement);
    this.orbitControls.enablePan = false;
    this.orbitControls.enableZoom = false;
    this.orbitControls.enableRotate = true;
    // damping: 마우스 떼도 관성으로 부드럽게 멈춤. 단, update() 매 프레임 호출 필수.
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    // 회전 중심을 노드 원점(0,0,0)으로 고정. 팬으로 카메라만 움직이므로 target도 같이
    // 옮기고 싶지 않다면 후속 세션에서 재검토. (지금은 노드 군집 중심 기준 회전.)
    this.orbitControls.target.set(0, 0, 0);
    // LEFT 버튼은 우리 팬이 담당 → OrbitControls에선 무시.
    // RIGHT 는 회전. MIDDLE은 비활성.
    this.orbitControls.mouseButtons = {
      LEFT: null,
      MIDDLE: null,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.orbitControls.update();
  }

  /**
   * update() — 매 프레임 render loop에서 호출되어야 함.
   * OrbitControls의 damping 효과가 이 호출에 의존.
   */
  update(): void {
    this.orbitControls.update();
  }

  /**
   * 히트테스트 대상 InstancedMesh 주입. 생성 이후 별도로 호출.
   * Scene 초기화 순서상 CameraController 가 먼저 만들어지고 InstancedNodes 가
   * 뒤따라오므로 생성자 파라미터가 아닌 setter 로 분리했다.
   */
  setPickTarget(mesh: THREE.Object3D | null): void {
    this.pickTarget = mesh;
  }

  /**
   * Buffer Index → UUID 역매핑 리졸버 주입.
   * bridge.getIndexToId() 를 람다로 감싸 전달하면 매 클릭마다 최신 배열이 조회된다
   * (store 가 변하면 bridge 내부 indexToId 도 갱신되므로 snapshot 금지).
   */
  setIndexToIdResolver(resolver: (() => readonly string[]) | null): void {
    this.indexToIdResolver = resolver;
  }

  private handleMouseDown(e: PointerEvent): void {
    if (e.button !== 0) return;

    // setPointerCapture: 이 포인터의 후속 이벤트(pointermove/up/cancel)가
    // 마우스가 캔버스 밖으로 나가도 canvas 로 계속 오게 강제 라우팅.
    // 동일 pointerId 에 대해 OrbitControls 도 같은 호출을 할 수 있으나
    // 사양상 중복 호출은 무해 (마지막 호출자가 캡처 소유).
    if (typeof this.domElement.setPointerCapture === "function") {
      try {
        this.domElement.setPointerCapture(e.pointerId);
        this.capturedPointerId = e.pointerId;
      } catch {
        // 일부 환경(비활성 pointer)에서는 throw 가능 — 무시하고 진행.
      }
    }

    this.isDragging = true;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    this.downClientX = e.clientX;
    this.downClientY = e.clientY;
    this.domElement.style.cursor = "grabbing";
  }

  /**
   * handlePointerCancel — 브라우저/OS 가 포인터를 취소시켰을 때.
   * 드래그 상태만 안전하게 리셋하고 히트테스트/선택은 건드리지 않는다.
   */
  private handlePointerCancel(_e: PointerEvent): void {
    this.isDragging = false;
    this.domElement.style.cursor = "grab";
    if (
      this.capturedPointerId !== null &&
      typeof this.domElement.releasePointerCapture === "function"
    ) {
      try {
        this.domElement.releasePointerCapture(this.capturedPointerId);
      } catch {
        /* noop */
      }
      this.capturedPointerId = null;
    }
  }

  /**
   * handleMouseMove — 드래그 중이면 카메라 position을 업데이트.
   *
   * Perspective에서는 픽셀당 월드 거리가 카메라-평면 거리에 비례하므로
   * 매 mousemove마다 현재 camera.position.z 를 기준으로 재계산한다.
   * (줌 후에도 자연스러운 팬 속도 유지 — 가까이 가면 민감해지고, 멀어지면 둔해짐.)
   */
  private handleMouseMove(e: PointerEvent): void {
    if (!this.isDragging) return;

    const dx = e.clientX - this.lastClientX;
    const dy = e.clientY - this.lastClientY;

    const ch = this.domElement.clientHeight || 1;
    // fov는 도(°) 단위. tan 에 넣기 전에 라디안 변환.
    const vFovRad = THREE.MathUtils.degToRad(this.camera.fov);
    // 팬 대상 평면은 z=0 이라고 가정. 카메라는 항상 z>0 에서 내려다봄.
    const distance = Math.abs(this.camera.position.z);
    const worldPerPixel = (2 * distance * Math.tan(vFovRad / 2)) / ch;

    // 카메라는 드래그 반대 방향으로 이동 (콘텐츠 follow hand).
    // y축: screen(↓+) + 카메라 역방향 → 결과적으로 +=.
    this.camera.position.x -= dx * worldPerPixel;
    this.camera.position.y += dy * worldPerPixel;

    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
  }

  private handleMouseUp(e: PointerEvent): void {
    if (!this.isDragging) return;

    // 드래그/클릭 판정: 전체 이동 거리(맨해튼) 가 임계값 미만이면 클릭으로 처리.
    // button 체크는 mousedown 쪽에서 이미 0 으로 제한되므로 여기서는 생략 가능하지만,
    // window mouseup 이벤트가 다른 경로로 들어올 여지를 막기 위해 방어적으로 확인.
    if (e.button === 0 && this.onPick) {
      const totalDist =
        Math.abs(e.clientX - this.downClientX) +
        Math.abs(e.clientY - this.downClientY);
      if (totalDist < CLICK_DISTANCE_THRESHOLD) {
        this.performPick(e.clientX, e.clientY);
      }
    }

    this.isDragging = false;
    this.domElement.style.cursor = "grab";

    // pointerup 도착하면 캡처 해제 (브라우저가 자동 해제하는 경우도 있지만 명시적으로).
    if (
      this.capturedPointerId !== null &&
      typeof this.domElement.releasePointerCapture === "function"
    ) {
      try {
        this.domElement.releasePointerCapture(this.capturedPointerId);
      } catch {
        /* noop */
      }
      this.capturedPointerId = null;
    }
  }

  /**
   * performPick — Raycaster 로 instancedMesh 히트테스트 → UUID 역변환 → onPick 호출.
   *
   * NDC 좌표는 domElement(canvas) 의 getBoundingClientRect 를 기준으로 계산한다.
   * 캔버스가 뷰포트 전체를 덮는 경우에도 left/top 이 0 이라 clientX/Y 와 동일하지만,
   * 패널 같은 오프셋이 생기는 경우를 대비해 일반화.
   *
   * hit 이 있으면 intersects[0].instanceId → indexToId[i] 로 UUID 획득.
   * hit 이 없거나 instanceId 가 없으면 null (빈 공간 클릭 = 선택 해제).
   */
  private performPick(clientX: number, clientY: number): void {
    if (!this.onPick) return;
    if (!this.pickTarget) {
      this.onPick(null);
      return;
    }

    const rect =
      typeof this.domElement.getBoundingClientRect === "function"
        ? this.domElement.getBoundingClientRect()
        : ({ left: 0, top: 0 } as DOMRect);
    const cw = this.domElement.clientWidth || 1;
    const ch = this.domElement.clientHeight || 1;

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const ndcX = (localX / cw) * 2 - 1;
    const ndcY = -(localY / ch) * 2 + 1;

    // matrixWorld/boundingSphere 갱신 책임은 InstancedNodes.syncFromBuffer 에 있다.
    // 여기서는 순수하게 NDC → Ray → intersect 만 수행.
    const ndc = new THREE.Vector2(ndcX, ndcY);
    this.raycaster.setFromCamera(ndc, this.camera);

    const intersects = this.raycaster.intersectObject(this.pickTarget, false);
    const first = intersects[0];
    if (first && first.instanceId !== undefined && this.indexToIdResolver) {
      const id = this.indexToIdResolver()[first.instanceId] ?? null;
      this.onPick(id);
    } else {
      this.onPick(null);
    }
  }

  /**
   * handleKeyDown — ESC 로 선택 해제 (M4 Step 3).
   *
   * 빈 공간 클릭과 의미적으로 동일 (선택된 노드 없음) → onPick(null) 재사용.
   * 별도 콜백을 두면 App 레이어에서 같은 selectNode(null) 을 두 번 배선해야 해
   * 불필요한 표면적이 늘어난다.
   *
   * 주의:
   *  - preventDefault 는 호출하지 않는다. ESC 의 기본 동작(전체화면 해제 등)을
   *    빼앗지 않기 위해서. 리스너는 리스닝만 하고, store 갱신은 onPick 으로 위임.
   *  - e.key === "Escape" 는 모든 모던 브라우저에서 IE legacy "Esc" 와 분리된 표준 값.
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    if (this.onPick) {
      this.onPick(null);
    }
  }

  /**
   * handleWheel — 휠로 카메라 z축 이동 (줌 in/out).
   *
   * 방향 규칙:
   *   deltaY > 0 (휠 아래로) → 줌아웃 → z 증가 (factor > 1)
   *   deltaY < 0 (휠 위로)   → 줌인   → z 감소 (factor < 1)
   *
   * 지수적 스케일: newZ = z * 1.1^(deltaY/100).
   * 같은 휠 동작이 현재 거리에 비례해 항상 동일 비율로 줌되어 체감이 일정하다.
   *
   * preventDefault(): 캔버스 위 휠로 페이지가 스크롤되는 걸 막음.
   */
  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = Math.pow(ZOOM_FACTOR_BASE, e.deltaY / ZOOM_DELTA_DIVISOR);
    const newZ = this.camera.position.z * factor;
    this.camera.position.z = THREE.MathUtils.clamp(newZ, MIN_ZOOM_Z, MAX_ZOOM_Z);
  }

  /**
   * dispose — 리스너 전부 제거 + OrbitControls 정리 + cursor 원복.
   * OrbitControls.dispose()는 내부에서 domElement에 붙인 pointer/wheel/contextmenu
   * 리스너를 전부 해제한다.
   */
  dispose(): void {
    this.domElement.removeEventListener("pointerdown", this.onMouseDown);
    this.domElement.removeEventListener("pointermove", this.onMouseMove);
    this.domElement.removeEventListener("pointerup", this.onMouseUp);
    this.domElement.removeEventListener("pointercancel", this.onPointerCancel);
    this.domElement.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);

    // 잔존 캡처 해제 (HMR 중 dispose 누락 시 다음 인스턴스와 경쟁 방지).
    if (
      this.capturedPointerId !== null &&
      typeof this.domElement.releasePointerCapture === "function"
    ) {
      try {
        this.domElement.releasePointerCapture(this.capturedPointerId);
      } catch {
        /* noop */
      }
      this.capturedPointerId = null;
    }

    this.orbitControls.dispose();

    this.domElement.style.cursor = "";
    this.domElement.style.touchAction = "";
  }
}
