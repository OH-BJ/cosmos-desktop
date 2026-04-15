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
        // expect() 대신 명시적 에러 처리로 변경
        //
        // CLAUDE.md §6-3 규칙: 프로덕션 코드에서 unwrap()/expect()를 사용하면
        // 에러 발생 시 사용자에게 Rust panic 스택 트레이스를 노출하게 된다.
        // Tauri 앱이 시작 불가 상태가 되어도 사용자가 이해할 수 있는 메시지를 줘야 한다.
        //
        // 여기서 Result를 더 이상 전파하지 않는 이유:
        // - pub fn run()의 시그니처가 이미 정해져 있음
        // - main.rs에서 호출하는 코드 체인을 바꾸지 않기 위해
        // - Tauri의 tauri::Builder::run()은 자체적으로 panic을 조용히 처리하는데,
        //   여기서 Err을 반환하면 호출자(main)가 처리할 책임이 생김
        // 따라서 이 경계에서 에러를 "소비"하고, 사용자 메시지로 변환 후 종료하는 게 맞음.
        .map_err(|e| {
            // 사용자가 이해할 수 있는 한국어 메시지로 변환
            eprintln!("cosmos-desktop 실행 실패: {}", e);
            eprintln!("자세한 정보를 위해 관리자에게 문의하세요.");
        })
        .ok(); // Result를 버림 (에러는 이미 eprintln!으로 처리했으므로)
}
