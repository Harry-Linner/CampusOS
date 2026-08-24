/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcademicCredentialRecord } from "../../shared/credentialBridge";
import { createEmptyAcademicCredentialRecord } from "../../shared/credentialBridge";
import { SettingsView } from "./SettingsView";

const connectedRecord: AcademicCredentialRecord = {
  configured: true,
  username: "3240100001",
  savedAt: "2026-07-18T08:00:00.000Z",
  storagePath: "C:/secure/academic-affairs.json",
  encrypted: true,
  sourceId: "academic-affairs",
  verificationState: "verified",
  verifiedAt: "2026-07-18T08:00:00.000Z",
  provider: "zju-unified-auth",
  program: "undergraduate",
  verifiedService: "undergraduate-academic-affairs",
  authenticatedProfile: {
    source: "zju-quality-development",
    studentId: "3240100001",
    secondClassPoints: 3.45,
    thirdClassPoints: 1,
    fourthClassPoints: 0,
    fetchedAt: "2026-07-18T08:00:00.000Z"
  }
};

const installBridge = (
  connect: (input: {
    username: string;
    password: string;
    program: "undergraduate" | "graduate";
  }) => Promise<AcademicCredentialRecord>
): void => {
  window.campusos = {
    shell: {
      platform: "win32",
      phase: "test",
      storageMode: "sqlite"
    },
    workspace: {
      hydrate: vi.fn(async () => {
        throw new Error("not used");
      }),
      sync: vi.fn(async () => {
        throw new Error("not used");
      })
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
        gradeChangesEnabled: true,
        savedAt: null,
        storagePath: null
      })),
      saveSettings: vi.fn(async (input) => ({
        ...input,
        savedAt: "2026-07-18T08:00:00.000Z",
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
      open: vi.fn(async () => undefined),
      reveal: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined)
    },
    plugins: {
      load: vi.fn(async () => {
        throw new Error("not used");
      }),
      subscribe: vi.fn(() => () => undefined),
      configure: vi.fn(async () => {
        throw new Error("not used");
      }),
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
        entries: [
          {
            id: "diagnostic-1",
            timestamp: "2026-07-19T04:00:00.000Z",
            module: "zju-undergraduate",
            operation: "refresh",
            state: "live" as const,
            durationMs: 320,
            errorCategory: null,
            message: null,
            requestFingerprint: null,
            retryClassification: null,
            upstreamChange: false
          }
        ],
        totalCount: 1,
        storagePath: "C:/diagnostics/refresh-log.json"
      })),
      clear: vi.fn(async () => ({
        entries: [],
        totalCount: 0,
        storagePath: "C:/diagnostics/refresh-log.json"
      })),
      exportTxt: vi.fn(async () => ({ canceled: true, path: null })),
      health: vi.fn(async () => ({
        sources: [
          {
            module: "zju-undergraduate",
            currentState: "live" as const,
            lastRunAt: "2026-07-19T04:00:00.000Z",
            recentEntries: [
              {
                id: "diagnostic-1",
                timestamp: "2026-07-19T04:00:00.000Z",
                module: "zju-undergraduate",
                operation: "refresh",
                state: "live" as const,
                durationMs: 320,
                errorCategory: null,
                message: null,
                requestFingerprint: null,
                retryClassification: null,
                upstreamChange: false
              }
            ],
            liveRuns: 1,
            cachedRuns: 0,
            unavailableRuns: 0,
            retryableFailures: 0,
            fatalFailures: 0,
            upstreamChangeCount: 0,
            lastFingerprint: null,
            lastMessage: null
          }
        ],
        totalRuns: 1
      })),
      probe: vi.fn(async () => ({
        ok: true,
        summary: {
          module: "zju-undergraduate",
          currentState: "live" as const,
          lastRunAt: "2026-07-19T04:00:00.000Z",
          recentEntries: [],
          liveRuns: 1,
          cachedRuns: 0,
          unavailableRuns: 0,
          retryableFailures: 0,
          fatalFailures: 0,
          upstreamChangeCount: 0,
          lastFingerprint: null,
          lastMessage: null
        }
      }))
    },
    updates: {
      getAppInfo: vi.fn(async () => ({
        name: "CampusOS",
        version: "0.1.0",
        packaged: false,
        licenseName: "MIT" as const,
        copyright: "Copyright (c) 2026 Harry-Linner"
      })),
      getStatus: vi.fn(async () => ({ state: "unavailable" as const })),
      check: vi.fn(async () => ({ state: "unavailable" as const })),
      download: vi.fn(async () => ({ state: "unavailable" as const })),
      cancelDownload: vi.fn(async () => ({ state: "unavailable" as const })),
      dismiss: vi.fn(async () => ({ state: "unavailable" as const })),
      install: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined)
    }
  };
};

afterEach(() => {
  cleanup();
  delete window.campusos;
});

