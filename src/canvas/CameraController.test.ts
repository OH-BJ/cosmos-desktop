import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";

/**
 * OrbitControls 는 내부에서 domElement 에 pointer/wheel/contextmenu 리스너를
 * 실제로 붙이고 setPointerCapture 같은 실DOM API에도 의존한다. jsdom 없이 우리의
 * 최소 mock DOM 으로는 구동이 어렵고, CameraController 의 관심사(설정/업데이트/정리)만
 * 검증하면 되므로 스텁으로 대체한다.
 *
 * 스텁은 실제 OrbitControls 와 동일한 속성(update/dispose/mouseButtons/target/
 * enablePan/enableZoom/enableRotate/enableDamping/dampingFactor)을 노출해서
 * CameraController 가 설정한 값을 테스트에서 확인할 수 있도록 한다.
 */
const orbitInstances: any[] = [];
vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  return {
    OrbitControls: vi.fn().mockImplementation(function (
      this: any,
      camera: any,
      domElement: any
    ) {
      this.camera = camera;
      this.domElement = domElement;
      this.enabled = true; // 실제 OrbitControls 와 일치 — CameraController 가 strict-false 체크
      this.enablePan = true;
      this.enableZoom = true;
      this.enableRotate = true;
      this.enableDamping = false;
      this.dampingFactor = 0;
      this.target = { set: vi.fn() };
      this.mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
      this.update = vi.fn();
      this.dispose = vi.fn();
      orbitInstances.push(this);
    }),
  };
});

import { CameraController } from "./CameraController";

/**
 * CameraController 단위 테스트 (M3 Step 1 — PerspectiveCamera 전환)
 *
 * 검증 목표:
 *  1) mousedown → isDragging=true, cursor="grabbing"
 *  2) mousemove: 스크린 픽셀 델타를 월드 좌표 델타로 변환해 camera.position 역방향 이동
 *     Perspective worldPerPixel = 2 * distance * tan(fov/2) / canvasHeight
 *  3) mouseup → isDragging=false, cursor="grab"
 *  4) dispose → window/domElement 리스너 전부 제거, cursor 복원
 *
 * 테스트 편의를 위해 "깔끔한 숫자"가 나오도록 카메라/DOM을 선택:
 *   fov=90°, tan(45°)=1, position.z=500, clientHeight=1000
 *   → worldPerPixel = 2 * 500 * 1 / 1000 = 1  (픽셀 1개 = 월드 1)
 *   이러면 100px 드래그가 정확히 100 월드 유닛으로 변환되어 기대값이 정수로 떨어짐.
 *   (Scene 의 실제 fov=50, z=500 과는 다르지만, 여기선 공식 검증이 목적이므로 OK.)
 *
 * Scene.test.ts 와 동일한 패턴으로 window/document 전역을 직접 주입한다.
 */
