# PLAN_M8 — "First Voyage"

> 작성: 2026-05-18 (Day 16). 9번째 AI 교차검증 사이클에서 Gemini 자문 적중 — M7 의 "별자리" 위에서 사용자가 **항해**할 수 있게 만드는 것이 다음 마일스톤. CRUD/영속성(원안 A)은 공간 탐색 없이 도입하면 상태 동기화 지옥에 빠진다는 판단으로 M9 로 미룸.

---

## M8 방향 결정 배경

M7 (First Constellation) 직후 후보 3종:
- A) CRUD + 영속성 (SQLite tauri-plugin-sql 와이어드 상태)
- B) 카메라 자동 fit
- C) 검색/필터 UI

**Gemini 자문 핵심:**
1. **First Voyage = B + C + Fly-to** — 별자리는 의미를 만들었으나 사용자가 그 안을 *돌아다닐 방법* 이 없다. "줌+팬" 만으로는 길찾기 불가능. CRUD 보다 항해가 선행조건.
2. **CRUD 미룸 (A → M9)** — 공간 탐색이 없는 상태에서 노드 CRUD 를 도입하면 "새 노드가 어디 생겼는지 모름 / 삭제한 노드 자리 텅 빔 / 위치 변경 = 화면 전체 재배치" 같은 동기화 부채 발생. 항해 도구 먼저.
3. **SQLite 의 진짜 자리** — 파일은 이미 FS 가 SoT. SQLite 는 **비-파일 노드** (메모/링크/태그/주석) 의 영속 저장소로 정의. M9 에서 도입.

**채택된 정의:**
> **M8 First Voyage** = (1) 부드러운 카메라 애니메이션 인프라 + (2) 검색 + 시각 하이라이트 + (3) 자동 fit. 별자리 위에서 *목적지를 정하고 그곳까지 자연스럽게 날아갈 수 있는 첫 항해 시스템*.

---

## 목표

- "더블 클릭한 노드 가까이로 카메라가 부드럽게 비행" — 줌/팬 수동 조작 없이 한 번에 도착.
- "검색창에 이름을 치면 매칭 노드가 강조되고, 누르면 그쪽으로 비행" — 별자리 안에서 *길 찾기* 가 처음으로 가능.
- "앱 열면 전체 별자리가 시야에 들어옴" — 하드코딩된 `z=270000` 졸업.
- 모든 항해는 **의존성 0** 으로 직접 구현 (gsap/TWEEN 미사용, lodash 금지 정책과 일치).

---

## 사전 결정 (재논의 X)

| 항목 | 결정 | 근거 |
|---|---|---|
| 카메라 애니메이션 | 직접 lerp + rAF | gsap/TWEEN 도입 X, M7-2 의 rAF+Dirty Flag 패턴 재사용 |
| Easing | `easeInOutCubic` | 자연스러운 가속/감속, 의존성 0 (수식 한 줄) |
| Fly-to duration | **800 ms** (초기값) | 너무 길면 답답, 너무 짧으면 멀미. 시각 검증 후 조정 |
| Orbit Lock 반경 | 대상 노드 `instanceScale × 5` | scale=500 → 2500 world units, scale=0.05 → 0.25 — 어느 깊이든 비례 |
| 검색 매칭 | substring (대소문자 무시) | 정규식/퍼지 X, 단순함 우선 (M9+ 카드로 보관) |
| 검색 UI | Spotlight 오버레이 (Cmd/Ctrl+K) | macOS Spotlight 패턴 — 이미 익숙, 모드 분리 명확 |
| Dimming opacity | 0.1 | 매칭 외 노드 흐릿하게, 완전 숨김은 X (별자리 형태 유지) |
| Emissive | 단순 색상 변경 (흰색 or 살구색) | full PBR Emissive 미도입. 셰이더 uniform 한 줄 |
| D5 과대화 해결 | **Max Pixel Size clamp** | 셰이더 상한 → D5 침투 시 폭발 방지. depth-aware scale 비율은 손대지 않음 (M7 결정 유지) |

