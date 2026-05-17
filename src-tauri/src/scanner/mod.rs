// 비동기 파일시스템 디렉토리 스캐너 (M6-1 Step 1+2 — First Grounding)
//
// # 코어 함수 분리 (Step 2 리팩터링)
// - `scan_directory_chunked(root, max_depth, chunk_size, emit)` — 콜백 기반 코어.
//   buffer 가 chunk_size 에 도달할 때마다 emit, 종료 시점에 is_last=true 청크 1개.
// - `scan_directory(root, max_depth)` — 레거시 어댑터. 모든 노드를 Vec 한 번에 반환.
//   내부적으로 `scan_directory_chunked` 를 chunk_size=usize::MAX 로 호출 →
//   중간 emit 없이 단 하나의 종료 청크에서 전부 수집.
//
// 같은 BFS 로직이 두 entry 에서 공유돼 중복/drift 위험 0. Step 1 테스트도 그대로 통과.
//
// # 안전장치 (Step 1 그대로)
// - `max_depth`: 무한 재귀 방지
// - `canonicalize()` 기반 visited set: 심볼릭 링크 / Windows junction cycle 차단
// - per-entry try/catch: 권한 거부된 폴더가 있어도 전체 실패하지 않고 건너뜀

// (M7-1 Step 1) Fractal Orbital Packing 좌표 계산 모듈
pub mod coords;

use crate::ipc_types::{NodeChunkEvent, NodeKind, ScannedNode};
use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::time::SystemTime;
use thiserror::Error;
use tokio::fs;

/// 청크 기본 크기. 사용자 디렉토리 (~수천 노드) 기준 청크 1~수개로 적당.
/// 향후 측정 후 조정 (Binary IPC 전환 시점에 1만~10만으로 키울 수 있음).
pub const DEFAULT_CHUNK_SIZE: usize = 1000;

/// 스캔 중 발생할 수 있는 에러
#[derive(Debug, Error)]
pub enum ScanError {
    /// root 경로가 존재하지 않거나 디렉토리가 아님
    #[error("root 경로가 존재하지 않거나 디렉토리가 아님: {0}")]
    InvalidRoot(PathBuf),

