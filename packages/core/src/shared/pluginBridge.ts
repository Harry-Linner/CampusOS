import type {
  CapabilityRecord,
  PluginCapability,
  PluginManifestV2,
  PluginRuntimeConfigurationInput,
  PluginRuntimeSnapshot
} from "@campusos/shared";

export interface PluginCapabilityReadInput {
  pluginId: string;
  capability: PluginCapability;
}

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

/** 能力声明审计：入口代码实际敏感用法 vs manifest 声明权限。 */
export interface CapabilityAudit {
  status: "verified" | "suspicious";
  findings: CapabilityFinding[];
}

export interface PluginPackageInspection {
  token: string;
  manifest: PluginManifestV2;
  entrypoints: {
    main?: string;
    renderer?: string;
  };
  archiveSize: number;
  unpackedSize: number;
  fileCount: number;
  sha256: string;
  signatureStatus: "unsigned" | "verified" | "invalid";
  capabilityAudit: CapabilityAudit;
}

export type PluginPackageSelection =
  | { canceled: true; inspection: null }
  | { canceled: false; inspection: PluginPackageInspection };

export interface InstalledPluginPackage {
  manifest: PluginManifestV2;
  entrypoints: PluginPackageInspection["entrypoints"];
  archiveSize: number;
  unpackedSize: number;
  fileCount: number;
  sha256: string;
  signatureStatus: "unsigned" | "verified" | "invalid";
  capabilityAudit: CapabilityAudit;
  installedAt: string;
  sourceFilename: string;
}

export interface PluginPackageRegistrySnapshot {
  packages: InstalledPluginPackage[];
  issues: Array<{
    directoryName: string;
    message: string;
  }>;
}

export interface PluginPackageMutationResult {
  installedPackage?: InstalledPluginPackage;
  registry: PluginPackageRegistrySnapshot;
  runtime: PluginRuntimeSnapshot;
}

export interface PluginUpdateCandidate {
  pluginId: string;
  version: string;
  packageUrl: string;
  packageSha256: string;
  manifest: PluginManifestV2;
  requiresReapproval?: boolean;
}

export interface PluginRuntimeBridge {
  load: () => Promise<PluginRuntimeSnapshot>;
  subscribe: (listener: (snapshot: PluginRuntimeSnapshot) => void) => () => void;
  configure: (
    input: PluginRuntimeConfigurationInput
  ) => Promise<PluginRuntimeSnapshot>;
  selectPackage: () => Promise<PluginPackageSelection>;
  discardPackage: (token: string) => Promise<void>;
  installPackage: (token: string) => Promise<PluginPackageMutationResult>;
  loadPackages: () => Promise<PluginPackageRegistrySnapshot>;
  uninstallPackage: (pluginId: string) => Promise<PluginPackageMutationResult>;
  checkUpdates?: () => Promise<PluginUpdateCandidate[]>;
  updatePackage?: (candidate: PluginUpdateCandidate) => Promise<PluginPackageMutationResult>;
  readCapability: <T>(
    input: PluginCapabilityReadInput
  ) => Promise<CapabilityRecord<T>[]>;
}
