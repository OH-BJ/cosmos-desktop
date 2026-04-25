import { commands } from "../lib/bindings";
import { useCosmosStore } from "./store";

/**
 * setupNodeDetailsSync — selectedNodeId 변화 → IPC 메타데이터 조회 → store 반영
 *
 * M5 Step 2 (First Meaning):
 *   "노드를 집은 순간, 그게 무엇인지 안다"
 *
 * 흐름:
 *   1. store.selectedNodeId 변경 (M4 클릭 핸들러)
 *   2. 이 모듈의 subscribe 콜백이 발화
 *   3. commands.getNodeDetails(id) 호출 (Rust IPC, 비동기)
 *   4. 응답 도착 시점에 selectedNodeId가 여전히 같은 ID면 setSelectedNodeDetails
 *   5. 다른 ID로 바뀌었거나 null이 되었으면 응답 폐기 (Stale Request Discard)
 *
 * # Stale Request Discard (Gemini 자문)
 * 사용자가 빠르게 노드 A → B를 클릭하면 두 IPC 호출이 in-flight 상태가 된다.
 * 네트워크/스레드 스케줄링에 따라 응답 순서가 뒤집힐 수 있고, 그 경우
 * "B를 클릭했는데 A의 메타데이터가 뜨는" race condition이 발생한다.
 * 응답 시점에 store.getState().selectedNodeId === 요청 시점의 id 인지
 * 한 번 더 확인하면 이 race를 차단할 수 있다.
 *
 * # 왜 requestId까지 추가로 체크하는가
 * 같은 ID를 두 번 연속 클릭(deselect → reselect) 한 케이스에선 selectedNodeId
 * 비교만으론 stale 판별이 안 된다 (둘 다 통과). 단조 증가 카운터를 함께 써서
 * "내가 마지막 요청인가"를 추가로 확인한다.
 *
 * # 반환값
 * 구독 해제 함수. App 컴포넌트의 useEffect cleanup에서 호출해야 한다.
 */
export function setupNodeDetailsSync(): () => void {
  // 단조 증가 요청 카운터. 마지막 요청만이 응답을 store에 반영할 자격이 있다.
  let lastRequestId = 0;

  const handleSelection = async (selectedNodeId: string | null): Promise<void> => {
    // null 선택 → IPC 호출 없이 즉시 details도 비운다.
    if (selectedNodeId === null) {
      // 카운터도 증가시켜야 in-flight 응답이 stale로 판별된다.
      lastRequestId++;
      useCosmosStore.getState().setSelectedNodeDetails(null);
      return;
    }

    const requestId = ++lastRequestId;

    try {
      const result = await commands.getNodeDetails(selectedNodeId);

      // Stale Request Discard:
      //   1) 다른 노드로 선택이 바뀌었으면 폐기
      //   2) 같은 ID 재클릭 등으로 더 새 요청이 떴으면 폐기
      if (
        useCosmosStore.getState().selectedNodeId !== selectedNodeId ||
        requestId !== lastRequestId
      ) {
        return;
      }

      if (result.status === "ok") {
        // result.data 는 NodeDetails | null (Rust Option<NodeDetails>)
        useCosmosStore.getState().setSelectedNodeDetails(result.data);
      } else {
        // 시스템 에러 — 현재 단계에선 발생하지 않지만 방어적으로 details 비움.
        console.error("getNodeDetails 응답 에러:", result.error);
        useCosmosStore.getState().setSelectedNodeDetails(null);
      }
    } catch (e) {
      // typedError가 Error 인스턴스면 throw 한다 (bindings.ts 참조).
      // IPC 채널 자체가 죽은 케이스 — 로깅만 하고 details는 손대지 않음.
      console.error("getNodeDetails 호출 실패:", e);
    }
  };

  // 초기 상태 1회 동기화. selectedNodeId가 null이면 setDetails(null)만 실행됨.
  void handleSelection(useCosmosStore.getState().selectedNodeId);

  // subscribeWithSelector 미들웨어 덕분에 selector 변경 시에만 콜백 호출.
  return useCosmosStore.subscribe(
    (state) => state.selectedNodeId,
    (selectedNodeId) => {
      void handleSelection(selectedNodeId);
    }
  );
}
