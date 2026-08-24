/**
 * Markdown 导出序列化（纯函数）：三个视图把正式数据映射为统一结构，
 * 此处负责渲染成 Markdown。不读 DOM、不依赖视图实现。
 */

export interface ExportMarkdownSection {
  heading: string;
  /** 表格：rows 每项为一行单元格数组；普通列表：rows 每项为单元素数组。 */
  rows: ReadonlyArray<readonly string[]>;
  kind?: "table" | "list";
}

export interface ExportMarkdownDocument {
  title: string;
  generatedAt: string;
  sections: ExportMarkdownSection[];
}

const escapeCell = (value: string): string =>
  value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();

const formatGeneratedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
};

const renderTable = (rows: ReadonlyArray<readonly string[]>): string => {
  if (rows.length === 0) return "";
  const columnCount = Math.max(...rows.map((row) => row.length));
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const headerLine = Array.from(
    { length: columnCount },
    (_, index) => escapeCell(header[index] ?? "")
  ).join(" | ");
  const separator = Array.from(
    { length: columnCount },
    () => "---"
  ).join(" | ");
  const bodyLines = body.map((row) =>
    Array.from(
      { length: columnCount },
      (_, index) => escapeCell(row[index] ?? "")
    ).join(" | ")
  );
  return [`| ${headerLine} |`, `| ${separator} |`, ...bodyLines.map((line) => `| ${line} |`)].join("\n");
};

const renderList = (rows: ReadonlyArray<readonly string[]>): string =>
  rows
    .map((row) => `- ${escapeCell(row[0] ?? "")}`)
    .filter((line) => line.length > 2)
    .join("\n");

export const renderExportMarkdown = (
  document: ExportMarkdownDocument
): string => {
  const parts: string[] = [];
  parts.push(`# ${document.title}`);
  parts.push("");
  parts.push(`> 导出时间：${formatGeneratedAt(document.generatedAt)}`);
  parts.push("");

  for (const section of document.sections) {
    if (section.rows.length === 0) continue;
    parts.push(`## ${section.heading}`);
    parts.push("");
    parts.push(
      section.kind === "list"
        ? renderList(section.rows)
        : renderTable(section.rows)
    );
    parts.push("");
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
};
