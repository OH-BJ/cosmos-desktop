/**
 * search — 노드 이름 substring 매칭 (M8 Step 2).
 *
 * PLAN_M8 결정:
 *   - **substring 매칭, 대소문자 무시**. 정규식/퍼지 매칭은 후속 (M9+).
 *   - 결과 최대 maxResults (기본 20) — Spotlight UI 가 길게 늘어지지 않게.
 *   - 정렬: 매칭 시작 위치 ASC, 동률이면 name.length ASC (짧을수록 우선).
 *
 * 순수 함수 — 외부 상태 없음, NodeBuffer/bridge 와 결합되지 않음. 테스트 용이.
 *
 * 성능 메모: 10k 이름 substring 매칭은 한 번 순회 + indexOf 로 ms 단위.
 *   debounce 없이 매 keystroke 마다 호출해도 144 FPS 영향 무시 가능.
 */

export interface SearchHit {
  /** indexToName 의 인덱스 (= Buffer Index). */
  index: number;
  /** 매칭된 노드의 이름 (그대로 표시용). */
  name: string;
  /** 매칭 시작 위치 (정렬 키 + UI hover/bold 강조에 사용 가능). */
  matchStart: number;
}

/**
 * searchNodes — 이름 substring 매칭 결과 반환.
 *
 * @param query 사용자 입력. 빈 문자열 → 빈 배열 (search-off 상태).
 * @param names indexToName 같은 readonly 배열. 인덱스 = Buffer Index.
 * @param maxResults 최대 결과 수 (기본 20).
 * @returns SearchHit[]. matchStart 기준 ASC → name.length ASC.
 */
export function searchNodes(
  query: string,
  names: readonly string[],
  maxResults: number = 20
): SearchHit[] {
  // 공백만 입력하면 검색 안 함 — 모든 노드 dim 되는 부작용 회피.
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const hits: SearchHit[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const start = name.toLowerCase().indexOf(q);
    if (start >= 0) {
      hits.push({ index: i, name, matchStart: start });
    }
  }

  hits.sort((a, b) => {
    if (a.matchStart !== b.matchStart) return a.matchStart - b.matchStart;
    return a.name.length - b.name.length;
  });

  return hits.slice(0, maxResults);
}
