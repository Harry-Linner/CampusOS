import { startTransition, useMemo, useState } from "react";
import type {
  PluginManifestV2,
  PluginRuntimeConfigurationInput,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import type {
  PluginPackageInspection,
  PluginPackageRegistrySnapshot
} from "../../shared/pluginBridge";
import { loadPlugins, type LoadedPlugin } from "../lib/pluginHost";
import {
  configurePluginRuntime,
  discardPluginPackage,
  installPluginPackage,
  loadInstalledPluginPackages,
  loadPluginRuntimeSnapshot,
  selectPluginPackage,
  uninstallPluginPackage
} from "../lib/pluginBridge";

interface PluginHostState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  plugins: LoadedPlugin[];
  packageRegistry: PluginPackageRegistrySnapshot;
  load: () => Promise<void>;
  configure: (input: PluginRuntimeConfigurationInput) => Promise<void>;
  selectPackage: () => Promise<PluginPackageInspection | null>;
  discardPackage: (token: string) => Promise<void>;
  installPackage: (token: string) => Promise<void>;
  uninstallPackage: (pluginId: string) => Promise<void>;
}

export const usePluginHost = (): PluginHostState => {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([]);
  const [packageRegistry, setPackageRegistry] = useState<
    PluginPackageRegistrySnapshot
  >({ packages: [], issues: [] });

  const applySnapshot = async (
    snapshot: PluginRuntimeSnapshot
  ): Promise<void> => {
    const loaded = await loadPlugins(snapshot);
    startTransition(() => {
      setPlugins(loaded);
      setReady(true);
      setError(null);
    });
  };

  return useMemo(
    () => ({
      ready,
      loading,
      error,
      plugins,
      packageRegistry,
      load: async () => {
        setLoading(true);
        try {
          const [runtime, registry] = await Promise.all([
            loadPluginRuntimeSnapshot(),
            loadInstalledPluginPackages()
          ]);
          await applySnapshot(runtime);
          startTransition(() => setPackageRegistry(registry));
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "插件运行时加载失败。"
          );
        } finally {
          setLoading(false);
        }
      },
      configure: async (input) => {
        setLoading(true);
        try {
          await applySnapshot(await configurePluginRuntime(input));
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "插件配置保存失败。"
          );
          throw nextError;
        } finally {
          setLoading(false);
        }
      },
      selectPackage: async () => {
        setLoading(true);
        try {
          const selection = await selectPluginPackage();
          setError(null);
          return selection.inspection;
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "插件包检查失败。"
          );
          throw nextError;
        } finally {
          setLoading(false);
        }
      },
      discardPackage: (token) => discardPluginPackage(token),
      installPackage: async (token) => {
        setLoading(true);
        try {
          const result = await installPluginPackage(token);
          await applySnapshot(result.runtime);
          startTransition(() => setPackageRegistry(result.registry));
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "插件安装失败。"
          );
          throw nextError;
        } finally {
          setLoading(false);
        }
      },
      uninstallPackage: async (pluginId) => {
        setLoading(true);
        try {
          const result = await uninstallPluginPackage(pluginId);
          await applySnapshot(result.runtime);
          startTransition(() => setPackageRegistry(result.registry));
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "插件卸载失败。"
          );
          throw nextError;
        } finally {
          setLoading(false);
        }
      }
    }),
    [error, loading, packageRegistry, plugins, ready]
  );
};

export type { PluginManifestV2 };
