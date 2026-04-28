import { useState } from "react";
import { useCosmosStore } from "../state/store";
import { parseDepth, validatePath } from "./scanControlHelpers";

/**
 * ScanControl — 정식 디렉토리 스캔 트리거 패널 (M6-2 Step 3).
 *
 * 기능:
 *  - 디렉토리 경로 입력 (default: VITE_SCAN_TARGET 또는 Windows 사용자 홈 추정).
 *  - max_depth 입력 (default: 5).
 *  - "스캔 시작" 버튼 — 입력 검증 후 onStartScan(path, depth) prop 콜백 호출.
 *  - 진행 상태 표시 — store.scanProgress 를 직접 구독.
 *
 * 책임 경계:
 *  - 이 컴포넌트는 IPC 를 직접 호출하지 않는다. Tauri 의존성을 격리해 테스트
 *    환경에서 import 만으로 깨지지 않도록 한다 (ScanControl.tsx 자체는 컴포넌트
 *    test 가 없지만, 분리해두면 추후 .test.tsx 추가가 쉬움).
 *  - 실제 commands.startDirectoryScan / clearChunkedNodes 호출은 App.tsx 의
 *    handleStartScan 에서 수행. 이 컴포넌트는 UI + 검증만.
 */
interface ScanControlProps {
  /** 스캔 시작 시 호출. App 이 clearChunkedNodes + startScan + IPC 를 묶어서 처리. */
  onStartScan: (path: string, maxDepth: number) => void;
}

/**
 * 기본 입력값. 환경변수가 있으면 우선, 없으면 Windows 사용자 홈 추정값.
 *  - dev 머신 한정. 정식 다이얼로그는 M7+ (@tauri-apps/plugin-dialog) 로 교체.
 */
const DEFAULT_PATH =
  (import.meta.env.VITE_SCAN_TARGET as string | undefined) ??
  "C:\\Users\\User\\Documents";
const DEFAULT_DEPTH = "5";

export function ScanControl({ onStartScan }: ScanControlProps) {
  const [pathInput, setPathInput] = useState<string>(DEFAULT_PATH);
  const [depthInput, setDepthInput] = useState<string>(DEFAULT_DEPTH);
  // 진행 상태는 store 가 단일 출처. 좌상단 카운트와 같은 값을 본다.
  const scanProgress = useCosmosStore((s) => s.scanProgress);

  const pathResult = validatePath(pathInput);
  const depthResult = parseDepth(depthInput);
  const errorMessage = !pathResult.ok
    ? pathResult.error
    : !depthResult.ok
      ? depthResult.error
      : null;
  // 스캔 중에도 비활성화 (중복 호출 방지). isLast 도착 후 다시 활성화.
  const canStart = pathResult.ok && depthResult.ok && !scanProgress.isScanning;

  const handleStart = () => {
    if (!canStart || !depthResult.ok) return;
    onStartScan(pathInput.trim(), depthResult.value);
  };

  // 진행 상태 표시. lastChunkId 가 null 이면 아직 한 번도 스캔 안 한 상태.
  const statusLine = (() => {
    if (scanProgress.isScanning) {
      return `스캔 중… ${scanProgress.totalScanned}개 노드`;
    }
    if (scanProgress.lastChunkId === null) {
      return "대기 중";
    }
    return `완료: ${scanProgress.totalScanned}개`;
  })();

  return (
    <div className="scan-control">
      <h4 className="scan-control__title">디렉토리 스캔</h4>
      <label className="scan-control__row">
        <span>경로</span>
        <input
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          spellCheck={false}
          disabled={scanProgress.isScanning}
        />
      </label>
      <label className="scan-control__row">
        <span>depth</span>
        <input
          type="number"
          value={depthInput}
          onChange={(e) => setDepthInput(e.target.value)}
          min={0}
          max={32}
          disabled={scanProgress.isScanning}
        />
      </label>
      <div className="scan-control__actions">
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
        >
          {scanProgress.isScanning ? "스캔 중…" : "스캔 시작"}
        </button>
        {/* Ctrl+S 단축키도 동일 핸들러 호출 — 사용자에게 힌트 */}
        <span className="scan-control__hint">또는 Ctrl+S</span>
      </div>
      <p className="scan-control__status">{statusLine}</p>
      {errorMessage && (
        <p className="scan-control__error">{errorMessage}</p>
      )}
    </div>
  );
}
