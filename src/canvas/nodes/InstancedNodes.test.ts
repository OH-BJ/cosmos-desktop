import { describe, it, expect, afterEach } from "vitest";
import * as THREE from "three";
import { InstancedNodes } from "./InstancedNodes";
import { allocateNodeBuffer, pushNode } from "../../state/nodeBuffer";
import { useCosmosStore } from "../../state/store";

/**
 * InstancedNodes 단위 테스트 (M2 재작성)
 *
 * bridge 단방향 데이터 흐름 전환 후 API:
 *   - 생성자는 빈 상태 (count=0)
 *   - syncFromBuffer(NodeBuffer)가 유일한 쓰기 경로
 *   - getMesh/getCount/getCapacity/dispose
 *
 * three.js InstancedMesh는 node 환경에서도 CPU 측 Matrix4 배열을 읽을 수 있으므로
 * 실제 GPU 없이 instanceMatrix 내용 검증이 가능하다.
 */
describe("InstancedNodes", () => {
  describe("생성자", () => {
    it("기본 capacity=1024로 빈 상태 초기화 (count=0)", () => {
      const nodes = new InstancedNodes();
      expect(nodes.getCount()).toBe(0);
      expect(nodes.getCapacity()).toBe(1024);
    });

    it("명시적 capacity로 빈 상태 초기화", () => {
      const nodes = new InstancedNodes(512);
      expect(nodes.getCount()).toBe(0);
      expect(nodes.getCapacity()).toBe(512);
    });
  });

  describe("syncFromBuffer", () => {
    it("버퍼의 노드 좌표를 instanceMatrix로 복사하고 count 갱신", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 10, 20, 30);
      pushNode(buffer, -5, 0, 7);

      nodes.syncFromBuffer(buffer);

      expect(nodes.getCount()).toBe(2);

      // instanceMatrix에서 각 인스턴스의 translation 좌표를 꺼내 검증
      const mesh = nodes.getMesh();
      const m0 = new THREE.Matrix4();
      mesh.getMatrixAt(0, m0);
      const p0 = new THREE.Vector3().setFromMatrixPosition(m0);
      expect(p0.x).toBeCloseTo(10);
      expect(p0.y).toBeCloseTo(20);
      expect(p0.z).toBeCloseTo(30);

      const m1 = new THREE.Matrix4();
      mesh.getMatrixAt(1, m1);
      const p1 = new THREE.Vector3().setFromMatrixPosition(m1);
      expect(p1.x).toBeCloseTo(-5);
      expect(p1.y).toBeCloseTo(0);
      expect(p1.z).toBeCloseTo(7);
    });

    it("빈 버퍼 동기화 시 count=0", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);

      nodes.syncFromBuffer(buffer);

      expect(nodes.getCount()).toBe(0);
    });

    it("재동기화 시 count가 덮어쓰기됨 (노드 감소 반영)", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 1, 1, 1);
      pushNode(buffer, 2, 2, 2);
      pushNode(buffer, 3, 3, 3);

      nodes.syncFromBuffer(buffer);
      expect(nodes.getCount()).toBe(3);

      // 버퍼 리셋 후 한 개만 재삽입 → count가 1로 줄어야 함
      buffer.count = 0;
      pushNode(buffer, 99, 99, 99);
      nodes.syncFromBuffer(buffer);
      expect(nodes.getCount()).toBe(1);
    });

    it("버퍼가 capacity를 초과하면 capacity만큼만 렌더", () => {
      const nodes = new InstancedNodes(2);
      // InstancedMesh capacity=2. 버퍼에 3개를 채워도 2개까지만 그려야 함.
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 1, 1, 1);
      pushNode(buffer, 2, 2, 2);
      pushNode(buffer, 3, 3, 3);

      nodes.syncFromBuffer(buffer);

      expect(nodes.getCount()).toBe(2);
    });
  });

  /**
   * M6-2 Step 2: 부분 업데이트 (addUpdateRange) 테스트.
   *
   * 검증 포인트:
   *  - startIndex 미지정 → updateRanges 비어있음 (전체 업로드 모드).
   *  - startIndex > 0 → updateRanges 에 신규 range 1 개 등록 (단위: typed array index).
   *  - 신규 영역 instanceMatrix 가 정확히 갱신됨.
   *  - 이전 영역 instanceMatrix 는 건드리지 않음 (점진 append 보장).
   *  - startIndex == renderCount (변화 없음) → updateRanges 비어있음 (no-op partial).
   *
   * three.js r169 의 BufferAttribute API:
   *  - updateRanges: Array<{ start, count }> (둘 다 typed array index).
   *  - addUpdateRange(start, count): updateRanges.push.
   *  - clearUpdateRanges(): updateRanges.length = 0.
   *
   * Mat4 itemSize=16 → 인스턴스 i 는 underlying Float32Array 에서 [i*16, i*16+16).
   */
  describe("syncFromBuffer 부분 업데이트 (M6-2 Step 2)", () => {
    it("startIndex 미지정 → updateRanges 비어있음 (full upload)", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 1, 1, 1);
      pushNode(buffer, 2, 2, 2);

      nodes.syncFromBuffer(buffer);

      const attr = nodes.getMesh().instanceMatrix;
      // updateRanges 가 비어있으면 WebGLAttributes 는 전체 bufferSubData 수행 — 의도된 동작.
      // (needsUpdate 는 setter-only 라 read 시 undefined → version 증가로 검증.)
      expect(attr.updateRanges.length).toBe(0);
      expect(attr.version).toBeGreaterThan(0);
    });

    it("startIndex > 0 → updateRanges 에 신규 range 만 등록 (typed array index 단위)", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      // 1차: 2개 채우고 전체 업로드.
      pushNode(buffer, 1, 1, 1);
      pushNode(buffer, 2, 2, 2);
      nodes.syncFromBuffer(buffer);

      // 2차: 3개 추가하고 startIndex=2 로 부분 업로드.
      pushNode(buffer, 3, 3, 3);
      pushNode(buffer, 4, 4, 4);
      pushNode(buffer, 5, 5, 5);
      nodes.syncFromBuffer(buffer, { startIndex: 2 });

      const attr = nodes.getMesh().instanceMatrix;
      // 정확히 1 개의 range, [2*16, 3*16) — 인스턴스 [2,5) → 3 개분.
      expect(attr.updateRanges.length).toBe(1);
      expect(attr.updateRanges[0]).toEqual({ start: 2 * 16, count: 3 * 16 });
      // needsUpdate 는 setter-only — version 이 두 번째 sync 후 추가 증가했는지로 검증.
      expect(attr.version).toBeGreaterThanOrEqual(2);
      expect(nodes.getCount()).toBe(5);
    });

    it("부분 업로드 후 신규 영역 instanceMatrix 가 정확히 갱신됨", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 1, 1, 1);
      nodes.syncFromBuffer(buffer);

      pushNode(buffer, 7, 8, 9);
      nodes.syncFromBuffer(buffer, { startIndex: 1 });

      const m = new THREE.Matrix4();
      nodes.getMesh().getMatrixAt(1, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(p.x).toBeCloseTo(7);
      expect(p.y).toBeCloseTo(8);
      expect(p.z).toBeCloseTo(9);
    });

    it("연속 부분 업로드 → 매 호출마다 updateRanges 가 신규 range 로 교체됨", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 1, 1, 1);
      nodes.syncFromBuffer(buffer);

      // append 1 → partial
      pushNode(buffer, 2, 2, 2);
      nodes.syncFromBuffer(buffer, { startIndex: 1 });
      // append 1 더 → 또 partial. 이전 range 가 누적되면 안 됨 (clearUpdateRanges 동작 검증).
      pushNode(buffer, 3, 3, 3);
      nodes.syncFromBuffer(buffer, { startIndex: 2 });

      const attr = nodes.getMesh().instanceMatrix;
      expect(attr.updateRanges.length).toBe(1);
      expect(attr.updateRanges[0]).toEqual({ start: 2 * 16, count: 1 * 16 });
    });

    it("startIndex >= renderCount (변화 없음) → updateRanges 비어있음 (no-op)", () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 1, 1, 1);
      pushNode(buffer, 2, 2, 2);

      // 초기 전체 업로드 후 startIndex 를 count 와 동일하게 → 추가 노드 없음.
      nodes.syncFromBuffer(buffer);
      nodes.syncFromBuffer(buffer, { startIndex: 2 });

      const attr = nodes.getMesh().instanceMatrix;
      // (renderCount > startIndex) 조건 False → addUpdateRange 호출 안 됨.
      expect(attr.updateRanges.length).toBe(0);
      expect(nodes.getCount()).toBe(2);
    });
  });

  describe("getMesh", () => {
    it("three.js InstancedMesh 객체 반환", () => {
      const nodes = new InstancedNodes(4);
      const mesh = nodes.getMesh();
      expect(mesh).toBeDefined();
      expect(mesh.constructor.name).toBe("InstancedMesh");
    });
  });

  /**
   * M7-1 Step 2: Size Attenuation / uniform 관리 테스트.
   *
   * 검증 포인트:
   *  - 초기 uniforms 기본값 (uMinPixelSize=4, uBaseRadius=5)
   *  - constructor options.resolution 이 uResolution 에 전달됨
   *  - setResolution(w, h) 호출 시 uResolution.value 가 동기 갱신됨
   *  - material 이 onBeforeCompile 패치를 가진 MeshBasicMaterial
   *
   * jsdom 환경에서는 WebGL 이 없어 onBeforeCompile 이 실제로 호출되지 않으므로,
   * 외부 보유 uniforms 객체로 검증한다 (이게 InstancedNodes 가 자체 보유하는 이유).
   */
  describe("size attenuation uniforms (M7-1 Step 2)", () => {
    it("기본 uniform 값: uMinPixelSize=4, uBaseRadius=1, uResolution=(1,1), uTanHalfFov=tan(25°)", () => {
      // (D15) BASE_RADIUS=1 — 실제 크기는 instanceMatrix 의 uniform scale 이 결정.
      //   pixelDiameter = uBaseRadius * instanceScale * (1/uTanHalfFov) * H / depth.
      // (M7-2 Step 2 hotfix) projectionMatrix[1][1] 대신 uTanHalfFov 사용 — picker 의
      //   setViewOffset 부작용 회피. 기본값은 Scene fov=50° 와 일치하도록 tan(25°).
      const nodes = new InstancedNodes(4);
      const u = nodes.getUniforms();
      expect(u.uMinPixelSize.value).toBeCloseTo(4.0);
      expect(u.uBaseRadius.value).toBeCloseTo(1.0);
      expect(u.uResolution.value.x).toBeCloseTo(1);
      expect(u.uResolution.value.y).toBeCloseTo(1);
      expect(u.uTanHalfFov.value).toBeCloseTo(Math.tan((50 * Math.PI) / 360), 6);
    });

    it("(M7-2) options.tanHalfFov 가 uniform 에 반영 + setTanHalfFov 로 갱신 가능", () => {
      const custom = Math.tan((90 * Math.PI) / 360); // fov=90° 가정 → tan(45°)=1
      const nodes = new InstancedNodes(4, { tanHalfFov: custom });
      const u = nodes.getUniforms();
      expect(u.uTanHalfFov.value).toBeCloseTo(custom, 6);
      // 런타임 갱신.
      nodes.setTanHalfFov(0.5);
      expect(u.uTanHalfFov.value).toBeCloseTo(0.5);
    });

    it("constructor options.resolution 이 uResolution 에 반영됨", () => {
      const nodes = new InstancedNodes(4, { resolution: [1920, 1080] });
      const u = nodes.getUniforms();
      expect(u.uResolution.value.x).toBeCloseTo(1920);
      expect(u.uResolution.value.y).toBeCloseTo(1080);
    });

    it("setResolution(w, h) 호출 시 uResolution.value 가 동기 갱신됨", () => {
      const nodes = new InstancedNodes(4, { resolution: [800, 600] });
      const u = nodes.getUniforms();
      // resize 시 Scene.handleResize → setResolution 경유.
      nodes.setResolution(1280, 720);
      expect(u.uResolution.value.x).toBeCloseTo(1280);
      expect(u.uResolution.value.y).toBeCloseTo(720);
    });

    it("material 이 MeshBasicMaterial + onBeforeCompile 패치를 가짐", () => {
      const nodes = new InstancedNodes(4);
      const mat = nodes.getMesh().material as THREE.MeshBasicMaterial;
      expect(mat.constructor.name).toBe("MeshBasicMaterial");
      // onBeforeCompile 함수가 등록됐는지만 검증 — jsdom 에서는 호출되지 않음.
      expect(typeof mat.onBeforeCompile).toBe("function");
      expect(typeof mat.customProgramCacheKey).toBe("function");
    });
  });

  describe("Depth-Aware instance scale (D15)", () => {
    it("buffer.scales[i] 가 instanceMatrix 의 uniform scale 로 compose 됨", () => {
      const nodes = new InstancedNodes(4);
      const buffer = allocateNodeBuffer(4);
      // pushNode 의 4번째 인자가 scale. D1(500), D2(50), D5(0.05) 모사.
      pushNode(buffer, 10, 20, 30, 500);
      pushNode(buffer, -5, 0, 7, 50);
      pushNode(buffer, 100, -50, 0, 0.05);

      nodes.syncFromBuffer(buffer);
      expect(nodes.getCount()).toBe(3);

      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();

      nodes.getMesh().getMatrixAt(0, m);
      m.decompose(p, q, s);
      expect(p.x).toBeCloseTo(10);
      // uniform scale → x/y/z 모두 500.
      expect(s.x).toBeCloseTo(500);
      expect(s.y).toBeCloseTo(500);
      expect(s.z).toBeCloseTo(500);

      nodes.getMesh().getMatrixAt(1, m);
      m.decompose(p, q, s);
      expect(p.x).toBeCloseTo(-5);
      expect(s.x).toBeCloseTo(50);

      nodes.getMesh().getMatrixAt(2, m);
      m.decompose(p, q, s);
      expect(s.x).toBeCloseTo(0.05);
    });

    it("vertex shader 에 instanceScale 추출 + pixelDiameter 가중 식이 들어있음", () => {
      // onBeforeCompile 은 첫 렌더 시점에만 호출되므로 직접 호출해 shader 객체를 들여다본다.
      const nodes = new InstancedNodes(4);
      const mat = nodes.getMesh().material as THREE.MeshBasicMaterial;
      // 가짜 shader: WebGLProgram 빌드 흐름의 입력 — onBeforeCompile 이 in-place 패치.
      const fakeShader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: "#include <common>\n#include <project_vertex>",
        fragmentShader: "",
      };
      mat.onBeforeCompile!(
        fakeShader as unknown as Parameters<
          NonNullable<THREE.MeshBasicMaterial["onBeforeCompile"]>
        >[0],
        // 두 번째 인자(renderer) 는 사용하지 않으므로 더미.
        {} as THREE.WebGLRenderer
      );
      // 핵심 키워드들 — 메인 셰이더가 instance uniform scale 을 정확히 반영.
      expect(fakeShader.vertexShader).toContain("_instanceScale");
      expect(fakeShader.vertexShader).toContain("length(instanceMatrix[0].xyz)");
      // pixelDiameter 식에 instanceScale 곱이 들어있어야 한다.
      expect(fakeShader.vertexShader).toMatch(/uBaseRadius\s*\*\s*_instanceScale/);
      // (M7-2 Step 2 hotfix) projectionMatrix[1][1] 직접 사용 금지 — uTanHalfFov 로 치환.
      //   picker 의 setViewOffset 이 P11 을 부풀려도 영향받지 않게.
      expect(fakeShader.vertexShader).toContain("uTanHalfFov");
      expect(fakeShader.vertexShader).not.toMatch(/projectionMatrix\[1\]\[1\]/);
    });
  });

  describe("dispose", () => {
    it("리소스 정리 (에러 없음)", () => {
      const nodes = new InstancedNodes(4);
      expect(() => nodes.dispose()).not.toThrow();
    });
  });

  /**
   * M4 Step 2: bindSelectionHighlight 테스트.
   *
   * 검증 포인트:
   *  - selectedNodeId=유효 id → highlightMesh.visible=true + position 일치
   *  - selectedNodeId=null → visible=false
   *  - 연속해서 다른 id 선택 → position 갱신
   *  - dispose 이후에는 store 변경이 highlightMesh 를 건드리지 않음 (unsub)
   *
   * store 는 모듈 스코프 전역이라 테스트 사이 격리를 위해 afterEach 에서 null 로 리셋.
   */
  describe("bindSelectionHighlight", () => {
    afterEach(() => {
      useCosmosStore.getState().selectNode(null);
    });

    /**
     * 테스트용 헬퍼: 버퍼 3개 노드 + InstancedNodes + highlightMesh + resolver 한 번에 준비.
     * id 는 bridge 실제 매핑과 무관하게 Map 으로 주입 (bridge 모킹 없이 단위 격리).
     */
    const setup = () => {
      const nodes = new InstancedNodes(8);
      const buffer = allocateNodeBuffer(8);
      pushNode(buffer, 10, 20, 30); // idx 0
      pushNode(buffer, -5, 0, 7); // idx 1
      pushNode(buffer, 100, -50, 0); // idx 2
      nodes.syncFromBuffer(buffer);

      const idToIndex = new Map<string, number>([
        ["id-a", 0],
        ["id-b", 1],
        ["id-c", 2],
      ]);
      const resolver = (id: string) => idToIndex.get(id);

      // highlightMesh 는 Scene 없이도 THREE.Mesh 단독으로 생성 가능.
      const highlightMesh = new THREE.Mesh(
        new THREE.SphereGeometry(6.5, 8, 8),
        new THREE.MeshBasicMaterial({ wireframe: true })
      );
      highlightMesh.visible = false;

      return { nodes, buffer, highlightMesh, resolver };
    };

    it("선택 시 visible=true + position 이 해당 노드 좌표와 일치", () => {
      const { nodes, buffer, highlightMesh, resolver } = setup();
      nodes.bindSelectionHighlight(highlightMesh, buffer, resolver);

      useCosmosStore.getState().selectNode("id-a");

      expect(highlightMesh.visible).toBe(true);
      expect(highlightMesh.position.x).toBeCloseTo(10);
      expect(highlightMesh.position.y).toBeCloseTo(20);
      expect(highlightMesh.position.z).toBeCloseTo(30);

      nodes.dispose();
    });

    it("선택 해제(null) 시 visible=false", () => {
      const { nodes, buffer, highlightMesh, resolver } = setup();
      nodes.bindSelectionHighlight(highlightMesh, buffer, resolver);

      useCosmosStore.getState().selectNode("id-b");
      expect(highlightMesh.visible).toBe(true);

      useCosmosStore.getState().selectNode(null);
      expect(highlightMesh.visible).toBe(false);

      nodes.dispose();
    });

    it("연속해서 다른 노드 선택 시 position 이 갱신됨", () => {
      const { nodes, buffer, highlightMesh, resolver } = setup();
      nodes.bindSelectionHighlight(highlightMesh, buffer, resolver);

      useCosmosStore.getState().selectNode("id-a");
      expect(highlightMesh.position.x).toBeCloseTo(10);

      useCosmosStore.getState().selectNode("id-c");
      expect(highlightMesh.position.x).toBeCloseTo(100);
      expect(highlightMesh.position.y).toBeCloseTo(-50);
      expect(highlightMesh.position.z).toBeCloseTo(0);
      expect(highlightMesh.visible).toBe(true);

      nodes.dispose();
    });

    it("dispose 이후에는 store 변경이 highlightMesh 를 건드리지 않음 (unsub 누수 방지)", () => {
      const { nodes, buffer, highlightMesh, resolver } = setup();
      nodes.bindSelectionHighlight(highlightMesh, buffer, resolver);

      useCosmosStore.getState().selectNode("id-a");
      const before = highlightMesh.position.clone();

      nodes.dispose();

      // dispose 후 다른 노드 선택해도 과거 메시 position 은 바뀌면 안 됨.
      useCosmosStore.getState().selectNode("id-c");
      expect(highlightMesh.position.x).toBeCloseTo(before.x);
      expect(highlightMesh.position.y).toBeCloseTo(before.y);
      expect(highlightMesh.position.z).toBeCloseTo(before.z);
    });
  });
});
