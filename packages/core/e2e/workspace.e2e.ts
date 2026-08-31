import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachRendererGuard } from "./rendererGuard";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const extractedField = <T,>(value: T, evidenceText: string | null) => ({
  value,
  confidence: "high",
  source: "explicit",
  evidenceText,
  needsConfirmation: false
});

const assistantExtractionFixture = {
  intents: [
    {
      intent: "create",
      kind: "deadline",
      title: extractedField("Submit report", "Submit report"),
      description: extractedField("Submit the final report", "Submit report"),
      deadlineAt: extractedField("2026-08-20T12:00:00.000Z", "Aug 20 at 20:00"),
      startAt: extractedField(null, null),
      endAt: extractedField(null, null),
      durationMinutes: extractedField(null, null),
      location: extractedField(null, null),
      courseName: extractedField(null, null),
      confidence: "high",
      missingFields: ["durationMinutes"],
      warnings: []
    },
    {
      intent: "create",
      kind: "event",
      title: extractedField("Review meeting", "Review meeting"),
      description: extractedField("Review meeting", "Review meeting"),
      deadlineAt: extractedField(null, null),
      startAt: extractedField("2026-08-21T02:00:00.000Z", "Aug 21 from 10:00"),
      endAt: extractedField("2026-08-21T03:00:00.000Z", "11:00"),
      durationMinutes: extractedField(60, "10:00 to 11:00"),
      location: extractedField("Room 101", "Room 101"),
      courseName: extractedField(null, null),
      confidence: "high",
      missingFields: [],
      warnings: []
    }
  ],
  unresolvedQuestions: []
};

const completeOnboarding = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "开始配置" }).click();
  await page.getByRole("button", { name: "开发模式跳过认证" }).click();
  await page.getByRole("button", { name: "开始同步" }).click();
  await page.getByRole("button", { name: "确认，继续" }).click();
  await page.getByRole("button", { name: "安装选中插件" }).click();
  await page.getByRole("button", { name: "保存并继续" }).click();
  await page.getByRole("button", { name: "进入 CampusOS" }).click();
};

const expectNoRootOverflow = async (page: Page): Promise<void> => {
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))).toEqual(expect.objectContaining({
    clientWidth: expect.any(Number),
    scrollWidth: expect.any(Number)
  }));
  const widths = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth + 1);
};

const settleView = async (page: Page): Promise<void> => {
  await page.locator(".view-stage").evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished)
    );
  });
};

