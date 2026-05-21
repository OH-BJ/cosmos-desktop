# cosmos-desktop

> 파일을 우주의 별처럼 3D로 시각화하는 데스크톱 앱.

## 한 줄 소개

17일간 Tauri + Rust + TypeScript + three.js로 만든 3D 우주 파일 탐색기. 144 FPS @ 2,200+ 노드.

## 상태

**Archived (2026-05-19)** — M1~M8 완성 후 포트폴리오 vehicle로 마무리.
재개 가능, 의무 X. 자세한 회고는 [`docs/RETROSPECTIVE.md`](./docs/RETROSPECTIVE.md), 보류 작업은 [`docs/STATUS.md`](./docs/STATUS.md).

## 데모

> 스크린샷 / GIF 자리 (TBA).

## 핵심 기능

- **Fractal Orbital Packing** 좌표 알고리즘 (D0~D5 5단계 계층)
- **GPU Color Picking** 자체 구현 (Offscreen 1×1 RT, raycaster 미사용)
- **depth-aware scale + Max Pixel Size clamp** (uTanHalfFov + uMaxPixelRatio)
- **144 FPS @ 2,200+ 노드** InstancedMesh 단일 드로콜
- **Cmd/Ctrl+F 검색** + 시각 강조 (매칭 금빛 1.5×, 비매칭 거의 검정, 호버 흰빛 2.0×)
- **더블 클릭 fly-to** + 홈 버튼 (Auto-fit AABB + FOV 기반 distance)
- **호버 툴팁** — React state 없는 DOM 직접 조작 (재렌더 0)

## 마일스톤

| ID | 이름 | 설명 |
|---|---|---|
| M1 | First Light | 3개 점이 화면에 보임 |
| M2 | First Interaction | OrbitControls 카메라 이동 |
| M3 | First Dimension | 인스턴스 자전 |
| M4 | First Selection | 클릭 / 호버 |
| M5 | First Meaning | 메타데이터 패널 |
| M6 | First Grounding | 실제 파일 시스템 스캔 + 청크 IPC |
| M7 | First Constellation | Fractal Orbital Packing + GPU Picker |
| M8 | First Voyage | Fly-to + 검색 + Auto-fit |

## 기술 스택

- **Frontend**: TypeScript, three.js r169 (R3F 없음), Zustand, TypedArray
- **Backend**: Rust, Tauri 2.x, tokio
- **IPC**: tauri-specta (타입 세이프 청크 스트리밍)
- **외부 의존성 0 정책**: gsap / TWEEN / lodash 미도입, 카메라 애니메이션 / easing / 유틸 모두 직접 구현

## 빌드 및 실행

```bash
npm install
npm run tauri dev
```

## 테스트

```bash
cargo test --lib    # Rust 41 tests
npm test            # TypeScript 163 tests
```

## 회고

17일간의 작업 회고와 마무리 결정 근거는 [`docs/RETROSPECTIVE.md`](./docs/RETROSPECTIVE.md) 참조.

## 라이선스

MIT — 자세한 내용은 [`LICENSE`](./LICENSE).
