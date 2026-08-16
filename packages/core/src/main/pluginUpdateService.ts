import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginManifestV2 } from "@campusos/shared";
import type { CampusmodPackageRegistry, CampusmodPackageInspection, InstalledCampusmodPackage } from "./campusmodPackageRegistry";
import { computeSha256 } from "./packageSignature";

const DEFAULT_FEED_URL = "https://raw.githubusercontent.com/Harry-Linner/CampusOS/main/plugins/updates.json";
const pluginIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

export interface PluginUpdateCandidate {
  pluginId: string;
  version: string;
  packageUrl: string;
  packageSha256: string;
  manifest: PluginManifestV2;
  requiresReapproval?: boolean;
}

export interface PluginUpdateFeed {
  version: 1;
  generatedAt: string;
  updates: PluginUpdateCandidate[];
}

const compareVersions = (left: string, right: string): number => {
  const parse = (value: string): number[] => value.split("-")[0].split(".").map((part) => Number(part));
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const isTrustedUrl = (value: string, feedUrl: string): boolean => {
  try {
    const candidate = new URL(value);
    const source = new URL(feedUrl);
    const local = candidate.hostname === "127.0.0.1" || candidate.hostname === "localhost";
    return (candidate.protocol === "https:" && candidate.hostname === source.hostname) || (!app.isPackaged && local && candidate.protocol === "http:");
  } catch {
    return false;
  }
};

const isManifest = (value: unknown): value is PluginManifestV2 =>
  typeof value === "object" && value !== null &&
  typeof (value as PluginManifestV2).id === "string" &&
  typeof (value as PluginManifestV2).version === "string" &&
  pluginIdPattern.test((value as PluginManifestV2).id);

const parseFeed = (value: unknown, feedUrl: string): PluginUpdateFeed => {
  if (typeof value !== "object" || value === null || (value as PluginUpdateFeed).version !== 1 || !Array.isArray((value as PluginUpdateFeed).updates)) {
    throw new Error("插件更新清单格式无效。");
  }
  const updates = (value as PluginUpdateFeed).updates.filter((candidate): candidate is PluginUpdateCandidate => {
    if (typeof candidate !== "object" || candidate === null) return false;
    return pluginIdPattern.test(candidate.pluginId) && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(candidate.version) &&
      /^([a-f0-9]{64})$/.test(candidate.packageSha256) && isTrustedUrl(candidate.packageUrl, feedUrl) && isManifest(candidate.manifest) && candidate.manifest.id === candidate.pluginId && candidate.manifest.version === candidate.version;
  });
  return { version: 1, generatedAt: typeof (value as PluginUpdateFeed).generatedAt === "string" ? (value as PluginUpdateFeed).generatedAt : new Date(0).toISOString(), updates };
};

export interface PluginUpdateService {
  check: () => Promise<PluginUpdateCandidate[]>;
  update: (candidate: PluginUpdateCandidate) => Promise<InstalledCampusmodPackage>;
}

export const createPluginUpdateService = (options: {
  registry: CampusmodPackageRegistry;
  feedUrl?: string;
  fetchImpl?: typeof fetch;
}): PluginUpdateService => {
  const feedUrl = options.feedUrl ?? (app.isPackaged ? DEFAULT_FEED_URL : process.env.CAMPUSOS_PLUGIN_UPDATE_FEED_URL ?? DEFAULT_FEED_URL);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    check: async () => {
      if (!isTrustedUrl(feedUrl, feedUrl)) throw new Error("插件更新源不受信任。");
      const response = await fetchImpl(feedUrl);
      if (!response.ok) throw new Error(`插件更新源返回 HTTP ${response.status}。`);
      const feed = parseFeed(await response.json(), feedUrl);
      const installed = (await options.registry.load()).packages;
      const installedById = new Map(installed.map((item) => [item.manifest.id, item]));
      return feed.updates.filter((candidate) => {
        const current = installedById.get(candidate.pluginId);
        if (!current || compareVersions(candidate.version, current.manifest.version) <= 0) return false;
        candidate.requiresReapproval = JSON.stringify({
          permissions: candidate.manifest.permissions,
          provides: candidate.manifest.provides,
          requires: candidate.manifest.requires,
          optionalRequires: candidate.manifest.optionalRequires,
          apiVersion: candidate.manifest.apiVersion,
          contributes: candidate.manifest.contributes
        }) !== JSON.stringify({
          permissions: current.manifest.permissions,
          provides: current.manifest.provides,
          requires: current.manifest.requires,
          optionalRequires: current.manifest.optionalRequires,
          apiVersion: current.manifest.apiVersion,
          contributes: current.manifest.contributes
        });
        return true;
      });
    },
    update: async (candidate) => {
      if (!isTrustedUrl(candidate.packageUrl, feedUrl)) throw new Error("插件包下载地址不受信任。");
      const response = await fetchImpl(candidate.packageUrl);
      if (!response.ok) throw new Error(`插件包下载失败：HTTP ${response.status}。`);
      const archive = Buffer.from(await response.arrayBuffer());
      if (computeSha256(archive) !== candidate.packageSha256) throw new Error("插件包摘要与更新清单不一致。");
      const installed = (await options.registry.load()).packages.find((item) => item.manifest.id === candidate.pluginId);
      if (!installed) throw new Error("插件尚未安装。");
      const root = join(app.getPath("userData"), "plugins", "updates");
      await mkdir(root, { recursive: true });
      const sourcePath = join(root, `${candidate.pluginId}-${randomUUID()}.campusmod`);
      await writeFile(sourcePath, archive, { flag: "wx" });
      try {
        const inspection: CampusmodPackageInspection = await options.registry.inspect(sourcePath);
        if (inspection.signatureStatus !== "verified") throw new Error("插件更新必须通过开发者签名验证。");
        if (inspection.manifest.id !== installed.manifest.id || inspection.manifest.version !== candidate.version) throw new Error("下载的插件 manifest 与更新清单不一致。");
        if (inspection.manifest.developerPublicKey !== installed.manifest.developerPublicKey) throw new Error("插件开发者公钥发生变化，需要重新安装并授权。");
        if (inspection.manifest.apiVersion !== installed.manifest.apiVersion) throw new Error("插件 API 版本发生变化，需要重新安装并授权。");
        return await options.registry.install(inspection.token);
      } finally {
        await rm(sourcePath, { force: true });
      }
    }
  };
};
