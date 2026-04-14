import { invoke } from "@tauri-apps/api/core";
import { Node } from "../state/store";

/**
 * getNodes() — Tauri IPC로 Rust 백엔드에서 노드 목록 조회
 *
 * Rust 커맨드 `get_nodes`를 호출해서 DB에서 모든 노드를 가져옴.
 * Backend agent가 src-tauri/src/commands/mod.rs에 구현.
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
