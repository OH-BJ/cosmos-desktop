// IPC (Inter-Process Communication) 타입 정의
// Rust 백엔드 ↔ TypeScript 프론트엔드 사이의 메시지 포맷
// serde 매크로로 JSON 직렬화/역직렬화 자동 생성

use serde::{Deserialize, Serialize};

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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub path: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