describe("SettingsView", () => {
  it("shows app version, update availability, and the MIT license", async () => {
    installBridge(vi.fn(async () => connectedRecord));

    render(createElement(SettingsView, {
      onRefresh: vi.fn().mockResolvedValue(undefined)
    }));

    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    expect(await screen.findByText("v0.1.0")).toBeDefined();
    expect(
      (screen.getByRole("button", {
        name: "开发版本不检查更新"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    expect(await screen.findByText("MIT")).toBeDefined();
    fireEvent.click(screen.getByText("查看 MIT 许可证"));
    expect(screen.getByText(/Permission is hereby granted/)).toBeDefined();
  });

  it("refreshes workspace data from an explicit settings action", async () => {
    installBridge(vi.fn(async () => connectedRecord));
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(createElement(SettingsView, { onRefresh }));
    fireEvent.click(screen.getByRole("button", { name: "数据与备份" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("刷新完成")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "高级" }));
    // 连接器健康与诊断日志都会出现来源名，使用多匹配断言两者之一存在。
    expect(
      (await screen.findAllByText("zju-undergraduate")).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("live · 320ms")).toBeDefined();
  });

  it("returns to onboarding only from the development tools section", async () => {
    installBridge(vi.fn(async () => connectedRecord));
    const onRestartOnboarding = vi.fn();

    render(createElement(SettingsView, {
      onRefresh: vi.fn().mockResolvedValue(undefined),
      showDevelopmentTools: true,
      onRestartOnboarding
    }));

    fireEvent.click(screen.getByRole("button", { name: "高级" }));
    fireEvent.click(await screen.findByRole("button", { name: "跳回初始引导界面" }));
    expect(onRestartOnboarding).toHaveBeenCalledTimes(1);
  });

  it("reports connected only after the main-process authentication succeeds", async () => {
    const connect = vi.fn(async () => connectedRecord);
    installBridge(connect);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(createElement(SettingsView, { onRefresh }));
    await screen.findByRole("button", { name: "连接并保存" });
    fireEvent.change(screen.getByLabelText("学号 / 统一认证账号"), {
      target: { value: "3240100001" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "secret" }
    });
    fireEvent.click(screen.getByRole("button", { name: "连接并保存" }));

    expect(await screen.findByText("认证后业务数据已返回")).toBeDefined();
    expect(screen.getByText("浙江大学素质拓展平台 · getMyInfo")).toBeDefined();
    expect(screen.getByText("返回学号")).toBeDefined();
    expect(screen.getByText("3240100001")).toBeDefined();
    expect(screen.getByText("第二课堂")).toBeDefined();
    expect(screen.getByText("3.45")).toBeDefined();
    expect(screen.getByText("第三课堂")).toBeDefined();
    expect(screen.getByText("第四课堂")).toBeDefined();
    expect(screen.getByText("2026/7/18 16:00:00")).toBeDefined();
    expect(
      screen.getByText(
        "以上数值来自本次认证后的业务接口返回，不是客户端生成的连接提示。"
      )
    ).toBeDefined();
    expect(connect).toHaveBeenCalledWith({
      username: "3240100001",
      password: "secret",
      program: "undergraduate"
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
  });

  it("keeps the password and does not refresh when authentication fails", async () => {
    const connect = vi.fn(async () => {
      throw new Error("统一认证拒绝了该账号或密码，请检查后重试。");
    });
    installBridge(connect);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(createElement(SettingsView, { onRefresh }));
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
    expect(onRefresh).not.toHaveBeenCalled();
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe(
      "wrong"
    );
  });

  it("uses the explicit graduate path and renders only the sanitized business receipt", async () => {
    const graduateRecord: AcademicCredentialRecord = {
      ...connectedRecord,
      username: "2240100001",
      program: "graduate",
      verifiedService: "graduate-academic-affairs",
      authenticatedProfile: {
        source: "zju-graduate-academic-affairs",
        studentId: "2240100001",
        verifiedDataset: "graduate-grades",
        recordCount: 12,
        fetchedAt: "2026-07-19T08:00:00.000Z"
      }
    };
    const connect = vi.fn(async () => graduateRecord);
    installBridge(connect);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(createElement(SettingsView, { onRefresh }));
    await screen.findByRole("button", { name: "连接并保存" });
    fireEvent.click(screen.getByRole("radio", { name: /研究生/ }));
    fireEvent.change(screen.getByLabelText("学号 / 统一认证账号"), {
      target: { value: "2240100001" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "secret" }
    });
    fireEvent.click(screen.getByRole("button", { name: "连接并保存" }));

    expect(await screen.findByText("浙江大学研究生院 · 成绩数据接口")).toBeDefined();
    expect(screen.getByText("研究生成绩记录")).toBeDefined();
    expect(screen.getByText("12 条")).toBeDefined();
    expect(screen.queryByText("private-course-name")).toBeNull();
    expect(connect).toHaveBeenCalledWith({
      username: "2240100001",
      password: "secret",
      program: "graduate"
    });
  });

  it("does not expose a GPA strategy control", async () => {
    installBridge(vi.fn(async () => connectedRecord));

    render(createElement(SettingsView, { onRefresh: vi.fn().mockResolvedValue(undefined) }));
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    await screen.findByRole("button", { name: "保存提醒" });

    expect(screen.queryByText(/GPA/)).toBeNull();
    expect(screen.queryByRole("radio", { name: /取首次|取最高/ })).toBeNull();
  });

  it("saves reminder settings without requiring a remote workspace refresh", async () => {
    installBridge(vi.fn(async () => connectedRecord));
    const onRefresh = vi.fn().mockRejectedValue(new Error("offline"));
    render(createElement(SettingsView, { onRefresh }));
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    await screen.findByRole("button", { name: "保存提醒" });

    fireEvent.click(screen.getByRole("switch", { name: "启用桌面通知" }));
    fireEvent.click(screen.getByRole("button", { name: "保存提醒" }));

    expect(await screen.findByText("已保存")).toBeDefined();
    expect(window.campusos?.reminders.saveSettings).toHaveBeenCalledWith({
      enabled: false,
      leadMinutes: [15, 120],
      gradeChangesEnabled: true
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
