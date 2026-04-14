// cosmos-desktop 백엔드 엔트리포인트
// Rust ↔ TypeScript IPC 브릿지, DB 초기화, 파일감시 등을 담당

// 모듈 선언 (파일 시스템 구조와 일치해야 함)
mod commands;
mod db;
mod ipc_types;
mod safety;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // tauri-plugin-sql 초기화
        // - SQLite 드라이버 자동 로드
        // - db::migrations()로 마이그레이션 자동 실행
        // - 프론트엔드에서 tauri.plugins.sql.execute() 호출 가능
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cosmos.db", db::migrations())
                .build(),
        )
        // tauri-plugin-opener 유지 (파일 열기, URL 열기 등)
        .plugin(tauri_plugin_opener::init())
        // IPC 핸들러 등록
        // tauri::generate_handler![] 매크로가 자동으로 #[tauri::command] 함수들을 등록
        // 함수 추가 시 여기에도 추가 필수
        .invoke_handler(tauri::generate_handler![
            commands::nodes::get_nodes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