---

## 작업 단계

### Step 0: M7.5 Refactoring (부채 청산)

M8 본 작업 전에 **별도 fix 커밋 권장**. M7-2 에서 남긴 부채 정리 + M8 의존성 해소.

#### 0-1. Raycaster 폐기
- GPU Picker 가 시각/판정 일치로 완전 대체.
- `CameraController` 의 `raycaster`, `pickTarget`, `indexToIdResolver`, `setPickTarget`, `setIndexToIdResolver`, `performPick`, `onPick` 옵션 모두 제거.
- `App.tsx` 에서 `setPickTarget` / `setIndexToIdResolver` 호출 + `onPick` 콜백 제거.
- `CameraController.test.ts` Raycaster mock 전제 4건 정리:
  - `클릭(<5px) + 히트 → onPick 호출 with UUID`
  - `드래그(>5px) → onPick 미호출 (팬 동작만)`
  - `클릭 + hit 없음 → onPick(null)`
  - `pickTarget 미설정 시에도 클릭 → onPick(null) 호출 (안전 경로)`
  - 위 4건을 `onPickPixel` 기준으로 재작성 (GPU 픽 결과 → selectNode 디스패치 검증).

#### 0-2. chunk_id reset on new scan
- Backend 의 `chunk_id` 카운터는 task 단위로 0 부터 시작하므로 사실 backend 수정 불필요.
- 문제는 **Frontend** `setupNodeChunkSync` 의 `lastChunkId` 가 단조 증가 가정 — 새 스캔 시 다시 0 부터 들어오면 "순서 어긋남" 경고 발사.
- 해법: `setupNodeChunkSync` 가 반환하는 객체에 `resetExpectedChunkId()` 메서드 추가, `App.handleStartScan` 의 `clearChunkedNodes` 직후 호출.
- 또는 더 간단하게: 청크 도착 시 `chunkId === 0` 이면 자동 reset (heuristic).

#### 0-3. Max Pixel Size clamp
- 셰이더에 `uMaxPixelSize` uniform 추가 (기본 100 px).
- `scaleFactor = clamp(uMinPixelSize / pixelDiameter, 1.0, uMaxPixelSize / pixelDiameter)` 형태로 상한 도입.
- D5 (scale=0.05) 가 카메라 침투 시 화면을 덮는 폭발 방지. 메인/픽커 셰이더 양쪽 동기.
- 시각 검증: D1 (scale=500) 줌인 시 정상 크기 유지 + D5 침투 시 100 px 이상으로 안 커짐.

#### 0-4. 회귀 + 별도 커밋
- cargo / vitest / tsc 그린 확인.
- 커밋 메시지: `fix(m7.5): Raycaster 폐기 + chunk_id reset + Max Pixel Size clamp`.

---

### Step 1: 카메라 애니메이션 파이프라인 (Fly-to)

#### 1-1. 신규 모듈 — `src/canvas/CameraAnimator.ts`

```ts
interface FlyToTarget {
  position: THREE.Vector3;     // 도착 카메라 위치
  lookAt: THREE.Vector3;       // 도착 OrbitControls.target
  duration?: number;           // 기본 800 ms
}

class CameraAnimator {
  flyTo(target: FlyToTarget): Promise<void>;
  update(): void;              // 매 프레임 호출 (Scene 의 onRender)
  isAnimating(): boolean;
  cancel(): void;
}
```

- 내부 상태: `startPos`, `startTarget`, `endPos`, `endTarget`, `startTime`, `duration`.
- `update()` 가 `(now - startTime) / duration` 으로 `t ∈ [0, 1]` 계산, easing 적용 후 `Vector3.lerpVectors` 로 camera.position + orbitControls.target 갱신.
- 완료 시 Promise resolve.

#### 1-2. Easing
```ts
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
```

