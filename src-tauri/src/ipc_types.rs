// IPC (Inter-Process Communication) 타입 정의
// Rust 백엔드 ↔ TypeScript 프론트엔드 사이의 메시지 포맷
// serde 매크로로 JSON 직렬화/역직렬화 자동 생성

use serde::{Deserialize, Serialize};
use specta::Type;

/// 3D 공간 노드 (파일, 링크, 메모 등의 개체)
///
/// # 필드
/// - `id`: 고유 식별자 (UUID 형식 권장, 다음 마일스톤)
/// - `path`: 로컬 파일시스템 경로 또는 URL (안전성 검증됨)
/// - `x`, `y`, `z`: 3D 공간 좌표 (무한 캔버스 위치)
///
/// # serde 매크로 설명
/// `#[derive(Serialize, Deserialize)]`는 구조체를 자동으로 JSON ↔ Rust 객체 변환
/// 프론트엔드 `src/state/store.ts`의 `Node` 타입과 필드 이름/타입이 반드시 일치해야 함
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
/// # `#[serde(rename_all = "camelCase")]` 설명
///
/// Rust 필드 이름은 snake_case 관례 (예: `created_at`, `updated_at`),
/// 그러나 TypeScript/JavaScript는 camelCase 관례 (예: `createdAt`, `updatedAt`).
/// 이 attribute를 붙이면 serde가 직렬화 시 자동으로 snake_case → camelCase 변환.
/// 예를 들어 Rust의 `pub created_at: i64` 필드는 JSON에서 `"createdAt": ...` 로 변환됨.
///
/// 왜 지금 당장 필요한가? 현재 필드엔 snake_case가 없지만, 다음 마일스톤에서
/// `created_at`, `updated_at`, `is_dirty` 같은 필드가 추가될 예정.
/// 지금 이 attribute를 추가하면 앞으로 TS 타입이 undefined로 읽히는 버그를 원천 차단.
///
/// 규약: 모든 IPC struct (Node, Project, Metadata 등)는 이 attribute를 반드시 부여.
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub path: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

// ---------------------------------------------------------------------------
// M5 — 노드 메타데이터 (선택된 노드의 상세 정보)
// ---------------------------------------------------------------------------

/// 노드 종류 (파일/디렉터리/링크/메모)
///
/// 프론트엔드에서 아이콘/색상 분기에 사용할 분류값.
/// `#[serde(rename_all = "camelCase")]` enum variant까지 camelCase로 변환되지는
/// 않지만 (variant는 PascalCase 그대로 유지), 일관성과 안전성 차원에서 부여.
/// JSON 표현 예: `"file"`, `"directory"`, `"link"`, `"memo"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    File,
    Directory,
    Link,
    Memo,
}

/// 노드 메타데이터 (선택된 노드 상세 정보 패널용)
///
/// # 필드 타입 결정 근거 (Gemini Pro 자문, 2026-04-23)
/// - `size_bytes: u64` — 파일 크기. JS Number는 53비트 안전 정수까지 (~9PB),
///   파일 크기로는 충분. BigInt 변환 불필요.
/// - `created_at`, `modified_at: i64` — Unix epoch milliseconds. i64는 ~300,000년
///   범위라 안전. ISO 8601 string 대신 number로 보내는 이유: 페이로드 작고,
///   파싱 빠르고, 정렬도 number 비교로 가능.
///
/// # camelCase 자동 변환
/// `size_bytes` → `sizeBytes`, `created_at` → `createdAt`, `modified_at` → `modifiedAt`.
/// 위 `#[serde(rename_all = "camelCase")]`가 처리. tauri-specta가 생성하는
/// TypeScript 타입에도 자동으로 반영됨.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NodeDetails {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub size_bytes: u64,
    pub created_at: i64,
    pub modified_at: i64,
}

