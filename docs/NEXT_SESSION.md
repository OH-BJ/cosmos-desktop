## 다음 세션 재개 포인트 (Day 17+)

### 직전 완료
- **M8 "First Voyage" 일괄 커밋** (Step 1 + 2 + 3, 5e9703b)
  - Step 1 (Fly-to): `CameraAnimator` 직접 lerp + rAF + easeInOutCubic, 800ms duration, OrbitControls 일시 비활성, 더블 클릭 → 노드 부근 비행
  - Step 2 (검색): Cmd/Ctrl+F 좌측 Spotlight 패널 (pointer-events 트릭으로 캔버스 보존), substring + matchStart/length 정렬, 매칭 금빛 + 1.5× / 비매칭 거의 검정 / 호버 흰빛 + 2.0×, M4 highlight 도 scale 동기
  - Step 3 (Auto-fit): `computeFitView` AABB + FOV 기반 distance, isLast 청크 자동 fit + 우상단 ⌂ HomeButton, 세 경로 (더블클릭/검색/홈) 모두 같은 CameraAnimator
- **M7.5 부채 청산** (별도 fix 커밋 3be4e4c)
  - Raycaster 폐기 (GPU Picker 대체) + ESC 콜백 분리 (`onEscClear`)
  - chunk_id reset on new scan (휴리스틱 — `chunkId === 0` 자동 리셋)
  - Max Pixel Size clamp (`uMaxPixelRatio`, 기본 H×0.1 상한)
- "First Voyage" 마일스톤 완성. M8 종료.
- 테스트: cargo 41/41 (변동 없음), vitest 134 → **163** (+29 누적), tsc clean

### 다음 할 일

#### 1. M9 진입 후보 (Gemini 자문 권장)
- **CRUD + 영속성**: 비-파일 노드 (메모/링크/태그/주석) SQLite 저장 — tauri-plugin-sql 이미 와이어드
- **파일시스템 watcher (notify crate)**: 외부에서 파일 변경 시 자동 반영 + 스캔 트리거
- **AI 통합**: Claude API / 로컬 LLM 으로 노드 자동 분류/태깅/검색 강화
- **다른 차별화**: 컬렉션 (드래그 멀티 선택), 가상 폴더, 시간축 (modified 기준 클러스터)
- 셋~넷 중 우선순위 결정 필요. 차별화 정도 + 구현 비용 + 타겟 사용자 가치로 평가.

#### 2. 알려진 후속 작업 (M9 또는 그 이후 카드)
- **검색 emissive bloom**: 현재는 instanceColor 단순 곱셈. PBR 추가 비용으로 별 자체가 발광하는 효과 가능.
- **검색 매칭이 시야 밖일 때**: Auto-fit 의 변형 — 매칭 노드만 bbox 잡아 fit. 결과 클릭 안 해도 자동.
- **호버 시각 효과 (Step 2 옵션 B/C)**: 호버 노드 instanceColor 부드러운 펄스 — 시간 기반 sin wave.
- **CameraAnimator easing 변종**: 노드 거리 비례 duration (멀리 가면 더 오래).
- **HoverTooltip JSX 단위 테스트 미작성**: vitest 환경 node — happy-dom 도입 시 SearchOverlay, HomeButton, HoverTooltip 일괄 가능.
- **호버 시각 효과 (Step 2 옵션 B/C)**: 호버 노드 펄스.
- **chunk_id reset 휴리스틱 한계**: 빈 스캔 (0 노드) → 0 청크 1개만 도착하는 케이스에서 단조 검증 무력화. 명시적 reset API 가 더 안전 (M9+ 카드).
- **모바일/터치 인터랙션**: 핀치 줌, 두 손가락 회전, 더블탭 fly-to. PointerEvents 는 이미 지원.
- **빌드/배포 (인스톨러)**: `tauri build` + 코드사인 + Windows MSI / macOS dmg 자동화.

### 사전 정리된 결정 (재논의 X)
- 좌표 알고리즘: Fractal Orbital Packing
- 거리 스케일: D1=100K / D2=10K / ... / D5=10
- 인스턴스 스케일: D0=5000 / D1=500 / D2=50 / D3=5 / D4=0.5 / D5+=0.05
- Picking: Color Buffer (Offscreen 1×1 RT)
- 셰이더: `uTanHalfFov` (P11 대체) + `uMaxPixelRatio` (상한)
- 호버 throttle: rAF + Dirty Flag
- 호버 UI: Screen Projected CSS 툴팁
- 카메라 애니메이션: 직접 lerp + rAF + easeInOutCubic, 800ms
- 검색: substring (정규식/퍼지 X), Cmd/Ctrl+F, 좌측 사이드 패널
- 매칭 시각: 금빛 (1.0, 0.85, 0.0) + 1.5×, 비매칭 (0.02, 0.02, 0.04), 호버 (1.0, 1.0, 1.0) + 2.0×
- Auto-fit: AABB 대각구 + FOV 기반 distance, padding 1.1
- 의존성 0 정책: gsap/TWEEN/lodash 모두 미도입

### 주의
- 시각 검증 스크린샷은 사용자 직접 업로드
- 메인/픽커 셰이더는 같은 `uTanHalfFov`, `uMaxPixelRatio` 값을 공유해야 식 drift 0 — App.tsx 에서 한 번만 계산해 양쪽 주입
- CameraAnimator 가 OrbitControls.enabled 를 false 로 만들 때 CameraController 의 pan/wheel 핸들러도 같이 차단 (strict-false 체크)
- `applyMatchHighlight` 는 O(count) per 호출 — 검색 매 keystroke 마다 발사되므로 10k+ 청크 시 성능 측정 필요 (M9+ 카드)

### 이슈 1 후속 (학습 정리, 미진행)
- 노션에 "막힌 문제 카드" + 학습 노트 작성
  - StrictMode 더블 마운트 + 비동기 listen Promise race
  - cancelled 클로저 패턴이 표준 해법인 이유
  - sceneRef 가드만으로 무력화되는 경로 도식화
  - (M7-2 추가) `setViewOffset` 의 `projectionMatrix` 부작용 — picker 셰이더가 main 과 같은 P11 을 쓰면 결과가 어긋나는 함정
  - (M8 추가) 직접 lerp + rAF 가 gsap 대비 의존성 0 으로 충분히 부드러운 이유 — 800ms × 144fps ≈ 115 프레임이라 easing 곡선이 시각적으로 매끄러움
