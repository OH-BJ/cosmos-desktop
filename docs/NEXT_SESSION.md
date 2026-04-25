## 다음 세션 재개 포인트 (Day 7+)

### 방금 완료: M5 Step 1
- Rust `ipc_types.rs`: `NodeDetails`/`NodeKind` (`#[serde(rename_all = "camelCase")]` + `Type` derive)
- `commands/node_details.rs`: `get_node_details` + 하드코딩 3 UUID
- `bin/gen_bindings.rs`: bindings 생성 전용 바이너리 (Windows webview2 DLL 체인 회피)
- `src/lib/bindings.ts` 자동 생성됨
- `cargo test` 11/11, `tsc --noEmit` 통과, Frontend 56/56 회귀 없음
- 커밋 안 됨 (Step 3에서 일괄)

### 다음 할 일
1. **Step 2**: Frontend 메타데이터 상태 + 패널 UI
   - `store.ts`에 `selectedNodeDetails` 필드 (옵션 α — 단일 필드)
   - `selectedNodeId` 구독 → `getNodeDetails` 호출 → Stale Request Discard
   - `NodeDetailsPanel.tsx` 신규 (이름/경로/타입/크기/수정일)
   - `App.tsx`에 배치 (기존 좌상단 정보 박스와 충돌 피해)
2. **Step 3**: 통합 + 시각 확인 + 커밋
   - `feat(m5): Rust IPC + 메타데이터 패널 (First Meaning)`
3. 여유 있으면: 노션 Day 7 기록

### 주의
- Step 2 시작 전 `/effort high` 권장
- `bindings.ts`는 Step 1에서 자동 생성됐으므로 import만 (`import { commands, NodeDetails, NodeKind } from '../lib/bindings'`)
- `selectedNodeId` 구독은 이미 `InstancedNodes.ts`에 있음 — 유사 패턴으로 메타 구독 추가
- Stale Request Discard: 응답 시점에 `store.getState().selectedNodeId === 요청 id` 체크 후에만 `setNodeDetails`
- bindings 재생성 필요 시: `cargo run --manifest-path src-tauri/Cargo.toml --bin gen_bindings`
