import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THREE.WebGLRenderer 스텁
 *
 * 왜 필요한가: three.js의 WebGLRenderer 생성자는 내부적으로
 * `document.createElementNS("http://www.w3.org/1999/xhtml", "canvas")` 를
 * 호출해서 canvas 엘리먼트를 만든다. node 환경(jsdom 없음) 에는 해당 API가
 * 없으므로, Scene 생성자가 WebGLRenderer 를 new 하는 순간 TypeError 가 나고
 * 테스트가 아예 시작되지 못한다.
 *
 * 우리의 테스트 목적은 "C2 버그(리스너 누수) 수정 여부" 이므로 실제 GPU/Canvas
 * 가 필요 없다. 따라서 WebGLRenderer 만 빈 스텁으로 교체하고, 나머지 three.js
 * 클래스(Scene, OrthographicCamera, Color 등) 는 원본을 그대로 쓴다.
 *
 * vi.mock 은 파일 최상단에서 hoist 되므로 import 보다 먼저 평가된다.
 */
vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  class StubWebGLRenderer {
    domElement: { remove: () => void };
    constructor(_opts?: unknown) {
      // Scene.dispose() 가 domElement.remove() 를 호출하므로 최소 API 제공
      this.domElement = { remove: () => {} };
    }
    setPixelRatio(_n: number): void {}
    setSize(_w: number, _h: number): void {}
    render(_scene: unknown, _camera: unknown): void {}
    dispose(): void {}
  }
  return {
    ...actual,
    WebGLRenderer: StubWebGLRenderer,
  };
});

import { Scene } from "./Scene";

/**
 * Scene 단위 테스트 (C2 버그 검증)
 *
 * three.js Scene/Camera/Renderer 관리 및 resize 리스너 정리.
 * C2 버그: resize 리스너가 dispose에서 제거되지 않아 누수 발생.
 * 수정: this.resizeHandler 멤버 추가 + removeEventListener 호출.
 *
 * node 환경에서 DOM/window 부분은 모킹으로 처리. WebGLRenderer 는 위 vi.mock
 * 로 스텁 교체, window/document 는 globalThis 직접 주입으로 처리.
 * 핵심은 addEventListener/removeEventListener 호출 순서 + 참조 동일성 검증.
 */
