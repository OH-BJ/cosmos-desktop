// 노드 조회 command

use crate::ipc_types::Node;

/// 모든 노드 조회
///
/// # 마일스톤 1 구현
/// 현재는 빈 배열 반환. 이유: DB 쿼리 레이어는 다음 마일스톤에서 구현.
/// 이번 마일스톤의 목표는 "IPC 파이프가 정상 작동하는지 확인"이므로,
/// 타입 시스템과 command 레지스트리가 올바르면 충분.
///
/// # Tauri 매크로 `#[tauri::command]`
/// `#[tauri::command]` 매크로를 함수에 붙이면 Tauri가 자동으로:
/// 1. 함수를 async 래퍼로 감싸기
/// 2. 에러를 JSON으로 직렬화하기
/// 3. 프론트엔드에서 호출 가능하게 등록하기
/// 위 세 가지를 자동 생성. 매크로가 없으면 수동으로 이 모든 걸 해야 함.
///
/// # 반환 타입 Result<Vec<Node>, String>
/// - `Ok(Vec<Node>)` — 성공, 노드 배열 반환
/// - `Err(String)` — 실패, 에러 메시지 반환 (사용자가 이해할 수 있는 한국어여야 함)
/// Rust의 Result<T, E> 패턴: 예외 던지기 대신 반환값에 성공/실패 담기.
/// 호출자(Tauri)는 자동으로 Result를 JSON 성공/실패 응답으로 변환.
#[tauri::command]
pub async fn get_nodes() -> Result<Vec<Node>, String> {
    // TODO: DB에서 모든 노드 SELECT (다음 마일스톤)
    // - tauri-plugin-sql의 execute() 또는 query()로 SELECT 실행
    // - 각 row를 Node 구조체로 매핑
    // - 에러 발생 시 SafetyError/DatabaseError를 한국어 메시지로 변환

    Ok(Vec::new())
}

// ---------------------------------------------------------------------------
// 단위 테스트
//
// `#[cfg(test)]` 어트리뷰트: 이 모듈은 `cargo test` 로 빌드할 때만 컴파일됨.
// 프로덕션 바이너리에는 포함되지 않으므로 테스트 코드가 런타임 크기를 늘리지
// 않는다. Rust 의 관용 테스트 배치 — 구현과 같은 파일의 하단에 둔다.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    /// 마일스톤 1 기준: IPC `get_nodes` 가 빈 Vec 을 정상 반환해야 한다.
    /// DB 연동 전 단계이므로 타입 시스템·command 시그니처·async 런타임
    /// 설정이 올바른지 확인하는 smoke test 역할.
    #[tokio::test]
    async fn get_nodes_returns_empty_vec() {
        let result = get_nodes().await;
        assert!(result.is_ok(), "get_nodes() must return Ok, got {:?}", result);
        let nodes = result.unwrap();
        assert_eq!(nodes.len(), 0, "M1 에서는 빈 배열이 기대값");
    }
}
