# cosmos-desktop — 마일스톤 2 Plan

> `/clear` 이후에도 살아남도록 저장된 M2 실행 계획.
> 작성: 2026-04-16, Tech Lead. **v2 — Product Owner 범위 축소 반영.**

---

## 목표

"UUID 기반 노드 3~5개가 여러 위치에 렌더되고, 사용자가 마우스 드래그로 화면을 팬할 수 있다."

M1이 "빈 우주 + 더미 노드 1개"였다면, M2는:
- bridge.ts가 Zustand ↔ TypedArray를 실제로 동기화 (UUID v7 + Buffer Index)
- InstancedMesh가 N개 노드를 올바른 위치에 렌더링
- 사용자가 드래그 팬으로 캔버스를 탐색 (First Interaction)

이것 이상은 전부 M3+.

## 확정된 설계 결정

M2_ENTER_CRITERIA.md 참조. 핵심 요약:
- ID: UUID v7(도메인) + Buffer Index(렌더링), bridge가 Map으로 매핑
- 동기화: Zustand subscribe → bridge → TypedArray → InstancedMesh
- FS IPC: timestamp 필드 추가된 FsChangeEvent (M3)

---

## Step 구성 (3 Step)

### Step 1: bridge.ts 재구현 + 다중 노드 렌더링
**복잡도:** ★★★☆☆ (중)
**레이어:** Frontend 단독 (Tech Lead 직접 or Frontend 에이전트)
**파일:**
- `src/state/bridge.ts` — 전면 재작성
- `src/state/nodeBuffer.ts` — `ids: Uint32Array` 제거, Buffer Index 활용으로 전환
- `src/state/store.ts` — Node 타입에 UUID v7 id 확정, 하드코딩 테스트 노드 3~5개
- `src/canvas/nodes/InstancedNodes.tsx` — bridge 연동으로 전환
- `src/canvas/CosmosCanvas.tsx` — 더미 노드 생성 → store 연동

**할 일:**
1. bridge.ts에 `idToIndex: Map<string, number>`, `indexToId: string[]` 양방향 매핑
2. `syncFromStore()` — Zustand subscribe → positions/colors/scales TypedArray 전량 재작성
3. ids Uint32Array 의존 코드 제거 (Buffer Index가 곧 렌더링 ID)
4. InstancedNodes가 bridge의 TypedArray를 직접 참조
5. instanceMatrix를 bridge 업데이트 시에만 갱신 (매 프레임 X)
6. instanceCount를 store.nodes.length와 동기화
7. store 초기화 시 하드코딩 노드 3~5개 삽입 (랜덤 좌표, UUID v7 형식 문자열)

**테스트 (QA):**
- bridge round-trip: Zustand에 노드 3개 추가 → TypedArray 인덱스/좌표 검증
- idToIndex/indexToId 일관성 테스트
- 노드 삭제 후 인덱스 재정렬 검증
- 화면에 N개 노드가 각각 다른 위치에 보이는지 수동 검증

**체크포인트:** 커밋 — "feat(m2): bridge 재구현 + 다중 노드 렌더링"

---

### Step 2: 카메라 팬 (First Interaction)
**복잡도:** ★★☆☆☆ (소~중)
**레이어:** Frontend 단독
**파일:**
- `src/canvas/CameraController.ts` (신규) — 마우스 드래그 팬 전용
- `src/canvas/CosmosCanvas.tsx` — CameraController 연결

**할 일:**
1. OrthographicCamera 잠금 유지 (M1에서 이미 설정됨)
2. 마우스 드래그 → 카메라 position.x/y 이동 (팬만)
3. 줌/회전 없음 (줌 → M3, 회전 → M4 3D 전환)
4. 드래그 중 커서 변경 (grab → grabbing)

**테스트 (QA):**
- 팬: 드래그 시 노드들이 반대 방향으로 이동하는지 수동 검증
- 팬 후 마우스 놓으면 정지하는지 확인
- 캔버스 밖으로 드래그 후 복귀 시 정상 동작 확인

**체크포인트:** 커밋 — "feat(m2): 카메라 팬 인터랙션"

---

### Step 3: 통합 검증 + 커밋
**복잡도:** ★☆☆☆☆ (소)
**레이어:** Frontend + QA
**파일:**
- `src/ui/InfoPanel.tsx` — 노드 개수 표시 업데이트
- 기존 Vitest 테스트 — 회귀 확인

**할 일:**
1. InfoPanel에 실제 노드 개수 반영 (store subscribe)
2. `tauri dev` 로 전체 흐름 수동 E2E: 앱 시작 → 노드 3~5개 보임 → 드래그 팬
3. 기존 Vitest 테스트 전부 통과 확인 (회귀 없음)
4. 최종 커밋: `feat(m2): bridge 구현 + 카메라 팬 (First Interaction)`

**테스트 (QA):**
- `npm test` 전체 통과
- `tauri dev` 정상 기동 + 시각적 검증
- M1 기능 회귀 없음 확인 (InfoPanel, 빈 우주 배경)

**체크포인트:** M2 최종 커밋

---

## 의존성 그래프

```
Step 1 (bridge + 렌더링) ──→ Step 2 (카메라 팬) ──→ Step 3 (통합 검증)
```

순차 의존. 병렬 분리 불필요 (3 Step, Frontend 단독).

## 복잡도 총합

| Step | 복잡도 | 예상 비중 |
|---|---|---|
| 1. bridge + 다중 노드 | ★★★ | 50% |
| 2. 카메라 팬 | ★★ | 30% |
| 3. 통합 검증 | ★ | 20% |

## 리스크

1. **bridge 전량 재작성 성능**: 노드 3~5개에서는 문제 없으나, M3에서 100+ 노드 전환 시 diff 모드 필요할 수 있음. M2에서는 전량 재작성으로 충분.
2. **M1 InstancedNodes 코드와의 호환**: 기존 더미 노드 로직을 bridge 연동으로 전환 시 회귀 가능성. Step 3에서 Vitest + tauri dev로 검증.

---

## M3 이후로 미룬 것

| 항목 | 원래 Step | 이동 대상 | 비고 |
|---|---|---|---|
| Rust IPC 노드 CRUD (commands.rs, uuid v7 crate) | Step 5 | **M3 메인** | 복잡도 ★★★★, 단독 마일스톤급 |
| 노드 히트테스트 + 선택 | Step 4 | **M3** | unproject + brute-force |
| 카메라 줌 (휠 스크롤) | Step 3 일부 | **M3** | zoom 속성 vs position.z 결정 포함 |
| UI 패널 확장 + 100노드 성능 검증 | Step 6 | **M3 끝** | 60fps@100노드 벤치마크 |
| 실제 FS 스캔 (notify + FsChangeEvent) | 해당 없음 | **M4** | timestamp 필드는 M3에서 추가 |

---

*v2 — Product Owner 범위 축소 반영. 승인 후 Step 1부터 착수.*
