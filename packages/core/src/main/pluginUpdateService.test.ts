import { describe, expect, it, vi } from "vitest";
import { computeSha256 } from "./packageSignature";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "/tmp/campusos-plugin-updates" }
}));

import { createPluginUpdateService, type PluginUpdateCandidate } from "./pluginUpdateService";
import type { InstalledCampusmodPackage } from "./campusmodPackageRegistry";
import type { PluginManifestV2 } from "@campusos/shared";

const manifest = {
  id: "dev.example.countdown",
  name: "countdown",
  displayName: "考试倒计时",
  version: "2.0.0",
  apiVersion: 2,
  kind: "feature",
  description: "显示考试倒计时。",
  icon: "计",
  permissions: ["storage:local"],
  sourceScope: ["local"],
  releaseStage: "ready",
  provides: [],
  requires: [],
  optionalRequires: [],
  contributes: { views: [{ id: "main", title: "考试倒计时", icon: "计", location: "activity", activityTarget: "countdown" }] },
  developerPublicKey: "key"
} as unknown as PluginManifestV2;
const installed = { manifest: { ...manifest, version: "1.0.0" }, signatureStatus: "verified" } as unknown as InstalledCampusmodPackage;

describe("plugin update service", () => {
  it("discovers only newer candidates from the trusted feed", async () => {
    const candidate: PluginUpdateCandidate = { pluginId: manifest.id, version: manifest.version, packageUrl: "http://127.0.0.1:3210/countdown.campusmod", packageSha256: "a".repeat(64), manifest };
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ version: 1, generatedAt: "", updates: [candidate] }) } as Response));
    const service = createPluginUpdateService({ feedUrl: "http://127.0.0.1:3210/updates.json", fetchImpl, registry: { load: async () => ({ packages: [installed], issues: [] }) } as never });
    await expect(service.check()).resolves.toMatchObject([{ pluginId: manifest.id, version: "2.0.0" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a feed outside the trusted HTTPS source", async () => {
    const service = createPluginUpdateService({ feedUrl: "http://evil.example/updates.json", fetchImpl: vi.fn(), registry: { load: async () => ({ packages: [], issues: [] }) } as never });
    await expect(service.check()).rejects.toThrow("不受信任");
  });

  it("verifies the downloaded archive digest before installing", async () => {
    const archive = Buffer.from("signed-package");
    const candidate: PluginUpdateCandidate = { pluginId: manifest.id, version: manifest.version, packageUrl: "http://127.0.0.1:3210/countdown.campusmod", packageSha256: computeSha256(archive), manifest };
    const inspect = vi.fn(async () => ({ token: "token", manifest, signatureStatus: "verified" }));
    const install = vi.fn(async () => ({ ...installed, manifest }));
    const service = createPluginUpdateService({ feedUrl: "http://127.0.0.1:3210/updates.json", fetchImpl: vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => archive } as unknown as Response)), registry: { load: async () => ({ packages: [installed], issues: [] }), inspect, install } as never });
    await expect(service.update(candidate)).resolves.toMatchObject({ manifest: { version: "2.0.0" } });
    expect(install).toHaveBeenCalledWith("token");
  });
});
