import * as THREE from "three";

/**
 * CameraController — 드래그 팬 전용 카메라 컨트롤러 (M2 Step 2, First Interaction)
 *
 * 설계 원칙:
 *  - 역할은 "팬(평행 이동) 딱 하나". 줌/회전은 제외 (줌 → M3, 회전 → M4 3D 전환).
 *  - OrthographicCamera 의 position.x/y 만 조작. zoom 속성과 position.z 는 불변.
 *  - 이벤트는 mousedown=domElement, mousemove/mouseup=window 로 분리해서
 *    캔버스 밖으로 드래그했다가 돌아와도 드래그가 지속되도록 한다.
 *
 * 스크린 → 월드 좌표 변환:
 *   OrthographicCamera 의 (right - left) 가 현재 뷰포트의 월드 너비이고,
 *   domElement.clientWidth 가 화면 픽셀 너비다. 둘의 비율이 픽셀당 월드 거리.
 *   worldDx = screenDx * (right - left) / clientWidth
 *
 * 카메라 이동 방향:
 *   사용자가 손(마우스)을 오른쪽으로 드래그하면 화면 속 콘텐츠가 오른쪽으로
 *   "끌려오는" 느낌을 주어야 자연스럽다. 콘텐츠를 오른쪽으로 보이게 하려면
 *   카메라는 반대쪽(왼쪽)으로 움직여야 하므로 x 축은 역방향 (cam.x -= worldDx).
 *   y 축은 스크린 y(아래=+) 와 월드 y(위=+) 가 부호가 반대라 한 번 뒤집히고,
 *   카메라 역방향 규칙으로 한 번 더 뒤집혀서 결과적으로 cam.y += screenDy 가 된다.
 *
 * 리소스 관리:
 *   dispose() 가 모든 리스너를 참조 동일성으로 제거한다 (C2 버그 교훈).
 *   StrictMode 더블 마운트에서도 누수 없도록 handler 를 멤버로 저장한다.
 */
export class CameraController {
  private camera: THREE.OrthographicCamera;
  private domElement: HTMLElement;

  // 드래그 상태. mousedown 으로 true, mouseup 으로 false.
  private isDragging = false;

  // 직전 mousemove 좌표. 델타 계산에 사용.
  private lastClientX = 0;
  private lastClientY = 0;

  // 리스너 참조를 멤버로 보관 (remove 시 동일 참조 필요)
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;

  constructor(camera: THREE.OrthographicCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;

    // 화살표 함수 래핑으로 this 바인딩 고정. 참조를 멤버에 저장해야 remove 가능.
    this.onMouseDown = (e) => this.handleMouseDown(e);
    this.onMouseMove = (e) => this.handleMouseMove(e);
    this.onMouseUp = (e) => this.handleMouseUp(e);

    // mousedown 은 canvas 위에서만 반응해야 함 (UI 패널 클릭과 분리).
    this.domElement.addEventListener("mousedown", this.onMouseDown);

    // mousemove/mouseup 은 window 전역에서 받음.
    // 이유: 드래그 중 커서가 canvas 를 벗어나도 이벤트를 놓치지 않기 위함.
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);

    // 초기 커서: 드래그 가능 상태임을 시각적으로 암시.
    this.domElement.style.cursor = "grab";
  }

  /**
   * handleMouseDown — 좌클릭 시에만 드래그 시작.
   * 중클릭/우클릭은 무시 (나중에 컨텍스트 메뉴/다른 인터랙션 여지).
   */
  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;

    this.isDragging = true;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    this.domElement.style.cursor = "grabbing";
  }

  /**
   * handleMouseMove — 드래그 중이면 카메라 position 을 업데이트.
   *
   * 성능 메모: 이 핸들러는 매 mousemove 마다 호출되므로 프레임당 여러 번
   * 실행될 수 있다. 하지만 카메라 position 변경은 값 할당 2회뿐이고,
   * 실제 GPU 업로드는 Scene 의 rAF 루프에서 renderer.render 가 담당한다.
   * mousemove 에서는 Matrix 재계산이 없고, Scene 루프가 자연스럽게 반영한다.
   */
  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;

    const dx = e.clientX - this.lastClientX;
    const dy = e.clientY - this.lastClientY;

    // 픽셀당 월드 거리 (카메라 뷰포트 / DOM 크기). clientWidth 가 0이면 1로 폴백.
    const worldWidth = this.camera.right - this.camera.left;
    const worldHeight = this.camera.top - this.camera.bottom;
    const cw = this.domElement.clientWidth || 1;
    const ch = this.domElement.clientHeight || 1;
    const scaleX = worldWidth / cw;
    const scaleY = worldHeight / ch;

    // 카메라는 드래그 반대 방향으로 이동 (콘텐츠가 손 따라오는 효과).
    // y 축은 screen(↓+) vs world(↑+) + 역방향 규칙이 겹쳐서 최종적으로 +=.
    this.camera.position.x -= dx * scaleX;
    this.camera.position.y += dy * scaleY;

    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
  }

  /**
   * handleMouseUp — 드래그 종료. 버튼 불문하고 드래그 상태 해제.
   */
  private handleMouseUp(_e: MouseEvent): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.domElement.style.cursor = "grab";
  }

  /**
   * dispose — 리스너 전부 제거 + cursor 원복.
   *
   * addEventListener/removeEventListener 는 참조 동일성으로 매칭하므로,
   * 생성자에서 멤버에 저장한 정확한 참조를 다시 넘겨야 한다.
   */
  dispose(): void {
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);

    // cursor 원복: 컨트롤러가 떼어진 뒤에도 grab 커서가 남아있으면 혼란스럽다.
    this.domElement.style.cursor = "";
  }
}
