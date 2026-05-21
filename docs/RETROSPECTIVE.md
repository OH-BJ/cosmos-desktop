# cosmos-desktop — 17일 회고

**기간:** D1 ~ D17 (2026-04-30 ~ 2026-05-18)
**결과:** M1~M8 완성, 아카이브.
**한 줄:** "보이는 것" 부터 "공간을 항해하는 것" 까지, 인스턴스 한 점을 띄우는 일에서 GPU 색상 픽킹 + 카메라 애니메이션 + 검색 강조까지 17일에 도달.

---

## 마일스톤별 학습

### M1 First Light — "보인다"
- three.js 인스턴스 메시 단일 드로콜로 3개 점을 띄움.
- Tauri 2 + React 19 + Vite 7 골격. R3F 미선택은 옳았다 (셰이더 컨트롤이 모든 후속 마일스톤의 토대).

### M2 First Interaction — "움직인다"
- OrbitControls. 직접 카메라 컨트롤러를 짜기 전 표준 도구를 깔아두고 빠르게 진입.
- 결정: pan/zoom/rotate 모두 OrbitControls 의존, 우리는 그 위에 얹는다.

### M3 First Dimension — "살아있다"
- 인스턴스 자전. delta time + 누적 회전. 단순했지만 "공간이 살아있다" 인상이 큼.

### M4 First Selection — "내가 누른다"
- 클릭 / 호버 / 선택 색상 변경. Raycaster 로 시작. M7-2 에서 GPU Picker 로 폐기.
- 학습: 처음부터 GPU Picker 를 짜는 건 과한 투자. Raycaster 로 인터랙션 의미를 검증한 후 교체가 옳음.

### M5 First Meaning — "의미가 있다"
- Rust IPC + 메타데이터 패널. tauri-specta rc.24 로 타입 세이프 IPC.
- 청크 스트리밍 IPC 의 사전 설계는 M6 에서 빛을 봄.

### M6 First Grounding — "진짜다"
- 실제 파일 시스템 스캔 + 청크 점진 병합. notify crate 는 M9 이월.
- 어려웠던 부분: **StrictMode 더블 마운트 + 비동기 `listen` Promise race**. cancelled 클로저 + sceneRef 가드 + chunk_id 단조 검증의 3중 방어로 해결.
- 학습: React 19 StrictMode 의 이중 effect 는 비동기 리스너에 치명적. async cleanup 의 표준 해법을 익힘.

### M7 First Constellation — "별자리다"
- **Fractal Orbital Packing**: D0~D5 5단계 계층, 거리 스케일 100K → 10. 무한 줌 인상의 핵심.
- **GPU Color Picking**: Offscreen 1×1 RT, raycaster 폐기. 픽커 셰이더가 메인 셰이더와 같은 `uTanHalfFov` / `uMaxPixelRatio` 를 공유해야 식 drift 0.
- 함정: `setViewOffset` 의 `projectionMatrix` 부작용 — picker 셰이더가 main 과 같은 P11 을 쓰면 결과가 어긋남. `uTanHalfFov` 로 P11 우회.
- 학습: 셰이더 식의 drift 는 디버깅 불가능에 가깝다. 같은 식을 양쪽에 주입하는 단일 소스 원칙.

### M8 First Voyage — "여행한다"
- **Fly-to**: 직접 lerp + rAF + easeInOutCubic, 800ms. gsap/TWEEN 미도입.
  - 학습: 800ms × 144fps ≈ 115 프레임이라 easing 곡선이 시각적으로 충분히 매끄러움. 외부 라이브러리 도입 명분 없음.
- **검색**: Cmd/Ctrl+F 좌측 Spotlight 패널. substring + matchStart/length 정렬.
  - UX 시행착오: 중앙 큰 모달 → 좌측 패널로 변경 (커서 뒤 별 색상 변화 확인 가능해야 함). 강조 색상 / 크기 두 번 강화 후 "확 강조" 인상 도달.
- **Auto-fit**: AABB 대각구 + FOV 기반 distance, isLast 청크 자동 fit + ⌂ 홈 버튼.

---

## 기술적 자랑거리

1. **외부 의존성 0 정책 유지**
   - gsap / TWEEN / lodash 미도입. 카메라 애니메이션, easing, 좌표 변환, 검색 정렬 모두 직접 구현.
   - 144 FPS @ 2,200+ 노드 단일 드로콜 달성.
2. **GPU Color Picker 자체 구현**
   - Offscreen 1×1 RT. raycaster 대비 인스턴스 카운트에 무관한 O(1) 픽킹.
3. **depth-aware scale + Max Pixel Size clamp**
   - `uTanHalfFov` (P11 대체) + `uMaxPixelRatio` (상한, 기본 H×0.1).
   - 줌인해도 별이 화면을 덮지 않고, 줌아웃해도 점이 사라지지 않음.
4. **React state 없는 DOM 직접 조작 호버 툴팁**
   - 마우스 이동마다 React 재렌더 0회. rAF + Dirty Flag throttling.
5. **TDD 엄격 적용**
   - 순수 로직 (좌표 변환, 청크 병합, 검색, fly-to easing, fit view) 모두 단위 테스트 선행.
   - 최종 카운트: Rust 41 + TypeScript 163 = **204 tests**.

---

## 한계 / 아쉬운 점

- **JSX 단위 테스트 미작성**: vitest 환경이 node 라 happy-dom 도입 전. SearchOverlay / HomeButton / HoverTooltip 셋 다 시각 검증으로 대체.
- **chunk_id reset 휴리스틱**: 빈 스캔 (0 노드) → 0 청크 1개만 도착하는 엣지 케이스에서 단조 검증 무력화. 명시적 reset API 가 더 안전 (M9+ 이월).
- **검색 emissive bloom**: 현재는 `instanceColor` 단순 곱셈. PBR 추가 비용으로 별 자체 발광 가능했으나 보류.
- **파일시스템 watcher 미구현**: 외부 변경 자동 반영 불가. M6 에서 인프라는 깔았으나 notify 와이어링은 M9 이월.
- **포지셔닝 미정**: 차별화 정도 vs 구현 비용 vs 타겟 사용자 가치의 트레이드오프. M9 진입 시 Gemini 자문 권장.

---

## Gemini 자문의 가치

설계 결정마다 Gemini 의견을 받고 비판적으로 검토하는 패턴을 사용. **9번 적중** (M8 방향성 포함).
- 가치: 단독 결정으로 빠질 함정을 미리 도려냄. 특히 "옵션 A vs B" 의 함정 (상태 동기화 지옥, 의존성 폭증) 사전 식별.
- 한계: Gemini 도 구현 세부를 모르므로 "방향성" 자문에 한정. 구현 함정 (StrictMode race, 셰이더 drift) 은 직접 마주쳐야 함.

---

## 마무리 결정

**17일 기점 아카이브.** 이유:
- M1~M8 의 "최소 가치 있는 인상" 도달.
- 차별화 vs 비용 트레이드오프가 명확하지 않아 M9 진입 부담이 큼 (A/B/C/D 4갈래).
- 포트폴리오 vehicle 로서의 가치는 현 시점에 충분.
- 재개 가능, 의무 X. 보류 작업 목록은 `STATUS.md`.

---

*Last updated: 2026-05-19*
