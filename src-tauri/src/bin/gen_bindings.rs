// 별도 실행 가능한 도구: tauri-specta로 frontend bindings.ts 생성
//
// 실행: `cargo run --manifest-path src-tauri/Cargo.toml --bin gen_bindings`
//
// 왜 필요한가:
// - lib.rs에 cargo test로 export하는 테스트를 두면 Windows에서
//   STATUS_ENTRYPOINT_NOT_FOUND DLL 이슈가 발생
//   (tauri-specta의 Builder<tauri::Wry> 타입이 webview2 DLL 체인을
//    test exe에 끌어들이는데, target/debug/deps/에 dll이 없어서 로드 실패)
// - main exe(`cargo tauri dev`로 실행되는 cosmos-desktop.exe)는 target/debug/에
//   WebView2Loader.dll이 같이 놓이므로 OK
// - 이 binary도 cargo build/run 시 target/debug/ 에 위치하기 때문에 DLL 로드 OK
//
// `pub fn run()`의 디버그 빌드 export 경로와 별개로, CI/개발자가 빠르게
// 실행해서 bindings.ts만 갱신하고 싶을 때 쓰는 도구.

fn main() {
    use cosmos_desktop_lib::__internal_build_specta_for_codegen as build_specta;
    use specta_typescript::Typescript;

    let builder = build_specta();
    match builder.export(Typescript::default(), "../src/lib/bindings.ts") {
        Ok(_) => {
            println!("[gen_bindings] ../src/lib/bindings.ts 생성 완료");
        }
        Err(e) => {
            eprintln!("[gen_bindings] bindings.ts 생성 실패: {}", e);
            std::process::exit(1);
        }
    }
}
