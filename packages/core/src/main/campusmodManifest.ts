/**
 * Campusmod manifest parsing (Core, main).
 *
 * Split out of campusmodPackageRegistry.ts in batch 21 of the ADR-0006 program:
 * the entrypoint shape, the contributes copy and the manifest validator work from
 * manifest bytes and entry names alone, so they need neither the registry's
 * filesystem access nor its install state.
 */
import {
  validateUserPluginManifestV2,
  type PluginManifestV2
} from "@campusos/shared";
import { normalizeArchivePath } from "./campusmodArchivePaths";
import type { CampusmodPackageLimits } from "./campusmodPackageLimits";

export interface CampusmodEntrypoints {
  main?: string;
  renderer?: string;
}

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const copyContributions = (
  value: unknown
): PluginManifestV2["contributes"] => {
  const candidate = value as Record<string, unknown>;
  return {
    ...(Array.isArray(candidate.views)
      ? { views: candidate.views as PluginManifestV2["contributes"]["views"] }
      : {}),
    ...(isStringArray(candidate.syncJobs)
      ? { syncJobs: [...candidate.syncJobs] }
      : {}),
    ...(isStringArray(candidate.settings)
      ? { settings: [...candidate.settings] }
      : {}),
    ...(isStringArray(candidate.searchProviders)
      ? { searchProviders: [...candidate.searchProviders] }
      : {}),
    ...(isStringArray(candidate.commands)
      ? { commands: [...candidate.commands] }
      : {})
  };
};

export const parseManifest = (
  bytes: Uint8Array,
  entries: ReadonlyMap<string, Uint8Array>,
  limits: CampusmodPackageLimits
): { manifest: PluginManifestV2; entrypoints: CampusmodEntrypoints } => {
  if (bytes.length > limits.maxManifestBytes) {
    throw new Error("插件 manifest 超过大小限制。");
  }

  let candidate: Record<string, unknown>;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("manifest must be an object");
    }
    candidate = parsed as Record<string, unknown>;
  } catch {
    throw new Error("插件 manifest 不是有效的 UTF-8 JSON。");
  }

  // Keep the official namespace boundary ahead of sandbox eligibility errors.
  // This prevents a malformed package from receiving a misleading runtime
  // capability error and preserves the package identity contract.
  if (
    typeof candidate.id === "string" &&
    candidate.id.startsWith("org.campusos.")
  ) {
    throw new Error("第三方插件不能使用 CampusOS 官方命名空间。");
  }
  const validation = validateUserPluginManifestV2(candidate);
  if (!validation.ok) {
    throw new Error(`插件 manifest 无效：${validation.issues.join("；")}`);
  }
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length > 120 ||
    !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(candidate.id)
  ) {
    throw new Error("第三方插件 ID 必须是小写反向域名格式。");
  }
  if (
    typeof candidate.version !== "string" ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(candidate.version)
  ) {
    throw new Error("第三方插件版本必须是有效的 SemVer。");
  }
  if (candidate.releaseStage !== "ready") {
    throw new Error("第三方安装包不能声明 placeholder 状态。");
  }

  const entrypointValue = candidate.entrypoints;
  if (
    typeof entrypointValue !== "object" ||
    entrypointValue === null ||
    Array.isArray(entrypointValue)
  ) {
    throw new Error("第三方插件 manifest 缺少 entrypoints。");
  }
  const entrypointCandidate = entrypointValue as Record<string, unknown>;
  const entrypoints: CampusmodEntrypoints = {};
  for (const key of ["main", "renderer"] as const) {
    const value = entrypointCandidate[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new Error(`插件 entrypoints.${key} 必须是字符串。`);
    }
    const path = normalizeArchivePath(value);
    if (path.endsWith("/") || !/\.(?:js|mjs)$/.test(path)) {
      throw new Error(`插件 entrypoints.${key} 必须指向 JavaScript 文件。`);
    }
    if (!entries.has(path)) {
      throw new Error(`插件 entrypoints.${key} 文件不存在：${path}`);
    }
    entrypoints[key] = path;
  }
  if (!entrypoints.main && !entrypoints.renderer) {
    throw new Error("第三方插件至少需要一个代码 entrypoint。");
  }

  const contributes = copyContributions(candidate.contributes);
  if ((contributes.syncJobs?.length ?? 0) > 0 && !entrypoints.main) {
    throw new Error("声明 syncJobs 的插件必须提供 main entrypoint。");
  }
  if ((contributes.views?.length ?? 0) > 0 && !entrypoints.renderer) {
    throw new Error("声明 views 的插件必须提供 renderer entrypoint。");
  }

  const manifest: PluginManifestV2 = {
    id: candidate.id as string,
    name: candidate.name as string,
    displayName: candidate.displayName as string,
    version: candidate.version as string,
    apiVersion: 2,
    kind: candidate.kind as PluginManifestV2["kind"],
    description: candidate.description as string,
    icon: candidate.icon as string,
    permissions: [...candidate.permissions as PluginManifestV2["permissions"]],
    sourceScope: [...candidate.sourceScope as string[]],
    releaseStage: "ready",
    provides: [...candidate.provides as PluginManifestV2["provides"]],
    requires: [...candidate.requires as PluginManifestV2["requires"]],
    optionalRequires: [
      ...candidate.optionalRequires as PluginManifestV2["optionalRequires"]
    ],
    ...(typeof candidate.contentHash === "string"
      ? { contentHash: candidate.contentHash }
      : {}),
    ...(typeof candidate.developerSignature === "string"
      ? { developerSignature: candidate.developerSignature }
      : {}),
    ...(typeof candidate.developerPublicKey === "string"
      ? { developerPublicKey: candidate.developerPublicKey }
      : {}),
    contributes
  };
  return { manifest, entrypoints };
};
