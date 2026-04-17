import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { CameraController } from "./CameraController";

/**
 * CameraController 단위 테스트 (M2 Step 2 — First Interaction)
 *
 * 검증 목표:
 *  1) mousedown → isDragging=true, cursor="grabbing"
 *  2) mousemove: 스크린 픽셀 델타를 월드 좌표 델타로 변환해 camera.position 역방향 이동
 *     (손이 오른쪽으로 가면 콘텐츠가 오른쪽으로 따라오도록 카메라는 왼쪽으로)
 *  3) mouseup → isDragging=false, cursor="grab"
 *  4) dispose → window/domElement 리스너 전부 제거, cursor 복원
 *
 * Scene.test.ts 와 동일한 패턴으로 window/document 전역을 직접 주입한다.
 * (프로젝트는 jsdom 없이 node 환경에서 vitest 돌림)
 */
describe("CameraController", () => {
  // window 이벤트 리스너 추적용 테이블
  let windowListeners: Record<string, Function[]>;
  let windowRemoved: Record<string, Function[]>;

  beforeEach(() => {
    windowListeners = {};
    windowRemoved = {};

    (globalThis as any).window = {
      addEventListener: vi.fn((event: string, handler: Function) => {
        (windowListeners[event] ||= []).push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: Function) => {
        (windowRemoved[event] ||= []).push(handler);
      }),
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  /**
   * 테스트용 mock DOM element 생성 헬퍼
   *
   * domElement.addEventListener/removeEventListener 도 추적하고,
   * clientWidth/Height 를 고정값으로 제공한다 (스케일 계산에 필요).
   */
  function createMockDom() {
    const dom: any = {
      clientWidth: 1920,
      clientHeight: 1080,
      style: { cursor: "" },
      _listeners: {} as Record<string, Function[]>,
      _removed: {} as Record<string, Function[]>,
      addEventListener: vi.fn((event: string, handler: Function) => {
        (dom._listeners[event] ||= []).push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: Function) => {
        (dom._removed[event] ||= []).push(handler);
      }),
    };
    return dom;
  }

  /**
   * 테스트용 OrthographicCamera 생성.
   * left/right/top/bottom 은 Scene 의 초기값과 동일 (1920x1080).
   */
  function createCamera(): THREE.OrthographicCamera {
    const cam = new THREE.OrthographicCamera(-960, 960, 540, -540, 0.1, 10000);
    cam.position.set(0, 0, 100);
    return cam;
  }

  describe("생성자", () => {
    it("생성 시 에러 없음 + cursor='grab'", () => {
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom);

      expect(dom.style.cursor).toBe("grab");
      expect(ctrl).toBeDefined();
    });

    it("생성 시 mousedown은 domElement에, mousemove/mouseup은 window에 등록", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      // domElement: mousedown 만 등록 (캔버스 위에서만 드래그 시작)
      expect(dom._listeners["mousedown"]?.length).toBe(1);

      // window: mousemove/mouseup 등록 (캔버스 밖으로 나가도 드래그 지속)
      expect(windowListeners["mousemove"]?.length).toBe(1);
      expect(windowListeners["mouseup"]?.length).toBe(1);
    });
  });

  describe("드래그 흐름", () => {
    it("mousedown (left button) → cursor='grabbing'", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousedown = dom._listeners["mousedown"][0];
      mousedown({ button: 0, clientX: 100, clientY: 100 });

      expect(dom.style.cursor).toBe("grabbing");
    });

    it("mousedown with right button (button=2) → 무시 (cursor 불변)", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousedown = dom._listeners["mousedown"][0];
      mousedown({ button: 2, clientX: 100, clientY: 100 });

      // 우클릭은 팬에 사용 안 함 (컨텍스트 메뉴/나중 인터랙션 여지)
      expect(dom.style.cursor).toBe("grab");
    });

    it("mousedown → mousemove: 카메라가 역방향으로 이동 (콘텐츠 follow hand)", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousedown = dom._listeners["mousedown"][0];
      const mousemove = windowListeners["mousemove"][0];

      mousedown({ button: 0, clientX: 0, clientY: 0 });

      // +100px 오른쪽으로 드래그
      // 스케일: worldWidth(1920)/clientWidth(1920) = 1 → worldDx = 100
      // 카메라는 반대 방향: x -= 100
      mousemove({ clientX: 100, clientY: 0 });
      expect(cam.position.x).toBe(-100);
      expect(cam.position.y).toBe(0);

      // +100px 아래로 드래그 (screen y는 아래가 +)
      // 자연스러운 팬: 손 아래 → 콘텐츠 아래 → 카메라 위
      // cam.y += dy (screen_down=+ 이므로 world y도 +)
      mousemove({ clientX: 100, clientY: 100 });
      expect(cam.position.y).toBe(100);
    });

    it("mouseup → isDragging 해제, cursor='grab', 이후 mousemove 무시", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousedown = dom._listeners["mousedown"][0];
      const mousemove = windowListeners["mousemove"][0];
      const mouseup = windowListeners["mouseup"][0];

      mousedown({ button: 0, clientX: 0, clientY: 0 });
      mouseup({ button: 0, clientX: 0, clientY: 0 });
      expect(dom.style.cursor).toBe("grab");

      // mouseup 이후 mousemove는 카메라 위치에 영향 X
      const before = cam.position.clone();
      mousemove({ clientX: 500, clientY: 500 });
      expect(cam.position.equals(before)).toBe(true);
    });

    it("드래그하지 않은 상태의 mousemove는 카메라 영향 없음", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousemove = windowListeners["mousemove"][0];
      const before = cam.position.clone();
      mousemove({ clientX: 500, clientY: 500 });

      expect(cam.position.equals(before)).toBe(true);
    });
  });

  describe("dispose", () => {
    it("dispose 시 window 리스너 제거 + domElement 리스너 제거 + cursor 복원", () => {
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom);

      const mousedownRef = dom._listeners["mousedown"][0];
      const mousemoveRef = windowListeners["mousemove"][0];
      const mouseupRef = windowListeners["mouseup"][0];

      ctrl.dispose();

      // 참조 동일성으로 제거되었는지 검증
      expect(dom._removed["mousedown"]?.[0]).toBe(mousedownRef);
      expect(windowRemoved["mousemove"]?.[0]).toBe(mousemoveRef);
      expect(windowRemoved["mouseup"]?.[0]).toBe(mouseupRef);

      // cursor 복원 (사용자가 다른 UI로 넘어갈 때 grab 커서 잔존 방지)
      expect(dom.style.cursor).toBe("");
    });
  });
});