#### 1-3. OrbitControls 일시 비활성
- 애니메이션 시작 시 `orbitControls.enabled = false` (회전/팬/줌 모두 차단).
- 완료 시 `enabled = true` 로 복원.
- `cancel()` 호출 시도 즉시 복원.

#### 1-4. 더블 클릭 → Fly-to
- `CameraController` 에 `onDoubleClickPick(clientX, clientY)` 콜백 추가.
- App 이 GPU Picker 로 instanceId 조회 → buffer.positions/scales 에서 도착 위치 계산 → `cameraAnimator.flyTo(...)`.
- 도착 위치: `nodePos + (현재 카메라 방향) × (scale × 5)` — 노드를 정면으로 보되 scale 비례 거리 유지.

#### 1-5. 테스트
- `CameraAnimator.test.ts` 신규:
  - flyTo 호출 후 update(t=0) → 시작 위치, update(t=0.5) → 중간, update(t=1) → 도착.
  - easing 함수 단위 (t=0,0.5,1 → 0,0.5,1).
  - cancel 후 isAnimating=false.
  - 동시 flyTo 호출 → 이전 취소되고 새 목적지로.
- 기존 tests 회귀 0.

#### 1-6. 위험
- OrbitControls.target 보간 누락 시 카메라가 회전하면서 도착 → 부자연스러움. target 도 반드시 lerp.
- `requestAnimationFrame` race: Scene 의 render 루프 안에서 `cameraAnimator.update()` 호출 → 별도 rAF 불필요.

---

### Step 2: 검색 + 시각 하이라이트

#### 2-1. Spotlight UI — `src/ui/Spotlight.tsx`
- Cmd/Ctrl+K 단축키로 토글.
- 화면 중앙 상단에 둥근 입력창 (CSS: `position: fixed; top: 20%; left: 50%; transform: translateX(-50%);`).
- 매칭 결과 리스트 (최대 10건) — 노드 이름 + 깊이 표시.
- ↑/↓ 화살표 키 네비게이션, Enter 로 선택, Esc 로 닫기.

#### 2-2. 검색 로직 — `src/canvas/search.ts`
```ts
function searchNodes(query: string, names: readonly string[]):
  Array<{ index: number; name: string }>;
```
- substring 매칭 (대소문자 무시).
- query.length === 0 → 빈 배열.
- 결과 정렬: 매칭 시작 위치 ASC, name.length ASC.

#### 2-3. 시각화 — Shader uniform 확장
- `InstancedNodes` 셰이더에 `uHighlightMask` 추가 — `sampler2D` 또는 `instanceColor` 활용.
  - **권장**: `instanceColor` (three.js 표준 attribute). 각 인스턴스 RGB 가 hover/match/normal 3가지 색.
  - 또는 별도 `instanceHighlight: Float32Array` (1.0 = match, 0.0 = dim) 추가.
- 셰이더 fragment 에서: `if (highlight < 0.5) fragColor.a = 0.1;` (Dimming).
- 매칭 노드는 Emissive 색상 (살구색 `#FFB07A` 권장).

#### 2-4. 결과 클릭 → Fly-to
- Step 1 `cameraAnimator.flyTo` 직접 호출.
- 매칭 강조는 Spotlight 닫혀도 유지 (Esc 한 번 더로 클리어).

#### 2-5. 테스트
- `search.test.ts`: substring 매칭, 정렬, 빈 query.
- Spotlight 컴포넌트 단위 테스트는 happy-dom 도입 후로 미룸 (M7-2 와 동일).

---

### Step 3: Auto-fit

#### 3-1. 신규 함수 — `src/canvas/autofit.ts`
```ts
function computeFitCameraPosition(
  positions: Float32Array,   // NodeBuffer.positions
  count: number,
  fov: number,               // degrees
  aspect: number,
): { position: THREE.Vector3; target: THREE.Vector3 };
```
- 모든 노드의 Bounding Box → 중심 + 반지름 계산.
- `distance = radius / Math.tan(fov/2 * π/180) / aspect` (보수적 marginal).
- target = bbox center, position = target + (0, 0, distance) (기본 정면).

