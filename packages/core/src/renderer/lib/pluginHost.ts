import { createElement } from "react";
import {
  getSandboxedRendererExecutionIssue,
  validateManifestV2,
  type PluginComponentProps,
  type PluginManifestV2,
  type PluginRuntimeRecord,
  type PluginRuntimeSnapshot
} from "@campusos/shared";
import { createPluginCapabilityClient } from "./pluginBridge";
import { Component as AcademicView } from "@campusos/plugin-academic";
import { manifest as academicManifest } from "@campusos/plugin-academic/manifest";
import { Component as ScheduleView } from "@campusos/plugin-schedule";
import { manifest as scheduleManifest } from "@campusos/plugin-schedule/manifest";
import { Component as AssistantView } from "@campusos/plugin-ai-assistant";
import { manifest as assistantManifest } from "@campusos/plugin-ai-assistant/manifest";
import { Component as BriefView } from "@campusos/plugin-daily-brief";
import { manifest as dailyBriefManifest } from "@campusos/plugin-daily-brief/manifest";
import { Component as CampusFeedView } from "@campusos/plugin-campus-feed";
import { manifest as campusFeedManifest } from "@campusos/plugin-campus-feed/manifest";

type PluginModule = {
  manifest: PluginManifestV2;
  Component: (props: PluginComponentProps) => JSX.Element;
};

interface PluginDefinition {
  id: string;
  load: () => Promise<PluginModule>;
}

export interface LoadedPlugin {
  manifest: PluginManifestV2;
  Component?: PluginModule["Component"];
  runtime: PluginRuntimeRecord;
  capabilities: ReturnType<typeof createPluginCapabilityClient>;
}

const createSandboxedRendererComponent = (
  manifest: PluginManifestV2
): PluginModule["Component"] => {
  const SandboxedRenderer = () => createElement("iframe", {
    className: "campusmod-sandbox-frame",
    src: `campusmod://${manifest.id}/`,
    title: `${manifest.displayName} 隔离插件视图`,
    sandbox: "allow-scripts allow-same-origin",
    referrerPolicy: "no-referrer"
  });
  SandboxedRenderer.displayName = `CampusmodSandbox(${manifest.id})`;
  return SandboxedRenderer;
};

const pluginDefinitions: PluginDefinition[] = [
  {
    id: academicManifest.id,
    load: async () => ({ manifest: academicManifest, Component: AcademicView })
  },
  {
    id: scheduleManifest.id,
    load: async () => ({ manifest: scheduleManifest, Component: ScheduleView })
  },
  {
    id: assistantManifest.id,
    load: async () => ({ manifest: assistantManifest, Component: AssistantView })
  },
  {
    id: dailyBriefManifest.id,
    load: async () => ({ manifest: dailyBriefManifest, Component: BriefView })
  },
  {
    id: campusFeedManifest.id,
    load: async () => ({ manifest: campusFeedManifest, Component: CampusFeedView })
  },
  {
    id: "org.campusos.materials",
    load: () => import("@campusos/plugin-materials")
  }
];

const pluginModuleCache = new Map<string, Promise<PluginModule>>();

const loadPluginDefinition = (definition: PluginDefinition): Promise<PluginModule> => {
  const cached = pluginModuleCache.get(definition.id);
  if (cached) return cached;
  const loading = definition.load();
  pluginModuleCache.set(definition.id, loading);
  return loading;
};

/** 判断一次 vite 热更新是否触及官方插件包源码（开发期插件 HMR 用）。 */
export const isPluginModuleUpdate = (
  updates: ReadonlyArray<{ type?: string; path?: string }>
): boolean =>
  updates.some((update) =>
    (update.path ?? "").includes("plugin-")
  );

interface PluginHotApi {
  on: (event: string, listener: (payload: unknown) => void) => void;
  off: (event: string, listener: (payload: unknown) => void) => void;
}

/**
 * 开发期插件源码热重载：官方插件包（@campusos/plugin-*）源码变更时，
 * 清空插件模块缓存并通知宿主重新加载；生产构建下为 no-op。
 */
export const setupPluginDevHmr = (onUpdate: () => void): (() => void) => {
  const meta = import.meta as ImportMeta & {
    env?: { DEV?: boolean };
    hot?: PluginHotApi;
  };
  const hot = meta.hot;
  if (!meta.env?.DEV || !hot) return () => undefined;
  const afterUpdate = (payload: unknown): void => {
    const updates = Array.isArray(
      (payload as { updates?: unknown })?.updates
    )
      ? (payload as { updates: Array<{ type?: string; path?: string }> }).updates
      : [];
    if (!isPluginModuleUpdate(updates)) return;
    pluginModuleCache.clear();
    onUpdate();
  };
  hot.on("vite:afterUpdate", afterUpdate);
  return () => {
    hot.off("vite:afterUpdate", afterUpdate);
  };
};

export const loadPlugins = async (
  runtimeSnapshot: PluginRuntimeSnapshot
): Promise<LoadedPlugin[]> => {
  const rendererModules = await Promise.all(
    pluginDefinitions.map(async (definition) => {
      const mod = await loadPluginDefinition(definition);
      const validation = validateManifestV2(mod.manifest);

      if (!validation.ok) {
        throw new Error(
          `Plugin ${definition.id} failed validation: ${validation.issues.join(", ")}`
        );
      }

      return mod;
    })
  );
  const moduleById = new Map(
    rendererModules.map((module) => [module.manifest.id, module])
  );
  const loaded = runtimeSnapshot.plugins.map((runtime): LoadedPlugin => {
    const module = moduleById.get(runtime.id);
    let Component = module?.Component;

    if (module && runtime.manifest.version !== module.manifest.version) {
      throw new Error(
        `Plugin ${runtime.id} version mismatch between main and renderer.`
      );
    }
    if (
      runtime.status === "active" &&
      (runtime.manifest.contributes.views?.length ?? 0) > 0 &&
      !module
    ) {
      const sandboxIssue = getSandboxedRendererExecutionIssue(runtime.manifest);
      if (sandboxIssue) {
        throw new Error(
          `Plugin ${runtime.id} cannot run in the renderer sandbox: ${sandboxIssue}`
        );
      }
      Component = createSandboxedRendererComponent(runtime.manifest);
    }

    return {
      manifest: runtime.manifest,
      runtime,
      capabilities: createPluginCapabilityClient(runtime.id),
      ...(Component ? { Component } : {})
    };
  });

  return loaded.sort((left, right) => left.manifest.displayName.localeCompare(right.manifest.displayName));
};
