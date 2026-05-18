import { useEffect, useMemo, useRef, useState } from "react";
import { searchNodes, type SearchHit } from "../canvas/search";

/**
 * SearchOverlay — Spotlight 스타일 노드 검색 오버레이 (M8 Step 2).
 *
 * PLAN_M8 결정:
 *  - Cmd/Ctrl + K 로 토글.
 *  - ESC 로 닫기 + 매칭 클리어.
 *  - substring 매칭, 최대 20 결과.
 *  - 결과 클릭 → onSelectNode(index) → App 이 fly-to.
 *  - 매칭 결과 변경 시 onMatchesChanged(matched) → App 이 InstancedNodes.applyMatchHighlight.
 *
 * Lazy 패턴 결정:
 *  - getNames/getPaths 를 함수로 받음 (배열 직접 prop X) — 매 query 마다 최신 매핑 조회.
 *    bridge.indexToName 가 청크 도착마다 자라기 때문에 snapshot 이면 stale.
 *  - 검색은 매 keystroke 마다 동기 실행 (10k 이름 < 1ms — debounce 불필요).
 *
 * 접근성:
 *  - 입력창 자동 포커스. ESC/Cmd+F 글로벌 단축키 (Windows 표준 Find 와 일치).
 *  - 결과 항목은 키보드 ↑/↓ 미지원 (Step 2 minimal). Enter = 마우스 hover 가 아닌 클릭 필수.
 *    M9+ 카드.
 */

export interface SearchOverlayProps {
  /** indexToName getter — 매 호출마다 최신 매핑. */
  getNames: () => readonly string[];
  /** indexToPath getter — 결과 부제목. */
  getPaths: () => readonly string[];
  /** 결과 클릭 시 호출. App 이 fly-to + 닫기. */
  onSelectNode: (index: number) => void;
  /**
   * 매칭 결과 변경 시 호출 (search-on 상태 진입/이탈, query 변경, 닫기).
   *   matched=null → 검색 비활성 (모든 노드 NORMAL 복원).
   *   matched=Set  → 그 인스턴스 ID 집합만 highlight, 나머지 dim.
   */
  onMatchesChanged: (matched: ReadonlySet<number> | null) => void;
  /**
   * onResultHover — 결과 리스트 항목 호버 진입/이탈 시 호출 (M8 Step 2 UX).
   *   index=number → 해당 인스턴스 강조. null → 이탈 (복원).
   *   App 이 InstancedNodes.setHoveredInList 에 위임.
   */
  onResultHover: (index: number | null) => void;
}

export function SearchOverlay({
  getNames,
  getPaths,
  onSelectNode,
  onMatchesChanged,
  onResultHover,
}: SearchOverlayProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+F 토글 + ESC 닫기. 글로벌 keydown 으로 캔버스 외부에서도 동작.
  //   F = Windows/macOS 표준 Find — preventDefault 로 브라우저 기본 페이지 검색 차단.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // 열림 시 입력창 자동 포커스.
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open]);

  // 매칭 결과 — query 변경 시 재계산. open 닫혀있으면 빈 배열로 강제.
  const results: SearchHit[] = useMemo(() => {
    if (!open) return [];
    return searchNodes(query, getNames(), 20);
  }, [open, query, getNames]);

  // 매칭 변경을 App 에 통보 (사이드 이펙트). 닫혀있거나 빈 query 면 null 로 클리어.
  useEffect(() => {
    if (!open || query.trim().length === 0) {
      onMatchesChanged(null);
      return;
    }
    const matched = new Set<number>(results.map((r) => r.index));
    onMatchesChanged(matched);
    // 닫힐 때 cleanup 으로 null 호출은 useEffect 의 의존성 변경 시 자동 발생.
  }, [open, query, results, onMatchesChanged]);

  // 언마운트 시 매칭 클리어 — App 이 InstancedNodes 색상을 NORMAL 로 복원.
  useEffect(() => {
    return () => onMatchesChanged(null);
  }, [onMatchesChanged]);

  if (!open) return null;

  const paths = getPaths();

  return (
    <div className="search-overlay" role="dialog" aria-label="노드 검색">
      <div className="search-overlay__panel">
        <input
          ref={inputRef}
          className="search-overlay__input"
          type="text"
          placeholder="이름으로 노드 검색 (Esc 로 닫기)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <ul className="search-overlay__results">
            {results.map((hit) => (
              <li
                key={hit.index}
                className="search-overlay__result"
                onMouseEnter={() => onResultHover(hit.index)}
                onMouseLeave={() => onResultHover(null)}
                onClick={() => {
                  // 클릭 시점에 호버도 해제 — fly-to 시작 후 잔재 발광 방지.
                  onResultHover(null);
                  onSelectNode(hit.index);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="search-overlay__result-name">{hit.name}</span>
                <span className="search-overlay__result-path">
                  {paths[hit.index] ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {query.trim().length > 0 && results.length === 0 && (
          <p className="search-overlay__empty">매칭된 노드 없음</p>
        )}
      </div>
    </div>
  );
}
