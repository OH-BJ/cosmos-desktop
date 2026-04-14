# cosmos-desktop

> 무한 줌 가능한 2D/3D 우주 캔버스로 기존 파일 탐색기를 대체하는 데스크톱 앱.

파일, 링크, 메모를 무한 3D 공간에 자유롭게 배치하고, 프로젝트별 "행성(클러스터)"으로 관련 파일을 근처에 모읍니다. 줌아웃하면 별자리처럼, 줌인하면 개별 파일을 조작할 수 있습니다.

## 기술 스택

- **프레임워크:** Tauri 2.x (Rust 백엔드)
- **렌더러:** three.js (순수, no react-three-fiber)
- **상태 관리:** Zustand + TypedArray 이중 구조
- **파일 감시:** notify (Rust)
- **지속성:** SQLite (tauri-plugin-sql)
- **언어:** TypeScript + Rust

## 현재 상태

마일스톤 1 진행 중 — "빈 우주 공간 + 노드 1개 표시"를 목표로 한 최소 골격 단계.

## 문서

- [`CLAUDE.md`](./CLAUDE.md) — 작업 지침 (Claude Code용)
- [`docs/PLAN.md`](./docs/PLAN.md) — 마일스톤 1 실행 계획
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 아키텍처 + 의사결정 로그

## 개발 환경

- Rust 1.94.1+
- Node 24+, npm 11+
- Windows 10/11 또는 macOS (Linux는 후순위)

```bash
npm install
npm run tauri dev
```

## 라이선스

TBD
