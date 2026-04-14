# cosmos-desktop — Architecture

> 프로젝트 아키텍처 개요와 의사결정 로그.
> 이 문서는 신규 합류자(또는 미래의 나)가 "왜 이렇게 만들었는지"를 30분 안에 파악할 수 있도록 작성한다.
> 코드 자체는 변하지만, **결정의 맥락**은 여기 남는다.

---

## 1. 프로젝트가 뭐고 왜 만드는가

**cosmos-desktop** 은 기존 OS 파일 탐색기를 대체하는 **무한 줌 가능한 2D/3D 우주 캔버스 데스크톱 앱**이다.

### 풀려는 문제

기존 파일 탐색기는 다음과 같은 한계가 있다:

1. **트리 + 리스트 구조에 갇힌 시각화** — 파일이 많아질수록 탐색이 선형적으로 느려진다.
2. **공간 기억(spatial memory)을 활용하지 못한다** — 사람은 "어디 있었지"를 기억하는 데 강한데, 트리 UI는 이걸 못 살린다.
3. **프로젝트 단위로 묶기 어렵다** — 폴더 이동 = 실제 파일 시스템 변경. 가볍게 "시각적으로만" 묶을 수 없다.
4. **파일 + 메모 + 링크가 분리되어 있다** — 같은 작업 맥락의 자료가 흩어진다.

### 해결 방식

- 파일/링크/메모를 **무한 3D 공간에 자유 배치**한다.
- 프로젝트별로 **"행성(클러스터)"** 를 만들어 관련 파일을 가까이 모은다.
- **줌아웃** 시 별자리처럼 전체 구조가 보이고, **줌인** 시 개별 파일을 직접 조작한다.
- 시각적 좌표는 메타데이터일 뿐, **실제 파일 시스템 경로와 양방향 매핑**된다.
- 파일 시스템에서 변화가 생기면 (외부 도구가 만든 파일 등) **실시간으로 캔버스에 반영**된다.

### 비목표 (Non-goals)

- 클라우드 스토리지 동기화 (적어도 v1에서는)
- 멀티 유저 협업
- 모바일 / 웹 버전
- 파일 내용 인덱싱(=검색엔진 기능). 메타데이터 검색만 한다.

### 성공 기준

이 프로젝트는 **포트폴리오 + 실사용** 양쪽 목적이다. "내가 매일 쓰고 싶은 수준"이 품질 기준.

- 60fps @ 10,000 노드 / 최소 30fps @ 100,000 노드
- 초기 메모리 < 150MB, 노드 10k 로드 < 500MB
- 1시간 사용 메모리 누수 없음
- Windows + macOS 동작
- 한글/이모지 파일명 무결성

---

## 2. 최종 기술 스택

| 레이어 | 선택 | 대안 (검토함) |
|---|---|---|
| 데스크톱 프레임워크 | **Tauri 2.x** | Electron, Neutralino |
| 백엔드 언어 | **Rust** | Node.js (Electron이면) |
| 렌더러 | **three.js (순수)** | PixiJS, Canvas2D, 순수 WebGL, react-three-fiber |
| UI 프레임워크 | **React** | Solid, Svelte |
| 상태 관리 | **Zustand + TypedArray (이중)** | Jotai, Valtio, Redux Toolkit |
| 파일 감시 | **notify (Rust crate)** | chokidar (Node), polling |
| 지속성 | **SQLite (`tauri-plugin-sql`)** | JSON 파일, IndexedDB |
| 공간 인덱스 | **rbush (R-Tree)** | quadtree, KD-tree, brute force |
| 텍스트 렌더링 | **MSDF bitmap font** | three.js `Text`(troika), DOM overlay |
| 빌드 도구 | Vite (Tauri 기본) | — |
| 언어 | **TypeScript + Rust** | — |
| 플랫폼 | **Windows + macOS** (Linux는 추후) | — |

---

## 3. 의사결정 로그

### 3-1. Electron vs Tauri → **Tauri** ✅

**왜:**
- 번들 크기: Tauri ~10MB vs Electron ~150MB. 데스크톱 앱 1차 인상에 큼.
- 런타임 메모리: Tauri는 OS 웹뷰(WebView2/WKWebView)를 재사용 → 베이스라인이 훨씬 가볍다.
- Rust 백엔드는 파일 시스템 작업(이 앱의 핵심)에서 Node.js보다 압도적으로 안전 + 빠르다.
- 보안 모델이 기본부터 엄격(allowlist 기반).

