import type {
  ExportSaveInput,
  ExportSaveResult
} from "../../shared/exportBridge";
import type { CampusosBridge } from "../../shared/campusBridge";

const resolveBridge = (): CampusosBridge["exports"] => {
  const bridge = window.campusos?.exports;
  if (!bridge || typeof bridge.save !== "function") {
    throw new Error("导出 IPC bridge 不可用。请重新启动桌面应用。");
  }
  return bridge;
};

export const saveExportText = (
  input: Omit<ExportSaveInput, "kind">
): Promise<ExportSaveResult> =>
  resolveBridge().save({ ...input, kind: "markdown" });

export const saveExportPng = (
  input: Omit<ExportSaveInput, "kind">
): Promise<ExportSaveResult> => resolveBridge().save({ ...input, kind: "png" });