#### 3-2. 트리거 시점
- 앱 첫 마운트 시 (단, 초기 하드코딩 3 노드만 있으면 skip).
- 디렉토리 스캔 완료 시 (`isLast=true` 청크 도착) → 자동 fit.
- UI: 우측 상단에 작은 "홈" 버튼 (✦) — 클릭 시 즉시 fit + Fly-to.

#### 3-3. Step 1 의존
- 자동 fit 도 `cameraAnimator.flyTo(...)` 로 부드럽게 이동 (instant 점프 X).
- 단 첫 마운트 시는 instant 가 자연스러울 수도 — 옵션으로 `instant: boolean` 노출.

#### 3-4. 테스트
- `autofit.test.ts`: 알려진 좌표 세트 (예: 단위 큐브 8개 모서리) → distance 가 수학적으로 예측되는 값.
- 빈 buffer → 기본값 반환 (안전).

---

## 단계 의존성

```
Step 0 (M7.5 부채) ─┐
                    ├─> Step 1 (Fly-to) ─┬─> Step 2 (검색)
                    │                    └─> Step 3 (Auto-fit)
                    └─> 독립 (Max Pixel Size clamp 는 셰이더 변경 + 시각 검증만)
```

- Step 0 는 모든 후속의 전제 (Raycaster 정리 안 하면 onPick 경로가 fly-to 와 충돌).
- Step 1 은 Step 2/3 의 공통 기반.
- Step 2 와 Step 3 는 서로 독립 — 병렬 작업 가능.

---

## 테스트 목표

| 단계 | cargo | vitest |
|---|---|---|
| Step 0 | 41 (그대로) | 133 + 회귀 정리 4건 변경 (+0 또는 -2 후 신규 +3) |
| Step 1 | 41 | +4 (CameraAnimator: easing, flyTo lerp, cancel, isAnimating) |
| Step 2 | 41 | +3 (search 함수 단위) |
| Step 3 | 41 | +2 (autofit 함수 단위) |
| **누적 목표** | **41** | **약 140+** |

---

## 위험 & 안전장치

- **카메라 멀미**: 800ms 가 절대값이 아니라 거리 비례로 조정 필요할 수도. Step 1 시각 검증 후 결정.
- **OrbitControls 상태 누수**: animator.cancel 누락 시 `enabled=false` 영구화. dispose 시 강제 복원.
- **검색 결과 0건**: 모든 노드가 dim 되면 화면이 거의 검정 → 빈 query 와 동일 처리로 폴백.
- **Auto-fit 발사 시점 race**: 스캔 완료 직후 InstancedMesh.syncFromBuffer 가 아직 안 끝났으면 buffer.count 가 작음 → onAfterChunk 의 마지막 sync 직후로 트리거 순서 명확히.

---

## 알려진 후속 (M9+ 카드 보관)

- **CRUD + 영속성** (원안 옵션 A): 비-파일 노드 (메모/링크/태그) 의 SQLite 저장.
- **퍼지 검색**: 현재 substring → fzf 스타일 가중치.
- **검색 히스토리 / 즐겨찾기**: Spotlight 에 최근 검색 노출.
- **카메라 경로 가시화**: Fly-to 동안 별자리 위에 곡선 leader line.
- **모바일 제스처**: 핀치 줌 / 더블탭 fly-to.

---

## 사전 정리된 결정 (재논의 X) — 요약

- 카메라 애니메이션: 직접 lerp + rAF, easeInOutCubic, 800ms
- 검색: substring, 대소문자 무시, Cmd/Ctrl+K
- 하이라이트: Dimming 0.1 + Emissive 색상 변경
- Auto-fit: 모든 노드 bbox + FOV 기반 거리, fly-to 로 부드럽게
- D5 과대화: Max Pixel Size clamp (셰이더 상한)
- 의존성 0 정책: gsap/TWEEN/lodash 모두 미도입

---

*Last updated: 2026-05-18*
