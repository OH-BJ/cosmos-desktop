# PLAN_M4 — "First Selection"

## 목표

사용자가 노드를 클릭하면 해당 노드가 선택되고, 단일 하이라이트 메시로 시각 피드백이 나타난다.

## 성공 기준

- 노드 3개 중 하나 클릭 → selectedNodeId 설정 + 하이라이트 메시 표시
- 빈 공간 클릭 또는 ESC → 선택 해제 + 하이라이트 숨김
- 팬/줌/회전과 클릭이 충돌 없이 작동 (드래그 후 뗀 것은 클릭으로 오판 X)
- InstancedMesh의 instanceColor는 건드리지 않음 (setColorAt 함정 회피)
- 테스트 전부 통과

## Step 구성 (3개)

### Step 1: Raycaster 히트테스트 + selectedNodeId 상태
- CameraController.ts에 pointer 이벤트 (mousedown/mouseup)
- 드래그/클릭 구분: mousedown~mouseup 거리 < 5px면 클릭
- 클릭 시: Raycaster.setFromCamera(NDC 좌표) + intersectObject(instancedMesh)
- intersects[0].instanceId → bridge.indexToId[] → UUID v7
- store에 setSelectedNodeId(id | null) 추가 + 호출
- 빈 공간 클릭 시 null
- OrbitControls mousedown과 충돌 안 하는지 Step 1에서 실측
- 테스트: 히트/빈공간/드래그후뗌 3케이스

### Step 2: 단일 하이라이트 메시
- Scene.ts에 highlightMesh 추가 (와이어프레임 SphereGeometry, 노드 1.2배 크기)
- 평소 visible = false
- store.selectedNodeId 구독 (subscribeWithSelector)
- selectedNodeId !== null → 해당 노드의 position 읽어 highlightMesh.position 이동 + visible = true
- selectedNodeId === null → visible = false
- InstancedMesh 완전히 건드리지 않음 (instanceColor, setColorAt 사용 금지)
- Log Depth Buffer 활성화된 씬에서 일반 Mesh가 정상 Z-test 되는지 확인
- 테스트: 선택 전환 + 해제 + 위치 일치

### Step 3: ESC 키 + 통합 + 커밋
- window keydown 이벤트 (ESC → setSelectedNodeId(null))
- dispose 시 keydown 리스너 제거 (C2 패턴)
- 팬 + 줌 + 회전 + 클릭 + ESC 모두 충돌 없이 작동
- App.tsx의 UI 텍스트에 "선택: {id 앞 8자}" 표시 (기존 "선택: 없음" 대체)
- tauri dev 시각 확인
- 커밋: feat(m4): 노드 클릭 선택 + 단일 하이라이트 (First Selection)

## M4 범위 밖 (미룸)

- GPU Color Picking → M5+ (호버링 수요 생길 때)
- 다중 선택 (Shift+클릭) → M5+
- 드래그 박스 셀렉트 → M6+
- 메타데이터 패널 (선택 노드의 이름/경로/크기 표시) → M5+ (Rust IPC 이후)
- 호버링 피드백 → M5+
- outline shader → M6+

## 리스크

1. **OrbitControls mousedown 선점**: 우클릭만 쓰도록 재매핑했지만 실제 우선순위 확인 필요. Step 1에서 실측 후 필요 시 stopPropagation.
2. **드래그/클릭 구분 임계값**: 5px 맨해튼 거리. 시간 임계값(300ms)은 생략 (우리 UX에 불필요).
3. **bridge.indexToId[] 동기화 타이밍**: 현재 하드코딩 3개 노드라 안전. diff 동기화(M5+) 도입 시 재검토.
4. **Log Depth Buffer 호환**: 일반 Mesh(highlightMesh)가 InstancedMesh와 같은 씬에서 정상 Z-test. 같은 renderer라 OK 예상, Step 2 시각 확인으로 검증.

## 선행 조건 (M3까지 완료됨)

- PerspectiveCamera → Raycaster.setFromCamera 표준 사용
- Log Depth Buffer → 깊이 판정 정확 (하이라이트 메시도 같은 설정 공유)
- bridge.idToIndex + indexToId[] 양방향 매핑 → Buffer Index → UUID v7 역변환 가능
- 이중 아키텍처 → selectedNodeId는 저빈도 업데이트 레이어에 자연 적합
- subscribeWithSelector → 선택 변경 시만 하이라이트 반응
