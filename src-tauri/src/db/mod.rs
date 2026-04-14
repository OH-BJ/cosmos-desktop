// SQLite 데이터베이스 초기화 및 마이그레이션
// tauri-plugin-sql의 Migration 인터페이스를 사용해서
// 앱 시작 시 자동으로 테이블/인덱스 생성

use tauri_plugin_sql::Migration;

/// 데이터베이스 마이그레이션 목록
///
/// 마이그레이션은 버전별로 순차 실행됨. 이미 적용된 마이그레이션은 건너뜀.
/// 이렇게 하면 사용자가 앱 업데이트할 때 자동으로 DB 스키마 진화 가능.
///
/// # Rust 매크로 `vec!`
/// `vec![a, b, c]`는 `Vec::new(); v.push(a); v.push(b); v.push(c);`의 단축형.
/// 매크로는 Rust 컴파일 시점에 코드로 확장되는 "코드 생성기" 같은 개념.
pub fn migrations() -> Vec<Migration> {
    vec![
        // 마이그레이션 1: 초기 노드 테이블 생성
        Migration {
            version: 1,
            description: "nodes 테이블 생성",
            sql: r#"
                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL,
                    x REAL NOT NULL,
                    y REAL NOT NULL,
                    z REAL NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                -- 경로 검색 성능 향상을 위한 인덱스 (다음 마일스톤)
                CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);
            "#,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ]
}
