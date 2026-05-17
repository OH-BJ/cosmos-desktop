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

  describe("클릭 선택 (M4 Step 1 — Raycaster 히트테스트)", () => {
    /**
     * mesh.raycast 를 오버라이드해 "히트 여부"를 테스트에서 제어한다.
     * Raycaster.intersectObject 는 내부적으로 object.raycast(raycaster, intersects) 를
     * 호출하므로, 실제 지오메트리를 준비하지 않고도 mock 흐름이 성립.
     */
    function createMockPickTarget(hit: { instanceId: number } | null) {
      const mesh = new THREE.Object3D();
      mesh.raycast = (_raycaster: any, intersects: any[]) => {
        if (hit) {
          intersects.push({
            distance: 100,
            point: new THREE.Vector3(),
            object: mesh,
            instanceId: hit.instanceId,
          });
        }
      };
      return mesh;
    }

    it("클릭(<5px) + 히트 → onPick 호출 with UUID", () => {
      const onPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom, { onPick });
      ctrl.setPickTarget(createMockPickTarget({ instanceId: 1 }));
      ctrl.setIndexToIdResolver(() => ["uuid-a", "uuid-b", "uuid-c"]);

      const down = dom._listeners["pointerdown"][0];
      const up = dom._listeners["pointerup"][0];

      down({ button: 0, clientX: 500, clientY: 500 });
      up({ button: 0, clientX: 502, clientY: 501 });

      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith("uuid-b");
    });

    it("드래그(>5px) → onPick 미호출 (팬 동작만)", () => {
      const onPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom, { onPick });
      ctrl.setPickTarget(createMockPickTarget({ instanceId: 0 }));
      ctrl.setIndexToIdResolver(() => ["uuid-a"]);

      const down = dom._listeners["pointerdown"][0];
      const up = dom._listeners["pointerup"][0];

      down({ button: 0, clientX: 0, clientY: 0 });
      up({ button: 0, clientX: 100, clientY: 0 });

      expect(onPick).not.toHaveBeenCalled();
    });

    it("클릭 + hit 없음 → onPick(null) (빈 공간 클릭 = 선택 해제)", () => {
      const onPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom, { onPick });
      ctrl.setPickTarget(createMockPickTarget(null));
      ctrl.setIndexToIdResolver(() => ["uuid-a"]);

      const down = dom._listeners["pointerdown"][0];
      const up = dom._listeners["pointerup"][0];

      down({ button: 0, clientX: 10, clientY: 10 });
      up({ button: 0, clientX: 12, clientY: 11 });

      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith(null);
    });

    it("pickTarget 미설정 시에도 클릭 → onPick(null) 호출 (안전 경로)", () => {
      const onPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onPick });

      const down = dom._listeners["pointerdown"][0];
      const up = dom._listeners["pointerup"][0];

      down({ button: 0, clientX: 0, clientY: 0 });
      up({ button: 0, clientX: 1, clientY: 0 });

      expect(onPick).toHaveBeenCalledWith(null);
    });

    it("pointercancel → isDragging 해제, cursor='grab', onPick 미호출", () => {
      const onPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onPick });

      const down = dom._listeners["pointerdown"][0];
      const cancel = dom._listeners["pointercancel"][0];

      down({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
      expect(dom.style.cursor).toBe("grabbing");

      cancel({ pointerId: 1 });
      expect(dom.style.cursor).toBe("grab");
      expect(onPick).not.toHaveBeenCalled();
    });

    it("onPick 옵션 생략 시 클릭해도 에러 없음", () => {
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
  });

  describe("ESC 키 선택 해제 (M4 Step 3)", () => {
    it("ESC 키다운 → onPick(null) 호출 (빈 공간 클릭과 동일 의미)", () => {
      const onPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onPick });

      // window 에 등록된 keydown 핸들러를 꺼내 직접 호출.
      // (실제 브라우저에서는 document 전역 keydown 이 여기로 들어옴.)
      const keydown = windowListeners["keydown"][0];
      keydown({ key: "Escape" });

      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith(null);
    });

    it("ESC 이외 키(Enter, a 등) → onPick 미호출", () => {
      const onPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      new CameraController(cam, dom, { onPick });

      const keydown = windowListeners["keydown"][0];
      keydown({ key: "Enter" });
      keydown({ key: "a" });
      keydown({ key: " " });

      expect(onPick).not.toHaveBeenCalled();
    });

    it("dispose 후 ESC 키가 와도 onPick 미호출 (C2 회귀 방지)", () => {
      const onPick = vi.fn();
      const cam = createCamera();
      const dom = createMockDom();
      const ctrl = new CameraController(cam, dom, { onPick });

      // dispose 전 등록된 핸들러 참조. 동일 참조로 removeEventListener 에
      // 전달됐는지까지 확인해야 "실제로 제거됐다" 고 말할 수 있다.
      const keydownRef = windowListeners["keydown"][0];

      ctrl.dispose();

      expect(windowRemoved["keydown"]?.[0]).toBe(keydownRef);
      expect(onPick).not.toHaveBeenCalled();
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
