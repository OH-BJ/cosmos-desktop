# M2 진입 조건 (Enter Criteria)

> 이 문서는 **M2 스프린트를 시작하기 전에 합의되어 있어야 하는** 설계 결정들의 목록이다.
> Day 2 Review Day (2026-04-15) 결과, 아래 5가지를 M1 마무리 시점에서 확정하지 않으면
> M2 코드가 쌓일수록 리팩터 부담이 기하급수로 커지는 것으로 판단됐다.
>
> 각 항목은 **M2 첫 세션에서 planner 서브에이전트와 함께 검토** 후 확정한다.
> 확정되면 이 문서를 `docs/M2_DECISIONS.md` (또는 `ARCHITECTURE.md` 갱신) 로 승격한다.

---

## 1. ID 타입 전략 (Rust UUID String ↔ TS Uint32Array)

**문제:**
- `src-tauri/src/ipc_types.rs` 의 `Node.id: String` (UUID 계획) 과
- `src/state/nodeBuffer.ts` 의 `ids: Uint32Array` (고빈도 버퍼) 사이에
- 브리지가 없다. 현재 `src/state/bridge.ts` 는 `node.id.charCodeAt(0)` 로 첫 글자의
  코드포인트만 취하는 **임시 구현**이라, 2개 이상의 노드를 로드하는 순간 ID 충돌이 발생한다.

**왜 M2 시작 전에 합의되어야 하는가:**
이 결정이 ipc_types, bridge, nodeBuffer, Rust 측 DB 스키마, 히트테스트 로직 전부에 영향을 준다.
M2 중반에 바꾸면 이미 쌓인 코드가 전부 손봐야 함.

**검토할 선택지:**

- **A안) Rust가 `u32` 시퀀셜 ID를 발급.**
  - 장점: TS 고빈도 버퍼(Uint32Array)와 타입 일치. 변환 레이어 불필요.
  - 단점: 노드 삭제/재생성 시 ID 재사용 문제. 사용자 간 DB 공유 시 충돌.

- **B안) Rust는 UUID String 유지, TS에 `Map<string, u32>` 매핑 레이어.**
  - 장점: 전역 고유성. DB 이식성. 현재 스키마 유지.
  - 단점: 매핑 관리 비용. Zustand ↔ nodeBuffer 동기화 시 양쪽 참조 필요.

- **C안) Rust가 `u64` (FNV 또는 xxhash32) 해시 필드를 **추가로** 제공.**
  - 장점: UUID는 정체성, u32/u64는 인덱스. 양쪽 장점 결합.
  - 단점: 필드가 두 개 → 직렬화 페이로드 증가.

**합의 필요 사항:** A/B/C 중 하나 선택 + nodeBuffer의 `Uint32Array` → 다른 타입 전환 여부(`Uint32Array` 대신 `BigUint64Array`?).

---

## 2. 고빈도/저빈도 동기화 규약 (`bridge.ts` 의 정확한 인터페이스)

**문제:**
- 현재 `syncFromStore(nodes, buffer)` 는 매 호출마다 **모든 노드를 다시 쓴다** (count=0으로 리셋 후 전체 push).
- `setupStoreSynchronization()` 는 빈 함수 — 누가 언제 어디서 이걸 호출하는지 정의되지 않음.
- ARCHITECTURE.md §3-4 에 "렌더 루프에서 Zustand `getState()` 호출 금지" 라고 못박았지만,
  반대 방향(Zustand 변경 → 렌더 루프가 볼 수 있어야 함)의 채널은 아직 없음.

**왜 M2 시작 전에 합의되어야 하는가:**
M2 핵심 작업이 "IPC로 받은 노드를 화면에 그리기" 이므로, 이 규약이 없으면 작업을 시작조차 할 수 없다.

**합의 필요 사항:**

- **트리거 시점:** Zustand `nodes` 배열이 변경되면 → 어떤 메커니즘으로 bridge가 호출되는가?
  - 후보 1: `useCosmosStore.subscribe(selector, handler)` 에서 TypedArray 업데이트.
  - 후보 2: IPC 핸들러가 Zustand와 nodeBuffer를 **동시에** 업데이트.
- **동기화 모드:** 전량 재작성 vs diff-based (추가/삭제/갱신만 반영).
  - M2 초반은 전량 재작성 OK, 노드 수가 1k 넘는 시점에서 diff 전환.
- **호출 스레드:** bridge는 **렌더 루프 바깥** 에서만 호출 (메인 스레드의 React 업데이트 콜백).
  - 렌더 루프는 TypedArray를 **읽기만** 한다 (원칙 재확인).
- **InstancedNodes 연결:** bridge가 TypedArray를 채운 직후, InstancedNodes의 setMatrixAt + instanceMatrix.needsUpdate 를 트리거하는 **단일 진입점** 함수.

---

## 3. FS sync IPC 계약 (notify → Rust → TS 이벤트 흐름)

**문제:**
- ARCHITECTURE.md §5-3 에 "notify 이벤트 → 디바운스 → IPC event → 프론트엔드" 가 기술되어 있다.
- 현재 Rust 측에 notify 감시 코드가 **전혀 없음** (watcher/ 폴더 미생성).
- Tauri event API 를 쓸지, command polling 을 쓸지도 결정 안 됨.

**왜 M2 시작 전에 합의되어야 하는가:**
FS sync 는 M2 의 가장 큰 기능 중 하나. IPC 타입(event payload 스키마)이 확정되지 않으면 frontend/backend 가 병렬로 일할 수 없다.

**합의 필요 사항:**

