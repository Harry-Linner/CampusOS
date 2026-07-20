import type { CampusDownloadRequest, CampusWorkspaceSnapshot } from "./campus";
import type { PluginCapabilityClient } from "./pluginCapabilities";

export * from "./campus";
export * from "./pluginCapabilities";

export type CampusPermission =
  | `network:${string}`
  | `auth:service:${string}`
  | `storage:domain:${string}`
  | "data:account:academic-profile"
  | "storage:local"
  | "notification"
  | "credential"
  | "dingtalk:entry";

export type PluginCapability = `${string}@${number}`;

export type PluginCapabilityBinding = string | readonly string[];

export const collectionCapabilities = [
  "academic.profile@1",
  "academic.timetable@1",
  "academic.exams@1",
  "academic.grades@1",
  "calendar.events@1"
] as const satisfies readonly PluginCapability[];

export const isCollectionCapability = (
  capability: PluginCapability
): boolean => collectionCapabilities.includes(
  capability as (typeof collectionCapabilities)[number]
);

export type PluginKind = "connector" | "feature";

export interface PluginContributions {
  views?: PluginActivityView[];
  syncJobs?: string[];
  settings?: string[];
  searchProviders?: string[];
  commands?: string[];
}

export interface PluginManifestV2 {
  id: string;
  name: string;
  displayName: string;
  version: string;
  apiVersion: 2;
  kind: PluginKind;
  description: string;
  icon: string;
  permissions: CampusPermission[];
  sourceScope: string[];
  releaseStage: "ready" | "placeholder";
  provides: PluginCapability[];
  requires: PluginCapability[];
  optionalRequires: PluginCapability[];
  contentHash?: string;
  developerSignature?: string;
  developerPublicKey?: string;
  contributes: PluginContributions;
}

export interface PluginRegistration {
  manifest: PluginManifestV2;
  enabled: boolean;
  grantedPermissions: CampusPermission[];
}

export type PluginRuntimeStatus =
  | "active"
  | "blocked"
  | "disabled"
  | "placeholder";

export interface PluginRuntimeRecord {
  id: string;
  manifest: PluginManifestV2;
  enabled: boolean;
  grantedPermissions: CampusPermission[];
  status: PluginRuntimeStatus;
  bindings: Partial<Record<PluginCapability, PluginCapabilityBinding>>;
  issues: string[];
}

export interface PluginRuntimeConfigurationInput {
  pluginId: string;
  enabled: boolean;
  grantedPermissions: CampusPermission[];
}

export interface PluginRuntimeSnapshot {
  apiVersion: 2;
  generatedAt: string;
  plugins: PluginRuntimeRecord[];
}

export type CoreActivityItemId =
  | "dashboard"
  | "calendar"
  | "materials"
  | "extensions"
  | "settings";

export type ActivityItemId = string;

export interface PluginActivityView {
  id: string;
  title: string;
  icon: string;
  location: "activity" | "extensions";
  activityTarget?: ActivityItemId;
  order?: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  icon: string;
  permissions: CampusPermission[];
  sourceScope: string[];
  status: "active" | "placeholder";
  views: PluginActivityView[];
}

export interface PluginComponentProps {
  snapshot: CampusWorkspaceSnapshot | null;
  loading: boolean;
  capabilities: PluginCapabilityClient;
  onRefresh: () => Promise<void>;
  downloads?: {
    enqueue: (input: CampusDownloadRequest) => Promise<void>;
    pause: (id: string) => Promise<void>;
    resume: (id: string) => Promise<void>;
    cancel: (id: string) => Promise<void>;
  };
}

export interface PluginValidationResult {
  ok: boolean;
  issues: string[];
}

export const getSandboxedRendererActivityTarget = (
  pluginId: string
): string => `mod-${pluginId.replace(/[.-]/g, "-")}`;

export const getSandboxedRendererExecutionIssue = (
  manifest: PluginManifestV2
): string | null => {
  if (manifest.kind !== "feature") {
    return "当前隔离执行只支持纯视图 feature 插件。";
  }
  if (
    manifest.permissions.length !== 1 ||
    manifest.permissions[0] !== "storage:local"
  ) {
    return "当前隔离执行只开放 storage:local，且必须显式声明。";
  }
  if (
    manifest.provides.length > 0 ||
    manifest.requires.length > 0 ||
    manifest.optionalRequires.length > 0
  ) {
    return "当前隔离视图不能提供或读取 capability。";
  }
  if (
    (manifest.contributes.syncJobs?.length ?? 0) > 0 ||
    (manifest.contributes.settings?.length ?? 0) > 0 ||
    (manifest.contributes.searchProviders?.length ?? 0) > 0 ||
    (manifest.contributes.commands?.length ?? 0) > 0
  ) {
    return "当前隔离执行不支持后台作业、设置、搜索或命令贡献。";
  }

  const views = manifest.contributes.views ?? [];
  const expectedTarget = getSandboxedRendererActivityTarget(manifest.id);
  if (
    views.length !== 1 ||
    views[0]?.location !== "activity" ||
    views[0].activityTarget !== expectedTarget
  ) {
    return `当前隔离执行要求唯一活动视图使用目标：${expectedTarget}`;
  }
  return null;
};

const isExactHttpsOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
};

