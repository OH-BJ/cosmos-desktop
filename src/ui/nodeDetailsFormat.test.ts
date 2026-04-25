import { describe, it, expect } from "vitest";
import { formatBytes, formatTimestamp, kindLabel } from "./nodeDetailsFormat";

/**
 * 포맷터 단위 테스트 (M5 Step 2)
 *
 * NodeDetailsPanel 의 핵심 표시 로직(크기/시간/타입 라벨)을 JSX와 분리해 검증.
 * jsdom 불필요 — 순수 함수.
 */

describe("formatBytes", () => {
  it("1024 미만은 바이트", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("1KB 이상 1MB 미만은 KB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("MB / GB 단위 전환", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
  });

  it("음수/NaN은 — 표시", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
});

describe("formatTimestamp", () => {
  it("0 또는 음수는 — 표시", () => {
    expect(formatTimestamp(0)).toBe("—");
    expect(formatTimestamp(-1)).toBe("—");
  });

  it("양의 ms는 빈 문자열이 아니다", () => {
    // 로케일 의존이라 정확 매칭 대신 비어있지 않음만 확인.
    const out = formatTimestamp(1_743_552_000_000);
    expect(out).not.toBe("");
    expect(out).not.toBe("—");
  });
});

describe("kindLabel", () => {
  it("4종 모두 한국어 라벨로 변환", () => {
    expect(kindLabel("file")).toBe("파일");
    expect(kindLabel("directory")).toBe("폴더");
    expect(kindLabel("link")).toBe("링크");
    expect(kindLabel("memo")).toBe("메모");
  });
});
