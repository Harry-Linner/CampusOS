import { saveExportPng, saveExportText } from "./exportBridge";
import {
  renderExportMarkdown,
  type ExportMarkdownDocument
} from "./exportMarkdown";

export const exportViewAsMarkdown = async (
  document: ExportMarkdownDocument,
  suggestedName: string
): Promise<void> => {
  await saveExportText({
    suggestedName,
    content: renderExportMarkdown(document)
  });
};

export const exportElementAsPng = async (
  element: HTMLElement,
  suggestedName: string
): Promise<void> => {
  // B4-2：html2canvas 只在此处使用，动态加载避免打进 renderer 首屏主包。
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(element, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true
  });
  await saveExportPng({
    suggestedName,
    content: canvas.toDataURL("image/png")
  });
};
