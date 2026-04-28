import { describe, it, expect } from "vitest";
import {
  parseDepth,
  validatePath,
  MIN_DEPTH,
  MAX_DEPTH,
} from "./scanControlHelpers";

/**
 * scanControlHelpers 단위 테스트 (M6-2 Step 3).
 *
 * 컴포넌트 본체(.tsx) 는 React 환경(jsdom + testing-library) 이 필요해 별도 .test.tsx
 * 로 분리하지만 — 현재 vitest config 는 .test.ts 만 include — 검증 로직을 순수
 * 함수로 떼어내 여기서 커버한다.
 */
describe("parseDepth", () => {
  it("정상 정수 → ok 반환", () => {
    const r = parseDepth("5");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
  });

  it("MIN_DEPTH(0) 경계 통과", () => {
    expect(parseDepth(String(MIN_DEPTH))).toEqual({ ok: true, value: MIN_DEPTH });
  });

  it("MAX_DEPTH(32) 경계 통과", () => {
    expect(parseDepth(String(MAX_DEPTH))).toEqual({ ok: true, value: MAX_DEPTH });
  });

  it("범위 초과 → 에러", () => {
    const r = parseDepth("33");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("범위");
  });

  it("음수 → 에러", () => {
    expect(parseDepth("-1").ok).toBe(false);
  });

  it("소수 → 에러 (정수만 허용)", () => {
    expect(parseDepth("3.5").ok).toBe(false);
  });

  it("문자/혼합 → 에러", () => {
    expect(parseDepth("12abc").ok).toBe(false);
    expect(parseDepth("abc").ok).toBe(false);
  });

  it("빈 문자열/공백 → '빈 입력' 에러", () => {
    const a = parseDepth("");
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toContain("입력");

    const b = parseDepth("   ");
    expect(b.ok).toBe(false);
  });
});

describe("validatePath", () => {
  it("정상 경로 → ok", () => {
    expect(validatePath("C:\\Users\\test").ok).toBe(true);
    expect(validatePath("/home/user").ok).toBe(true);
    expect(validatePath("~/Documents").ok).toBe(true);
  });

  it("빈 문자열 → 에러", () => {
    const r = validatePath("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("경로");
  });

  it("공백만 → 에러", () => {
    expect(validatePath("    ").ok).toBe(false);
  });
});
