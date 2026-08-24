export type ExportKind = "markdown" | "png";

export interface ExportSaveInput {
  suggestedName: string;
  content: string;
  kind: ExportKind;
}

export interface ExportSaveResult {
  canceled: boolean;
  path: string | null;
}

export interface ExportBridge {
  save: (input: ExportSaveInput) => Promise<ExportSaveResult>;
}