**리스크:**
- Rust 학습 곡선. → **AI가 코드를 작성하므로 사용자 부담 적음. 사용자는 코드를 읽고 개념을 이해하는 수준이면 충분.**
- 웹뷰 호환성: Tauri는 OS 내장 웹뷰를 쓰므로 Windows(WebView2 = Edge Chromium)와 macOS(WKWebView = Safari) 동작이 다를 수 있음. → three.js + WebGL2 기준으로 둘 다 지원되므로 OK.
- macOS Safari 웹뷰는 Chrome보다 일부 신기능 지연 → 사용 기능은 안전한 베이스라인으로 제한.

### 3-2. 렌더러: PixiJS vs three.js → **three.js** ✅

**왜:**
- 처음부터 **3D 아키텍처**를 채택. 초기 MVP는 2D처럼 보이지만, 카메라만 잠가둔 3D 씬이다.
- 향후 "행성 클러스터를 진짜 3D 구체로 표현", "카메라 회전으로 다른 각도에서 보기" 같은 확장이 자연스럽다. PixiJS로 시작하면 이 확장이 사실상 재작성이다.
- three.js의 `InstancedMesh`, `Points`, raycasting, 머터리얼 시스템은 대량 노드 렌더링에 잘 맞는다.
- 생태계가 가장 크다 → 막혔을 때 답이 있을 확률이 높다.

**왜 react-three-fiber는 안 쓰는가:**
- R3F는 three.js 객체를 React 가상 DOM 트리에 묶는다. 노드 10만 개에서 reconciliation이 병목이 된다.
- 이 프로젝트는 **React를 UI 셸**(메뉴, 패널, 모달)에만 쓰고, 캔버스는 React 밖에서 직접 three.js로 그린다. 두 세계를 명확히 분리.

### 3-3. 2D vs 3D → **3D 아키텍처 + 카메라 잠금 MVP** ✅

**왜:**
- 처음부터 3D로 짓되, 초기에는 카메라를 top-down orthographic으로 잠가서 사용자 입장에서는 2D처럼 동작.
- 나중에 **카메라 컨트롤 토글만 풀면** 3D 모드. 아키텍처 재작성이 아니다.
- 좌표는 처음부터 `Vec3`으로 저장하고, z축은 초기에 0 또는 카테고리별 살짝 다른 값으로 둔다.

### 3-4. 상태 관리: Zustand + TypedArray 이중 구조 ✅

**왜 단순한 Zustand 단일 구조가 아닌가:**
- 카메라 transform, 노드 위치, 애니메이션 진행도, 뷰포트 bounds는 **프레임마다(60Hz)** 변한다.
- 이걸 Zustand 같은 React-친화 store에 넣으면 매 프레임 React reconciliation이 발생 → 60fps 불가능.

**해결책 — 이중 구조:**

| 구분 | 저장소 | 예시 | 누가 읽는가 |
|---|---|---|---|
| **고빈도 상태** | `Float32Array` / `Uint32Array` (모듈 스코프) | 노드 위치 `[x,y,z, x,y,z, ...]`, 카메라 행렬, 애니메이션 진행도 | three.js 렌더 루프가 직접 |
| **저빈도 상태** | Zustand store | 선택된 노드 ID, 열린 메뉴, 모달, 사용자 설정, 테마 | React 컴포넌트가 구독 |

- 두 상태가 동기화될 필요가 있을 때(예: 노드 클릭 → 선택 상태 변경)는 **명시적 이벤트 브릿지**로 처리.
- Zustand `getState()`를 렌더 루프 안에서 호출하지 않는다. 안티패턴.

상세는 추후 `docs/STATE.md` 에서.

### 3-5. 파일 감시: notify (Rust) ✅

**왜:**
- Tauri 백엔드를 쓰는 이상 자연스러운 선택.
- OS 네이티브 감시 API (Windows: ReadDirectoryChangesW, macOS: FSEvents)를 통합 추상화.
- chokidar(Node) 대비 수만 파일 규모에서 안정적.

**리스크 / 대응:**
- Windows의 `ReadDirectoryChangesW`는 **버퍼 오버플로우** 가능 → notify가 `Error::Rescan` 이벤트를 emit할 수 있음. 반드시 핸들링하고 **전체 디렉터리 재스캔 fallback** 을 준비한다.
- 대량 이벤트 폭풍(git checkout, npm install 같은 상황) → **디바운스 + 배치**로 모아서 프론트엔드에 전달. 이벤트 하나당 IPC 호출 금지.

상세는 추후 `docs/FS_SYNC.md` 에서.

### 3-6. 지속성: SQLite (tauri-plugin-sql) ✅

