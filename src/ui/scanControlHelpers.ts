/**
 * ScanControl 보조 순수 함수 (M6-2 Step 3).
 *
 * ScanControl.tsx 본체는 React 컴포넌트라 .test.tsx 가 필요하지만, 입력 검증/파싱
 * 같은 순수 로직은 .test.ts 로 충분하다. 여기에 분리해 vitest (env: node) 에서
 * 직접 검증한다.
 */

/**
 * 사용자 입력 max_depth 검증/파싱 결과.
 *
 * @property ok 검증 통과 여부.
 * @property value ok=true 일 때만 의미 있는 정수.
 * @property error ok=false 일 때 사용자에게 보여줄 한국어 메시지.
 */
export type DepthParseResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/** 허용 max_depth 범위. 너무 깊으면 스캐너가 시스템 디렉토리까지 탐색해 부담. */
export const MIN_DEPTH = 0;
export const MAX_DEPTH = 32;

/**
 * parseDepth() — 문자열 입력을 정수 max_depth 로 변환.
 *
 *  - 공백/소수/음수/문자 → 에러.
 *  - 0 ~ 32 범위만 허용 (Rust scanner 가 u32 라 음수 자체가 의미 없음).
 *  - 빈 문자열은 "빈 입력" 에러로 명확히 구분.
 *
 * 분리 이유: ScanControl 컴포넌트의 onChange 마다 호출되며, 잘못된 입력일 때
 * 시작 버튼을 비활성화 하는 용도로도 쓰인다.
 */
export function parseDepth(raw: string): DepthParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "depth 를 입력하세요" };
  }
  // Number() 는 "12abc" → NaN. parseInt 는 "12abc" → 12 라 부적합.
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: "정수만 입력 가능" };
  }
  if (n < MIN_DEPTH || n > MAX_DEPTH) {
    return { ok: false, error: `${MIN_DEPTH} ~ ${MAX_DEPTH} 범위` };
  }
  return { ok: true, value: n };
}

/**
 * validatePath() — 경로 문자열 기본 검증.
 *
 *  - 빈 문자열 → 거부.
 *  - 그 외엔 일단 통과 (실제 존재 여부는 Rust scanner 가 검증).
 *
 * 의도적으로 Windows/Unix 형식을 모두 허용. 사용자가 `~/Documents` 를
 * 입력해도 일단 ok 로 두고 backend 에 위임한다 (Rust 가 사용자에게 친화적인
 * 에러 메시지를 돌려줌).
 */
export function validatePath(raw: string): DepthParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "경로를 입력하세요" };
  }
  return { ok: true, value: 1 };
}
