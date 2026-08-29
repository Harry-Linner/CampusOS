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
import { manifest as academicManifest } from "@campusos/plugin-academic/manifest";
import { manifest as scheduleManifest } from "@campusos/plugin-schedule/manifest";
import { manifest as assistantManifest } from "@campusos/plugin-ai-assistant/manifest";
import { manifest as campusFeedManifest } from "@campusos/plugin-campus-feed/manifest";
import { manifest as materialsManifest } from "@campusos/plugin-materials/manifest";

type PluginModule = {
  manifest: PluginManifestV2;
  Component: (props: PluginComponentProps) => JSX.Element;
};

interface PluginDefinition {
  id: string;
  manifest: PluginManifestV2;
  loadComponent: () => Promise<PluginModule["Component"]>;
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

// B4-2：manifest 静态（轻量元数据，供侧栏/校验），视图组件全部动态 import——
// 渲染到该视图时才加载，避免打进 renderer 首屏主包。
const pluginDefinitions: PluginDefinition[] = [
  {
    id: academicManifest.id,
    manifest: academicManifest,
    loadComponent: () => import("@campusos/plugin-academic").then((m) => m.Component)
  },
  {
    id: scheduleManifest.id,
    manifest: scheduleManifest,
    loadComponent: () => import("@campusos/plugin-schedule").then((m) => m.Component)
  },
  {
    id: assistantManifest.id,
    manifest: assistantManifest,
    loadComponent: () => import("@campusos/plugin-ai-assistant").then((m) => m.Component)
  },
  {
    id: campusFeedManifest.id,
    manifest: campusFeedManifest,
    loadComponent: () => import("@campusos/plugin-campus-feed").then((m) => m.Component)
  },
  {
    id: materialsManifest.id,
    manifest: materialsManifest,
    loadComponent: () => import("@campusos/plugin-materials").then((m) => m.Component)
  }
];

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
    componentCache.clear();
    onUpdate();
  };
  hot.on("vite:afterUpdate", afterUpdate);
  return () => {
    hot.off("vite:afterUpdate", afterUpdate);
  };
};

const pluginDefinitionById = new Map(
  pluginDefinitions.map((definition) => [definition.id, definition])
);
const componentCache = new Map<string, Promise<PluginModule["Component"] | null>>();

/**
 * B4-2：按需加载官方插件视图组件（渲染到该视图时才 import），模块缓存保证只加载一次。
 * 第三方插件不在 pluginDefinitions 中，返回 null（其 sandbox iframe 由 loadPlugins 提供）。
 */
export const loadPluginComponent = (
  pluginId: string
): Promise<PluginModule["Component"] | null> => {
  const cached = componentCache.get(pluginId);
  if (cached) return cached;
  const definition = pluginDefinitionById.get(pluginId);
  const loading = definition ? definition.loadComponent() : Promise.resolve(null);
  componentCache.set(pluginId, loading);
  return loading;
};

export const loadPlugins = async (
  runtimeSnapshot: PluginRuntimeSnapshot
): Promise<LoadedPlugin[]> => {
  const loaded = runtimeSnapshot.plugins.map((runtime): LoadedPlugin => {
    const definition = pluginDefinitionById.get(runtime.id);
    let Component: PluginModule["Component"] | undefined;

    if (definition) {
      const validation = validateManifestV2(definition.manifest);
      if (!validation.ok) {
        throw new Error(
          `Plugin ${definition.id} failed validation: ${validation.issues.join(", ")}`
        );
      }
      if (runtime.manifest.version !== definition.manifest.version) {
        throw new Error(
          `Plugin ${runtime.id} version mismatch between main and renderer.`
        );
      }
      // B4-2：官方插件视图组件按需加载（loadPluginComponent），此处不预载。
    } else if (
      runtime.status === "active" &&
      (runtime.manifest.contributes.views?.length ?? 0) > 0
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
