## 다음 세션 재개 포인트 (Day 12 — M7 진입)

### 직전 완료
- **M6-2 "Frontend Ingestion" 풀 완주 (D11 단일 세션)** → "First Grounding" 마일스톤 완성
- 파이프라인 끝-끝 작동: 사용자 트리거 → Rust scanner → 청크 IPC → Frontend 점진 병합 → 시각 렌더 144FPS
- 시각 검증: ~/Documents depth 5 스캔, 수천 노드 우주 공간 분포, 135–144 FPS, M1~M5 회귀 0
- 테스트: Rust 25 + JS 103 = **128/128**

### M6-2 핵심 결정
- **InstancedMesh capacity 10000** — 정적, 동적 확장은 M7+
- **부분 업데이트 (addUpdateRange)** — 청크당 1,000개 = 64KB GPU 업로드 (전체 1/10)
- **β 옵션** — 새 스캔 시 청크 노드만 리셋, 하드코딩 3개 데모 노드 보존
- **Stats.js dev only** — `import.meta.env.DEV` 가드, production 빌드 미포함
- **store.scanProgress** — 좌상단 카운트 + ScanControl 진행 표시 단일 출처

### 다음 할 일 (Day 12 — M7 후보)
M7 은 Plan 에서 결정되지 않음. 후보 카드:
1. **GPU Color Picking** — Raycaster 비용 폭증 시 (10k+ 노드 클릭 1회 ~16ms 측정 필요)
2. **SQLite 영속성 + CRUD** — 스캔 결과를 휘발성 메모리에서 영구 저장으로
3. **notify Watcher** — 파일시스템 변경 실시간 반영
4. **의미 있는 3D 좌표 알고리즘** — random 분포 → 클러스터링/디렉토리 트리 매핑
5. **Binary IPC 전환** — JSON → bincode/postcard 로 청크 직렬화 비용 ↓
6. **동적 capacity 확장** — 10000 부족 시 growNodeBuffer 자동 호출

### 주의 / 알려진 이슈
- 청크 노드 클릭 → NodeDetailsPanel 은 "메타데이터 없음" 상태 (commands.getNodeDetails 가
  스캔된 path 를 모름). M7 SQLite 영속성에서 자연스럽게 해결될 예정.
- ScanControl 컴포넌트 자체는 unit test 없음 — 검증 로직은 scanControlHelpers.test.ts
  로 분리. 컴포넌트 테스트는 @testing-library/react 도입 시점에 추가.
- 좌상단 "노드 N개" 는 store.nodes(=3) + scanProgress.totalScanned 합산.
  buffer.count 와 항상 일치 — store/buffer 동기화 깨지면 여기가 어긋날 수 있어
  디버그 시 첫 확인 지점.
- Ctrl+S 임시 단축키는 dev-only. ScanControl 패널과 동일한 handleStartScan 호출.