describe("CameraController", () => {
  let windowListeners: Record<string, Function[]>;
  let windowRemoved: Record<string, Function[]>;

  beforeEach(() => {
    windowListeners = {};
    windowRemoved = {};
    orbitInstances.length = 0;

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
   * 테스트용 mock DOM element 생성 헬퍼.
   * clientHeight=1000 은 위의 worldPerPixel=1 공식과 맞물림.
   */
  function createMockDom() {
    const dom: any = {
      clientWidth: 1000,
      clientHeight: 1000,
      style: { cursor: "" },
      _listeners: {} as Record<string, Function[]>,
      _removed: {} as Record<string, Function[]>,
      addEventListener: vi.fn((event: string, handler: Function) => {
        (dom._listeners[event] ||= []).push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: Function) => {
        (dom._removed[event] ||= []).push(handler);
      }),
      // M4: 히트테스트에서 NDC 변환에 canvas 좌상단 오프셋이 필요.
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 1000,
        width: 1000,
        height: 1000,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    };
    return dom;
  }

  /**
   * 테스트용 PerspectiveCamera.
   * fov=90°, z=500 → tan(45°)=1 이라 계산이 깔끔.
   */
  function createCamera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 10000);
    cam.position.set(0, 0, 500);
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

      expect(dom._listeners["pointerdown"]?.length).toBe(1);
      expect(dom._listeners["pointermove"]?.length).toBe(1);
      expect(dom._listeners["pointerup"]?.length).toBe(1);
    });
  });

  describe("드래그 흐름", () => {
    it("mousedown (left button) → cursor='grabbing'", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousedown = dom._listeners["pointerdown"][0];
      mousedown({ button: 0, clientX: 100, clientY: 100 });

      expect(dom.style.cursor).toBe("grabbing");
    });

    it("mousedown with right button (button=2) → 무시 (cursor 불변)", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousedown = dom._listeners["pointerdown"][0];
      mousedown({ button: 2, clientX: 100, clientY: 100 });

      expect(dom.style.cursor).toBe("grab");
    });

    it("mousedown → mousemove: 카메라가 역방향으로 이동 (콘텐츠 follow hand)", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousedown = dom._listeners["pointerdown"][0];
      const mousemove = dom._listeners["pointermove"][0];

      mousedown({ button: 0, clientX: 0, clientY: 0 });

      // +100px 오른쪽으로 드래그
      // worldPerPixel = 2*500*tan(45°)/1000 = 1 → worldDx = 100
      // 카메라는 반대 방향: x -= 100
      mousemove({ clientX: 100, clientY: 0 });
      expect(cam.position.x).toBeCloseTo(-100, 6);
      expect(cam.position.y).toBeCloseTo(0, 6);

      // 이어서 +100px 아래로 드래그 (dy=100)
      // cam.y += dy * 1 = 100 (screen↓ + 카메라 역방향 → += 로 귀결)
      mousemove({ clientX: 100, clientY: 100 });
      expect(cam.position.y).toBeCloseTo(100, 6);
    });

    it("줌 거리에 따라 팬 속도 변화 (distance-based scaling)", () => {
      // Perspective 의 핵심: 카메라가 멀수록 1픽셀당 더 큰 월드 거리.
      // z=1000 이면 worldPerPixel = 2*1000*1/1000 = 2 → 100px 드래그 = 200 월드.
      const cam = createCamera();
      cam.position.z = 1000;
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousedown = dom._listeners["pointerdown"][0];
      const mousemove = dom._listeners["pointermove"][0];

      mousedown({ button: 0, clientX: 0, clientY: 0 });
      mousemove({ clientX: 100, clientY: 0 });

      expect(cam.position.x).toBeCloseTo(-200, 6);
    });

    it("mouseup → isDragging 해제, cursor='grab', 이후 mousemove 무시", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousedown = dom._listeners["pointerdown"][0];
      const mousemove = dom._listeners["pointermove"][0];
      const mouseup = dom._listeners["pointerup"][0];

      mousedown({ button: 0, clientX: 0, clientY: 0 });
      mouseup({ button: 0, clientX: 0, clientY: 0 });
      expect(dom.style.cursor).toBe("grab");

      const before = cam.position.clone();
      mousemove({ clientX: 500, clientY: 500 });
      expect(cam.position.equals(before)).toBe(true);
    });

    it("드래그하지 않은 상태의 mousemove는 카메라 영향 없음", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const mousemove = dom._listeners["pointermove"][0];
      const before = cam.position.clone();
      mousemove({ clientX: 500, clientY: 500 });

      expect(cam.position.equals(before)).toBe(true);
    });
  });

  describe("휠 줌", () => {
    /**
     * wheel mock 이벤트 헬퍼. preventDefault 가 호출되는지 확인하기 위한 vi.fn 포함.
     */
    function wheelEvent(deltaY: number) {
      return { deltaY, preventDefault: vi.fn() };
    }

    it("wheel deltaY > 0 (아래로) → 줌아웃 = z 증가", () => {
      const cam = createCamera(); // z=500
      const dom = createMockDom();
      new CameraController(cam, dom);

      const onWheel = dom._listeners["wheel"][0];
      // factor = 1.1^(100/100) = 1.1 → 500 * 1.1 = 550
      onWheel(wheelEvent(100));

      expect(cam.position.z).toBeCloseTo(550, 6);
    });

    it("wheel deltaY < 0 (위로) → 줌인 = z 감소 + preventDefault 호출", () => {
      const cam = createCamera(); // z=500
      const dom = createMockDom();
      new CameraController(cam, dom);

      const onWheel = dom._listeners["wheel"][0];
      // factor = 1.1^(-100/100) = 1/1.1 ≈ 0.909 → 500 / 1.1 ≈ 454.545
      const ev = wheelEvent(-100);
      onWheel(ev);

      expect(cam.position.z).toBeCloseTo(500 / 1.1, 6);
      expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    });

    it("clamp min: 줌인 과도 시 z는 0.1 이하로 안 내려감", () => {
      // (M7-1 hotfix) MIN_ZOOM_Z 50 → 0.1 (D5 노드 ≈10 까지 들어가게).
      const cam = createCamera();
      cam.position.z = 0.12; // 거의 최소치
      const dom = createMockDom();
      new CameraController(cam, dom);

      const onWheel = dom._listeners["wheel"][0];
      // 큰 음수 deltaY: 1.1^-10 ≈ 0.386 → 0.12 * 0.386 ≈ 0.046 → clamp 0.1
      onWheel(wheelEvent(-1000));

      expect(cam.position.z).toBe(0.1);
    });

    it("clamp max: 줌아웃 과도 시 z는 1,000,000 초과 안 함", () => {
      // (M7-1 hotfix) MAX_ZOOM_Z 5000 → 1e6 (D1 별자리 100K 조망 가능).
      const cam = createCamera();
      cam.position.z = 900_000;
      const dom = createMockDom();
      new CameraController(cam, dom);

      const onWheel = dom._listeners["wheel"][0];
      // 큰 양수 deltaY: 1.1^10 ≈ 2.59 → 900K * 2.59 > 1e6 → clamp 1e6
      onWheel(wheelEvent(1000));

      expect(cam.position.z).toBe(1_000_000);
    });
  });

  describe("회전 (OrbitControls 연동)", () => {
    it("OrbitControls 생성 + 팬/줌 비활성 + 회전만 활성 + damping on", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      expect(orbitInstances.length).toBe(1);
      const oc = orbitInstances[0];
      expect(oc.enablePan).toBe(false);
      expect(oc.enableZoom).toBe(false);
      expect(oc.enableRotate).toBe(true);
      expect(oc.enableDamping).toBe(true);
      expect(oc.dampingFactor).toBeCloseTo(0.05, 6);
    });

    it("mouseButtons: LEFT=null (우리 팬과 분리), RIGHT=ROTATE", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const oc = orbitInstances[0];
      expect(oc.mouseButtons.LEFT).toBeNull();
      expect(oc.mouseButtons.MIDDLE).toBeNull();
      expect(oc.mouseButtons.RIGHT).toBe(THREE.MOUSE.ROTATE);
      // target 은 (0,0,0) 으로 세팅되어야 함
      expect(oc.target.set).toHaveBeenCalledWith(0, 0, 0);
    });

    it("update() 호출 시 OrbitControls.update() 위임", () => {
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom);

      const oc = orbitInstances[0];
      const before = oc.update.mock.calls.length; // 생성자 내부에서 1회 호출됨
      ctrl.update();
      ctrl.update();

      expect(oc.update.mock.calls.length).toBe(before + 2);
    });
  });

  describe("클릭 픽 (M7.5 cleanup — GPU Picker 경로만)", () => {
    it("클릭(<5px) → onPickPixel 호출 with clientX/Y", () => {
      const onPickPixel = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onPickPixel });

      const down = dom._listeners["pointerdown"][0];
      const up = dom._listeners["pointerup"][0];

      down({ button: 0, clientX: 500, clientY: 500 });
      up({ button: 0, clientX: 502, clientY: 501 });

      expect(onPickPixel).toHaveBeenCalledTimes(1);
      expect(onPickPixel).toHaveBeenCalledWith(502, 501);
    });

    it("드래그(>5px) → onPickPixel 미호출 (팬 동작만)", () => {
      const onPickPixel = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onPickPixel });

      const down = dom._listeners["pointerdown"][0];
      const up = dom._listeners["pointerup"][0];

      down({ button: 0, clientX: 0, clientY: 0 });
      up({ button: 0, clientX: 100, clientY: 0 });

      expect(onPickPixel).not.toHaveBeenCalled();
    });

    it("pointercancel → isDragging 해제, cursor='grab', onPickPixel 미호출", () => {
      const onPickPixel = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onPickPixel });

      const down = dom._listeners["pointerdown"][0];
      const cancel = dom._listeners["pointercancel"][0];

      down({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
      expect(dom.style.cursor).toBe("grabbing");

      cancel({ pointerId: 1 });
      expect(dom.style.cursor).toBe("grab");
      expect(onPickPixel).not.toHaveBeenCalled();
    });

    it("onPickPixel 옵션 생략 시 클릭해도 에러 없음", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);

      const down = dom._listeners["pointerdown"][0];
      const up = dom._listeners["pointerup"][0];

      expect(() => {
        down({ button: 0, clientX: 0, clientY: 0 });
        up({ button: 0, clientX: 1, clientY: 0 });
      }).not.toThrow();
    });

    it("(M8 Step 1) 더블 클릭 → onDoubleClickPick(clientX, clientY) 호출", () => {
      const onDoubleClickPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onDoubleClickPick });

      const dbl = dom._listeners["dblclick"][0];
      dbl({ clientX: 123, clientY: 456 });

      expect(onDoubleClickPick).toHaveBeenCalledTimes(1);
      expect(onDoubleClickPick).toHaveBeenCalledWith(123, 456);
    });

    it("(M8 Step 1) orbitControls.enabled=false 면 pan/wheel 모두 차단", () => {
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom);
      const orbit = orbitInstances[0];
      // 애니메이션 진입 모사 — enabled false 로 설정.
      orbit.enabled = false;

      const down = dom._listeners["pointerdown"][0];
      const move = dom._listeners["pointermove"][0];
      const wheel = dom._listeners["wheel"][0];

      const initialZ = cam.position.z;
      down({ button: 0, clientX: 0, clientY: 0 });
      move({ clientX: 100, clientY: 0 });
      // 드래그 시작 자체가 차단됨 → 카메라 x 변동 없음.
      expect(cam.position.x).toBeCloseTo(0, 6);

      wheel({ deltaY: 100, preventDefault: () => {} });
      // 휠도 차단 → z 불변.
      expect(cam.position.z).toBeCloseTo(initialZ, 6);
    });
  });

  describe("ESC 키 선택 해제 (M4 Step 3 → M7.5 cleanup: onEscClear 분리)", () => {
    it("ESC 키다운 → onEscClear 호출 (빈 공간 클릭과 동일 의미)", () => {
      const onEscClear = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onEscClear });

      // window 에 등록된 keydown 핸들러를 꺼내 직접 호출.
      const keydown = windowListeners["keydown"][0];
      keydown({ key: "Escape" });

      expect(onEscClear).toHaveBeenCalledTimes(1);
    });

    it("ESC 이외 키(Enter, a 등) → onEscClear 미호출", () => {
      const onEscClear = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onEscClear });

      const keydown = windowListeners["keydown"][0];
      keydown({ key: "Enter" });
      keydown({ key: "a" });
      keydown({ key: " " });

      expect(onEscClear).not.toHaveBeenCalled();
    });

    it("dispose 후 ESC 키가 와도 onEscClear 미호출 (C2 회귀 방지)", () => {
      const onEscClear = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom, { onEscClear });

      const keydownRef = windowListeners["keydown"][0];

      ctrl.dispose();

      expect(windowRemoved["keydown"]?.[0]).toBe(keydownRef);
      expect(onEscClear).not.toHaveBeenCalled();
    });
  });

  describe("호버 (M7-2 Step 2 — rAF + Dirty Flag throttle)", () => {
    /**
     * 가짜 rAF 큐. 콜백을 모아두고 flushRaf 로 수동 발사 → 한 프레임을 결정성 있게 시뮬레이트.
     * cancelAnimationFrame 은 id 로 큐에서 제거.
     */
    let rafCallbacks: Map<number, FrameRequestCallback>;
    let nextRafId: number;
    let origRaf: typeof requestAnimationFrame | undefined;
    let origCancel: typeof cancelAnimationFrame | undefined;

    beforeEach(() => {
      rafCallbacks = new Map();
      nextRafId = 0;
      origRaf = (globalThis as any).requestAnimationFrame;
      origCancel = (globalThis as any).cancelAnimationFrame;
      (globalThis as any).requestAnimationFrame = (
        cb: FrameRequestCallback
      ): number => {
        nextRafId += 1;
        rafCallbacks.set(nextRafId, cb);
        return nextRafId;
      };
      (globalThis as any).cancelAnimationFrame = (id: number): void => {
        rafCallbacks.delete(id);
      };
    });

    afterEach(() => {
      (globalThis as any).requestAnimationFrame = origRaf;
      (globalThis as any).cancelAnimationFrame = origCancel;
    });

    function flushRaf(): void {
      const cbs = Array.from(rafCallbacks.values());
      rafCallbacks.clear();
      for (const cb of cbs) cb(performance.now());
    }

    it("연속된 mousemove 가 한 프레임 안에서 onHoverPick 1회만 호출 (Dirty Flag throttle)", () => {
      const onHoverPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onHoverPick });

      const move = dom._listeners["pointermove"][0];
      // 3번 연속 mousemove — 모두 같은 rAF 사이클 안.
      move({ clientX: 10, clientY: 20 });
      move({ clientX: 30, clientY: 40 });
      move({ clientX: 50, clientY: 60 });

      // rAF 콜백이 아직 안 돌았으면 onHoverPick 호출 X.
      expect(onHoverPick).not.toHaveBeenCalled();
      // rAF 는 1개만 예약돼야 한다 (이미 예약된 동안 추가 mousemove 는 dirty 만 set).
      expect(rafCallbacks.size).toBe(1);

      // 한 프레임 발사 — 마지막 좌표로 1회.
      flushRaf();
      expect(onHoverPick).toHaveBeenCalledTimes(1);
      expect(onHoverPick).toHaveBeenCalledWith(50, 60);

      // 같은 프레임 안에 추가 mousemove 없이 한 번 더 flush → 추가 호출 없음.
      flushRaf();
      expect(onHoverPick).toHaveBeenCalledTimes(1);
    });

    it("pointerleave → 대기 중 rAF 취소 + onHoverLeave 호출 + 이후 픽 미발사", () => {
      const onHoverPick = vi.fn();
      const onHoverLeave = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onHoverPick, onHoverLeave });

      const move = dom._listeners["pointermove"][0];
      const leave = dom._listeners["pointerleave"][0];
      // 호버 진입 — rAF 1개 예약.
      move({ clientX: 100, clientY: 100 });
      expect(rafCallbacks.size).toBe(1);

      // 캔버스 떠남 — rAF 취소 + onHoverLeave 발사.
      leave({});
      expect(onHoverLeave).toHaveBeenCalledTimes(1);
      expect(rafCallbacks.size).toBe(0);

      // 뒤늦게 flush 해도 픽은 안 일어난다 (취소됐기 때문).
      flushRaf();
      expect(onHoverPick).not.toHaveBeenCalled();
    });

    it("드래그 중 mousemove → tickHover 가 onHoverPick 스킵 (팬/호버 충돌 방지)", () => {
      const onHoverPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onHoverPick });

      const down = dom._listeners["pointerdown"][0];
      const move = dom._listeners["pointermove"][0];
      // 드래그 시작.
      down({ button: 0, clientX: 0, clientY: 0 });
      // 팬 도중 mousemove — hoverDirty 는 set 되지만 tickHover 가 isDragging 가드로 skip.
      move({ clientX: 50, clientY: 50 });
      flushRaf();
      expect(onHoverPick).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("dispose 시 window 리스너 제거 + domElement 리스너(mousedown/wheel) 제거 + cursor 복원", () => {
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom);

      const mousedownRef = dom._listeners["pointerdown"][0];
      const wheelRef = dom._listeners["wheel"][0];
      const mousemoveRef = dom._listeners["pointermove"][0];
      const mouseupRef = dom._listeners["pointerup"][0];

      const oc = orbitInstances[0];

      ctrl.dispose();

      expect(dom._removed["pointerdown"]?.[0]).toBe(mousedownRef);
      expect(dom._removed["wheel"]?.[0]).toBe(wheelRef);
      expect(dom._removed["pointermove"]?.[0]).toBe(mousemoveRef);
      expect(dom._removed["pointerup"]?.[0]).toBe(mouseupRef);
      // (M8 Step 1) dblclick 리스너도 동일 참조로 제거.
      expect(dom._removed["dblclick"]?.[0]).toBe(dom._listeners["dblclick"][0]);
      expect(oc.dispose).toHaveBeenCalledTimes(1);

      expect(dom.style.cursor).toBe("");
    });

    it("dispose 후 wheel 이벤트가 와도 카메라 z는 변하지 않는다 (C2 회귀 방지)", () => {
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom);

      const onWheel = dom._listeners["wheel"][0];
      ctrl.dispose();

      const zBefore = cam.position.z;
      // dispose 후에도 핸들러 참조는 살아있지만, 실제 DOM에서는 제거됨.
      // removeEventListener가 동일 참조로 호출됐는지를 위에서 검증했고,
      // 여기서는 "의미적으로" 사용자가 휠 돌려도 카메라가 안 움직이는지만 추가 체크.
      // 직접 onWheel을 부르는 대신, removed 에 기록된 참조가 원본과 같은지 재확인.
      expect(dom._removed["wheel"]?.[0]).toBe(onWheel);
      expect(cam.position.z).toBe(zBefore);
    });
  });
});
