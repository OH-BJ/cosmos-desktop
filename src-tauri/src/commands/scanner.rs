// 디렉토리 스캔 IPC commands (M6-1 Step 1+2)
//
// # 두 가지 entry
// - `scan_directory_command` (Step 1, 비스트리밍): 결과를 한 번에 Vec 으로 반환.
//   debug/CLI 용도 또는 작은 디렉토리 즉시 결과 필요 시.
// - `start_directory_scan` (Step 2, 스트리밍): 즉시 ack 후 백그라운드에서
//   `node_chunk_event` 를 1,000개 단위로 emit. **운영 entry 는 이쪽**.

use crate::ipc_types::{NodeChunkEvent, ScannedNode};
use crate::scanner::{scan_directory, scan_directory_chunked, DEFAULT_CHUNK_SIZE};
use std::path::PathBuf;
use tauri::AppHandle;
// Event trait 가 in-scope 여야 `chunk.emit(&app)` 메서드 호출 가능.
// derive 가 자동 생성한 Event impl 의 메서드.
use tauri_specta::Event;

/// (Step 1 호환) 디렉토리 스캔 결과를 한 번에 반환.
///
/// 작은 디렉토리에서만 사용. 큰 트리는 `start_directory_scan` 권장.
#[tauri::command]
#[specta::specta]
pub async fn scan_directory_command(
    path: String,
    max_depth: u32,
) -> Result<Vec<ScannedNode>, String> {
    let root = PathBuf::from(&path);
    scan_directory(root, max_depth)
        .await
        .map_err(|e| format!("디렉토리 스캔 실패: {}", e))
}

/// (Step 2) 청크 스트리밍 디렉토리 스캔.
///
/// # 흐름
/// 1. Frontend 가 `invoke('start_directory_scan', {path, maxDepth})` 호출.
/// 2. 본 함수는 입력 검증 후 즉시 `Ok(())` 반환.
/// 3. `tokio::spawn` 으로 백그라운드 task 생성, 그 안에서 `scan_directory_chunked` 호출.
/// 4. 청크가 완성될 때마다 `chunk.emit(&app)` → frontend `events.nodeChunkEvent.listen()`.
/// 5. 마지막 청크는 `is_last = true` (성공/실패 모두 종료 시그널 보장).
///
/// # 왜 즉시 Ok 반환인가
/// 큰 디렉토리(수만 노드)는 수 초 걸릴 수 있다. invoke 가 그동안 대기하면
/// frontend 에서 await 중인 promise 가 응답성을 잃는다. 청크 이벤트로만 진행상황을
/// 알리고, 호출 자체는 fire-and-forget.
///
/// # 에러 정책
/// - 입력 검증 (현재 없음) 실패 → invoke 단계에서 Err(String) 반환.
/// - 백그라운드 task 의 scanner 에러 → eprintln + 빈 종료 청크 emit.
///   (M6-1 끝 또는 M7 에서 별도 ScanErrorEvent 추가 예정.)
///
/// # AppHandle 구체 타입
/// `AppHandle<tauri::Wry>` 로 고정 (제너릭 `<R: Runtime>` 은 collect_commands!
/// 매크로가 타입 추론 실패함 — 2026-04 시점 tauri-specta rc.24 한계).
/// Wry 가 우리 builder 의 런타임이므로 손실 없음.
#[tauri::command]
#[specta::specta]
pub async fn start_directory_scan(
    app: AppHandle<tauri::Wry>,
    path: String,
    max_depth: u32,
) -> Result<(), String> {
    let root = PathBuf::from(&path);

    // 백그라운드 task 로 스캔 시작. 본 함수는 즉시 ack 반환.
    // app 과 root 가 'static 이어야 spawn 가능 → AppHandle 은 Clone+Send+Sync,
    // PathBuf 는 owned 이라 둘 다 안전하게 move.
    tokio::spawn(async move {
        let scan_result = scan_directory_chunked(
            root,
            max_depth,
            DEFAULT_CHUNK_SIZE,
            |chunk| {
                // Event::emit 은 sync. 실패는 frontend 가 listener 를
                // 등록하지 않은 등 거의 발생 안 하지만 stderr 로 기록.
                if let Err(e) = chunk.emit(&app) {
                    eprintln!("[scanner] node_chunk_event emit 실패: {}", e);
                }
            },
        )
        .await;

        if let Err(e) = scan_result {
            // root 검증 실패 등으로 청크 emit 이 단 한 번도 안 일어났을 수 있다.
            // frontend listener 가 영원히 대기하지 않도록 종료 신호 강제 emit.
            eprintln!("[scanner] 스캔 실패: {}", e);
            let terminal = NodeChunkEvent {
                chunk_id: 0,
                nodes: Vec::new(),
                is_last: true,
                total_scanned: 0,
            };
            let _ = terminal.emit(&app);
        }
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// 단위 테스트
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs as stdfs;
    use tempfile::tempdir;

    /// scan_directory_command (Step 1) IPC 경계 정상 동작.
    #[tokio::test]
    async fn scan_command_returns_nodes_for_valid_dir() {
        let tmp = tempdir().expect("temp dir");
        stdfs::File::create(tmp.path().join("x.txt")).expect("파일 생성");

        let result = scan_directory_command(tmp.path().to_string_lossy().into_owned(), 3).await;
        let nodes = result.expect("Ok 기대");
        assert_eq!(nodes.len(), 1, "x.txt 하나");
        assert_eq!(nodes[0].name, "x.txt");
    }

    /// 잘못된 경로 → Err(String) (panic 아님).
    #[tokio::test]
    async fn scan_command_returns_error_string_for_invalid_path() {
        let result = scan_directory_command(
            "/this/path/definitely/does/not/exist/abc".to_string(),
            5,
        )
        .await;
        assert!(result.is_err(), "잘못된 경로 → Err");
        let msg = result.unwrap_err();
        assert!(msg.contains("디렉토리 스캔 실패"), "사용자 메시지 prefix");
    }

    // start_directory_scan 의 emit 자체는 AppHandle 이 필요해 단위 테스트 불가.
    // Step 3 통합 검증 (frontend listener 등록 후 시각 확인) 으로 검증한다.
    // 청크 분할 로직 자체는 scanner::tests::chunked_* 4개 테스트가 커버.
}
