# PLAN_M7 — "First Constellation"

> 작성: 2026-04-30 (Day 12). 6번째 AI 교차검증 사이클(웹 Claude → Gemini Pro → Planner 메타리뷰)에서 Gemini Pro의 "놓친 옵션 G" 채택.

---

## M7 방향 결정 배경

D3, D5, D6, D7, D9-2 에 이은 **6번째 3단계 교차검증**. 웹 Claude 사전 추천은 A 단일(호버링+GPU Picking)이었으나 Gemini Pro 가 옵션 G 를 제시하고 Planner 가 메타리뷰로 채택.

**Gemini 핵심 인용:**
1. **LOD 인과** — "볼 수 없는 것은 클릭할 수 없다." LOD 가 깨진 1px 노드는 GPU Picking 도 불가. 시각이 인터랙션의 선행조건.
2. **서사 인과** — "의미 없는 공간은 호버할 이유가 없다." 무작위 분산 위에 호버는 노이즈일 뿐. 좌표가 의미를 가져야 호버가 발견을 만든다.
3. **기술 부채** — 레이아웃을 먼저 잡으면 튜닝 한 번. 호버 먼저 잡고 좌표를 나중에 바꾸면 호버를 두 번 튜닝해야 함.

**비교 표:**

| 측면 | 웹 Claude (A) | Gemini Pro (G, 채택) |
|---|---|---|
| 범위 | 호버링 + GPU Picking | B(좌표) + F(LOD/Billboard) + A(호버) |
| 우선순위 | 인터랙션 즉시성 | 시각적 토대 → 인터랙션 |
| 리스크 | 무작위 분산 위 호버 = 노이즈 | Shader 작성 부담 |
| 부채 | 좌표 변경 시 호버 재튜닝 | 한 번에 끝 |

---

## 목표

디렉토리 트리를 반영한 의미 있는 3D 좌표 + 거리 무관 최소 Hit-Area 보장 + GPU Color Picking 기반 호버. M6 의 무작위 분산을 별자리(Constellation)로 승격.

## 성공 기준

- ScannedNode 가 디렉토리 트리 기반 좌표를 가진다 (랜덤 폴백 제거)
- 줌아웃 시 모든 노드가 최소 4×4px 로 보장됨
- 호버 시 툴팁 등장 (path/name/kind/sizeBytes)
- 60fps 유지 (M4 클릭 + M5 메타패널 + M6 청크 스트리밍 회귀 0)
- 테스트 전부 통과 (Rust + Frontend)

---

## 마일스톤 분해

### M7-1 "Spatial Foundation" (3 Steps)

**Step 1: Rust 측 3D 좌표 계산**
- BFS 스캔 시 depth + parent 기반 좌표 결정
- **알고리즘: Fractal Orbital Packing** (Gemini Pro 7번째 교차검증 결과)
  - 계층적 Fibonacci sphere + 지수적 거리 축소
  - 각 부모가 자신만의 독립 구면 형성
  - BFS 와 100% 호환, O(1) 자식 좌표 계산

- **거리 스케일 (지수적 축소)**:

  | depth | radius (부모 기준) |
  |---|---|
  | 0 (root) | (0, 0, 0) 절대 원점 |
  | 1 | 100,000 |
  | 2 | 10,000 |
  | 3 | 1,000 |
  | 4 | 100 |
  | 5 | 10 |

  수식: `r_d = 10^(5-d)` (d ≥ 1), 그 후 밀집도 보정.

- **인덱스 안정성**: 디렉토리마다 `(modified_time, file_name)` 으로 정렬 후 sibling 인덱스 부여. 같은 트리 → 같은 좌표 결정성.

- **밀집도 보정**: `r_adjusted = r_d × log10(N+1).max(1.0)` — 한 디렉토리 자식이 많을 때 구 반경을 부드럽게 확장. N=10일 때 1.04배, N=100일 때 2.0배, N=1000일 때 3.0배.

- **ScannedNode + NodeChunkEvent 에 `position: [f32; 3]` 추가**
- Frontend `defaultRandomCoord` 폴백 제거

**Step 2: ShaderMaterial / Size Attenuation 수정**
- 카메라 거리 무관 최소 Hit-Area **4×4px** 보장
- three.js InstancedMesh + 커스텀 ShaderMaterial 통합
- 가까운 노드: 정상 크기 / 먼 노드: 4px 클램프
- vertex shader 에서 gl_Position.w 기반 minSize 보정

**Step 3: 통합 + 시각 검증 + 커밋**
- M6-2 의 ~/Documents 스캔 트리거 그대로 사용
- 별자리 형성 시각 확인 (디렉토리 트리 reflected)
- 줌아웃 시 노드 4px 유지 확인
- M4/M5 회귀 검증 (Raycaster 임시 유지)

### M7-2 "Interaction Layer" (3 Steps)

**Step 1: Offscreen GPU Color Picking 파이프라인**
- WebGLRenderTarget (offscreen)
- Buffer Index u32 → RGB 24bit 색상 인코딩 (1,677만 노드 가능)
- Picking 전용 ShaderMaterial 별도
- `readRenderTargetPixels` 로 색상 읽고 u32 역변환

**Step 2: 호버 상태 + UI**
- Zustand 에 `hoveredNodeId` 추가
- **rAF + Dirty Flag throttle** (lodash debounce 금지)
- Screen Projected CSS 툴팁 (Floating UI 패턴)
- 청크 노드 메타 (path/name/kind/sizeBytes) 그대로 표시

**Step 3: M4 클릭 + M7 호버 공존 + 회귀 + 커밋**
- 색상/스타일 구분 (호버 != 선택)
- Raycaster 제거 또는 유지 결정 (Step 2 측정 후)
- 클릭 시 lazy fetch (M5 NodeDetailsPanel 그대로)

---

## 리스크

1. **3D 좌표 알고리즘 선택** — 성능 vs 가독성. M7-1 Step 1 초반 결정.
2. **Shader 작성 부담** — 커스텀 ShaderMaterial 첫 도입. Vertex/Fragment 양쪽 검증 필요.
3. **GPU Picking RGB 인코딩 정밀도** — u32 → 24bit RGB 매핑. 1,677만 노드까지 안전.
4. **rAF + Dirty Flag throttle** — 매 프레임 readPixels 시 GPU↔CPU 동기화 비용. Dirty Flag 로 마우스 이동 시만 트리거.
5. **M4 Raycaster + M7 GPU Picking 병행 vs 교체** — Step 2 측정 후 결정. 노드 수 적을 땐 Raycaster 가 더 쌀 수 있음.

---

## 사전 정리된 결정

- **분해**: M7-1 + M7-2 (M6 패턴 따름)
- **좌표 알고리즘**: M7-1 Step 1 에서 3가지 후보 중 결정
- **Picking 방식**: Color Buffer (Offscreen WebGLRenderTarget) — DepthTexture 호환성 파편화 회피
- **호버 throttle**: rAF + Dirty Flag (lodash 금지)
- **호버 UI**: Screen Projected CSS 툴팁
- **메타데이터**: 청크에 이미 있는 거 사용, lazy fetch X

---

## 참고 링크

- 노션 학습 노트: "M7 사전 정리 + Gemini Pro 자문 프롬프트" 카드 (Gemini 답변 본문)
- `docs/PLAN_M6.md` — 분해 패턴 참고 (M6-1/M6-2 → M7-1/M7-2)
- 노션 D6 막힌 문제 카드 — Raycaster 3원인 (히트박스/거리 감쇠/카메라 절두체)
