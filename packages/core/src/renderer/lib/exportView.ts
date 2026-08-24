import html2canvas from "html2canvas";
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
