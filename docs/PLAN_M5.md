# PLAN_M5 — "First Meaning"

## 목표

사용자가 선택한 노드의 메타데이터(이름, 경로, 타입, 크기, 수정일)를 UI 패널에서 본다.

## 성공 기준

- 노드 3개에 하드코딩 메타데이터 부여 (Rust 메모리 HashMap)
- 좌클릭 → 하이라이트 + 메타데이터 패널에 해당 노드 정보 표시
- 다른 노드 클릭 → 패널 내용 갱신 (Stale Request 방지)
- 빈 공간/ESC → 패널 숨김
- tauri-specta로 타입 세이프 IPC 바인딩 생성
- 팬/줌/회전/선택 모두 기존대로 작동
- 테스트 전부 통과 (Rust cargo test + Frontend vitest)

## Step 구성 (3개)

### Step 1: Rust 기반 + tauri-specta IPC 통신

- `src-tauri/src/ipc_types.rs`:
  * `NodeDetails` 구조체 (id/name/path/kind/sizeBytes/createdAt/modifiedAt)
  * `#[serde(rename_all = "camelCase")]` 필수
  * `NodeKind` enum (File/Directory/Link/Memo)
- `src-tauri/src/commands.rs`:
  * `get_node_details(id: String) -> Result<Option<NodeDetails>, String>`
  * 하드코딩 HashMap (UUID v7 3개에 각각 가짜 메타)
- `src-tauri/Cargo.toml`: tauri-specta 의존성 추가
- `src-tauri/src/main.rs`: collect_types! 매크로로 bindings 파일 생성 설정
- 자동 생성: `src/lib/bindings.ts` (tauri-specta 결과물)
- Frontend: bindings.ts에서 타입 세이프 getNodeDetails import만 하면 됨 (수동 래핑 X)
- 테스트:
  * Rust: cargo test (NodeDetails serde round-trip, get_node_details 3개 ID + 없는 ID)
  * Frontend: bindings 타입 컴파일 확인 (tsc --noEmit)

### Step 2: Frontend 메타데이터 상태 + 패널 UI

- `src/state/store.ts`:
  * `selectedNodeDetails: NodeDetails | null` 필드 추가 (옵션 α — 단일 필드)
  * `setNodeDetails(details)` action
- `src/state/nodeDetailsSync.ts` 신규 (또는 적절한 위치):
  * store.selectedNodeId 구독 (subscribeWithSelector)
  * 변경 시 getNodeDetails 호출
  * Stale Request Discard: 응답 시점에 store.getState().selectedNodeId === 요청 id 확인 후에만 setNodeDetails
- `src/ui/NodeDetailsPanel.tsx` 신규:
  * props: details: NodeDetails | null
  * 이름, 경로 (truncate), 타입 (라벨), 크기 (포맷팅 "1.2 KB"), 수정일 (Date 변환)
  * null 시 숨김 or "선택된 노드 없음"
- `src/ui/App.tsx`: 패널 배치 (우측 상단 또는 하단, 기존 좌상단 정보 박스와 겹치지 않게)
- 테스트:
  * store: setNodeDetails 동작 확인
  * nodeDetailsSync: selectedNodeId 변경 시 IPC 호출, stale response 무시 확인 (mock)
  * NodeDetailsPanel: 각 필드 렌더링

### Step 3: 통합 + 시각 확인 + 커밋

- 기존 M4 기능 전부 여전히 작동 확인
- 새 기능:
  * 좌클릭 → 하이라이트 + 패널 표시
  * 다른 노드 클릭 → 패널 갱신 (race 없음)
  * 빈 공간/ESC → 패널 숨김
- tauri dev 시각 확인
- 커밋: feat(m5): Rust IPC + 메타데이터 패널 (First Meaning)

## M5 범위 밖 (미룸)

- SQLite 영속성 → M6
- 실제 FS 스캔 (notify crate) → M6 이후
- CRUD (create/update/delete) → M6+ (지금은 read만)
- 캐시 Map (옵션 β) → M6 리팩터
- 호버링 프리뷰 → M7+
- Binary IPC (Vec<u8>) → M6+ 대량 데이터 시
- Billboarding Shader → M7+

## 리스크

1. **tauri-specta 도입 마찰**: 처음 세팅은 복잡. Step 1 초반에 검증 후 진행.
2. **snake_case ↔ camelCase**: serde `rename_all = "camelCase"` 누락 시 frontend에서 undefined.
3. **Stale request race**: Gemini 제안 ID 매칭 패턴 (AbortController 불필요).
4. **Rust 첫 빌드 시간**: Day 1에 1m 44s 걸렸음. tauri-specta 추가로 더 걸릴 가능성. 시각 확인까지 여유 시간 확보.
5. **패널 UI 위치**: 기존 좌상단 정보 박스와 충돌 안 나게. 우측 상단 또는 하단 고려.

## 선행 조건 (M4까지 완료됨)

- selectedNodeId Zustand 상태 → 구독으로 IPC 트리거
- bridge.idToIndex → UUID v7 직접 사용 가능 (Buffer Index 변환 불필요)
- InstancedMesh 렌더링 + 단일 하이라이트 메시 → UI 패널만 추가

## 향후 확장 메모

Gemini Pro 옵션 4 (Binary IPC Vec<u8>):
- M5 범위 밖이지만 M6+ 성능 최적화 핵심 카드
- 10만 노드 초기 로드, 대량 메타 업데이트 시 JSON 직렬화 병목
- Rust에서 Vec<u8> → JS Uint8Array/ArrayBuffer 복사 오버헤드 최소화 전송
- 적용 시점: 실측 성능 병목 발생 또는 1k+ 노드 시나리오

## 검증 과정 (기록)

웹 Claude 초안 → Gemini Pro 자문(웹) → 웹 Claude Planner 메타리뷰 → 사용자 승인 (4번째 재현).

Gemini Pro 핵심 기여:
- invoke (Request-Response) 권장: 사용자 주도 액션
- tauri-specta 강력 추천: 타입 세이프 TS 클라이언트 자동 생성 (ts-rs보다 강력)
- u64/i64 → JS number 안전성 보장: 9PB/300000년 경계, BigInt 변환 불필요
- Unix ms (u64) 타임스탬프 권장: 페이로드/파싱/정렬 모두 우위
- Stale Request Discard 패턴: AbortController보다 가벼움, 응답 시점 ID 매칭
- 옵션 4 (Binary IPC Vec<u8>): M6+ 대량 데이터 전송용 카드로 기록

Planner 메타리뷰:
- Gemini 기술 선택 전부 채택
- 메타데이터 상태 구조: 옵션 α (Zustand 단일 필드) 시작 → β (캐시 Map) 승격은 M6+
- 리스크 지적: snake_case ↔ camelCase (serde rename_all 필수), tauri-specta 도입 마찰 (Step 1에서 먼저 세팅)
