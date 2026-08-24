/**
 * `.campusmod` 能力声明审计：静态扫描入口代码实际引用的敏感 API，
 * 与 manifest 声明的权限比对，输出"已核验 / 存疑"结论与逐条发现。
 *
 * 纯静态、无执行、无依赖；结果仅用于安装确认提示与用户知情，
 * 执行边界仍由沙箱负责。
 */

export type CapabilityFindingCategory =
  | "network"
  | "storage"
  | "privileged"
  | "eval";

export interface CapabilityFinding {
  category: CapabilityFindingCategory;
  detail: string;
  line?: number;
}

export interface CapabilityAudit {
  status: "verified" | "suspicious";
  findings: CapabilityFinding[];
}

const NETWORK_CALL_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfetch\s*\(/g, label: "fetch" },
  { pattern: /\bXMLHttpRequest\b/g, label: "XMLHttpRequest" },
  { pattern: /\bWebSocket\s*\(/g, label: "WebSocket" },
  { pattern: /\bnavigator\.sendBeacon\s*\(/g, label: "navigator.sendBeacon" },
  { pattern: /\bEventSource\s*\(/g, label: "EventSource" }
];

const STORAGE_CALL_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\blocalStorage\b/g, label: "localStorage" },
  { pattern: /\bindexedDB\b/g, label: "indexedDB" },
  { pattern: /\bdocument\.cookie\b/g, label: "document.cookie" }
];

const PRIVILEGED_CALL_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bwindow\.campusos\b/g, label: "window.campusos（宿主桥）" },
  { pattern: /\bipcRenderer\b/g, label: "ipcRenderer" },
  { pattern: /\bipcMain\b/g, label: "ipcMain" },
  { pattern: /\bprocess\./g, label: "process 全局" },
  { pattern: /\brequire\s*\(/g, label: "require（Node 模块）" },
  { pattern: /\bchild_process\b/g, label: "child_process" },
  { pattern: /\bnode:\w+/g, label: "node: 内置模块" }
];

const EVAL_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\beval\s*\(/g, label: "eval" },
  { pattern: /\bnew\s+Function\s*\(/g, label: "new Function" }
];

/** 轻量剥除字符串与注释，降低误报（不追求完整解析）。 */
const stripStringsAndComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n\r]*/g, " ")
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, " ")
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, " ")
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, " ");

/** 只剥注释、保留字符串：用于提取代码中真实出现的 URL 字面量（注释里的 URL 不算）。 */
const collectCommentRanges = (
  source: string
): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    ranges.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  // 注意：行注释匹配可能命中字符串内的 "https://"，其区间起点在 // 之前，
  // URL 匹配起点在 "https:"（早于该区间），因此不会被误排除。
  for (const match of source.matchAll(/\/\/[^\n\r]*/g)) {
    ranges.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return ranges;
};

const extractHttpOrigins = (source: string): string[] => {
  const ranges = collectCommentRanges(source);
  const origins = new Set<string>();
  const pattern = /https?:\/\/([a-z0-9.-]+)(?::\d+)?/gi;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (ranges.some((range) => start >= range.start && start < range.end)) {
      continue;
    }
    const host = match[1].toLowerCase();
    const scheme = match[0].toLowerCase().startsWith("https") ? "https" : "http";
    origins.add(`${scheme}://${host}`);
  }
  return [...origins].sort();
};

const findOccurrences = (
  source: string,
  pattern: RegExp
): Array<{ line?: number }> => {
  const occurrences: Array<{ line?: number }> = [];
  for (const match of source.matchAll(pattern)) {
    const before = source.slice(0, match.index);
    occurrences.push({
      line: before.split("\n").length
    });
  }
  return occurrences;
};

const isOriginDeclared = (
  origin: string,
  permissions: readonly string[]
): boolean => {
  const parsed = origin.startsWith("https://")
    ? { scheme: "https", host: origin.slice(8) }
    : { scheme: "http", host: origin.slice(7) };
  return permissions.some((permission) => {
    const declared = permission.startsWith("network:")
      ? permission.slice(8)
      : permission.startsWith("auth:service:")
        ? permission.slice(13)
        : null;
    if (!declared) return false;
    try {
      const url = new URL(declared);
      return (
        url.protocol === `${parsed.scheme}:` &&
        url.hostname === parsed.host
      );
    } catch {
      return false;
    }
  });
};

/** 扫描单个入口源码，返回逐条发现（不含权限比对结论）。 */
export const scanEntrySource = (source: string): CapabilityFinding[] => {
  const code = stripStringsAndComments(source);
  const findings: CapabilityFinding[] = [];
  const push = (
    category: CapabilityFindingCategory,
    label: string,
    occurrences: Array<{ line?: number }>
  ): void => {
    for (const occurrence of occurrences) {
      findings.push({
        category,
        detail: `检测到 ${label} 调用`,
        line: occurrence.line
      });
    }
  };

  for (const { pattern, label } of NETWORK_CALL_PATTERNS) {
    push("network", label, findOccurrences(code, pattern));
  }
  for (const { pattern, label } of STORAGE_CALL_PATTERNS) {
    push("storage", label, findOccurrences(code, pattern));
  }
  for (const { pattern, label } of PRIVILEGED_CALL_PATTERNS) {
    push("privileged", label, findOccurrences(code, pattern));
  }
  for (const { pattern, label } of EVAL_PATTERNS) {
    push("eval", label, findOccurrences(code, pattern));
  }
  for (const origin of extractHttpOrigins(source)) {
    findings.push({
      category: "network",
      detail: `代码中出现网络来源：${origin}`
    });
  }
  return findings;
};

/** 汇总审计：网络/存储用法须有对应声明；特权面与 eval 任何出现即存疑。 */
export const buildCapabilityAudit = (
  entrySources: Record<string, string | undefined>,
  permissions: readonly string[]
): CapabilityAudit => {
  const findings: CapabilityFinding[] = [];
  for (const [entryName, source] of Object.entries(entrySources)) {
    if (!source) continue;
    for (const finding of scanEntrySource(source)) {
      const prefixed: CapabilityFinding = {
        ...finding,
        detail: `[${entryName}] ${finding.detail}`
      };
      if (finding.category === "network") {
        const originMatch = finding.detail.match(
          /https?:\/\/[a-z0-9.-]+/i
        );
        if (originMatch && isOriginDeclared(originMatch[0], permissions)) {
          continue; // 已声明的网络来源不构成存疑
        }
        if (originMatch) {
          findings.push(prefixed);
          continue;
        }
        // fetch 等调用但无字面量来源 → 需存在任意 network 声明才算覆盖
        if (permissions.some((permission) => permission.startsWith("network:"))) {
          continue;
        }
        findings.push(prefixed);
        continue;
      }
      if (finding.category === "storage") {
        if (
          permissions.includes("storage:local") ||
          permissions.some((permission) => permission.startsWith("storage:domain:"))
        ) {
          continue;
        }
        findings.push(prefixed);
        continue;
      }
      // privileged / eval：user 插件不授予，任何出现即存疑
      findings.push(prefixed);
    }
  }
  return {
    status: findings.length > 0 ? "suspicious" : "verified",
    findings
  };
};
