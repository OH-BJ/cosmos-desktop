/**
 * HomeButton — 별자리 전체 보기 트리거 버튼 (M8 Step 3).
 *
 * 우상단 절대 위치. 클릭 시 onAutoFit 콜백 호출 → App 이 AutoFit 계산 + Fly-to.
 *
 * 키보드 단축키나 컨텍스트 메뉴는 후속 — 1차 UX 는 명시적 마우스 클릭.
 */

export interface HomeButtonProps {
  onAutoFit: () => void;
}

export function HomeButton({ onAutoFit }: HomeButtonProps) {
  return (
    <button
      type="button"
      className="home-button"
      onClick={onAutoFit}
      aria-label="전체 별자리 보기"
      title="전체 별자리 보기"
    >
      ⌂
    </button>
  );
}
