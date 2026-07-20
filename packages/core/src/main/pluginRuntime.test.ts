import { describe, expect, it } from "vitest";
import type { PluginManifestV2 } from "@campusos/shared";
import { resolvePluginRuntime } from "./pluginRuntime";

const createManifest = (
  overrides: Partial<PluginManifestV2> = {}
): PluginManifestV2 => ({
  id: "org.campusos.calendar-workspace",
  name: "calendar-workspace",
  displayName: "日历工作台",
  version: "1.0.0",
  apiVersion: 2,
  kind: "feature",
  description: "统一展示课程、考试、截止事项和用户日程。",
  icon: "Calendar",
  permissions: ["storage:domain:calendar"],
  sourceScope: ["workspace:calendar"],
  releaseStage: "ready",
  provides: [],
  requires: ["calendar.events@1"],
  optionalRequires: [],
  contributes: {
    views: []
  },
  ...overrides
});

describe("resolvePluginRuntime", () => {
  it("activates a permitted plugin and binds its required capability", () => {
    const eventProvider = createManifest({
      id: "org.campusos.workspace-compat",
      name: "workspace-compat",
      displayName: "工作台兼容连接器",
      kind: "connector",
      permissions: [],
      provides: ["calendar.events@1"],
      requires: [],
      contributes: {
        syncJobs: ["workspace-refresh"]
      }
    });
    const calendar = createManifest();

    const snapshot = resolvePluginRuntime({
      registrations: [
        {
          manifest: eventProvider,
          enabled: true,
          grantedPermissions: []
        },
        {
          manifest: calendar,
          enabled: true,
          grantedPermissions: ["storage:domain:calendar"]
        }
      ],
      coreCapabilities: []
    });

    expect(snapshot.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: calendar.id,
          status: "active",
          bindings: {
            "calendar.events@1": [eventProvider.id]
          }
        })
      ])
    );
  });

  it("binds every active provider for a collection capability", () => {
    const firstProvider = createManifest({
      id: "org.campusos.academic-exams",
      name: "academic-exams",
      displayName: "考试事件",
      permissions: [],
      provides: ["calendar.events@1"],
      requires: [],
      contributes: { syncJobs: ["exam-events"] }
    });
    const secondProvider = createManifest({
      id: "org.campusos.deadline-assistant",
      name: "deadline-assistant",
      displayName: "截止事项",
      permissions: [],
      provides: ["calendar.events@1"],
      requires: [],
      contributes: { syncJobs: ["deadline-events"] }
    });
    const calendar = createManifest({ permissions: [] });

    const snapshot = resolvePluginRuntime({
      registrations: [firstProvider, secondProvider, calendar].map(
        (manifest) => ({ manifest, enabled: true, grantedPermissions: [] })
      ),
      coreCapabilities: []
    });

    expect(snapshot.plugins.find((plugin) => plugin.id === calendar.id)).toEqual(
      expect.objectContaining({
        status: "active",
        bindings: {
          "calendar.events@1": [firstProvider.id, secondProvider.id]
        }
      })
    );
  });

  it("blocks consumers when more than one plugin provides the same singleton capability", () => {
    const firstProvider = createManifest({
      id: "org.campusos.zju-undergraduate",
      name: "zju-undergraduate",
      displayName: "本科教务连接器",
      kind: "connector",
      permissions: [],
      provides: ["academic.course-catalog@1"],
      requires: [],
      contributes: {}
    });
    const secondProvider = createManifest({
      id: "org.campusos.zju-graduate",
      name: "zju-graduate",
      displayName: "研究生教务连接器",
      kind: "connector",
      permissions: [],
      provides: ["academic.course-catalog@1"],
      requires: [],
      contributes: {}
    });
    const timetable = createManifest({
      id: "org.campusos.academic-timetable",
      name: "academic-timetable",
      displayName: "课表",
      permissions: [],
      requires: ["academic.course-catalog@1"]
    });

    const snapshot = resolvePluginRuntime({
      registrations: [firstProvider, secondProvider, timetable].map(
        (manifest) => ({
          manifest,
          enabled: true,
          grantedPermissions: []
        })
      ),
      coreCapabilities: []
    });

    expect(snapshot.plugins.find((plugin) => plugin.id === timetable.id)).toEqual(
      expect.objectContaining({
        status: "blocked",
        issues: ["能力提供者冲突：academic.course-catalog@1"]
      })
    );
  });

  it("binds undergraduate and graduate academic feeds as collections", () => {
    const firstProvider = createManifest({
      id: "org.campusos.zju-undergraduate",
      name: "zju-undergraduate",
      displayName: "本科教务连接器",
      kind: "connector",
      permissions: [],
      provides: ["academic.timetable@1"],
      requires: [],
      contributes: {}
    });
    const secondProvider = createManifest({
      id: "org.campusos.zju-graduate",
      name: "zju-graduate",
      displayName: "研究生教务连接器",
      kind: "connector",
      permissions: [],
      provides: ["academic.timetable@1"],
      requires: [],
      contributes: {}
    });
    const timetable = createManifest({
      id: "org.campusos.academic-timetable",
      name: "academic-timetable",
      displayName: "课表",
      permissions: [],
      requires: ["academic.timetable@1"]
    });

    const snapshot = resolvePluginRuntime({
      registrations: [firstProvider, secondProvider, timetable].map(
        (manifest) => ({ manifest, enabled: true, grantedPermissions: [] })
      ),
      coreCapabilities: []
    });

    expect(snapshot.plugins.find((plugin) => plugin.id === timetable.id)).toEqual(
      expect.objectContaining({
        status: "active",
        bindings: {
          "academic.timetable@1": [firstProvider.id, secondProvider.id]
        }
      })
    );
  });

  it("fails closed when plugin capability dependencies form a cycle", () => {
    const first = createManifest({
      id: "org.campusos.first",
      name: "first",
      displayName: "First",
      kind: "connector",
      permissions: [],
      provides: ["test.first@1"],
      requires: ["test.second@1"],
      contributes: {}
    });
    const second = createManifest({
      id: "org.campusos.second",
      name: "second",
      displayName: "Second",
      kind: "connector",
      permissions: [],
      provides: ["test.second@1"],
      requires: ["test.first@1"],
      contributes: {}
    });

    const snapshot = resolvePluginRuntime({
      registrations: [first, second].map((manifest) => ({
        manifest,
        enabled: true,
        grantedPermissions: []
      })),
      coreCapabilities: []
    });

    expect(snapshot.plugins).toEqual([
      expect.objectContaining({
        id: first.id,
        status: "blocked",
        issues: ["插件能力依赖存在循环"]
      }),
      expect.objectContaining({
        id: second.id,
        status: "blocked",
        issues: ["插件能力依赖存在循环"]
      })
    ]);
  });

  it("blocks an incompatible manifest before activation", () => {
    const incompatible = {
      ...createManifest({
        permissions: []
      }),
      apiVersion: 1,
      permissions: ["credential"]
    } as unknown as PluginManifestV2;

    const snapshot = resolvePluginRuntime({
      registrations: [
        {
          manifest: incompatible,
          enabled: true,
          grantedPermissions: ["credential"]
        }
      ],
      coreCapabilities: ["calendar.events@1"]
    });

    expect(snapshot.plugins[0]).toEqual(
      expect.objectContaining({
        status: "blocked",
        issues: [
          "不支持的插件 API 版本：1",
          "Manifest v2 禁止权限：credential"
        ]
      })
    );
  });

  it("activates without optional capabilities and binds them when available", () => {
    const calendar = createManifest({
      permissions: [],
      optionalRequires: ["planner.schedule@1"]
    });

    const withoutPlanner = resolvePluginRuntime({
      registrations: [
        {
          manifest: calendar,
          enabled: true,
          grantedPermissions: []
        }
      ],
      coreCapabilities: ["calendar.events@1"]
    });

    expect(withoutPlanner.plugins[0]).toEqual(
      expect.objectContaining({
        status: "active",
        bindings: {
          "calendar.events@1": ["core"]
        }
      })
    );

    const planner = createManifest({
      id: "org.campusos.auto-scheduler",
      name: "auto-scheduler",
      displayName: "自动规划",
      permissions: [],
      provides: ["planner.schedule@1"],
      requires: ["calendar.events@1"]
    });
    const withPlanner = resolvePluginRuntime({
      registrations: [
        {
          manifest: planner,
          enabled: true,
          grantedPermissions: []
        },
        {
          manifest: calendar,
          enabled: true,
          grantedPermissions: []
        }
      ],
      coreCapabilities: ["calendar.events@1"]
    });

    expect(withPlanner.plugins.find((plugin) => plugin.id === calendar.id)).toEqual(
      expect.objectContaining({
        status: "active",
        bindings: {
          "calendar.events@1": ["core"],
          "planner.schedule@1": planner.id
        }
      })
    );
  });

  it("blocks duplicate plugin ids instead of allowing registry overwrite", () => {
    const duplicate = createManifest({
      permissions: [],
      requires: []
    });
    const snapshot = resolvePluginRuntime({
      registrations: [duplicate, duplicate].map((manifest) => ({
        manifest,
        enabled: true,
        grantedPermissions: []
      })),
      coreCapabilities: []
    });

    expect(snapshot.plugins).toHaveLength(2);
    expect(snapshot.plugins.every((plugin) => plugin.status === "blocked")).toBe(
      true
    );
    expect(snapshot.plugins[0].issues).toEqual([
      `插件 ID 重复：${duplicate.id}`
    ]);
  });
});