test("validates the complete fixture-backed workspace at desktop and narrow widths", async ({ browserName: _browserName }, testInfo) => {
  void _browserName;
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-workspace-e2e-"));
  const downloadPayload = Buffer.from("CampusOS E2E completed download", "utf8");
  const downloadServer = createServer((_request, response) => {
    response.writeHead(200, {
      "content-length": String(downloadPayload.byteLength),
      "content-type": "application/pdf"
    });
    response.end(downloadPayload);
  });
  await new Promise<void>((resolveListen) =>
    downloadServer.listen(0, "127.0.0.1", resolveListen)
  );
  const downloadAddress = downloadServer.address();
  if (!downloadAddress || typeof downloadAddress === "string") {
    throw new Error("Download fixture server did not expose an address.");
  }
  const downloadUrl = `http://127.0.0.1:${downloadAddress.port}/completed.pdf`;
  const assistantServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "fixture route not found" } }));
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const requestBody = Buffer.concat(chunks).toString("utf8");
      const result = requestBody.includes("structured capability check")
        ? { intents: [], unresolvedQuestions: [] }
        : assistantExtractionFixture;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    });
  });
  await new Promise<void>((resolveListen) =>
    assistantServer.listen(0, "127.0.0.1", resolveListen)
  );
  const assistantAddress = assistantServer.address();
  if (!assistantAddress || typeof assistantAddress === "string") {
    throw new Error("Assistant fixture server did not expose an address.");
  }
  const assistantBaseUrl = `http://127.0.0.1:${assistantAddress.port}/v1`;
  const app = await electron.launch({
    args: [
      join(packageRoot, "out/main/main.js"),
      `--user-data-dir=${userDataPath}`
    ],
    env: {
      ...process.env,
      CAMPUSOS_E2E_FIXTURE: "1"
    }
  });

  try {
    const page = await app.firstWindow({ timeout: 10_000 });
    attachRendererGuard(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await completeOnboarding(page);
    await expect.poll(async () => {
      try {
        const cached = JSON.parse(
          await readFile(join(userDataPath, "plugins", "runtime-cache.json"), "utf8")
        ) as { plugins?: unknown[] };
        return cached.plugins?.length ?? 0;
      } catch {
        return 0;
      }
    }).toBeGreaterThan(0);
    // AI connection is configured in the AI assistant view's 设置 tab.
    await page.getByRole("button", { name: "AI 助手" }).click();
    await page.getByLabel("AI 助手视图").getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "模型连接" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("assistant-settings-desktop.png"),
      fullPage: true
    });
    await page.setViewportSize({ width: 820, height: 900 });
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("assistant-settings-narrow.png"),
      fullPage: true
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator(".settings-fields").getByLabel("服务商").selectOption("openai-compatible");
    await page.locator(".settings-fields").getByLabel("模型").last().fill("fixture-model");
    await page.locator(".settings-fields").getByLabel("API Key").last().fill("fixture-key");
    await page.locator(".settings-fields").getByLabel("接口地址").last().fill(assistantBaseUrl);
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(page.getByText(/结构化能力可用/)).toBeVisible();
    await page.getByRole("button", { name: "保存设置" }).click();
    await page.getByLabel("AI 助手视图").getByRole("button", { name: "消息" }).click();

    await expect(page.getByRole("heading", { name: "AI 助手" })).toBeVisible();
    const assistantMessage = "Submit report by Aug 20 at 20:00. Review meeting Aug 21 from 10:00 to 11:00 in Room 101.";
    await page.getByLabel("粘贴消息").fill(assistantMessage);
    await page.getByRole("button", { name: "交给 AI 解析" }).click();
    await expect(page.getByText("2 个候选 · Schema 3")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Submit report" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review meeting" })).toBeVisible();
    await expect(page.getByText(/原文证据/).first()).toBeVisible();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("assistant-candidates-desktop.png"),
      fullPage: true
    });
    await page.setViewportSize({ width: 820, height: 900 });
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("assistant-candidates-narrow.png"),
      fullPage: true
    });
    await page.setViewportSize({ width: 1440, height: 960 });

    await page.getByLabel("主导航").getByRole("button", { name: "AI 助手" }).click();
    await page.getByLabel("AI 助手视图").getByRole("button", { name: "设置" }).click();
    await expect(page.locator(".settings-fields").getByLabel("模型").last()).toHaveValue("fixture-model");
    await expect(page.getByRole("button", { name: "测试连接" })).toBeEnabled();
    await expectNoRootOverflow(page);

    await page.getByLabel("主导航").getByRole("button", { name: "学业" }).click();
    for (const label of ["课表", "课程", "考试", "成绩", "素拓"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "成绩", exact: true }).click();
    await expect(page.getByRole("heading", { name: "学业成绩" })).toBeVisible();
    await expect(page.getByLabel(/权重/)).toHaveCount(0);
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("academic-desktop.png"),
      fullPage: true
    });

    await page.getByLabel("主导航").getByRole("button", { name: "日程" }).click();
    for (const label of ["月历", "周视图", "日程", "日视图"]) {
      await expect(
        page.getByLabel("日历视图").getByRole("button", { name: label, exact: true })
      ).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "新建" })).toBeVisible();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("schedule-desktop.png"),
      fullPage: true
    });

    await page.getByLabel("主导航").getByRole("button", { name: "资料" }).click();
    await expect(page.getByRole("button", { name: "课程资料", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "下载队列", exact: true })).toBeVisible();
    await page.evaluate(async (url) => {
      await window.campusos?.downloads.enqueue({
        url,
        expectedBytes: 31,
        title: "e2e-completed.pdf",
        courseName: "E2E Course",
        sourceId: "academic-affairs",
        semester: "2025-2026 spring"
      });
    }, downloadUrl);
    await expect.poll(async () => page.evaluate(async () =>
      (await window.campusos?.downloads.list())?.[0]?.status
    )).toBe("ready");
    await page.getByRole("button", { name: /^下载队列/ }).click();
    await expect(page.getByText("e2e-completed.pdf", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "打开" })).toBeVisible();
    await expect(page.getByRole("button", { name: "在文件夹中显示" })).toBeVisible();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("materials-desktop.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "搜索" }).click();
    const search = page.getByRole("searchbox", { name: "搜索课程、事项和资料" });
    await search.fill("软件工程");
    await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
    await expect(page.locator(".global-search-results li").first()).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByLabel("应用设置").getByRole("button", { name: "设置" }).click();
    const settingsNav = page.getByLabel("设置分类");
    await settingsNav.getByRole("button", { name: "通知" }).click();
    await page.getByRole("switch", { name: "启用桌面通知" }).click();
    await page.getByRole("switch", { name: "启用成绩变化通知" }).click();
    await page.getByRole("button", { name: "保存提醒" }).click();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await expect.poll(async () => page.evaluate(async () =>
      window.campusos?.reminders.loadScheduleState()
    )).toMatchObject({
      enabled: false,
      scheduledCount: 0,
      nextFireAt: null
    });
    await expect.poll(async () => page.evaluate(async () =>
      window.campusos?.reminders.loadSettings()
    )).toMatchObject({
      gradeChangesEnabled: false
    });
    await settingsNav.getByRole("button", { name: "更新" }).click();
    await expect(page.getByRole("heading", { name: "更新" })).toBeVisible();
    await settingsNav.getByRole("button", { name: "关于" }).click();
    await expect(page.getByRole("heading", { name: "关于" })).toBeVisible();
    await expect(page.getByText("MIT", { exact: true })).toBeVisible();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("settings-desktop.png"),
      fullPage: true
    });

    await page.setViewportSize({ width: 820, height: 900 });
    await page.getByLabel("主导航").getByRole("button", { name: "学业" }).click();
    await page.getByRole("button", { name: "成绩", exact: true }).click();
    await expect(page.getByRole("heading", { name: "学业成绩" })).toBeVisible();
    await expect(page.getByLabel(/权重/)).toHaveCount(0);
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("academic-narrow.png"),
      fullPage: true
    });

    await page.getByLabel("主导航").getByRole("button", { name: "资料" }).click();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("materials-narrow.png"),
      fullPage: true
    });

    await page.getByLabel("主导航").getByRole("button", { name: "日程" }).click();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("schedule-narrow.png"),
      fullPage: true
    });

    // Regression: the fixed notification trigger must not cover the settings
    // button once the rail collapses into a horizontal top bar at narrow widths.
    await page.getByLabel("应用设置").getByRole("button", { name: "设置" }).click();
    await expect(page.getByLabel("设置分类")).toBeVisible();
    await expect(page.getByRole("heading", { name: "账号" })).toBeVisible();
    await expectNoRootOverflow(page);

    // Regression: at narrow widths the document root is the scroll container,
    // so the reserved document gutter must keep the layout width constant when
    // the scrollbar appears/disappears between categories.
    const stageWidths = await page.evaluate(async () => {
      const measure = () => Math.round(
        document.querySelector(".view-stage")?.getBoundingClientRect().width ?? 0
      );
      const nav = document.querySelector(".settings-nav");
      if (!nav) return null;
      const go = (label: string): void => {
        const button = [...nav.querySelectorAll("button")].find(
          (candidate) => (candidate.textContent ?? "").trim() === label
        );
        button?.click();
      };
      go("高级");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const advanced = measure();
      go("账号");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const account = measure();
      return { advanced, account };
    });
    expect(stageWidths).not.toBeNull();
    expect(Math.abs(stageWidths!.advanced - stageWidths!.account)).toBeLessThanOrEqual(2);
  } finally {
    await app.close();
    await new Promise<void>((resolveClose, rejectClose) =>
      downloadServer.close((error) => error ? rejectClose(error) : resolveClose())
    );
    await new Promise<void>((resolveClose, rejectClose) =>
      assistantServer.close((error) => error ? rejectClose(error) : resolveClose())
    );
    await rm(userDataPath, { recursive: true, force: true });
  }
});
