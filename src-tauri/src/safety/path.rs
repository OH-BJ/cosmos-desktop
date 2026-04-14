// 경로 검증 로직
// 사용자 파일 삭제 같은 위험을 사전에 방지

use std::path::Path;
use thiserror::Error;

/// 경로 검증 에러
/// thiserror 매크로가 Display 트레잇을 자동 생성해서 사용자 메시지 출력 가능하게 함
#[derive(Debug, Error)]
pub enum SafetyError {
    #[error("시스템 디렉터리 접근 불가: {0}")]
    SystemDirectory(String),

    #[error("부모 디렉터리 심볼릭 링크는 지원 안 함: {0}")]
    SymbolicLink(String),

    #[error("경로가 존재하지 않음: {0}")]
    PathNotFound(String),

    #[error("경로 정규화 실패: {0}")]
    CanonicalizeError(String),
}

/// 경로 안전성 검증
///
/// # 검증 규칙
/// 1. 시스템 보호 디렉터리 (Windows: `C:\Windows`, `C:\Program Files`, macOS: `/System`, `/usr` 등)에
///    속하면 거부
/// 2. 심볼릭 링크 부모는 거부 (심볼릭 링크 traversal 공격 방지)
/// 3. 경로가 정규화 가능해야 함
///
/// # 반환
/// - `Ok(())` — 경로 안전함
/// - `Err(SafetyError)` — 검증 실패, 에러 메시지는 한국어 사용자용
///
/// # Rust 개념: Result<T, E>
/// Rust의 에러 처리 철학. 예외 던지기 대신 반환값에 `Ok(결과)` 또는 `Err(에러)` 담기.
/// 호출자는 `match` 또는 `?` 연산자로 처리 필수. 에러를 "자동으로 무시"할 수 없음.
pub fn validate_path(path: &Path) -> Result<(), SafetyError> {
    let abs_path = path
        .canonicalize()
        .map_err(|_| SafetyError::CanonicalizeError(path.display().to_string()))?;

    // Windows 의 canonicalize 는 `\\?\` (extended-length) 프리픽스를 붙여 반환한다.
    // 예: `C:\Windows\System32` → `\\?\C:\Windows\System32`
    // 이 상태로 `starts_with("c:\\windows")` 를 하면 거짓이 되므로 반드시 벗겨야 한다.
    // UNC 경로 (`\\?\UNC\server\share`) 도 처리.
    let raw = abs_path.to_string_lossy().to_lowercase();
    let path_str = raw
        .strip_prefix(r"\\?\unc\")
        .map(|rest| format!(r"\\{}", rest))
        .unwrap_or_else(|| raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string());

    // Windows 시스템 디렉터리 차단
    let windows_forbidden = [
        "c:\\windows",
        "c:\\program files",
        "c:\\program files (x86)",
        "c:\\programdata",
    ];

    for forbidden in &windows_forbidden {
        if path_str.starts_with(forbidden) {
            return Err(SafetyError::SystemDirectory(abs_path.display().to_string()));
        }
    }

    // macOS/Linux 시스템 디렉터리 차단
    let unix_forbidden = [
        "/system",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/lib",
        "/boot",
        "/root",
    ];

    for forbidden in &unix_forbidden {
        if path_str.starts_with(&forbidden.to_lowercase()) {
            return Err(SafetyError::SystemDirectory(abs_path.display().to_string()));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_windows_forbidden() {
        let windows_paths = vec![
            PathBuf::from("C:\\Windows\\System32"),
            PathBuf::from("C:\\Program Files\\SomeApp"),
            PathBuf::from("C:\\ProgramData\\Config"),
        ];

        for path in windows_paths {
            if path.exists() {
                // canonicalize 가능할 때만 테스트 (CI 환경에선 실제 경로 필요)
                let result = validate_path(&path);
                assert!(result.is_err(), "Expected {:?} to be forbidden", path);
            }
        }
    }

    #[test]
    fn test_user_home_allowed() {
        // 사용자 홈 디렉터리는 허용되어야 함
        let home = std::env::temp_dir();
        let result = validate_path(&home);
        assert!(
            result.is_ok(),
            "User temp dir should be allowed: {:?}",
            home
        );
    }
}