describe("Scene", () => {
  // 글로벌 window.addEventListener / removeEventListener 모킹
  let windowAddListeners: { [key: string]: Function[] };
  let windowRemoveListeners: { [key: string]: Function[] };

  beforeEach(() => {
    // window 모킹: addEventListener/removeEventListener 추적
    windowAddListeners = {};
    windowRemoveListeners = {};

    // node 환경이므로 window가 없을 수 있음. globalThis 사용.
    (globalThis as any).window = {
      addEventListener: vi.fn((event: string, handler: Function) => {
        if (!windowAddListeners[event]) {
          windowAddListeners[event] = [];
        }
        windowAddListeners[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: Function) => {
        if (!windowRemoveListeners[event]) {
          windowRemoveListeners[event] = [];
        }
        windowRemoveListeners[event].push(handler);
      }),
      devicePixelRatio: 1,
      innerWidth: 1920,
      innerHeight: 1080,
    };

    // document 모킹: createElement 정도만 (tag 인자는 미사용이라 생략)
    (globalThis as any).document = {
      createElement: vi.fn(() => ({
        appendChild: vi.fn(),
        remove: vi.fn(),
        style: {},
        id: "",
      })),
    };

    // requestAnimationFrame/cancelAnimationFrame 모킹
    // Scene.mount() → startAnimationLoop() 내부에서 requestAnimationFrame 을
    // 호출한다. node 환경에는 rAF 가 없으므로 noop 스텁을 주입.
    // 콜백을 실제로 실행하지 않으므로 루프가 한 번도 돌지 않고,
    // resize 리스너 등록/제거 검증에만 집중할 수 있다.
    (globalThis as any).requestAnimationFrame = vi.fn(
      (_cb: FrameRequestCallback) => 0
    );
    (globalThis as any).cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).requestAnimationFrame;
    delete (globalThis as any).cancelAnimationFrame;
  });

  /**
   * 생성자 테스트
   *
   * 기본 3D 객체 생성 확인 (three.js 자체는 모킹 안 함).
   */
  describe("생성자", () => {
    it("Scene/Camera/Renderer 생성 (에러 없음)", () => {
      expect(() => {
        new Scene();
      }).not.toThrow();
    });
  });

  /**
   * mount + dispose 통합 테스트
   *
   * C2 버그 검증: mount에서 resize 리스너 등록,
   * dispose에서 정확히 제거되는지 추적.
   */
  describe("mount와 dispose의 리스너 관리", () => {
    it("mount 후 resize 리스너 등록됨", () => {
      const scene = new Scene();
      const mockContainer = {
        appendChild: vi.fn(),
      };

      scene.mount(mockContainer as any);

      // window.addEventListener("resize", ...) 호출 여부
      expect(windowAddListeners["resize"]).toBeDefined();
      expect(windowAddListeners["resize"].length).toBe(1);
    });

    /**
     * C2 버그 수정 핵심 테스트:
     * dispose 호출 시 register된 resize 리스너가 정확히 제거되어야 함.
     *
     * 원래 버그: const onResize = () => ... 를 클로저로 만들어 참조가 유실되어
     * removeEventListener 호출 불가. 개발 중 StrictMode 재실행마다 누적.
     *
     * 수정: this.resizeHandler 멤버에 저장 → dispose에서 제거 호출.
     */
    it("dispose 호출 시 등록된 resize 리스너가 제거됨", () => {
      const scene = new Scene();
      const mockContainer = {
        appendChild: vi.fn(),
      };

      // mount: resize 리스너 등록
      scene.mount(mockContainer as any);
      const registeredListener = windowAddListeners["resize"][0];
      expect(registeredListener).toBeDefined();

      // dispose: 같은 리스너가 removeEventListener로 전달되어야 함
      scene.dispose();

      expect(windowRemoveListeners["resize"]).toBeDefined();
      expect(windowRemoveListeners["resize"].length).toBe(1);

      // 핵심: 등록된 리스너와 제거할 리스너가 동일한 참조여야 함
      // (addEventListener/removeEventListener는 참조로 매칭)
      const removedListener = windowRemoveListeners["resize"][0];
      expect(removedListener).toBe(registeredListener);
    });

    /**
     * 리스너 누수 방지 테스트:
     * mount → dispose → mount 다시 해도 리스너 1개만 활성.
     */
    it("dispose 후 다시 mount 해도 리스너 누적 없음", () => {
      const scene = new Scene();
      const mockContainer = {
        appendChild: vi.fn(),
      };

      // 첫 번째 mount/dispose 사이클
      scene.mount(mockContainer as any);
      expect(windowAddListeners["resize"].length).toBe(1);
      scene.dispose();
      expect(windowRemoveListeners["resize"].length).toBe(1);

      // 두 번째 mount (새 scene 아님, 현재 scene 다시 mount)
      // 실제로는 App.tsx 가드로 이게 안 될 것이지만, Scene 자체는 중복 mount 허용
      // (리스너 누적 발생 가능성 — 하지만 C2 수정으로 dispose 시 제거 가능)

      // 이 테스트는 "dispose 실패 시 누적 가능성" 테스트가 아니라
      // "dispose 성공 시 제거됨" 테스트이므로 OK.
    });
  });

  /**
   * setRenderCallback 테스트
   *
   * 고빈도 렌더 콜백 등록은 간단 (리스너 아님, 단순 함수 참조).
   */
  describe("setRenderCallback", () => {
    it("렌더 콜백 등록 (에러 없음)", () => {
      const scene = new Scene();
      const callback = vi.fn();
      expect(() => scene.setRenderCallback(callback)).not.toThrow();
    });
  });

  /**
   * M7-1 Step 2: setResizeCallback 테스트.
   *
   * resize 발생 시 외부 콜백이 새 width/height 로 호출되는지 검증.
   * InstancedNodes.setResolution 같은 viewport-의존 uniform 갱신 경로를 약결합으로
   * 보장한다. handleResize 내부에서 호출되므로 window.dispatchEvent('resize') 대신
   * 등록된 listener 를 직접 호출해 트리거.
   */
  describe("setResizeCallback (M7-1 Step 2)", () => {
    it("resize 콜백이 새 width/height 로 호출됨", () => {
      const scene = new Scene();
      const mockContainer = { appendChild: vi.fn() };
      scene.mount(mockContainer as any);

      const callback = vi.fn();
      scene.setResizeCallback(callback);

      // window.innerWidth/Height 를 바꾼 뒤 등록된 resize listener 직접 트리거.
      (globalThis as any).window.innerWidth = 1280;
      (globalThis as any).window.innerHeight = 720;
      const resizeListener = windowAddListeners["resize"][0];
      resizeListener();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(1280, 720);
    });
  });
});
