import { useEffect, useRef } from "react";
import { useCosmosStore } from "../state/store";

/**
 * HoverTooltip — 호버된 노드 이름을 노드 위에 띄우는 DOM 툴팁 (M7-2 Step 2).
 *
 * 설계 결정:
 *   - 3D 객체가 아닌 **DOM 박스**로 띄운다 — three.js 텍스처/스프라이트 대비 DPI 선명,
 *     접근성(텍스트 select 안 됨), z-index 조작 자유.
 *   - **pointer-events: none** — 캔버스 마우스 이벤트(클릭/드래그) 를 방해하지 않는다.
 *   - **React state 회피** — hoveredNodeId 변경 시 rAF 시작/종료만 hook 으로 처리,
 *     매 프레임 위치 갱신은 div.style 직접 조작 (재렌더 없음). 144 FPS 유지.
 *
 * Data flow:
 *   store.hoveredNodeId 변화 → useEffect 실행 →
 *     id 있으면 rAF 루프 시작 (매 프레임 getProjection() 호출 → DOM transform/text 갱신)
 *     id 없으면 div hidden + rAF 취소.
 *
 * getProjection 는 App 이 주입 — Scene/Camera/Buffer 에 대한 클로저를 안에 담아
 * HoverTooltip 자체는 어떤 three.js 객체도 직접 알지 않는다 (테스트 용이).
 */

export interface HoverTooltipProjection {
  /** 화면 픽셀 X (CSS, 캔버스 좌상단 기준 0). */
  screenX: number;
  /** 화면 픽셀 Y. */
  screenY: number;
  /** 표시할 노드 이름. */
  name: string;
}

export interface HoverTooltipProps {
  /**
   * 현재 호버된 노드의 화면 위치 + 이름을 계산해 반환.
   *   null = 표시 안 함 (카메라 뒤, 노드 없음, 매핑 없음 등).
   *   매 프레임 호출되므로 가벼워야 함 (Vector3 재사용 권장).
   */
  getProjection: () => HoverTooltipProjection | null;
}

export function HoverTooltip({ getProjection }: HoverTooltipProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const hoveredId = useCosmosStore((s) => s.hoveredNodeId);

  useEffect(() => {
    const div = divRef.current;
    if (!div) return;

    // 호버 해제 시: 즉시 숨기고 rAF 도 안 돌린다 (CPU 절약).
    if (hoveredId === null) {
      div.style.display = "none";
      return;
    }

    // 호버 진입: rAF 루프 시작. requestAnimationFrame 이 없는 환경(test) 에서는 1회만 처리.
    let rafId: number | null = null;
    const tick = () => {
      const proj = getProjection();
      if (!proj) {
        div.style.display = "none";
      } else {
        // 위치는 left/top 으로 직접 픽셀 지정. transform translate(-50%, -100%) 는 CSS 가 담당.
        //   → 마우스 위쪽으로 살짝 올라온 위치에 표시.
        div.style.left = `${proj.screenX}px`;
        div.style.top = `${proj.screenY}px`;
        div.style.display = "block";
        if (div.textContent !== proj.name) {
          div.textContent = proj.name;
        }
      }
      if (typeof requestAnimationFrame === "function") {
        rafId = requestAnimationFrame(tick);
      }
    };
    tick();

    return () => {
      if (rafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
      // unmount/호버 해제 시 박스 숨김 — 잔재 표시 방지.
      div.style.display = "none";
    };
  }, [hoveredId, getProjection]);

  // 초기엔 hidden. 실제 표시는 useEffect 내부에서 display 토글로 제어.
  return <div ref={divRef} className="hover-tooltip" style={{ display: "none" }} />;
}
