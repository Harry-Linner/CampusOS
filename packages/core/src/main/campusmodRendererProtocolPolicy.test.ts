import { describe, expect, it, vi } from "vitest";
import type {
  PluginManifestV2,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import type { CampusmodRegistrySnapshot } from "./campusmodPackageRegistry";
import { createCampusmodRendererProtocolHandler } from "./campusmodRendererProtocolPolicy";

const manifest: PluginManifestV2 = {
  id: "dev.example.countdown",
  name: "countdown",
  displayName: "考试倒计时",
  version: "1.0.0",
  apiVersion: 2,
  kind: "feature",
  description: "显示考试倒计时。",
  icon: "Clock",
  permissions: ["storage:local"],
  sourceScope: ["local"],
  releaseStage: "ready",
  provides: [],
  requires: [],
  optionalRequires: [],
  contributes: {
    views: [{
      id: "countdown-main",
      title: "倒计时",
      icon: "Clock",
      location: "activity",
      activityTarget: "mod-dev-example-countdown"
    }]
  }
};

const createRuntime = (status: "active" | "disabled"): PluginRuntimeSnapshot => ({
  apiVersion: 2,
  generatedAt: "2026-07-19T00:00:00.000Z",
  plugins: [{
    id: manifest.id,
    manifest,
    enabled: status === "active",
    grantedPermissions: status === "active" ? ["storage:local"] : [],
    status,
    bindings: {},
    issues: []
  }]
});

const registry: CampusmodRegistrySnapshot = {
  packages: [{
    manifest,
    entrypoints: { renderer: "dist/renderer.js" },
    archiveSize: 1024,
    unpackedSize: 2048,
    fileCount: 2,
    sha256: "a".repeat(64),
    signatureStatus: "unsigned",
    installedAt: "2026-07-19T00:00:00.000Z",
    sourceFilename: "countdown.campusmod"
  }],
  issues: []
};

describe("campusmod renderer protocol policy", () => {
  it("refuses resources while an installed plugin is disabled", async () => {
    const readPackageFile = vi.fn(async () => new Uint8Array());
    const handler = createCampusmodRendererProtocolHandler({
      loadRuntime: async () => createRuntime("disabled"),
      loadPackages: async () => registry,
      readPackageFile
    });

    const response = await handler({
      method: "GET",
      url: "campusmod://dev.example.countdown/"
    });

    expect(response.status).toBe(403);
    expect(readPackageFile).not.toHaveBeenCalled();
  });

  it("serves a restrictive sandbox document and host-owned bootstrap", async () => {
    const handler = createCampusmodRendererProtocolHandler({
      loadRuntime: async () => createRuntime("active"),
      loadPackages: async () => registry,
      readPackageFile: async () => new Uint8Array()
    });

    const page = await handler({
      method: "GET",
      url: "campusmod://dev.example.countdown/"
    });
    const bootstrap = await handler({
      method: "GET",
      url: "campusmod://dev.example.countdown/__campusos__/bootstrap.js"
    });
    const csp = page.headers.get("content-security-policy") ?? "";

    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(await page.text()).toContain("/__campusos__/bootstrap.js");
    expect(await bootstrap.text()).toContain(
      'await import("/dist/renderer.js")'
    );
    expect(await handler({
      method: "POST",
      url: "campusmod://dev.example.countdown/"
    })).toMatchObject({ status: 400 });
  });

  it("serves verified package bytes without allowing another origin", async () => {
    const readPackageFile = vi.fn(async () => new TextEncoder().encode(
      "export const mount = () => undefined;"
    ));
    const handler = createCampusmodRendererProtocolHandler({
      loadRuntime: async () => createRuntime("active"),
      loadPackages: async () => registry,
      readPackageFile
    });

    const response = await handler({
      method: "GET",
      url: "campusmod://dev.example.countdown/dist/renderer.js"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8"
    );
    expect(await response.text()).toContain("mount");
    expect(readPackageFile).toHaveBeenCalledWith(
      manifest.id,
      "dist/renderer.js"
    );
    expect(await handler({
      method: "GET",
      url: "https://dev.example.countdown/dist/renderer.js"
    })).toMatchObject({ status: 400 });
  });
});
