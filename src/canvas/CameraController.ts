import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * 카메라 줌 범위 — Perspective z축. z=0 이 노드 평면.
 *  - MIN_ZOOM_Z: 너무 가까이 가면 노드 안쪽/뒤로 들어가 시야 깨짐.
 *  - MAX_ZOOM_Z: 너무 멀면 노드가 점으로 사라짐.
 */
const MIN_ZOOM_Z = 50;
const MAX_ZOOM_Z = 5000;
/**
 * 휠 한 눈금당 줌 배율. 지수적 스케일을 쓰는 이유:
 *  - 현재 z에 비례해서 z가 변하면 "같은 휠 동작=같은 체감 줌"이 된다.
 *  - 1.1^(deltaY/100) — 브라우저 표준 deltaY(100단위/줄) 기준 10% 변화.
 */
const ZOOM_FACTOR_BASE = 1.1;
const ZOOM_DELTA_DIVISOR = 100;

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

  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;

  private readonly orbitControls: OrbitControls;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.onMouseDown = (e) => this.handleMouseDown(e);
    this.onMouseMove = (e) => this.handleMouseMove(e);
    this.onMouseUp = (e) => this.handleMouseUp(e);
    this.onWheel = (e) => this.handleWheel(e);

    // mousedown 은 canvas 위에서만 반응해야 함 (UI 패널 클릭과 분리).
    this.domElement.addEventListener("mousedown", this.onMouseDown);
    // wheel 도 canvas 위에서만. passive=false 여야 preventDefault() 로 페이지 스크롤 차단 가능.
    this.domElement.addEventListener("wheel", this.onWheel, { passive: false });

    // mousemove/mouseup 은 window 전역. 캔버스 밖으로 나가도 드래그 지속.
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);

    this.domElement.style.cursor = "grab";

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

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;

    this.isDragging = true;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    this.domElement.style.cursor = "grabbing";
  }

  /**
   * handleMouseMove — 드래그 중이면 카메라 position을 업데이트.
   *
   * Perspective에서는 픽셀당 월드 거리가 카메라-평면 거리에 비례하므로
   * 매 mousemove마다 현재 camera.position.z 를 기준으로 재계산한다.
   * (줌 후에도 자연스러운 팬 속도 유지 — 가까이 가면 민감해지고, 멀어지면 둔해짐.)
   */
  private handleMouseMove(e: MouseEvent): void {
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

  private handleMouseUp(_e: MouseEvent): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.domElement.style.cursor = "grab";
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
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    this.domElement.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);

    this.orbitControls.dispose();

    this.domElement.style.cursor = "";
  }
}
