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
  signatureStatus: "unsigned";
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
  signatureStatus: "unsigned";
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

export interface PluginRuntimeBridge {
  load: () => Promise<PluginRuntimeSnapshot>;
  configure: (
    input: PluginRuntimeConfigurationInput
  ) => Promise<PluginRuntimeSnapshot>;
  selectPackage: () => Promise<PluginPackageSelection>;
  discardPackage: (token: string) => Promise<void>;
  installPackage: (token: string) => Promise<PluginPackageMutationResult>;
  loadPackages: () => Promise<PluginPackageRegistrySnapshot>;
  uninstallPackage: (pluginId: string) => Promise<PluginPackageMutationResult>;
  readCapability: <T>(
    input: PluginCapabilityReadInput
  ) => Promise<CapabilityRecord<T>[]>;
}
