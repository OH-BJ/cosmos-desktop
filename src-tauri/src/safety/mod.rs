// 파일시스템 안전성 검증 모듈
// CLAUDE.md §7 "파일 안전" 규칙 구현:
// - 사용자 지정 범위 외부 경로 차단
// - 시스템 디렉터리 하드코딩 차단
// - 삭제 시 휴지통 경유 (다음 마일스톤)

pub mod path;

pub use path::{validate_path, SafetyError};