**저장하는 것:**
- 노드 좌표 (파일 경로 ↔ Vec3)
- 사용자가 만든 클러스터/행성 메타데이터
- 사용자 설정 (테마, 카메라 기본값 등)
- 캐시: 썸네일, 파일 메타 (mtime/size 등)

**왜 SQLite인가:**
- 파일 경로 인덱싱, 좌표 범위 쿼리 등 관계형 쿼리가 자연스럽다.
- 트랜잭션이 있어 데이터 무결성 보장.
- 단일 파일 → 백업/이전 쉬움.
- `tauri-plugin-sql` 로 Rust ↔ TS 양쪽 접근.

### 3-7. 공간 인덱스: rbush (R-Tree) ✅

**왜:**
- 히트테스트(클릭한 좌표에 어떤 노드가 있나)와 뷰포트 컬링(현재 카메라에 보이는 노드만 그리기)에 둘 다 R-Tree가 적합.
- 노드 10만 개에서 선형 탐색 = 절대 불가. R-Tree는 O(log N).
- rbush는 JS 생태계에서 사실상 표준, 잘 검증됨.

**대안:**
- Quadtree: 2D 전용 → 나중에 3D 확장 시 재작성 필요.
- KD-tree: 정적 데이터에 강함. 노드 위치가 자주 바뀌는 우리 케이스엔 R-Tree가 더 낫다.

### 3-8. 텍스트 렌더링: MSDF bitmap font ✅

**왜 이게 진지한 결정인가:**
- 노드마다 파일 이름 라벨이 필요. 노드가 10만 개면 라벨도 10만 개.
- three.js의 troika-three-text 같은 라이브러리는 노드당 별도 mesh + 텍스처 → 즉시 VRAM 폭발.
- **MSDF (Multi-channel Signed Distance Field) bitmap font** 는 **단일 텍스처 + InstancedMesh**로 수만 개 글자를 렌더링해도 1드로우콜에 가깝게 처리 가능.
- 줌 레벨 변화에도 글자가 선명하게 유지됨 (SDF의 핵심 장점).

---

## 4. 시스템 다이어그램

### 4-1. 전체 구조

```mermaid
flowchart TB
    User[사용자]

    subgraph Frontend["Frontend (TypeScript, WebView)"]
        UI[React UI Shell<br/>메뉴, 패널, 모달]
        Canvas[Canvas Layer<br/>three.js Scene]
        State[State Layer<br/>Zustand + TypedArray]
        Spatial[rbush 공간 인덱스]
    end

    subgraph Backend["Backend (Rust, Tauri)"]
        Cmd[Tauri Commands<br/>IPC 핸들러]
        Watcher[FS Watcher<br/>notify crate]
        DB[SQLite Layer<br/>tauri-plugin-sql]
        Safety[Path Safety<br/>화이트리스트 검증]
    end

    OS[OS File System]
    SQLiteFile[(cosmos.db)]

    User --> UI
    User --> Canvas
    UI <--> State
    Canvas <--> State
    Canvas <--> Spatial
    State <-->|"IPC<br/>(commands)"| Cmd
    State <--|"IPC events<br/>(FS 변경 알림)"|--Cmd

    Cmd --> Safety
    Safety --> Watcher
    Safety --> DB
    Watcher --> OS
    DB --> SQLiteFile
    Watcher -.이벤트.-> Cmd
```

### 4-2. 주요 모듈 구조 (예정)

```
cosmos-desktop/
├── src/                          # Frontend (TypeScript)
│   ├── main.tsx                  # 진입점
│   ├── ui/                       # React UI 셸
│   │   ├── App.tsx
│   │   ├── components/           # 메뉴, 패널, 모달
│   │   └── hooks/                # Zustand 구독 훅
│   ├── canvas/                   # three.js 캔버스 레이어
│   │   ├── Scene.ts              # Scene/Camera/Renderer 셋업
│   │   ├── nodes/                # InstancedMesh 노드 렌더링
│   │   ├── camera/               # 카메라 컨트롤(2D 잠금/3D 토글)
│   │   ├── interaction/          # 팬/줌/클릭/드래그
│   │   ├── text/                 # MSDF 폰트 라벨
│   │   └── shaders/              # GLSL 셰이더
│   ├── state/                    # 상태 레이어
│   │   ├── store.ts              # Zustand store (저빈도)
│   │   ├── nodeBuffer.ts         # TypedArray (고빈도, 노드 transform)
│   │   ├── camera.ts             # 카메라 transform (TypedArray)
│   │   └── bridge.ts             # 두 상태 간 명시적 이벤트 브릿지
│   ├── spatial/                  # rbush 래퍼
│   ├── ipc/                      # Tauri IPC 클라이언트 + 타입
│   └── lib/                      # 공통 유틸 (좌표 변환 등)
│
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── main.rs               # Tauri 앱 진입점
│   │   ├── commands/             # IPC commands
│   │   ├── watcher/              # notify 기반 FS 감시
│   │   ├── db/                   # SQLite 스키마/쿼리
│   │   ├── safety/               # 경로 검증 (화이트리스트)
│   │   └── ipc_types.rs          # serde 타입 (TS와 공유)
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── docs/
│   ├── ARCHITECTURE.md           # 이 문서
│   ├── RENDERING.md              # 렌더링 전략 (추후)
│   ├── FS_SYNC.md                # FS 동기화 (추후)
│   └── STATE.md                  # 상태 아키텍처 (추후)
│
├── tests/
│   ├── unit/                     # Vitest 단위 테스트
│   └── e2e/                      # Playwright E2E
│
├── .claude/
│   ├── agents/                   # planner / frontend / backend / qa
│   └── settings.local.json
│
└── CLAUDE.md                     # Claude Code 작업 지침
```

