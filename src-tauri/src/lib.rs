// cosmos-desktop 백엔드 엔트리포인트
// Rust ↔ TypeScript IPC 브릿지, DB 초기화, 파일감시 등을 담당

// 모듈 선언 (파일 시스템 구조와 일치해야 함)
mod commands;
mod db;
mod ipc_types;
mod safety;
// (M6-1 Step 1) tokio 비동기 디렉토리 스캐너 코어
mod scanner;

use tauri_specta::{collect_commands, collect_events, Builder};

/// tauri-specta Builder 생성 (런타임/빌드 양쪽에서 공통 사용)
///
/// 왜 함수로 분리했는가:
/// - `run()` (앱 실행)에서는 `invoke_handler()`로 IPC 등록에 사용
/// - 테스트(`export_bindings`)에서는 동일 Builder로 `bindings.ts` 생성
/// - 두 호출이 똑같은 command 목록을 보장 (drift 방지)
///
/// `collect_commands!` 매크로:
/// - 인자로 받은 함수들의 specta 메타정보를 수집
/// - 각 함수에는 `#[tauri::command] + #[specta::specta]`가 필수
/// - 빠뜨리면 frontend bindings에서 해당 함수 누락
fn build_specta() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::nodes::get_nodes,
            commands::node_details::get_node_details,
            // (M6-1 Step 1) 비스트리밍 스캔. 작은 디렉토리/디버그용으로 유지.
            commands::scanner::scan_directory_command,
            // (M6-1 Step 2) 청크 스트리밍 스캔. 운영 entry.
            commands::scanner::start_directory_scan,
        ])
        // (M6-1 Step 2) Event 등록. derive(tauri_specta::Event) 가 만든 Event impl 을
        // collect_events! 가 수집해 frontend `events.nodeChunkEvent.listen()` wrapper 생성.
        .events(collect_events![ipc_types::NodeChunkEvent])
}

/// `gen_bindings` 바이너리에서만 호출하는 공개 wrapper.
/// 실제 외부 사용은 금지 (이름의 `__internal_` prefix가 의도를 표현).
/// 이렇게 분리한 이유는 lib 밖(별도 bin)에서 동일 Builder 정의를 재사용해
/// command 목록의 drift를 방지하면서, lib 자체는 prviate API만 노출하려 함.
#[doc(hidden)]
pub fn __internal_build_specta_for_codegen() -> Builder<tauri::Wry> {
    build_specta()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = build_specta();

    // 디버그 빌드(=`tauri dev` 또는 `cargo build`)에서만 bindings.ts 갱신.
    // 릴리스 빌드에서는 frontend bundle이 이미 컴파일된 상태이므로 무의미하다.
    // 경로는 `src-tauri/` 기준 상대 경로 → 프로젝트 루트의 `src/lib/bindings.ts`.
    #[cfg(debug_assertions)]
    {
        use specta_typescript::Typescript;
        if let Err(e) = specta_builder
            .export(Typescript::default(), "../src/lib/bindings.ts")
        {
            eprintln!("[tauri-specta] bindings.ts 생성 실패: {}", e);
        }
    }

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
        // tauri-specta Builder의 invoke_handler()가 collect_commands!에 등록된
        // 함수들을 자동으로 묶어서 반환. tauri::generate_handler! 매크로 호출이
        // 더 이상 필요 없다 (drift 위험 제거).
        .invoke_handler(specta_builder.invoke_handler())
        // (M6-1 Step 2) Event 시스템 마운트.
        // collect_events! 로 등록한 NodeChunkEvent 의 emit/listen 채널이 실제로
        // 작동하려면 App 인스턴스에 mount 가 필요하다. setup hook 안에서 호출.
        // specta_builder 를 setup 클로저로 move (`invoke_handler` 가 &self 라
        // 위에서 builder 가 소비되지 않음).
        .setup(move |app| {
            specta_builder.mount_events(app);
            Ok(())
        })
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

// NOTE (M5 Step 1): bindings.ts 자동 export 테스트를 lib.rs에 두려 했으나,
// Windows에서 lib 테스트 exe가 STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)로
// 실패하는 이슈를 확인했다 (tauri-specta + tauri 2.10 + WebView2 DLL 체인 충돌
// 추정 — webview2-com-sys 다중 버전 빌드).
// → 자동 export는 `pub fn run()`의 디버그 빌드 경로에 의존하기로 결정.
//   개발자가 `cargo tauri dev`를 한 번 실행하면 ../src/lib/bindings.ts가 갱신된다.
//   향후 build.rs 또는 xtask로 분리해 cargo test 없이도 갱신되게 만드는 것은 M6+ 과제.
