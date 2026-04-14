import { defineConfig } from "vitest/config";

/**
 * Vitest 설정
 *
 * 순수 로직 (좌표 변환, 상태 리듀서, TypedArray 조작 등) 단위 테스트 전용.
 * three.js 렌더링/React 컴포넌트 스냅샷은 이 설정 범위 밖 (필요 시 jsdom 환경 추가).
 *
 * 테스트 파일 위치:
 * - `src/**\/*.test.ts`  — 구현 바로 옆 (co-located)
 * - `tests/unit/**\/*.test.ts` — 분리된 단위 테스트
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
