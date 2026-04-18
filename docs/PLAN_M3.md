# PLAN_M3 — "First Dimension"

## 목표

사용자가 휠로 줌인/아웃, 드래그로 회전하며 3D 공간을 탐색할 수 있다.

## 성공 기준

- PerspectiveCamera로 전환된 상태에서 기존 팬 여전히 작동
- 휠 이벤트로 줌 in/out (깊이 이동)
- 드래그 회전 (방식은 Step 3에서 확정)
- 노드 3개가 카메라 이동/회전 시 원근감과 함께 움직이는 것 시각 확인
- 테스트 전부 통과

## Step 구성 (3개)

### Step 1: PerspectiveCamera 전환 + 기존 팬 재작동
- Scene.ts: OrthographicCamera → PerspectiveCamera
- Renderer: logarithmicDepthBuffer: true 활성화
- CameraController.ts: 드래그 팬을 Perspective 기준으로 재작성 (distance-based delta scaling)
- 기존 34개 테스트 중 카메라 관련 갱신
- 시각 확인: 어제와 동일한 장면(노드 3개 + 팬)이 Perspective로 재현
- 커밋 가치: "기존 기능 보존 증명"

### Step 2: 휠 줌
- CameraController.ts: onWheel 핸들러 추가
- Perspective 줌 = camera.position.z 이동 (fov 변경 X)
- min/max clamp
- 테스트: 줌 in/out + clamp 경계

### Step 3: 회전 + 통합 + 커밋
- 구현 방식 선택 (Step 3 착수 시 결정):
  - 후보 A: three.js 내장 OrbitControls 사용 (표준, 권장)
  - 후보 B: CameraController.ts 직접 확장 (외부 의존성 줄임)
- Alt+드래그 또는 우클릭 드래그로 궤도 회전
- 통합: 팬 + 줌 + 회전 상호 영향 확인
- tauri dev 회귀
- 커밋: feat(m3): PerspectiveCamera + 줌 + 회전 (First Dimension)

## M3 범위 밖 (미룸)

- Billboarding Shader (노드 크기 상수 유지) → M4+
- GPU Color Picking 히트테스트 → M4
- diff 동기화 → M5
- FS 스캔 → M5+
- Rust IPC CRUD → M5+

## 리스크

1. **기존 팬 로직 재작성**: Perspective 전환으로 screen→world delta 계산식 달라짐. 어제 y축 2중 반전 학습 노트 참조.
2. **초기 카메라 위치/FOV 튜닝**: 노드가 너무 멀거나 가까우면 안 보임. Step 1 시각 확인 단계에서 조정.
3. **Z-fighting**: Logarithmic Depth Buffer로 방어하되, 확인 절차 Step 1에 포함.
4. **기존 테스트 갱신 범위**: CameraController.test.ts 좌표 가정 검토 필수.

## 선행 조건

- bridge.ts 전량 재작성 방식 유지 (노드 10개 스케일)
- InstancedNodes는 Perspective에서도 작동 (사이즈 보정 없어도 3개는 보임)