    /// 그 외 IO 에러 (root canonicalize 실패 등)
    #[error("IO 에러: {0}")]
    Io(#[from] std::io::Error),
}

/// 청크 콜백 기반 비동기 디렉토리 스캐너 (M6-1 Step 2 코어).
///
/// # 인자
/// - `root`: 스캔 시작 절대 경로
/// - `max_depth`: root 기준 최대 깊이 (1 = 직계 자식만)
/// - `chunk_size`: 한 청크에 담을 최대 노드 수 (테스트는 작게, 운영은 1000)
/// - `emit`: 청크가 완성될 때마다 호출되는 동기 콜백
///
/// # 보장
/// - 성공 시 **마지막에 정확히 1개의** `is_last = true` 청크가 emit 됨 (남은
///   노드 0개여도 마찬가지 — frontend listener 가 영원히 대기하지 않게).
/// - `chunk_id` 는 0 부터 1씩 증가.
/// - `total_scanned` 는 누적값 (이 청크 포함).
///
/// # 반환
/// 총 스캔된 노드 수.
///
/// # 콜백이 sync 인 이유
/// `tauri_specta::Event::emit` 자체가 sync 메서드이고, mpsc 채널을 끼우면
/// 작업량 대비 복잡도 폭증. 콜백 안에서 무거운 처리(IO 등)를 하지 않는다는
/// 전제 하에 sync 가 안전. 호출 빈도는 chunk_size 마다 1회로 적다.
pub async fn scan_directory_chunked<F>(
    root: PathBuf,
    max_depth: u32,
    chunk_size: usize,
    mut emit: F,
) -> Result<u32, ScanError>
where
    F: FnMut(NodeChunkEvent),
{
    debug_assert!(chunk_size > 0, "chunk_size must be > 0");

    // root canonicalize → 일관된 경로 포맷으로 visited set 시드.
    let canonical_root = fs::canonicalize(&root)
        .await
        .map_err(|_| ScanError::InvalidRoot(root.clone()))?;

    let root_meta = fs::metadata(&canonical_root).await?;
    if !root_meta.is_dir() {
        return Err(ScanError::InvalidRoot(root));
    }

    // chunk_size 가 usize::MAX 같은 큰 값일 때 Vec::with_capacity 가
    // 메모리 통째로 잡지 않도록 1024 cap.
    let buffer_cap = chunk_size.min(1024);
    let mut buffer: Vec<ScannedNode> = Vec::with_capacity(buffer_cap);

    let mut total_scanned: u32 = 0;
    let mut chunk_id: u32 = 0;

    let mut visited: HashSet<PathBuf> = HashSet::new();
    visited.insert(canonical_root.clone());

    // (M7-1 Step 1) BFS 큐 항목에 부모 좌표 추가.
    // root 의 위치는 절대 원점 (0, 0, 0). 자식들은 child_position 으로 계산된 값.
    let mut queue: VecDeque<(PathBuf, u32, [f32; 3])> = VecDeque::new();
    queue.push_back((canonical_root, 0, [0.0_f32, 0.0, 0.0]));

    while let Some((dir, parent_depth, parent_pos)) = queue.pop_front() {
        let child_depth = parent_depth + 1;
        if child_depth > max_depth {
            continue;
        }

        // 권한 거부 등 read_dir 실패는 스킵 — 큰 트리에선 일부 폴더 막힘이 흔함.
        let mut entries = match fs::read_dir(&dir).await {
            Ok(e) => e,
            Err(_) => continue,
        };

        // (M7-1 Step 1) 좌표 결정성을 위해 entries 를 먼저 모은다.
        // sibling_index 가 안정적이려면 정렬 키가 필요하기 때문.
        // 정렬 키: (modified_time, file_name). 둘 다 동일하면 자연 순서.
        // 메모리: 한 디렉토리 자식 수만큼이라 보통 수십~수백 개. 안전.
        struct PendingEntry {
            path: PathBuf,
            name: String,
            file_type: std::fs::FileType,
            size_bytes: u64,
            modified: SystemTime,
        }
        let mut pending: Vec<PendingEntry> = Vec::new();

        loop {
            let entry = match entries.next_entry().await {
                Ok(Some(e)) => e,
                Ok(None) => break,
                Err(_) => continue,
            };

            let path = entry.path();
            // file_type() 는 std::fs::FileType 반환. dir/file/symlink 일관 판별.
            // entry.metadata() 는 심볼릭 링크 타깃을 따라가 "링크 자체" 정보를 잃는다.
            let file_type = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().into_owned();

            // 심볼릭 링크는 타깃 크기 / mtime 대신 0/UNIX_EPOCH 폴백.
            let (size_bytes, modified) = if file_type.is_symlink() {
                (0, SystemTime::UNIX_EPOCH)
            } else {
                match entry.metadata().await {
                    Ok(m) => (m.len(), m.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
                    Err(_) => (0, SystemTime::UNIX_EPOCH),
                }
            };

            pending.push(PendingEntry {
                path,
                name,
                file_type,
                size_bytes,
                modified,
            });
        }

        // 정렬: (modified_time, file_name). 같은 mtime 이면 이름 사전순.
        pending.sort_by(|a, b| {
            a.modified
                .cmp(&b.modified)
                .then_with(|| a.name.cmp(&b.name))
        });

        let sibling_total = pending.len();
        for (sibling_index, p) in pending.into_iter().enumerate() {
            // 심볼릭 링크 판별을 dir 보다 먼저! Windows 의 디렉토리 심볼릭은
            // is_dir 도 true 가 될 수 있다 → 잘못 분류 후 재귀 위험.
            let kind = if p.file_type.is_symlink() {
                NodeKind::Link
            } else if p.file_type.is_dir() {
                NodeKind::Directory
            } else {
                NodeKind::File
            };

            // (M7-1 Step 1) Fractal Orbital Packing 으로 자식 좌표 계산.
            let position =
                coords::child_position(parent_pos, child_depth, sibling_index, sibling_total);

            buffer.push(ScannedNode {
                // UUID v7 = 시간 정렬 가능. 청크가 순서 없이 도착해도 ID 정렬로
                // 대략 시간 순 복원 가능 (Step 2 단일 task 라 사실상 보장됨).
                id: uuid::Uuid::now_v7().to_string(),
                path: p.path.to_string_lossy().into_owned(),
                name: p.name,
                kind,
                size_bytes: p.size_bytes,
                depth: child_depth,
                position,
            });
            total_scanned += 1;

            // 버퍼 가득 → flush. 새 Vec 으로 교체 (drained 는 emit 으로 이동).
            if buffer.len() >= chunk_size {
                let drained = std::mem::replace(&mut buffer, Vec::with_capacity(buffer_cap));
                emit(NodeChunkEvent {
                    chunk_id,
                    nodes: drained,
                    is_last: false,
                    total_scanned,
                });
                chunk_id += 1;
            }

            // 진짜 디렉토리이고 더 깊이 갈 수 있으면 큐에 push.
            // is_symlink 우선 분기이므로 file_type.is_dir() 는 비-심볼릭 디렉토리만 true.
            if p.file_type.is_dir() && child_depth < max_depth {
                if let Ok(canonical) = fs::canonicalize(&p.path).await {
                    if visited.insert(canonical.clone()) {
                        // 부모 좌표 = 이 디렉토리의 좌표 (위에서 계산한 position).
                        queue.push_back((canonical, child_depth, position));
                    }
                }
            }
        }
    }

    // 종료 신호: 항상 마지막에 정확히 1개의 is_last=true 청크 emit.
    // - 빈 디렉토리: nodes=[], total=0
    // - 정확히 chunk_size 의 배수: nodes=[], total=N (직전에 full chunk 가 emit 됨)
    // - 일반: nodes=남은 것, total=N
    emit(NodeChunkEvent {
        chunk_id,
        nodes: buffer,
        is_last: true,
        total_scanned,
    });

    Ok(total_scanned)
}

/// 레거시 비스트리밍 API (Step 1 호환).
///
/// 내부적으로 `scan_directory_chunked` 를 `chunk_size = usize::MAX` 로 호출 →
/// 중간 emit 없이 종료 청크 단 1번에서 모든 노드를 받아 Vec 으로 누적.
/// 같은 BFS 로직을 공유하므로 향후 버그 수정/최적화가 한 곳에 집중된다.
///
/// **신규 코드는 가능하면 `start_directory_scan` IPC 를 사용**하고, 이 API 는
/// 단위 테스트나 한 번에 결과가 필요한 용도로만 유지.
pub async fn scan_directory(
    root: PathBuf,
    max_depth: u32,
) -> Result<Vec<ScannedNode>, ScanError> {
    let mut all: Vec<ScannedNode> = Vec::new();
    scan_directory_chunked(root, max_depth, usize::MAX, |chunk| {
        // chunk_size=usize::MAX 이므로 종료 청크 1번만 호출됨. extend 1회.
        all.extend(chunk.nodes);
    })
    .await?;
    Ok(all)
}

// ---------------------------------------------------------------------------
// 단위 테스트
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs as stdfs;
    use std::io::Write;
    use tempfile::tempdir;

    // ---- 레거시 scan_directory (Step 1 회귀 보호) -----------------------

    #[tokio::test]
    async fn scans_flat_directory() {
        let tmp = tempdir().expect("temp dir 생성 실패");
        for name in ["a.txt", "b.txt", "c.txt"] {
            let mut f = stdfs::File::create(tmp.path().join(name)).expect("파일 생성 실패");
            f.write_all(b"hello").expect("파일 write 실패");
        }

        let nodes = scan_directory(tmp.path().to_path_buf(), 5)
            .await
            .expect("스캔 성공");
        assert_eq!(nodes.len(), 3, "3 파일 기대");
        for n in &nodes {
            assert_eq!(n.kind, NodeKind::File, "파일이어야 함");
            assert_eq!(n.depth, 1, "직계 자식 = depth 1");
            assert_eq!(n.size_bytes, 5, "'hello' = 5 bytes");
        }
    }

    #[tokio::test]
    async fn respects_max_depth() {
        let tmp = tempdir().expect("temp dir");
        let sub = tmp.path().join("sub");
        stdfs::create_dir(&sub).expect("sub 생성");
        stdfs::File::create(sub.join("leaf.txt")).expect("leaf 생성");

        let nodes = scan_directory(tmp.path().to_path_buf(), 1)
            .await
            .expect("스캔");
        assert_eq!(nodes.len(), 1, "max_depth=1 → 1 노드");
        assert_eq!(nodes[0].kind, NodeKind::Directory);
        assert_eq!(nodes[0].name, "sub");
        assert_eq!(nodes[0].depth, 1);

        let nodes = scan_directory(tmp.path().to_path_buf(), 2)
            .await
            .expect("스캔");
        assert_eq!(nodes.len(), 2, "max_depth=2 → sub + leaf");
        let mut names: Vec<&str> = nodes.iter().map(|n| n.name.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["leaf.txt", "sub"]);
        let leaf = nodes.iter().find(|n| n.name == "leaf.txt").unwrap();
        assert_eq!(leaf.depth, 2, "손자 = depth 2");
    }

    #[tokio::test]
    async fn invalid_root_returns_error() {
        let result = scan_directory(
            PathBuf::from("/nonexistent/path/that/should/never/exist/xyz123"),
            5,
        )
        .await;
        assert!(
            matches!(result, Err(ScanError::InvalidRoot(_))),
            "존재 없는 경로는 InvalidRoot, got {:?}",
            result
        );
    }

    #[tokio::test]
    async fn root_must_be_directory() {
        let tmp = tempdir().expect("temp dir");
        let file = tmp.path().join("solo.txt");
        stdfs::File::create(&file).expect("파일 생성");

        let result = scan_directory(file, 5).await;
        assert!(
            matches!(result, Err(ScanError::InvalidRoot(_))),
            "파일을 root로 주면 InvalidRoot, got {:?}",
            result
        );
    }

    #[tokio::test]
    async fn does_not_panic_on_empty_dir() {
        let tmp = tempdir().expect("temp dir");
        let nodes = scan_directory(tmp.path().to_path_buf(), 5)
            .await
            .expect("빈 디렉토리도 Ok");
        assert_eq!(nodes.len(), 0, "비어 있으면 0 노드");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_cycle_does_not_loop() {
        use std::os::unix::fs::symlink;
        let tmp = tempdir().expect("temp dir");
        let sub = tmp.path().join("sub");
        stdfs::create_dir(&sub).expect("sub 생성");
        symlink(tmp.path(), sub.join("loop")).expect("symlink 생성");

        let nodes = scan_directory(tmp.path().to_path_buf(), 10)
            .await
            .expect("스캔");
        assert!(
            nodes.len() < 100,
            "cycle 방지 실패, {} 노드 발견",
            nodes.len()
        );
        let has_link = nodes.iter().any(|n| n.kind == NodeKind::Link);
        assert!(has_link, "심볼릭 링크가 Link로 분류돼야 함");
    }

    // ---- Step 2 신규: scan_directory_chunked 청크 분할 ------------------

    /// 5 파일, chunk_size=2 → 청크 3개: (2, false), (2, false), (1, true)
    #[tokio::test]
    async fn chunked_emits_correct_chunks() {
        let tmp = tempdir().expect("temp dir");
        for i in 0..5 {
            stdfs::File::create(tmp.path().join(format!("f{}.txt", i)))
                .expect("파일 생성");
        }

        let mut chunks: Vec<NodeChunkEvent> = Vec::new();
        let total = scan_directory_chunked(
            tmp.path().to_path_buf(),
            5,
            2,
            |c| chunks.push(c),
        )
        .await
        .expect("청크 스캔");

        assert_eq!(total, 5, "총 5 파일");
        assert_eq!(chunks.len(), 3, "5/2 = 3 청크 (2+2+1)");

        assert_eq!(chunks[0].chunk_id, 0);
        assert_eq!(chunks[0].nodes.len(), 2);
        assert!(!chunks[0].is_last);
        assert_eq!(chunks[0].total_scanned, 2);

        assert_eq!(chunks[1].chunk_id, 1);
        assert_eq!(chunks[1].nodes.len(), 2);
        assert!(!chunks[1].is_last);
        assert_eq!(chunks[1].total_scanned, 4);

        assert_eq!(chunks[2].chunk_id, 2);
        assert_eq!(chunks[2].nodes.len(), 1);
        assert!(chunks[2].is_last, "마지막 청크 is_last=true");
        assert_eq!(chunks[2].total_scanned, 5);
    }

    /// 빈 디렉토리도 종료 청크 1개 (is_last=true, nodes=[]) — frontend listener 가
    /// 영원히 대기하지 않게 종료 신호를 항상 보낸다.
    #[tokio::test]
    async fn chunked_empty_dir_emits_one_terminal_chunk() {
        let tmp = tempdir().expect("temp dir");
        let mut chunks: Vec<NodeChunkEvent> = Vec::new();
        let total = scan_directory_chunked(
            tmp.path().to_path_buf(),
            5,
            100,
            |c| chunks.push(c),
        )
        .await
        .expect("스캔");

        assert_eq!(total, 0);
        assert_eq!(chunks.len(), 1, "빈 디렉토리도 종료 청크 1개");
        assert!(chunks[0].is_last);
        assert_eq!(chunks[0].nodes.len(), 0);
        assert_eq!(chunks[0].chunk_id, 0);
        assert_eq!(chunks[0].total_scanned, 0);
    }

    /// 정확히 chunk_size 의 배수일 때: full chunks + 빈 종료 청크.
    /// 예: 4 파일, chunk_size=2 → (2, false), (2, false), (0, true)
    #[tokio::test]
    async fn chunked_exact_multiple_emits_terminal_empty() {
        let tmp = tempdir().expect("temp dir");
        for i in 0..4 {
            stdfs::File::create(tmp.path().join(format!("f{}.txt", i)))
                .expect("파일 생성");
        }

        let mut chunks: Vec<NodeChunkEvent> = Vec::new();
        scan_directory_chunked(tmp.path().to_path_buf(), 5, 2, |c| chunks.push(c))
            .await
            .expect("스캔");

        assert_eq!(chunks.len(), 3, "4/2 = 2 full + 1 빈 종료 = 3 청크");
        assert!(!chunks[0].is_last);
        assert!(!chunks[1].is_last);
        assert!(chunks[2].is_last, "종료 청크");
        assert_eq!(chunks[2].nodes.len(), 0, "남은 노드 0");
        assert_eq!(chunks[2].total_scanned, 4);
    }

    // ---- M7-1 Step 1: 좌표 통합 검증 -------------------------------------

    /// 같은 트리를 두 번 스캔하면 같은 노드의 position 이 동일해야 한다 (결정성).
    /// 정렬 키 (modified_time, file_name) 가 안정적이면 sibling_index 가 같고
    /// child_position 이 결정성이라 좌표가 같아야 한다.
    #[tokio::test]
    async fn scan_produces_deterministic_positions() {
        let tmp = tempdir().expect("temp dir");
        for name in ["alpha.txt", "beta.txt", "gamma.txt"] {
            stdfs::File::create(tmp.path().join(name)).expect("파일 생성");
        }

        let nodes_a = scan_directory(tmp.path().to_path_buf(), 5)
            .await
            .expect("스캔 1");
        let nodes_b = scan_directory(tmp.path().to_path_buf(), 5)
            .await
            .expect("스캔 2");

        assert_eq!(nodes_a.len(), nodes_b.len(), "노드 수 동일");

        // path → position map 비교
        for a in &nodes_a {
            let b = nodes_b.iter().find(|n| n.path == a.path).expect("같은 path");
            assert_eq!(a.position, b.position, "{} 의 position 일치해야", a.name);
        }
    }

    /// 자식 노드 position 이 (0, 0, 0) 이 아니어야 한다.
    /// root 의 직계 자식은 depth=1, r_d=100,000 만큼 떨어진다.
    #[tokio::test]
    async fn scan_assigns_non_origin_positions() {
        let tmp = tempdir().expect("temp dir");
        stdfs::File::create(tmp.path().join("file.txt")).expect("파일 생성");

        let nodes = scan_directory(tmp.path().to_path_buf(), 5)
            .await
            .expect("스캔");
        assert_eq!(nodes.len(), 1);
        let p = nodes[0].position;
        let mag = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
        // depth=1, total=1 → r_adjusted = 100,000 × 1.0
        assert!(
            (mag - 100_000.0).abs() < 1.0,
            "직계 자식 거리 ≈ 100,000, got {}",
            mag
        );
    }

    /// chunked 가 종료 청크에서 잘못된 chunk_id 를 쓰지 않는지: 단조 증가 보장.
    #[tokio::test]
    async fn chunked_chunk_ids_monotonic() {
        let tmp = tempdir().expect("temp dir");
        for i in 0..7 {
            stdfs::File::create(tmp.path().join(format!("f{}.txt", i)))
                .expect("파일 생성");
        }
        let mut chunks: Vec<NodeChunkEvent> = Vec::new();
        scan_directory_chunked(tmp.path().to_path_buf(), 5, 3, |c| chunks.push(c))
            .await
            .expect("스캔");
        // 7/3 = (3, 3, 1+terminal). chunk_id 0,1,2.
        let ids: Vec<u32> = chunks.iter().map(|c| c.chunk_id).collect();
        assert_eq!(ids, vec![0, 1, 2], "chunk_id 단조 증가");
    }
}
