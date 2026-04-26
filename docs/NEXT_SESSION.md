## 다음 세션 재개 포인트 (Day 10)

### 직전 완료
- M5 "First Meaning" 완주 (커밋 dac6618, +1232/-8)
- M6 방향 확정: "First Grounding" (5번째 AI 교차검증 재현)
- PLAN_M6.md 작성, PLAN.md M6 섹션 정리

### 다음 할 일
1. M6-1 Step 1 착수: tokio 비동기 디렉토리 워커
   - max_depth 5, 심볼릭 링크 cycle 방지
   - Tauri capabilities `fs:read` 설정 우선
2. M6-1 Step 2: 청크 스트리밍 IPC (JSON 시작)
3. M6-1 Step 3: 통합 + 커밋

### 주의
- Step 1 시작 시 `/effort high` 권장 (Rust 비동기 + tokio + 안전장치)
- Tauri 2.x FS capabilities 설정 누락 빈번 — 미리 확인
- 청크 크기 1,000은 시작점, 실측 후 조정
- Binary IPC는 측정 후 전환 (M6-1 끝 또는 M7)
- InstancedMesh capacity 확장은 M6-2 작업