const isManifestV2Permission = (permission: string): boolean => {
  if (permission === "notification") return true;
  if (permission === "data:account:academic-profile") return true;
  if (permission === "storage:local") return true;
  if (/^storage:(?:domain|files):[a-z0-9.-]+$/.test(permission)) return true;

  for (const prefix of ["network:", "auth:service:"] as const) {
    if (permission.startsWith(prefix)) {
      return isExactHttpsOrigin(permission.slice(prefix.length));
    }
  }

  return false;
};

const isCapability = (value: unknown): value is PluginCapability =>
  typeof value === "string" &&
  /^[a-z][a-z0-9.-]*@[1-9][0-9]*$/.test(value);

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.trim().length > 0);

export const validateManifestV2 = (
  manifest: unknown
): PluginValidationResult => {
  if (typeof manifest !== "object" || manifest === null) {
    return {
      ok: false,
      issues: ["Manifest v2 必须是对象"]
    };
  }

  const candidate = manifest as Record<string, unknown>;
  const issues: string[] = [];

  if (candidate.apiVersion !== 2) {
    issues.push(`不支持的插件 API 版本：${String(candidate.apiVersion)}`);
  }

  for (const field of [
    "id",
    "name",
    "displayName",
    "version",
    "description",
    "icon"
  ]) {
    if (typeof candidate[field] !== "string" || candidate[field] === "") {
      issues.push(`Manifest v2 缺少字段：${field}`);
    }
  }

  if (candidate.kind !== "connector" && candidate.kind !== "feature") {
    issues.push("Manifest v2 kind 无效");
  }

  if (
    candidate.releaseStage !== "ready" &&
    candidate.releaseStage !== "placeholder"
  ) {
    issues.push("Manifest v2 releaseStage 无效");
  }

  if (!Array.isArray(candidate.permissions)) {
    issues.push("Manifest v2 permissions 必须是数组");
  } else {
    for (const permission of candidate.permissions) {
      if (permission === "credential") {
        issues.push("Manifest v2 禁止权限：credential");
      } else if (
        typeof permission !== "string" ||
        !isManifestV2Permission(permission)
      ) {
        issues.push(`Manifest v2 权限无效：${String(permission)}`);
      }
    }
  }

  for (const field of ["provides", "requires", "optionalRequires"]) {
    const capabilities = candidate[field];
    if (!Array.isArray(capabilities)) {
      issues.push(`Manifest v2 ${field} 必须是数组`);
    } else if (!capabilities.every(isCapability)) {
      issues.push(`Manifest v2 ${field} 包含无效能力`);
    }
  }

  if (!isNonEmptyStringArray(candidate.sourceScope)) {
    issues.push("Manifest v2 sourceScope 必须是非空字符串数组");
  }

  if (typeof candidate.contributes !== "object" || candidate.contributes === null) {
    issues.push("Manifest v2 contributes 必须是对象");
  } else {
    const contributes = candidate.contributes as Record<string, unknown>;
    if (contributes.views !== undefined && !Array.isArray(contributes.views)) {
      issues.push("Manifest v2 contributes.views 必须是数组");
    } else if (Array.isArray(contributes.views)) {
      for (const view of contributes.views) {
        if (typeof view !== "object" || view === null) {
          issues.push("Manifest v2 view 必须是对象");
          continue;
        }

        const candidateView = view as Record<string, unknown>;
        for (const field of ["id", "title", "icon"]) {
          if (
            typeof candidateView[field] !== "string" ||
            candidateView[field] === ""
          ) {
            issues.push(`Manifest v2 view 缺少字段：${field}`);
          }
        }
        if (
          candidateView.location !== "activity" &&
          candidateView.location !== "extensions"
        ) {
          issues.push("Manifest v2 view location 无效");
        }
        if (
          candidateView.location === "activity" &&
          (typeof candidateView.activityTarget !== "string" ||
            !/^[a-z][a-z0-9-]*$/.test(candidateView.activityTarget))
        ) {
          issues.push("Manifest v2 activity view 缺少有效 activityTarget");
        }
        if (
          candidateView.order !== undefined &&
          (typeof candidateView.order !== "number" ||
            !Number.isFinite(candidateView.order))
        ) {
          issues.push("Manifest v2 view order 无效");
        }
      }
    }

    for (const field of [
      "syncJobs",
      "settings",
      "searchProviders",
      "commands"
    ]) {
      if (
        contributes[field] !== undefined &&
        !isNonEmptyStringArray(contributes[field])
      ) {
        issues.push(`Manifest v2 contributes.${field} 必须是非空字符串数组`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
};

export const validateManifest = (
  manifest: Partial<PluginManifest>
): PluginValidationResult => {
  const issues: string[] = [];

  if (!manifest.id) issues.push("missing id");
  if (!manifest.name) issues.push("missing name");
  if (!manifest.displayName) issues.push("missing displayName");
  if (!manifest.version) issues.push("missing version");
  if (!manifest.description) issues.push("missing description");
  if (!manifest.icon) issues.push("missing icon");

  if (!Array.isArray(manifest.permissions)) {
    issues.push("permissions must be an array");
  }

  if (!Array.isArray(manifest.sourceScope) || manifest.sourceScope.length === 0) {
    issues.push("sourceScope must include at least one source");
  }

  if (!Array.isArray(manifest.views)) {
    issues.push("views must be an array");
  }

  return {
    ok: issues.length === 0,
    issues
  };
};

export const firstWaveSources = [
  "教务处网站",
  "计算机学院院网",
  "云峰学院院网",
  "ETA 三全育人平台"
] as const;