- **이벤트 채널:** Tauri `emit` / `listen` API 사용 (커맨드 polling 제외).
- **이벤트 이름 규약:** `fs://change`, `fs://rescan`, `fs://error` 같은 scheme.
- **Payload 스키마 초안 (Rust struct + serde):**
  ```rust
  #[derive(Serialize)]
  pub struct FsChangeEvent {
      pub kind: FsChangeKind, // Created / Modified / Removed / Renamed
      pub paths: Vec<String>,
      pub batch_id: u64,      // 디바운스 윈도우 식별
  }
  ```
- **디바운스 윈도우:** 100ms 기본값 (ARCHITECTURE.md §3-5 의 리스크 대응).
- **Rescan fallback 트리거:** Windows `ReadDirectoryChangesW` 버퍼 오버플로우 감지 시 `fs://rescan` 발사.
- **TS 측 구독 지점:** App.tsx 마운트 시 한 번 + dispose 시 `unlisten`.

---

## 4. `validate_path` 호출부 연결 계획

**문제:**
- `src-tauri/src/safety/path.rs::validate_path` 는 정의되어 있고 단위 테스트도 있지만, **실제 어느 command 에서도 호출되지 않는다** (dead_code). Review Day 에서 확인됨.
- M2 에 쓰기 계열 command(파일 생성/이동/삭제, 노드 좌표 저장)가 들어오면 **모두** 이 함수를 감싸야 한다. 하나라도 빼먹으면 시스템 디렉터리 공격 경로가 열린다.

**왜 M2 시작 전에 합의되어야 하는가:**
"어느 command 가 validate_path 를 불러야 하는가" 가 정의되지 않으면 **어느 command 가 그것을 빼먹었는지** 감사(audit)할 수 없다. 체크리스트를 먼저 만들어야 한다.

**합의 필요 사항:**

- **필수 호출 대상 command 목록 (M2 예상):**
  - `upsert_node(path, x, y, z)` — 노드 좌표 저장 (path 는 사용자가 드래그로 어디에 놓았는지 기록)
  - `create_memo(path, content)` — 메모 파일 생성
  - `delete_node(id)` — DB 행 삭제 (path 확인 후 trash crate 경유)
  - `move_file(from, to)` — 파일 이동
  - `scan_directory(root)` — FS 재귀 스캔 시작점
- **호출 패턴:** 각 command 진입부 첫 줄에 `validate_path(Path::new(&input_path))?;` 호출. 그 외 분기 허용 안 함.
- **테스트 정책:** 각 command 에 "시스템 디렉터리 입력 시 `SafetyError` 반환" 네거티브 테스트 필수.
- **주석 규약:** validate_path 호출 줄 위에 "// SAFETY: CLAUDE.md §7 규칙 — 쓰기 command 는 반드시 경로 검증 후 진행" 주석 고정.
- **의존성:** `canonicalize()` 는 **실존 파일만** 정규화 가능하므로, 생성 시나리오(아직 존재하지 않는 경로)에서는 부모 디렉터리를 canonicalize 하는 별도 분기가 필요 — 이것도 M2 에서 함수 시그니처 분리할지 결정.

---

## 5. CSP 정책 초안 (M3 확정, M2 에서는 방향성만)

**문제:**
- `src-tauri/tauri.conf.json` 의 `security.csp` 가 `null` (완전 비활성화).
- ARCHITECTURE.md §3-1 에 "Tauri 는 기본부터 allowlist 기반 보안" 이라 써 놓고 CSP 를 꺼놓은 상태는 자기모순.

**왜 M2 시작 전에 방향성만 합의되어야 하는가:**
M3 성능 튜닝 단계에서 CSP 를 갑자기 켜면 외부 폰트/이미지 로드, WebGL 셰이더 inline 등이 깨질 수 있다. M2 에서 코드를 쓸 때 **미리** CSP 제약을 의식하면 M3 전환이 매끄럽다.

**합의 필요 사항 (방향성만):**

- `default-src 'self'` 기본
- `script-src 'self'` — inline 스크립트 금지, eval 금지
- `style-src 'self' 'unsafe-inline'` — three.js/React 는 inline 스타일 쓰는 경우가 있음. 필요 시 nonce 기반으로 전환.
- `img-src 'self' data: blob:` — 노드 썸네일 locally 생성
- `connect-src 'self' ipc: https://ipc.localhost` — Tauri IPC 허용
- `font-src 'self' data:` — MSDF 폰트 atlas
- `worker-src 'self' blob:` — Web Worker (나중에 공간 인덱스 백그라운드 연산용)

**M2 작업자 주의:**
- 외부 CDN 에서 스크립트/폰트/이미지 로드 금지.
- `eval()`, `new Function()`, `innerHTML = "<script>..."` 사용 금지.
- three.js 셰이더는 GLSL 문자열 → `ShaderMaterial` 경유로만 사용 (inline script 아님, CSP 영향 없음).

---

## 검토/확정 프로토콜

M2 첫 세션에서:

1. Tech Lead 가 이 문서를 읽고, 각 항목에 대해 **현재 생각하는 디폴트** 를 쓴다.
2. planner 서브에이전트에게 "이 디폴트를 비판적으로 검토해줘" 요청.
3. 필요하면 Gemini MCP 에 거시 관점 자문 (Flash 모델).
4. 사용자(OH-BJ) 가 최종 결정.
5. 결정 내용을 `docs/ARCHITECTURE.md` §3 의사결정 로그에 반영하고, 이 파일은 `docs/_archived/M2_ENTER_CRITERIA_resolved.md` 로 이동.

---

*작성: 2026-04-15 — Day 2 Review Day Phase 6 통합 리포트 결정 3 (사용자 승인)*
*리뷰어 출처: Gemini Flash, Frontend·Backend·QA 서브에이전트, Planner 서브에이전트*
