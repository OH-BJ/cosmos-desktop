## 다음 세션 재개 포인트 (Day 15+)

### 직전 완료
- **M7-1 "Spatial Foundation" 일괄 커밋** (Step 1 + 2 + 3)
  - Step 1 (좌표): Rust `scanner/coords.rs` Fractal Orbital Packing + BFS 부모좌표 전파 + ScannedNode.position
  - Step 2 (가시성): InstancedNodes `MeshBasicMaterial.onBeforeCompile` 패치, 4×4px 클램프, BASE_RADIUS=500, uResolution uniform
  - 카메라 (Step 1 의존): FOV 50°, position.z=270_000, far 1e6, OrbitControls zoom 0.1~1e6
  - D14 hotfix 부속: StrictMode 청크 리스너 race 시뮬 테스트 2개
- 테스트: cargo 36/36, vitest 111/111, tsc clean

### 다음 할 일

#### 1. M7-2 "Interaction Layer" (3 Steps)
- **Step 1**: Offscreen GPU Color Picking 파이프라인
  - WebGLRenderTarget (offscreen)
  - Buffer Index u32 → RGB 24bit 인코딩 (1,677만 노드 가능)
  - Picking 전용 ShaderMaterial 별도 작성
  - `readRenderTargetPixels` → u32 역변환
- **Step 2**: 호버 상태 + UI
  - Zustand `hoveredNodeId` 추가
  - rAF + Dirty Flag throttle (lodash 금지)
  - Screen Projected CSS 툴팁 (Floating UI 패턴)
  - 청크 메타 (path/name/kind/sizeBytes) 표시
- **Step 3**: M4 클릭 + M7 호버 공존 + 회귀 + 커밋
  - 색상/스타일 구분 (호버 ≠ 선택)
  - Raycaster 제거/유지 결정 (Step 2 측정 후)
  - boundingSphere 호환 (Picking 으로 대체되면 무관)

#### 2. 알려진 후속 작업 (M7-2 또는 그 이후 카드로 보관)
- **depth-aware instance scale**: BASE_RADIUS=500 으로 D5(≈10) 침투 시 화면 폭발. coords.rs 에서 depth 별 instanceMatrix scale 산출 → InstancedNodes 가 setMatrixAt 시 적용. M7-2 와 함께 처리하거나 별도 마일스톤으로 분리 가능.
- **chunk_id reset on new scan**: 새 스캔 시작 시 backend chunk_id 카운터 미초기화 (경고만, 기능 영향 X).
- **카메라 초기 위치 미세 튜닝**: 별자리 무게중심 기반 자동 fit (현재는 z=270K 하드코딩).
- **ShaderMaterial boundingSphere 호환**: size attenuation 으로 화면 클램프된 노드는 Raycaster 가 못 잡음. M7-2 GPU Picking 으로 자연 해결 — Raycaster 폐기 시점 결정 필요.

### 사전 정리된 결정 (재논의 X)
- 좌표 알고리즘: Fractal Orbital Packing (Gemini Pro H 채택)
- 거리 스케일: D1=100K / D2=10K / D3=1K / D4=100 / D5=10
- Picking 방식: Color Buffer (Offscreen WebGLRenderTarget)
- 호버 throttle: rAF + Dirty Flag (lodash 금지)
- 호버 UI: Screen Projected CSS 툴팁
- 메타데이터: 청크에 이미 있는 거 사용

### 주의
- 시각 검증 스크린샷은 사용자 직접 업로드
- BASE_RADIUS=500 은 임시 평균값 — D5 줌인 시 폭발 인지, 후속 마일스톤에서 정공법
- Logarithmic Depth Buffer 신뢰 (D5 결정) — 100K~10 스케일 차이도 z-fighting X

### 이슈 1 후속 (학습 정리, 미진행)
- 노션에 "막힌 문제 카드" + 학습 노트 작성
  - StrictMode 더블 마운트 + 비동기 listen Promise race
  - cancelled 클로저 패턴이 표준 해법인 이유
  - sceneRef 가드만으로 무력화되는 경로 도식화
