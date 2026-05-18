import { describe, it, expect } from "vitest";
import { searchNodes } from "./search";

/**
 * searchNodes 단위 테스트 (M8 Step 2).
 *
 * 검증:
 *  - 빈 query / 공백 only → 빈 결과 (검색 비활성).
 *  - substring 대소문자 무시.
 *  - 정렬: matchStart ASC, 동률이면 name.length ASC.
 *  - maxResults 제한 (기본 20).
 */

const SAMPLE = [
  "Documents",       // 0
  "downloads",       // 1
  "doc.txt",         // 2
  "readme.md",       // 3
  "DOC_archive",     // 4
  "scripts",         // 5
  "another-doc",     // 6 (matchStart = 8)
];

describe("searchNodes", () => {
  it("빈 query → 빈 결과 (검색 OFF 의미)", () => {
    expect(searchNodes("", SAMPLE)).toEqual([]);
    expect(searchNodes("   ", SAMPLE)).toEqual([]);
  });

  it("substring 대소문자 무시 — 'doc' 이 5개 매칭", () => {
    const hits = searchNodes("doc", SAMPLE);
    const indices = hits.map((h) => h.index);
    // Documents(0), downloads(X — doc 미포함), doc.txt(2), DOC_archive(4), another-doc(6).
    //   downloads 는 "doc" 없음. 확인: d-o-w-n-l-o-a-d-s → 아니. 확인 결과 4개.
    expect(indices).toEqual(expect.arrayContaining([0, 2, 4, 6]));
    expect(indices).toHaveLength(4);
  });

  it("정렬: matchStart ASC 먼저, 동률이면 name.length ASC", () => {
    const hits = searchNodes("doc", SAMPLE);
    // matchStart=0: Documents(9), doc.txt(7), DOC_archive(11)
    //   짧은 doc.txt 가 먼저, Documents, DOC_archive 순.
    // matchStart=8: another-doc.
    const order = hits.map((h) => h.name);
    expect(order[0]).toBe("doc.txt");
    expect(order[1]).toBe("Documents");
    expect(order[2]).toBe("DOC_archive");
    expect(order[3]).toBe("another-doc");
  });

  it("maxResults 제한 — 3개로 자르기", () => {
    const hits = searchNodes("doc", SAMPLE, 3);
    expect(hits).toHaveLength(3);
  });

  it("매칭 0건 → 빈 배열", () => {
    const hits = searchNodes("xyz_no_match_at_all", SAMPLE);
    expect(hits).toEqual([]);
  });

  it("SearchHit 의 matchStart 가 정확 (대소문자 무관)", () => {
    const hits = searchNodes("DOC", SAMPLE);
    const docTxt = hits.find((h) => h.name === "doc.txt")!;
    expect(docTxt.matchStart).toBe(0);
    const another = hits.find((h) => h.name === "another-doc")!;
    expect(another.matchStart).toBe(8);
  });
});
