/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcademicCredentialRecord } from "../../shared/credentialBridge";
import { createEmptyAcademicCredentialRecord } from "../../shared/credentialBridge";
import type {
  PluginRuntimeRecord,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { OnboardingWizard } from "./OnboardingWizard";

const verifiedRecord: AcademicCredentialRecord = {
  configured: true,
  username: "3240100001",
  savedAt: "2026-07-19T08:00:00.000Z",
  storagePath: "C:/secure/academic-affairs.json",
  encrypted: true,
  sourceId: "academic-affairs",
  verificationState: "verified",
  verifiedAt: "2026-07-19T08:00:00.000Z",
  provider: "zju-unified-auth",
  program: "undergraduate",
  verifiedService: "undergraduate-academic-affairs",
  authenticatedProfile: {
    source: "zju-quality-development",
    studentId: "3240100001",
    secondClassPoints: 3.45,
    thirdClassPoints: 1,
    fourthClassPoints: 0,
    fetchedAt: "2026-07-19T08:00:00.000Z"
  }
};

const stubPlugin: PluginRuntimeRecord = {
  id: "org.campusos.calendar-workspace",
  manifest: {
    id: "org.campusos.calendar-workspace",
    name: "calendar-workspace",
    displayName: "日历工作台",
    version: "0.3.0",
    apiVersion: 2,
    kind: "feature",
    description: "消费统一事件能力，展示课程、考试、截止事项。",
    icon: "Calendar",
    permissions: ["storage:domain:calendar", "notification"],
    sourceScope: ["capability:calendar.events"],
    releaseStage: "ready",
    provides: [],
    requires: ["core.workspace-snapshot@1", "calendar.events@1"],
    optionalRequires: [],
    contributes: {
      views: [
        {
          id: "calendar-main",
          title: "日历",
          icon: "Calendar",
          location: "activity",
          activityTarget: "calendar",
          order: 1
        }
      ]
    }
  },
  enabled: true,
  grantedPermissions: [],
  status: "active",
  bindings: {},
  issues: []
};

const runtimeSnapshot: PluginRuntimeSnapshot = {
  apiVersion: 2,
  generatedAt: "2026-07-19T08:00:00.000Z",
  plugins: [stubPlugin]
};

const emptySnapshot = {
  generatedAt: "2026-07-19T12:00:00.000Z",
  term: {
    label: "2025-2026 夏",
    phase: "active" as const,
    currentWeek: 6,
    progressPercent: 38
  },
  sourceStates: [],
  courses: [],
  todayCourses: [
    {
      id: "course-1",
      title: "高等数学",
      instructor: "张教授",
      location: "紫金港东1A-301",
      startAt: "2026-07-19T00:00:00.000Z",
      endAt: "2026-07-19T01:35:00.000Z",
      sourceId: "academic-affairs" as const,
      courseCode: "MATH1001"
    }
  ],
  deadlines: [
    {
      id: "dl-1",
      title: "高数作业 第七章",
      dueAt: "2026-07-21T23:59:00.000Z",
      sourceId: "learning-platform" as const,
      kind: "assignment" as const,
      priority: "routine" as const,
      courseName: "高等数学"
    }
  ],
  materials: [],
  downloads: [],
  reminders: [],
  summary: {
    readySources: 2,
    totalSources: 5,
    downloadsInFlight: 0,
    materialsReady: 0,
    remindersQueued: 0,
    deadlinesDueSoon: 1
  }
};

const installBridge = (
  connect: (input: {
    username: string;
    password: string;
    program: string;
  }) => Promise<AcademicCredentialRecord>
): void => {
  window.campusos = {
    shell: {
      platform: "win32",
      phase: "workspace-persisted",
      storageMode: "sqlite"
    },
    workspace: {
      hydrate: vi.fn(async () => ({
        snapshot: emptySnapshot,
        hydratedFrom: "disk" as const,
        savedAt: "2026-07-19T12:00:00.000Z",
        storagePath: "C:/data/workspace.json"
      })),
      sync: vi.fn(async () => ({
        snapshot: emptySnapshot,
        hydratedFrom: "synced" as const,
        savedAt: "2026-07-19T12:00:00.000Z",
        storagePath: "C:/data/workspace.json"
      }))
    },
    credentials: {
      academicAffairs: {
        load: vi.fn(async () =>
          createEmptyAcademicCredentialRecord(
            "C:/secure/academic-affairs.json",
            true
          )
        ),
        connect: async (input) => {
          try {
            return { ok: true, record: await connect(input) };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "invalid-credentials",
                message:
                  error instanceof Error
                    ? error.message
                    : "统一认证连接失败。"
              }
            };
          }
        },
        clear: vi.fn(async () =>
          createEmptyAcademicCredentialRecord(
            "C:/secure/academic-affairs.json",
            true
          )
        )
      }
    },
    reminders: {
      loadSettings: vi.fn(async () => ({
        enabled: true,
        leadMinutes: [15, 120],
        savedAt: null,
        storagePath: null
      })),
      saveSettings: vi.fn(async (input) => ({
        ...input,
        savedAt: "2026-07-19T08:00:00.000Z",
        storagePath: "C:/settings/reminders.json"
      })),
      loadScheduleState: vi.fn(async () => ({
        enabled: true,
        supported: true,
        scheduledCount: 0,
        nextFireAt: null,
        lastScheduledAt: null,
        transport: "electron" as const
      }))
    },
    downloads: {
      list: vi.fn(async () => []),
      enqueue: vi.fn(async () => {
        throw new Error("not used");
      }),
      pause: vi.fn(async () => false),
      resume: vi.fn(async () => false),
      cancel: vi.fn(async () => false),
      subscribe: vi.fn(() => () => undefined)
    },
    plugins: {
      load: vi.fn(async () => runtimeSnapshot),
      configure: vi.fn(async () => runtimeSnapshot),
      selectPackage: vi.fn(async () => ({
        canceled: true as const,
        inspection: null
      })),
      discardPackage: vi.fn(async () => undefined),
      installPackage: vi.fn(async () => {
        throw new Error("not used");
      }),
      loadPackages: vi.fn(async () => ({ packages: [], issues: [] })),
      uninstallPackage: vi.fn(async () => {
        throw new Error("not used");
      }),
      readCapability: vi.fn(async () => {
        throw new Error("not used");
      })
    },
    diagnostics: {
      load: vi.fn(async () => ({
        entries: [],
        totalCount: 0,
        storagePath: "C:/diagnostics/refresh-log.json"
      })),
      clear: vi.fn(async () => ({
        entries: [],
        totalCount: 0,
        storagePath: "C:/diagnostics/refresh-log.json"
      })),
      exportTxt: vi.fn(async () => ({ canceled: true, path: null }))
    }
  };
};

