import type {
  CapabilityRecord,
  PluginCapability,
  PluginCapabilityClient,
  PluginRuntimeConfigurationInput,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import type {
  PluginPackageMutationResult,
  PluginPackageRegistrySnapshot,
  PluginPackageSelection,
  PluginRuntimeBridge
} from "../../shared/pluginBridge";

const resolvePluginRuntimeBridge = (): PluginRuntimeBridge => {
  if (typeof window === "undefined" || !window.campusos?.plugins) {
    throw new Error("插件运行时仅能在 CampusOS 桌面应用中使用。");
  }

  return window.campusos.plugins;
};

export const loadPluginRuntimeSnapshot = async (): Promise<PluginRuntimeSnapshot> =>
  resolvePluginRuntimeBridge().load();

export const configurePluginRuntime = async (
  input: PluginRuntimeConfigurationInput
): Promise<PluginRuntimeSnapshot> =>
  resolvePluginRuntimeBridge().configure(input);

export const selectPluginPackage = async (): Promise<PluginPackageSelection> =>
  resolvePluginRuntimeBridge().selectPackage();

export const discardPluginPackage = async (token: string): Promise<void> =>
  resolvePluginRuntimeBridge().discardPackage(token);

export const installPluginPackage = async (
  token: string
): Promise<PluginPackageMutationResult> =>
  resolvePluginRuntimeBridge().installPackage(token);

export const loadInstalledPluginPackages = async (
): Promise<PluginPackageRegistrySnapshot> =>
  resolvePluginRuntimeBridge().loadPackages();

export const uninstallPluginPackage = async (
  pluginId: string
): Promise<PluginPackageMutationResult> =>
  resolvePluginRuntimeBridge().uninstallPackage(pluginId);

export const readPluginCapability = async <T>(
  pluginId: string,
  capability: PluginCapability
): Promise<CapabilityRecord<T>[]> =>
  resolvePluginRuntimeBridge().readCapability<T>({ pluginId, capability });

export const createPluginCapabilityClient = (
  pluginId: string
): PluginCapabilityClient => Object.freeze({
  read: <T>(capability: PluginCapability) =>
    readPluginCapability<T>(pluginId, capability)
});