// ---------------------------------------------------------------------------
// 단위 테스트: serde round-trip 검증
// 직렬화 후 역직렬화 시 원본과 동일해야 하며, 특히 camelCase 변환이 제대로 되는지 확인
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    /// Node struct의 serde round-trip 검증
    ///
    /// JSON 직렬화 후 역직렬화 시 필드가 손실되지 않고 정확히 복원되는지 확인.
    /// 또한 JSON 형식이 snake_case가 아닌 원래대로 유지되는지 검증.
    /// (현재는 필드가 모두 camelCase이지만, 앞으로 추가될 snake_case 필드도
    /// camelCase로 변환되는 것을 방어하는 선제적 테스트)
    #[test]
    fn test_node_serde_roundtrip() {
        let original = Node {
            id: "node-001".to_string(),
            path: "/home/user/document.txt".to_string(),
            x: 100.5,
            y: 200.3,
            z: 50.0,
        };

        // Rust 객체 → JSON 직렬화
        let json_str = serde_json::to_string(&original)
            .expect("Node를 JSON으로 직렬화할 수 없음");

        // 역직렬화: JSON → Rust 객체
        let deserialized: Node =
            serde_json::from_str(&json_str).expect("JSON에서 Node로 역직렬화할 수 없음");

        // round-trip 후 필드가 모두 일치하는지 확인
        assert_eq!(deserialized.id, original.id, "id가 일치해야 함");
        assert_eq!(deserialized.path, original.path, "path가 일치해야 함");
        assert_eq!(deserialized.x, original.x, "x 좌표가 일치해야 함");
        assert_eq!(deserialized.y, original.y, "y 좌표가 일치해야 함");
        assert_eq!(deserialized.z, original.z, "z 좌표가 일치해야 함");
    }

    /// JSON 형식이 정확한지 검증
    ///
    /// serde가 현재 필드들을 JSON에 정확히 직렬화하는지 확인.
    /// 미래에 snake_case 필드가 추가되면 이 테스트가 실패해서
    /// 누군가 camelCase 변환을 깜빡했는지 즉시 알 수 있음.
    #[test]
    fn test_node_json_format() {
        let node = Node {
            id: "test-id".to_string(),
            path: "/test/path".to_string(),
            x: 1.0,
            y: 2.0,
            z: 3.0,
        };

        let json_str =
            serde_json::to_string(&node).expect("Node를 JSON으로 직렬화할 수 없음");

        // JSON에 필수 필드가 모두 포함되어 있는지 확인
        assert!(json_str.contains("\"id\""), "JSON에 'id' 필드가 있어야 함");
        assert!(
            json_str.contains("\"path\""),
            "JSON에 'path' 필드가 있어야 함"
        );
        assert!(json_str.contains("\"x\""), "JSON에 'x' 필드가 있어야 함");
        assert!(json_str.contains("\"y\""), "JSON에 'y' 필드가 있어야 함");
        assert!(json_str.contains("\"z\""), "JSON에 'z' 필드가 있어야 함");

        // 예: `"id":"test-id"` 형태로 필드값도 정확히 포함되는지 확인
        assert!(
            json_str.contains("test-id"),
            "JSON에 id 값이 포함되어야 함"
        );
    }

    /// NodeDetails serde round-trip
    ///
    /// camelCase 변환 (size_bytes → sizeBytes 등)이 직렬화/역직렬화를 거쳐도
    /// 원본 데이터를 그대로 복원하는지 확인. snake_case ↔ camelCase 미스매치는
    /// frontend에서 undefined로 나타나는 흔한 버그이므로 회귀 방지 테스트.
    #[test]
    fn test_node_details_serde_roundtrip() {
        let original = NodeDetails {
            id: "01900000-0000-7000-8000-000000000001".to_string(),
            name: "documents.txt".to_string(),
            path: "/Users/demo/documents.txt".to_string(),
            kind: NodeKind::File,
            size_bytes: 2048,
            created_at: 1_743_465_600_000, // 2025-04-01 UTC
            modified_at: 1_743_552_000_000,
        };

        let json_str = serde_json::to_string(&original).expect("직렬화 실패");
        let deserialized: NodeDetails = serde_json::from_str(&json_str).expect("역직렬화 실패");
        assert_eq!(deserialized, original, "round-trip 후 동일해야 함");
    }

    /// NodeDetails JSON에 camelCase 필드명이 포함되는지 검증
    ///
    /// snake_case로 직렬화되면 frontend에서 details.sizeBytes가 undefined로 떨어진다.
    /// 이 테스트는 그런 회귀를 즉시 잡는다.
    #[test]
    fn test_node_details_json_camelcase() {
        let details = NodeDetails {
            id: "id".into(),
            name: "n".into(),
            path: "/p".into(),
            kind: NodeKind::Directory,
            size_bytes: 0,
            created_at: 0,
            modified_at: 0,
        };

        let json_str = serde_json::to_string(&details).expect("직렬화 실패");
        assert!(json_str.contains("\"sizeBytes\""), "sizeBytes (camelCase) 필요");
        assert!(json_str.contains("\"createdAt\""), "createdAt (camelCase) 필요");
        assert!(json_str.contains("\"modifiedAt\""), "modifiedAt (camelCase) 필요");
        // snake_case 형태로는 직렬화되면 안 됨
        assert!(!json_str.contains("size_bytes"), "snake_case로 새지 않아야 함");
    }

    /// NodeKind 각 variant가 camelCase로 직렬화되는지 확인
    ///
    /// rename_all = "camelCase"는 enum variant도 변환한다 (PascalCase → camelCase).
    /// File → "file", Directory → "directory" 등.
    #[test]
    fn test_node_kind_serialization() {
        let cases = [
            (NodeKind::File, "\"file\""),
            (NodeKind::Directory, "\"directory\""),
            (NodeKind::Link, "\"link\""),
            (NodeKind::Memo, "\"memo\""),
        ];
        for (kind, expected) in cases {
            let json = serde_json::to_string(&kind).expect("NodeKind 직렬화 실패");
            assert_eq!(json, expected, "NodeKind variant 직렬화 형식 불일치");
        }
    }
}
