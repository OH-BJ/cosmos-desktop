# cosmos-desktop — 마일스톤 1 Plan

> `/clear` 이후에도 살아남도록 저장된 첫 마일스톤 실행 계획.
> 작성: 2026-04-14, Tech Lead 승인 by Product Owner.

---

## 목표
"앱이 빈 우주 공간을 띄우고 노드 1개를 표시한다"까지를 첫 마일스톤.
Tauri + three.js + 이중 상태의 **최소 골격**만.

## 분배 전략
스캐폴딩은 두 레이어가 명확히 갈리므로 frontend/backend **병렬**,
그 다음 Tech Lead가 통합, 마지막에 QA가 스모크 테스트.
Planner는 이 단계에선 호출 안 함.

---

## Step 1 — Tech Lead 단독 (에이전트 호출 X)

- `git init`, `.gitignore` (Tauri/Rust/Node 표준)
- `npm create tauri-app@latest` 실행 → React + TS 템플릿 선택
- `package.json`, `Cargo.toml`, `tauri.conf.json` 사용자에게 보여주고 확인
- 빈 `docs/`, `tests/unit/`, `tests/e2e/` 디렉터리 생성
- `.env.example` 생성 (현재는 비어 있어도 됨)
- `README.md` 한 줄짜리 placeholder

**산출물:** 빌드 가능한 빈 Tauri 앱

---

## Step 2 — Frontend/Backend 병렬 호출

### Frontend Agent 위임
- `src/canvas/Scene.ts` — three.js Scene/Camera (orthographic, 잠금)/Renderer 셋업
- `src/canvas/nodes/InstancedNodes.ts` — InstancedMesh 1개 + 더미 노드 1개
- `src/state/nodeBuffer.ts` — TypedArray 레이아웃 정의 + 빈 버퍼 초기화
- `src/state/store.ts` — Zustand 빈 store + 타입 정의
- `src/state/bridge.ts` — 이벤트 브릿지 인터페이스만 (구현은 다음 마일스톤)
- `src/ui/App.tsx` — Canvas 컴포넌트 마운트 + 빈 UI 셸
- 한국어 주석 + 3D/WebGL 개념 설명 의무

### Backend Agent 위임
- `src-tauri/src/safety/path.rs` — 경로 검증 화이트리스트 인터페이스 (구현은 stub)
- `src-tauri/src/db/mod.rs` — SQLite 연결 셋업 + 노드 테이블 마이그레이션 1개 (`nodes(id, path, x, y, z)`)
- `src-tauri/src/commands/mod.rs` — `get_nodes() -> Vec<Node>` command 1개 (현재는 SQLite에서 빈 리스트 반환)
- `src-tauri/src/ipc_types.rs` — `Node` struct (serde + TS 호환)
- `tauri.conf.json` — `tauri-plugin-sql` 등록
- 한국어 주석 + Rust 개념 설명 의무

---

## Step 3 — Tech Lead 통합

- 두 에이전트 결과물 확인, 충돌/누락 해결
- IPC 타입 일치 확인 (Rust `Node` ↔ TS `Node`)
- `npm run tauri dev` 실행해서 앱 띄움
- 빈 우주 + 노드 1개 보이는지 직접 확인
- 사용자에게 스크린샷/콘솔 로그 보고

---

## Step 4 — QA Agent 호출

- 빌드 통과 검증 (dev 빌드만)
- TypeScript/Rust 타입 체크 통과
- Vitest + `cargo test` 셋업 동작 확인
- IPC `get_nodes`가 빈 배열 반환하는지 단위 테스트 1개
- 한글 경로 의식 체크

---

## Step 5 — 사용자 승인 → 첫 커밋

- `feat: cosmos-desktop 초기 스캐폴딩` 단일 커밋
- 본문에 `ARCHITECTURE.md` 링크 + 마일스톤 설명

---

## 이번에 안 하는 것 (의식적 제외)

- MSDF 폰트 (골격에 불필요, 다음 마일스톤)
- rbush (노드 1개라 불필요)
- 카메라 팬/줌 (다음 마일스톤)
- 실제 FS 감시 (notify 스켈레톤만, 동작은 다음)

---

## 환경 확인

- `rustc 1.94.1` ✅
- `node v24.14.1`, `npm 11.12.1` ✅
- `git 2.51.1.windows.1` ✅
- 첫 빌드 시간 OK ✅

---

## M3 — "First Dimension" (카메라 줌 + 회전)

선정 경로: 웹 Claude 추천. M1 "First Light" → M2 "First Interaction" → M3 "First Dimension" 서사 연결.

목표: OrthographicCamera 줌(휠) + 회전 도입. PerspectiveCamera 전환 검토. "진짜 3D 우주" 감각 완성.

범위 (예비, Plan 수립은 M3 착수 시):
- 휠 줌인/아웃
- Alt+드래그 또는 우클릭 드래그로 회전
- 카메라 모드 전환 (Orthographic ↔ Perspective) 검토
- 노드 크기 줌 레벨 따라 보정

M3 진입 시 할 일:
1. Gemini Pro 재자문 (PerspectiveCamera 전환 타이밍, 성능 영향)
2. Planner 메타리뷰
3. Plan 수립 → Step 3개 권장 (M2처럼)

선행 조건:
- 현재 bridge.ts 전량 재작성 방식 유지 OK (노드 10개 스케일)
- diff 동기화는 M4로
