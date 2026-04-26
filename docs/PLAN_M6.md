# PLAN_M6 — "First Grounding"

> 작성: 2026-04-25 (Day 9-2). 5번째 AI 교차검증 사이클(웹 Claude → Gemini Pro → Planner 메타리뷰)에서 후보 D 확정.

---

## 목표

실제 파일 시스템을 비동기 워커 스레드로 스캔하여 청크 단위로 Frontend에 스트리밍, three.js 우주에 수백~수천 노드를 점진 등장. M1~M5 인프라가 진짜 데이터에서 버티는지 검증.

## 성공 기준

- 사용자 디렉토리(예: ~/Documents) 스캔
- 노드 수: 100~수천 (실측에 따름)
- 청크 단위 점진 렌더링 (UI 블로킹 0)
- 60fps 유지 (M4 히트테스트 + M5 메타패널 회귀 없음)
- 재귀 깊이 제한 + 심볼릭 링크 안전
- 테스트 전부 통과 (Rust + Frontend)

---

## 마일스톤 분해 (Gemini 권장)

### M6-1 "Backend Pipeline" (Rust)

**Step 1: 비동기 디렉토리 워커**
- `tokio::spawn` 또는 `std::thread::spawn`
- 재귀 walker (`max_depth` 5 기본)
- 심볼릭 링크 cycle 방지 (visited set)
- Tauri capabilities `fs:read` 설정

**Step 2: 청크 스트리밍 IPC**
- `emit('node_chunk', chunk)` Tauri event
- 1,000개 단위 청크 (조정 가능)
- JSON 청크로 시작 (Binary IPC는 M6-1 끝 또는 M7 카드)
- 청크 데이터: `NodeId/path/kind/sizeBytes/createdAt/modifiedAt` + 임시 3D 좌표 (랜덤 분산)

**Step 3: 통합 + 단위 테스트 + 커밋**

### M6-2 "Frontend Ingestion" (Frontend)

**Step 1: 청크 수신 + nodeBuffer 점진 병합**
- `listen('node_chunk', handler)`
- InstancedMesh capacity 동적 확장 (또는 10000으로 키움)
- `bridge.idToIndex` 점진 업데이트

**Step 2: 렌더링 + 회귀 검증**
- 청크마다 `instanceMatrix.needsUpdate`
- 60fps 유지 측정 (Stats.js 또는 `console.time`)
- M4 히트테스트 + M5 메타패널 정상 작동

**Step 3: 통합 + 시각 확인 + 커밋**

---

## M6 범위 밖 (M7+ 미룸)

- `notify` crate FS Watcher → M7+ 독립 마일스톤
- SQLite 영속성 → M7+ 사용자 커스텀 메타 등장 시
- CRUD (create/update/delete) → M7+ Read 안정 후
- 호버링 + GPU Color Picking → M7+ 노드 많아진 후
- 의미 있는 3D 좌표 알고리즘 (디렉토리 트리 → 클러스터) → M7+ 시각 카드
- Binary IPC (`Vec<u8>`) → 측정 후 M6-1 끝 또는 M7 전환

---

## 리스크

1. **InstancedMesh capacity** — Day 1에 3으로 하드코딩. 동적 확장 또는 10000으로 키워야 함. M6-2 Step 1 초반에 결정.
2. **재귀 깊이 + 심볼릭 링크** — 무한 루프 위험. 처음부터 안전장치.
3. **Tauri FS 권한** — `capabilities/main.json` (또는 해당 파일) 설정. 누락 시 권한 에러.
4. **JSON 직렬화 비용** — 청크당 1,000개. 실측 후 Binary IPC 전환 결정.
5. **청크 사이 race condition** — 빠르게 도착하는 청크 순서 보장? 우리 구조는 append-only라 순서 무관 가능.

---

## 선행 조건 (M5까지 완료됨)

- `tauri-specta` 인프라 → M6 commands에도 적용
- Stale Request Discard 패턴 → 적용 가능
- TypedArray + Zustand 이중 아키텍처 → 청크 병합 자연
- M4 히트테스트 + M5 메타패널 → 회귀 0 검증 대상

---

## 향후 확장 메모

- **Binary IPC**: 청크 페이로드를 `Vec<u8>` → `Uint8Array` zero-copy 전송 (M6-1 끝 또는 M7)
- **디렉토리 트리 의미 매핑**: 깊이 기반 거리, 형제 그룹화 (M7+)
- **Watcher (`notify`)**: 디렉토리 변경 자동 감지 (M7+)
- **CRUD**: Read 안정화 후 write (M7+)