afterEach(() => {
  cleanup();
  delete window.campusos;
  localStorage.removeItem("campusos.onboarding.completed");
});

describe("OnboardingWizard", () => {
  it("renders the welcome step on first mount", async () => {
    installBridge(vi.fn(async () => verifiedRecord));
    const onComplete = vi.fn();

    render(createElement(OnboardingWizard, { onComplete }));
    expect(await screen.findByText("CampusOS")).toBeDefined();
    expect(screen.getByText("把校园事务放回一个清晰的工作台。")).toBeDefined();
    expect(screen.getByRole("button", { name: "开始配置" })).toBeDefined();
  });

  it("navigates from welcome to account step", async () => {
    installBridge(vi.fn(async () => verifiedRecord));
    const onComplete = vi.fn();

    render(createElement(OnboardingWizard, { onComplete }));
    fireEvent.click(screen.getByRole("button", { name: "开始配置" }));

    expect(
      await screen.findByText("连接 ZJU 统一认证")
    ).toBeDefined();
    expect(screen.getByLabelText("学号 / 统一认证账号")).toBeDefined();
    expect(screen.getByLabelText("密码")).toBeDefined();
    expect(screen.getByRole("button", { name: "连接并保存" })).toBeDefined();
  });

  it("allows development builds to skip authentication and continue to sync", async () => {
    installBridge(vi.fn(async () => verifiedRecord));
    const onComplete = vi.fn();

    render(
      createElement(OnboardingWizard, {
        onComplete,
        allowDevelopmentAuthSkip: true
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "开始配置" }));
    await screen.findByRole("button", { name: "开发模式跳过认证" });

    fireEvent.click(screen.getByRole("button", { name: "开发模式跳过认证" }));
    expect(await screen.findByText("同步数据")).toBeDefined();
    expect(screen.getByRole("button", { name: "开始同步" })).toBeDefined();
  });

  it("shows the auth form and connects successfully", async () => {
    const connect = vi.fn(async () => verifiedRecord);
    installBridge(connect);
    const onComplete = vi.fn();

    render(createElement(OnboardingWizard, { onComplete }));

    fireEvent.click(screen.getByRole("button", { name: "开始配置" }));
    await screen.findByRole("button", { name: "连接并保存" });

    fireEvent.change(screen.getByLabelText("学号 / 统一认证账号"), {
      target: { value: "3240100001" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "secret" }
    });
    fireEvent.click(screen.getByRole("button", { name: "连接并保存" }));

    expect(connect).toHaveBeenCalledWith({
      username: "3240100001",
      password: "secret",
      program: "undergraduate"
    });

    expect(await screen.findByText("认证成功")).toBeDefined();
    expect(screen.getByText("继续同步")).toBeDefined();
  });

  it("displays an error when authentication fails", async () => {
    const connect = vi.fn(async () => {
      throw new Error("统一认证拒绝了该账号或密码，请检查后重试。");
    });
    installBridge(connect);
    const onComplete = vi.fn();

    render(createElement(OnboardingWizard, { onComplete }));
    fireEvent.click(screen.getByRole("button", { name: "开始配置" }));
    await screen.findByRole("button", { name: "连接并保存" });

    fireEvent.change(screen.getByLabelText("学号 / 统一认证账号"), {
      target: { value: "3240100001" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "wrong" }
    });
    fireEvent.click(screen.getByRole("button", { name: "连接并保存" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "统一认证拒绝了该账号或密码"
    );
  });

  it("navigates from account to sync step", async () => {
    installBridge(vi.fn(async () => verifiedRecord));
    const onComplete = vi.fn();

    render(createElement(OnboardingWizard, { onComplete }));
    fireEvent.click(screen.getByRole("button", { name: "开始配置" }));
    await screen.findByRole("button", { name: "连接并保存" });

    fireEvent.change(screen.getByLabelText("学号 / 统一认证账号"), {
      target: { value: "3240100001" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "secret" }
    });
    fireEvent.click(screen.getByRole("button", { name: "连接并保存" }));
    await screen.findByText("继续同步");

    fireEvent.click(screen.getByRole("button", { name: "继续同步" }));
    expect(await screen.findByText("同步数据")).toBeDefined();
    expect(screen.getByRole("button", { name: "开始同步" })).toBeDefined();
  });

  it("completes onboarding and calls onComplete", async () => {
    installBridge(vi.fn(async () => verifiedRecord));
    const onComplete = vi.fn();

    render(createElement(OnboardingWizard, { onComplete }));

    // Step 0 → 1: welcome → account
    fireEvent.click(screen.getByRole("button", { name: "开始配置" }));
    await screen.findByRole("button", { name: "连接并保存" });

    // Step 1: fill auth
    fireEvent.change(screen.getByLabelText("学号 / 统一认证账号"), {
      target: { value: "3240100001" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "secret" }
    });
    fireEvent.click(screen.getByRole("button", { name: "连接并保存" }));
    await screen.findByText("继续同步");

    // Step 1 → 2: account → sync
    fireEvent.click(screen.getByRole("button", { name: "继续同步" }));
    await screen.findByRole("button", { name: "开始同步" });

    // Step 2: sync
    fireEvent.click(screen.getByRole("button", { name: "开始同步" }));
    await screen.findByRole("button", { name: "确认，继续" });

    // Step 2 → 3: sync → plugins
    fireEvent.click(screen.getByRole("button", { name: "确认，继续" }));
    expect(await screen.findByText("推荐扩展")).toBeDefined();

    // Step 3 → 4: plugins → done
    fireEvent.click(
      screen.getByRole("button", { name: "安装选中插件" })
    );
    expect(await screen.findByText("一切就绪")).toBeDefined();
    expect(window.campusos!.plugins.configure).toHaveBeenCalledWith({
      pluginId: stubPlugin.id,
      enabled: true,
      grantedPermissions: stubPlugin.manifest.permissions
    });

    // Step 4: done → complete
    fireEvent.click(screen.getByRole("button", { name: "进入 CampusOS" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("campusos.onboarding.completed")).toBe("1");
  });

  it("returns to welcome from account step", async () => {
    installBridge(vi.fn(async () => verifiedRecord));
    const onComplete = vi.fn();

    render(createElement(OnboardingWizard, { onComplete }));
    fireEvent.click(screen.getByRole("button", { name: "开始配置" }));
    await screen.findByText("连接 ZJU 统一认证");

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByText("开始配置")).toBeDefined();
  });

  it("disables the connect button when fields are empty", async () => {
    installBridge(vi.fn(async () => verifiedRecord));
    const onComplete = vi.fn();

    render(createElement(OnboardingWizard, { onComplete }));
    fireEvent.click(screen.getByRole("button", { name: "开始配置" }));
    await screen.findByRole("button", { name: "连接并保存" });

    const connectButton = screen.getByRole("button", {
      name: "连接并保存"
    }) as HTMLButtonElement;
    expect(connectButton.disabled).toBe(true);
  });
});
