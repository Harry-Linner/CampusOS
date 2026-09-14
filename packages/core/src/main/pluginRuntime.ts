import type {
  PluginCapability,
  PluginCapabilityBinding,
  PluginRegistration,
  PluginRuntimeRecord,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { isCollectionCapability, validateManifestV2 } from "@campusos/shared";

export interface ResolvePluginRuntimeInput {
  registrations: PluginRegistration[];
  coreCapabilities: PluginCapability[];
}

const createRuntimeRecord = (
  registration: PluginRegistration,
  record: Pick<PluginRuntimeRecord, "status" | "bindings" | "issues">
): PluginRuntimeRecord => ({
  id: registration.manifest.id,
  manifest: registration.manifest,
  enabled: registration.enabled,
  grantedPermissions: [...registration.grantedPermissions],
  ...record
});

const findCyclicPlugins = (
  dependencies: ReadonlyMap<string, readonly string[]>
): Set<string> => {
  const visitState = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cyclicPlugins = new Set<string>();

  const visit = (pluginId: string): void => {
    const state = visitState.get(pluginId);
    if (state === "visited") return;

    if (state === "visiting") {
      const cycleStart = stack.lastIndexOf(pluginId);
      for (const cyclePluginId of stack.slice(cycleStart)) {
        cyclicPlugins.add(cyclePluginId);
      }
      return;
    }

    visitState.set(pluginId, "visiting");
    stack.push(pluginId);

    for (const dependencyId of dependencies.get(pluginId) ?? []) {
      visit(dependencyId);
    }

    stack.pop();
    visitState.set(pluginId, "visited");
  };

  for (const pluginId of dependencies.keys()) {
    visit(pluginId);
  }

  return cyclicPlugins;
};

export const resolvePluginRuntime = ({
  registrations,
  coreCapabilities
}: ResolvePluginRuntimeInput): PluginRuntimeSnapshot => {
  const records = new Map<string, PluginRuntimeRecord>();
  const activationCandidates = new Map<string, PluginRegistration>();
  const pluginIdCounts = new Map<string, number>();

  for (const registration of registrations) {
    pluginIdCounts.set(
      registration.manifest.id,
      (pluginIdCounts.get(registration.manifest.id) ?? 0) + 1
    );
  }

  for (const registration of registrations) {
    const { manifest } = registration;
    if ((pluginIdCounts.get(manifest.id) ?? 0) > 1) {
      records.set(manifest.id, createRuntimeRecord(registration, {
        status: "blocked",
        bindings: {},
        issues: [`插件 ID 重复：${manifest.id}`]
      }));
      continue;
    }

    const validation = validateManifestV2(manifest);

    if (!validation.ok) {
      records.set(manifest.id, createRuntimeRecord(registration, {
        status: "blocked",
        bindings: {},
        issues: validation.issues
      }));
      continue;
    }

    if (manifest.releaseStage === "placeholder") {
      records.set(manifest.id, createRuntimeRecord(registration, {
        status: "placeholder",
        bindings: {},
        issues: ["插件尚未实现"]
      }));
      continue;
    }

    if (!registration.enabled) {
      records.set(manifest.id, createRuntimeRecord(registration, {
        status: "disabled",
        bindings: {},
        issues: []
      }));
      continue;
    }

    const missingPermissions = manifest.permissions.filter(
      (permission) => !registration.grantedPermissions.includes(permission)
    );
    if (missingPermissions.length > 0) {
      records.set(manifest.id, createRuntimeRecord(registration, {
        status: "blocked",
        bindings: {},
        issues: missingPermissions.map(
          (permission) => `权限未授权：${permission}`
        )
      }));
      continue;
    }

    activationCandidates.set(manifest.id, registration);
  }

  const providerCandidates = new Map<PluginCapability, string[]>();
  for (const capability of coreCapabilities) {
    providerCandidates.set(capability, ["core"]);
  }

  for (const registration of activationCandidates.values()) {
    for (const capability of registration.manifest.provides) {
      const candidates = providerCandidates.get(capability) ?? [];
      candidates.push(registration.manifest.id);
      providerCandidates.set(capability, candidates);
    }
  }

  for (const [pluginId, registration] of activationCandidates) {
    const missingCapabilities = registration.manifest.requires.filter(
      (capability) => !providerCandidates.has(capability)
    );
    const conflictingCapabilities = registration.manifest.requires.filter(
      (capability) =>
        !isCollectionCapability(capability) &&
        (providerCandidates.get(capability)?.length ?? 0) > 1
    );

    if (missingCapabilities.length === 0 && conflictingCapabilities.length === 0) {
      continue;
    }

    records.set(pluginId, createRuntimeRecord(registration, {
      status: "blocked",
      bindings: {},
      issues: [
        ...missingCapabilities.map((capability) => `缺少能力：${capability}`),
        ...conflictingCapabilities.map(
          (capability) => `能力提供者冲突：${capability}`
        )
      ]
    }));
    activationCandidates.delete(pluginId);
  }

  const dependencies = new Map<string, string[]>();
  for (const [pluginId, registration] of activationCandidates) {
    dependencies.set(
      pluginId,
      registration.manifest.requires
        .flatMap((capability) => {
          const candidates = providerCandidates.get(capability) ?? [];
          return isCollectionCapability(capability)
            ? candidates
            : candidates.slice(0, 1);
        })
        .filter(
          (providerId): providerId is string =>
            providerId !== undefined && providerId !== "core"
        )
    );
  }

  const cyclicPlugins = findCyclicPlugins(dependencies);
  for (const pluginId of cyclicPlugins) {
    const registration = activationCandidates.get(pluginId) as PluginRegistration;
    records.set(pluginId, createRuntimeRecord(registration, {
      status: "blocked",
      bindings: {},
      issues: ["插件能力依赖存在循环"]
    }));
    activationCandidates.delete(pluginId);
  }

  const activePlugins = new Set<string>();
  let activatedInPass = true;

  while (activatedInPass) {
    activatedInPass = false;

    for (const [pluginId, registration] of activationCandidates) {
      if (activePlugins.has(pluginId)) continue;

      const allProvidersActive = registration.manifest.requires.every(
        (capability) => {
          const candidates = providerCandidates.get(capability) ?? [];
          if (isCollectionCapability(capability)) {
            return candidates.some(
              (providerId) =>
                providerId === "core" || activePlugins.has(providerId)
            );
          }
          const providerId = candidates[0];
          return providerId === "core" || activePlugins.has(providerId ?? "");
        }
      );

      if (!allProvidersActive) continue;

      activePlugins.add(pluginId);
      activatedInPass = true;
    }
  }

  for (const [pluginId, registration] of activationCandidates) {
    if (!activePlugins.has(pluginId)) {
      const unavailableCapabilities = registration.manifest.requires.filter(
        (capability) => {
          const candidates = providerCandidates.get(capability) ?? [];
          if (isCollectionCapability(capability)) {
            return !candidates.some(
              (providerId) =>
                providerId === "core" || activePlugins.has(providerId)
            );
          }
          const providerId = candidates[0];
          return providerId !== "core" && !activePlugins.has(providerId ?? "");
        }
      );

      records.set(pluginId, createRuntimeRecord(registration, {
        status: "blocked",
        bindings: {},
        issues: unavailableCapabilities.map(
          (capability) => `依赖提供者未激活：${capability}`
        )
      }));
      continue;
    }

    const boundOptionalCapabilities = registration.manifest.optionalRequires.filter(
      (capability) => {
        const candidates = providerCandidates.get(capability);
        if (!candidates || candidates.length === 0) return false;

        if (isCollectionCapability(capability)) {
          return candidates.some(
            (providerId) =>
              providerId === "core" || activePlugins.has(providerId)
          );
        }
        if (candidates.length !== 1) return false;

        return candidates[0] === "core" || activePlugins.has(candidates[0]);
      }
    );
    const bindings = Object.fromEntries(
      [...registration.manifest.requires, ...boundOptionalCapabilities].map(
        (capability): [PluginCapability, PluginCapabilityBinding] => {
          const candidates = providerCandidates.get(capability) ?? [];
          if (isCollectionCapability(capability)) {
            return [
              capability,
              candidates.filter(
                (providerId) =>
                  providerId === "core" || activePlugins.has(providerId)
              )
            ];
          }
          return [capability, candidates[0] as string];
        }
      )
    ) as Partial<Record<PluginCapability, PluginCapabilityBinding>>;

    records.set(pluginId, createRuntimeRecord(registration, {
      status: "active",
      bindings,
      issues: []
    }));
  }

  return {
    apiVersion: 2,
    generatedAt: new Date().toISOString(),
    plugins: registrations.map((registration) =>
      records.get(registration.manifest.id) as PluginRuntimeRecord
    )
  };
};
