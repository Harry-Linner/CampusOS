import type {
  DiagnosticExportResult,
  DiagnosticProbeResult,
  DiagnosticSnapshot,
  HealthViewSnapshot
} from "../../shared/diagnosticBridge";
import type { CampusosBridge } from "../../shared/campusBridge";

const resolveBridge = (): CampusosBridge["diagnostics"] => {
  const bridge = window.campusos?.diagnostics;
  if (
    !bridge ||
    typeof bridge.load !== "function" ||
    typeof bridge.clear !== "function" ||
    typeof bridge.exportTxt !== "function" ||
    typeof bridge.health !== "function" ||
    typeof bridge.probe !== "function"
  ) {
    throw new Error("诊断 IPC bridge 不可用。请重新启动桌面应用。");
  }
  return bridge;
};

export const loadDiagnostics = (): Promise<DiagnosticSnapshot> =>
  resolveBridge().load();

export const clearDiagnostics = (): Promise<DiagnosticSnapshot> =>
  resolveBridge().clear();

export const exportDiagnostics = (): Promise<DiagnosticExportResult> =>
  resolveBridge().exportTxt();

export const loadHealthView = (): Promise<HealthViewSnapshot> =>
  resolveBridge().health();

export const probeSource = (
  sourceId: string
): Promise<DiagnosticProbeResult> => resolveBridge().probe(sourceId);
