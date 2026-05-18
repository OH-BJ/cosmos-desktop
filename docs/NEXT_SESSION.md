## 다음 세션 재개 포인트 (Day 16+)

### 직전 완료
- **M7-2 "Interaction Layer" 일괄 커밋** (Step 1 + 2 + 3, f9a4a00)
  - Step 1 (GPU Color Picking): Offscreen 1×1 RT, (id+1) 24bit RGB 인코딩, 메인과 동일 size-attenuation 셰이더 공유 (시각 픽셀 = 판정 픽셀)
  - Step 2 (호버 + 툴팁): `projection.ts` 순수 함수, `HoverTooltip` DOM 직접 조작 (재렌더 0), CameraController rAF + Dirty Flag throttle, `indexToName` path 폴백
  - Picker hotfix (uTanHalfFov): `setViewOffset` 이 P11 부풀려 D5 작은 노드 픽 실패하던 버그 → 메인/픽커 모두 `1/tan(fov/2)` uniform 으로 우회
- **Depth-Aware instance scale** (D15 후속 카드 동시 완료)
  - Rust `scale_for_depth(d)`: 5000/500/50/5/0.5/0.05
  - BASE_RADIUS=1 로 의미 분리, instanceMatrix uniform scale 합성 (matrix.compose)
  - M4 highlight mesh 도 buffer.scales 동기 (시각 회귀 0)
- "First Constellation" 마일스톤 (M7-1 + M7-2) 완성. M7 종료.
- 테스트: cargo 41/41 (+5), vitest 133/133 (+22 누적), tsc clean

### 다음 할 일

#### 1. M8 진입 후보 (Gemini 자문 권장)
- **CRUD + 영속성**: 노드 추가/수정/삭제 IPC + SQLite 영속 (tauri-plugin-sql 이미 와이어드)
- **카메라 자동 fit**: 별자리 무게중심 기반 초기 카메라 위치 산출 (지금은 z=270K 하드코딩)
- **검색/필터 UI**: 노드 이름/path 텍스트 검색 → InstancedMesh 하이라이트 (또는 색상 변경)
- 셋 중 우선순위 결정 필요

#### 2. 알려진 후속 작업 (M8 또는 그 이후 카드)
- **Raycaster 폐기 검토**: M7-2 에서 GPU Picker 가 시각/판정 일치로 대체. CameraController 의 `onPick(Raycaster)` 경로는 `onPickPixel(GPU)` 직후 호출되어 결과를 덮어쓰는 구조 → Raycaster 코드 제거 가능. 단 CameraController.test 4건이 Raycaster mock 전제 → 동시 정리 필요.
- **chunk_id reset on new scan**: 새 스캔 시작 시 backend chunk_id 카운터 미초기화 (경고만, 기능 영향 X).
- **HoverTooltip JSX 단위 테스트 미작성**: vitest 환경이 node 라 React/DOM 렌더 검증 밖. 시각 검증으로 위임 중 — happy-dom 도입 시 추가 가능.
- **호버 시각 효과 (옵션 B/C)**: 현재는 툴팁만. 호버 노드 instanceColor 살짝 밝히기 등은 후속.
- **D5 줌인 시 클램프 동작 검증**: depth-aware scale 도입으로 D5 scale=0.05 까지 작아짐. 카메라가 D5 가까이 침투할 때 4×4 px 클램프가 폭발 없이 자연 전이하는지 육안 검증 미수행.
- **카메라 자동 fit 알고리즘**: BFS 좌표 무게중심 + 표준편차 → 적정 z 거리 산출 함수 신규.

### 사전 정리된 결정 (재논의 X)
- 좌표 알고리즘: Fractal Orbital Packing (Gemini Pro H 채택)
- 거리 스케일: D1=100K / D2=10K / D3=1K / D4=100 / D5=10
- 인스턴스 스케일: D0=5000 / D1=500 / D2=50 / D3=5 / D4=0.5 / D5+=0.05 (10× 비율)
- Picking 방식: Color Buffer (Offscreen WebGLRenderTarget, 1×1)
- 호버 throttle: rAF + Dirty Flag (lodash 금지)
- 호버 UI: Screen Projected CSS 툴팁 (DOM, three.js 객체 X)
- 메타데이터: 청크에 이미 있는 name 사용
- 셰이더 P11 대체: `uTanHalfFov` uniform — setViewOffset 영향 받지 않게

### 주의
- 시각 검증 스크린샷은 사용자 직접 업로드
- Logarithmic Depth Buffer 신뢰 (D5 결정) — 100K~10 스케일 차이도 z-fighting X
- 메인/픽커 셰이더는 같은 `uTanHalfFov` 값을 공유해야 식 drift 0 — App.tsx 에서 한 번만 계산해 양쪽 주입

### 이슈 1 후속 (학습 정리, 미진행)
- 노션에 "막힌 문제 카드" + 학습 노트 작성
  - StrictMode 더블 마운트 + 비동기 listen Promise race
  - cancelled 클로저 패턴이 표준 해법인 이유
  - sceneRef 가드만으로 무력화되는 경로 도식화
  - (M7-2 추가) `setViewOffset` 의 `projectionMatrix` 부작용 — picker 셰이더가 main 과 같은 P11 을 쓰면 결과가 어긋나는 함정
