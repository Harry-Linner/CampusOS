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
    id: "org.campusos.academic-grades",
    load: () => import("@campusos/plugin-academic-grades")
  },
  {
    id: "org.campusos.academic-scraper",
    load: () => import("@campusos/plugin-academic-scraper")
  },
  {
    id: "org.campusos.calendar-workspace",
    load: () => import("@campusos/plugin-calendar")
  },
  {
    id: "org.campusos.materials",
    load: () => import("@campusos/plugin-materials")
  },
  {
    id: "org.campusos.dingtalk-entry",
    load: () => import("@campusos/plugin-dingtalk-entry")
  },
  {
    id: "org.campusos.exam-countdown",
    load: () => import("@campusos/plugin-exam-countdown")
  }
];

export const loadPlugins = async (
  runtimeSnapshot: PluginRuntimeSnapshot
): Promise<LoadedPlugin[]> => {
  const rendererModules = await Promise.all(
    pluginDefinitions.map(async (definition) => {
      const mod = await definition.load();
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
