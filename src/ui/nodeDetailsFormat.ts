import type { NodeKind } from "../lib/bindings";

/**
 * NodeDetails 표시용 포맷팅 유틸 (순수 함수, jsdom 불필요)
 *
 * NodeDetailsPanel.tsx에서 import. JSX와 분리해 단위 테스트 가능.
 */

/**
 * formatBytes — 파일 크기 사람이 읽는 문자열로 변환
 *
 * 1024 진법 (KiB/MiB 관례지만 표기는 KB/MB로 단순화).
 * 0~1023 → "N B", 1024~ → "X.X KB", 1MB↑ → "X.X MB", 1GB↑ → "X.XX GB"
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * formatTimestamp — Unix epoch ms → 로케일 문자열
 *
 * Rust에서 i64 ms로 들어오므로 그대로 Date 생성자에 전달.
 * 빈 값/0은 "—" 표시 (M5 fixture는 양수 ms이므로 예외 케이스 방어용).
 */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleString();
}

/**
 * kindLabel — NodeKind enum → 한국어 라벨
 *
 * 기획상 사용자에게는 한국어로 노출 (CLAUDE.md §6).
 * NodeKind 추가 시 컴파일 에러로 누락을 잡기 위해 switch + assertNever 사용.
 */
export function kindLabel(kind: NodeKind): string {
  switch (kind) {
    case "file":
      return "파일";
    case "directory":
      return "폴더";
    case "link":
      return "링크";
    case "memo":
      return "메모";
    default:
      // 컴파일 타임 exhaustiveness check (NodeKind 추가 시 여기서 타입 에러).
      return assertNever(kind);
  }
}

function assertNever(x: never): never {
  throw new Error(`Unhandled NodeKind: ${String(x)}`);
}
