import type { NodeDetails } from "../lib/bindings";
import { formatBytes, formatTimestamp, kindLabel } from "./nodeDetailsFormat";

/**
 * NodeDetailsPanel — 선택된 노드의 메타데이터 표시 패널 (M5: First Meaning)
 *
 * 위치: 우측 상단 고정. 좌측 상단의 ui-panel(노드 개수/선택 ID 표시)과 충돌 X.
 *
 * 표시 정책:
 * - details === null → 컴포넌트 자체를 렌더하지 않음 (return null).
 *   → "선택 해제" 시 패널이 사라지는 시각적 피드백.
 * - 경로(path)는 길어질 수 있으므로 .truncate 클래스로 한 줄 자르기.
 * - 모든 라벨은 한국어 (CLAUDE.md §6 커뮤니케이션 규칙).
 *
 * Props:
 * - details: store.selectedNodeDetails 를 그대로 전달.
 *   App.tsx에서 useCosmosStore selector로 구독한 결과를 prop drilling.
 */
interface NodeDetailsPanelProps {
  details: NodeDetails | null;
}

export function NodeDetailsPanel({ details }: NodeDetailsPanelProps) {
  if (details === null) return null;

  return (
    <div className="node-details-panel">
      <h3 className="node-details-panel__title">{details.name}</h3>
      <dl className="node-details-panel__list">
        <dt>경로</dt>
        <dd className="node-details-panel__path" title={details.path}>
          {details.path}
        </dd>

        <dt>타입</dt>
        <dd>{kindLabel(details.kind)}</dd>

        <dt>크기</dt>
        <dd>{formatBytes(details.sizeBytes)}</dd>

        <dt>수정일</dt>
        <dd>{formatTimestamp(details.modifiedAt)}</dd>
      </dl>
    </div>
  );
}