---

## 5. 데이터 흐름 핵심 시나리오

### 5-1. 앱 시작 시
1. Tauri 앱 부팅 → 백엔드 초기화 → SQLite 연결 → 마지막 작업 디렉터리 로드.
2. 백엔드가 작업 디렉터리를 재귀 스캔 → 파일 목록 + 메타데이터를 SQLite와 비교 → 새/삭제 파일 정리.
3. 백엔드가 `notify` 감시 시작.
4. 프론트엔드 로드 → IPC로 노드 목록 + 좌표 일괄 fetch (페이지네이션) → TypedArray에 채움.
5. three.js Scene 초기화 → InstancedMesh로 노드 렌더 → 첫 프레임.

### 5-2. 사용자가 노드를 드래그할 때
1. raycast로 노드 hit (rbush로 후보 좁힘 → 정밀 raycast).
2. 드래그 중에는 TypedArray의 해당 노드 좌표만 매 프레임 갱신 → 즉시 반영, React 리렌더 0회.
3. 드래그 종료 시 한 번만 IPC로 백엔드에 좌표 저장 요청 → SQLite update.
4. rbush 인덱스 갱신.

### 5-3. 외부 도구가 파일을 추가했을 때
1. `notify` 가 파일 생성 이벤트 발사.
2. Rust 측에서 디바운스 윈도우(예: 100ms) 동안 이벤트 모음.
3. 윈도우 종료 후 IPC event로 프론트엔드에 배치 전달.
4. 프론트엔드: 새 노드 좌표 자동 배치(클러스터 근처에 배치하는 알고리즘) → TypedArray에 추가 → 인덱스 갱신 → 렌더.

---

## 6. 위험과 미해결 항목

| 위험 | 영향 | 현재 대응 | 미정 |
|---|---|---|---|
| Windows `notify` 버퍼 오버플로우 | FS 변경 누락 → 캔버스 stale | rescan fallback 의무화 | 디바운스 윈도우 길이 |
| MSDF 폰트 한글 글리프 (수천 자) | 텍스처 크기 폭발 | atlas page 분할 | 어떤 한글 폰트 쓸지 |
| WebView2 / WKWebView 호환 차이 | macOS에서 셰이더/기능 깨짐 | WebGL2 베이스라인 고수 | 둘 다에서 벤치마크 필요 |
| 파일 삭제 안전성 | 사용자 데이터 손실 | `trash` crate 경유 + 명시 확인 | 휴지통 복원 UX |
| 노드 100k에서 R-Tree 메모리 | 유저 머신마다 다름 | 측정 후 결정 | 청크 단위 lazy load? |
| 좌표 영구화 충돌 | 두 PC에서 같은 DB? | v1은 단일 머신 가정 | 동기화는 비목표 |

---

## 7. 향후 추가될 문서

- `docs/RENDERING.md` — three.js 씬 구조, InstancedMesh 패턴, LOD 전략, MSDF 셋업
- `docs/FS_SYNC.md` — notify 사용법, 디바운스 정책, rescan fallback 알고리즘, IPC 페이로드 스키마
- `docs/STATE.md` — TypedArray 레이아웃, Zustand 슬라이스, 두 상태 간 이벤트 브릿지 규약
- `docs/IPC.md` — Tauri commands 카탈로그, event 카탈로그, 타입 동기화 전략

---

*Last updated: 2026-04-13 — 초안 (스택 확정 직후)*
