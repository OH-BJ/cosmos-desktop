// 노드 메타데이터 조회 command (M5 — First Meaning)
//
// 사용자가 노드를 클릭했을 때 frontend에서 호출. 선택된 노드 1개의 상세 정보
// (이름, 경로, 종류, 크기, 타임스탬프)를 반환한다.
//
// M5 단계에서는 실제 FS 스캔/DB 조회가 없으므로 하드코딩된 in-memory HashMap
// 3개만 반환. 실제 FS/DB 연동은 M6+에서 처리.

use crate::ipc_types::{NodeDetails, NodeKind};
use std::collections::HashMap;
use std::sync::OnceLock;

/// 가짜 메타데이터 저장소 (process-wide 싱글톤)
///
/// `OnceLock`은 처음 접근 시 한 번만 초기화되는 lazy static.
/// `lazy_static!` 매크로의 std 표준 대체물이며 추가 의존성 없이 사용 가능.
/// HashMap을 매번 만들 필요 없이 첫 호출에서 한 번 만들고 이후엔 참조만.
fn fixtures() -> &'static HashMap<String, NodeDetails> {
    static FIXTURES: OnceLock<HashMap<String, NodeDetails>> = OnceLock::new();
    FIXTURES.get_or_init(|| {
        let mut m = HashMap::new();
        // 타임스탬프 기준점: 2025-04-01 00:00 UTC ms
        let base_created: i64 = 1_743_465_600_000;
        let base_modified: i64 = 1_743_552_000_000;

        m.insert(
            "01900000-0000-7000-8000-000000000001".to_string(),
            NodeDetails {
                id: "01900000-0000-7000-8000-000000000001".to_string(),
                name: "documents.txt".to_string(),
                path: "/Users/demo/documents.txt".to_string(),
                kind: NodeKind::File,
                size_bytes: 2048,
                created_at: base_created,
                modified_at: base_modified,
            },
        );
        m.insert(
            "01900000-0000-7000-8000-000000000002".to_string(),
            NodeDetails {
                id: "01900000-0000-7000-8000-000000000002".to_string(),
                name: "Projects".to_string(),
                path: "/Users/demo/Projects".to_string(),
                kind: NodeKind::Directory,
                size_bytes: 0,
                created_at: base_created,
                modified_at: base_modified,
            },
        );
        m.insert(
            "01900000-0000-7000-8000-000000000003".to_string(),
            NodeDetails {
                id: "01900000-0000-7000-8000-000000000003".to_string(),
                name: "memo".to_string(),
                path: "/Users/demo/memo.md".to_string(),
                kind: NodeKind::Memo,
                size_bytes: 512,
                created_at: base_created,
                modified_at: base_modified,
            },
        );
        m
    })
}

/// 노드 ID 하나에 대한 메타데이터 조회
///
/// # 반환값
/// - `Ok(Some(details))` — 해당 ID 노드를 찾음
/// - `Ok(None)` — 해당 ID가 없음 (frontend에서 "선택된 노드 정보 없음"으로 처리)
/// - `Err(String)` — 시스템 에러 (현재 단계에선 발생 안 함)
///
/// # 왜 `Result<Option<T>, E>`인가
/// - `Option`: 비즈니스 로직상의 "없음" (정상 흐름)
/// - `Result`: 시스템 레벨 실패 (DB connection error 등)
/// 두 의미를 분리해야 frontend가 "조회 실패 (재시도)" vs "정보 없음" 구분 가능.
///
/// # tauri-specta `#[specta::specta]`
/// `#[tauri::command]`만으로는 frontend에 invoke 함수 시그니처가 자동 생성되지
/// 않는다. `#[specta::specta]`를 함께 붙여야 tauri-specta Builder가 메타정보를
/// 수집해 `bindings.ts`에 타입 세이프 wrapper를 만든다.
#[tauri::command]
#[specta::specta]
pub async fn get_node_details(id: String) -> Result<Option<NodeDetails>, String> {
    Ok(fixtures().get(&id).cloned())
}

// ---------------------------------------------------------------------------
// 단위 테스트
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    /// 하드코딩 3개 ID는 모두 정상 조회되어야 한다.
    #[tokio::test]
    async fn get_existing_nodes() {
        let ids = [
            "01900000-0000-7000-8000-000000000001",
            "01900000-0000-7000-8000-000000000002",
            "01900000-0000-7000-8000-000000000003",
        ];
        for id in ids {
            let result = get_node_details(id.to_string()).await;
            let some = result.expect("Ok 기대").expect(&format!("{} 노드 존재해야 함", id));
            assert_eq!(some.id, id, "조회한 ID와 반환 ID 일치");
        }
    }

    /// 각 ID별 NodeKind가 의도대로 분류되는지 확인 (스펙 회귀 방지)
    #[tokio::test]
    async fn kinds_match_expectation() {
        let pairs = [
            ("01900000-0000-7000-8000-000000000001", NodeKind::File),
            ("01900000-0000-7000-8000-000000000002", NodeKind::Directory),
            ("01900000-0000-7000-8000-000000000003", NodeKind::Memo),
        ];
        for (id, expected_kind) in pairs {
            let details = get_node_details(id.to_string())
                .await
                .expect("Ok 기대")
                .expect("Some 기대");
            assert_eq!(details.kind, expected_kind, "{} kind 불일치", id);
        }
    }

    /// 존재하지 않는 ID는 `Ok(None)` 반환 (Err가 아님)
    #[tokio::test]
    async fn missing_node_returns_none() {
        let result = get_node_details("does-not-exist".to_string()).await;
        assert!(matches!(result, Ok(None)), "없는 ID는 Ok(None), got {:?}", result);
    }
}
