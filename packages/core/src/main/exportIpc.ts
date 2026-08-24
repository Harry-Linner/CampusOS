import { dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ExportSaveInput, ExportSaveResult } from "../shared/exportBridge";
import { assertTrustedRenderer } from "./ipcSecurity";

const MAX_PNG_BYTES = 20 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

const isExportSaveInput = (value: unknown): value is ExportSaveInput => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ExportSaveInput>;
  return (
    typeof candidate.suggestedName === "string" &&
    candidate.suggestedName.length > 0 &&
    candidate.suggestedName.length <= 255 &&
    typeof candidate.content === "string" &&
    candidate.content.length <= MAX_MARKDOWN_BYTES * 2 &&
    (candidate.kind === "markdown" || candidate.kind === "png")
  );
};

const saveExportFile = async (
  input: ExportSaveInput
): Promise<ExportSaveResult> => {
  const extension = input.kind === "png" ? "png" : "md";
  const safeName = basename(input.suggestedName).replace(
    /[\\/:*?"<>|]/g,
    "-"
  );
  const defaultName = safeName.toLowerCase().endsWith(`.${extension}`)
    ? safeName
    : `${safeName}.${extension}`;
  const result = await dialog.showSaveDialog({
    title: input.kind === "png" ? "导出图片" : "导出 Markdown",
    defaultPath: defaultName,
    filters:
      input.kind === "png"
        ? [{ name: "PNG 图片", extensions: ["png"] }]
        : [{ name: "Markdown", extensions: ["md"] }]
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true, path: null };
  }

  if (input.kind === "png") {
    const dataUrl = input.content;
    const commaIndex = dataUrl.indexOf(",");
    const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
    const buffer = Buffer.from(base64, "base64");
    if (buffer.byteLength > MAX_PNG_BYTES) {
      throw new Error("导出图片超过大小限制。");
    }
    await writeFile(result.filePath, buffer);
  } else {
    const content = Buffer.from(input.content, "utf8");
    if (content.byteLength > MAX_MARKDOWN_BYTES) {
      throw new Error("导出内容超过大小限制。");
    }
    await writeFile(result.filePath, content);
  }
  return { canceled: false, path: result.filePath };
};

export const registerExportHandlers = (): void => {
  ipcMain.handle("campusos:export:save", async (event, input: unknown) => {
    assertTrustedRenderer(event);
    if (!isExportSaveInput(input)) {
      throw new Error("导出参数无效。");
    }
    return saveExportFile(input);
  });
};
