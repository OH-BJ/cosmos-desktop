import { invoke } from "@tauri-apps/api/core";
import { Node } from "../state/store";

/**
 * getNodes() — Tauri IPC로 Rust 백엔드에서 노드 목록 조회
 *
 * Rust 커맨드 `get_nodes`를 호출해서 DB에서 모든 노드를 가져옴.
 * Backend agent가 src-tauri/src/commands/mod.rs에 구현.
 *
 * ⚠️ M1 상태 (2026-04-15 Review Day 메모):
 * 이 함수는 **정의만** 되어 있고, 현재 아무 곳에서도 호출하지 않는다.
 * 이유: M1 목표는 "앱 기동 + 더미 노드 1개 렌더" 였고, 실제 DB 연동과 초기
 * 로드 시나리오는 M2 작업이기 때문. ARCHITECTURE.md §5-1 "앱 시작 시"
 * 시나리오("프론트엔드 로드 → IPC로 노드 목록 + 좌표 일괄 fetch")는 M2에서
 * App.tsx 마운트 useEffect에 연결 예정. 구체적인 연결 지점과 상태 동기화
 * 규약은 docs/M2_ENTER_CRITERIA.md 의 "고빈도/저빈도 동기화 규약" 항목에서
 * 확정한 뒤 구현한다.
 *
 * 반환값: Node[] (이중 상태의 저빈도 Zustand로 저장)
 *
 * @returns Promise<Node[]>
 * @throws IPC 오류 시 에러 전파 (UI에서 처리)
 */
export async function getNodes(): Promise<Node[]> {
  try {
    // @tauri-apps/api/core 의 invoke 함수로 Rust 커맨드 호출
    // 'get_nodes' — Rust 측의 #[tauri::command] fn get_nodes()와 매칭
    const nodes = await invoke<Node[]>("get_nodes");
    return nodes;
  } catch (error) {
    // IPC 오류를 그대로 전파
    // (UI 레이어가 잡아서 사용자에게 표시)
    console.error("Failed to fetch nodes from backend:", error);
    throw error;
  }
}
