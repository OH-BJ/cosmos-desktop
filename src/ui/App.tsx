import { useEffect, useRef } from "react";
import { Scene } from "../canvas/Scene";
import { InstancedNodes } from "../canvas/nodes/InstancedNodes";
import { useCosmosStore } from "../state/store";
import "./App.css";

/**
 * App — cosmos-desktop 메인 컴포넌트
 *
 * 역할:
 * 1) Canvas 마운트 (useRef)
 * 2) three.js Scene 생성 + 렌더 루프 시작
 * 3) InstancedNodes 초기화
 * 4) 사용자 입력 감시 (나중에)
 * 5) Zustand 상태 구독 (UI 업데이트)
 *
 * 구조: <div ref={containerRef} /> 안에 three.js canvas 렌더링.
 * CSS는 flex로 전체 화면 차지하게 설정.
 */
function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const instancedNodesRef = useRef<InstancedNodes | null>(null);

  // Zustand에서 노드 목록 + 선택 상태 구독
  // (UI 업데이트용. 렌더링은 threejs가 담당)
  const nodes = useCosmosStore((state) => state.nodes);
  const selectedNodeId = useCosmosStore((state) => state.selectedNodeId);

  /**
   * useEffect: 초기화 (마운트 시 한 번만 실행)
   *
   * 1) three.js Scene 생성
   * 2) InstancedNodes 생성 (노드 1개 + 원점 배치)
   * 3) Scene을 DOM에 마운트
   * 4) 렌더 루프 설정
   *
   * cleanup: unmount 시 리소스 정리 (dispose)
   */
  useEffect(() => {
    if (!containerRef.current) {
      console.error("Container ref not available");
      return;
    }

    // Scene 생성
    const scene = new Scene();
    sceneRef.current = scene;

    // InstancedNodes 생성 (더미 노드 1개 원점 배치)
    const instancedNodes = new InstancedNodes(1024);
    instancedNodesRef.current = instancedNodes;

    // Scene에 InstancedMesh 추가
    scene.getScene().add(instancedNodes.getMesh());

    // DOM에 canvas 마운트
    scene.mount(containerRef.current);

    // 렌더 콜백 설정 (M1: 빈 콜백, M2에서 노드 갱신 로직 추가)
    scene.setRenderCallback(() => {
      // 여기서 고빈도 상태 업데이트 (위치 애니메이션 등)
      // M1: 아무것도 안 함
    });

    // Cleanup: React unmount 시 리소스 해제
    return () => {
      if (sceneRef.current) {
        sceneRef.current.dispose();
        sceneRef.current = null;
      }
      if (instancedNodesRef.current) {
        instancedNodesRef.current.dispose();
        instancedNodesRef.current = null;
      }
    };
  }, []);

  /**
   * useEffect: 노드 목록 변화 감시
   *
   * Zustand의 nodes 배열이 바뀌면 여기서 감지.
   * M1에서는 로그만 출력.
   * M2에서 실제 InstancedMesh 업데이트 로직 구현.
   */
  useEffect(() => {
    if (nodes.length > 0) {
      console.log(`[App] Nodes updated: ${nodes.length} nodes`);
      // M2: syncFromStore(nodes, buffer) 호출 등
    }
  }, [nodes]);

  /**
   * 선택 상태 변화
   *
   * UI/하이라이트 업데이트 (M2+)
   */
  useEffect(() => {
    if (selectedNodeId) {
      console.log(`[App] Selected node: ${selectedNodeId}`);
    }
  }, [selectedNodeId]);

  return (
    <div className="app-root">
      {/* three.js canvas가 이 div 안에 마운트됨 */}
      <div className="canvas-container" ref={containerRef} />

      {/* UI 셸 (현재 빈 상태) */}
      <div className="ui-panel">
        <p>Cosmos Desktop — 빈 우주 공간</p>
        <p>
          노드 {nodes.length}개 | 선택: {selectedNodeId || "없음"}
        </p>
      </div>
    </div>
  );
}

export default App;
