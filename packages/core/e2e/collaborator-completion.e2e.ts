import { prepareFixtureWorkspace } from "./fixtureWorkspace";
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachRendererGuard } from "./rendererGuard";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

interface SqliteStatement {
  run: (...parameters: unknown[]) => unknown;
}

interface SqliteDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
}

const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};



const waitForWindow = async (
  app: ElectronApplication,
  urlFragment: string
): Promise<Page> => {
  await expect.poll(
    () => app.windows().find((candidate) => candidate.url().includes(urlFragment))?.url() ?? "",
    { timeout: 15_000 }
  ).toContain(urlFragment);
  const page = app.windows().find((candidate) => candidate.url().includes(urlFragment));
  if (!page) throw new Error(`Electron window did not open: ${urlFragment}`);
  page.setDefaultTimeout(15_000);
  attachRendererGuard(page);
  await page.waitForLoadState("domcontentloaded");
  return page;
};

const expectPetArtworkContained = async (page: Page): Promise<void> => {
  expect(await page.locator(".pet-character").evaluate((character) => {
    const image = character.querySelector("img");
    if (!image) return false;
    const frame = character.getBoundingClientRect();
    const artwork = image.getBoundingClientRect();
    return frame.width > 40 && frame.height > 40 && artwork.width > 40 && artwork.height > 40
      && artwork.left >= 0 && artwork.top >= 0
      && artwork.right <= window.innerWidth + 1 && artwork.bottom <= window.innerHeight + 1
      && artwork.bottom <= frame.bottom + 1 && artwork.height <= frame.height + 1;
  })).toBe(true);
};

const seedCampusFeedFixture = (userDataPath: string): void => {
  const database = new DatabaseSync(join(userDataPath, "campusos.sqlite"));
  const now = new Date().toISOString();
  const item = {
    id: "e2e-campus-feed-detail",
    sourceId: "ugrs-dwjl",
    url: "https://e2e.invalid/campus-feed/detail",
    title: "E2E 国际交流项目报名通知",
    summary: "脱敏 fixture：核对报名时间、地点与附件。",
    publishedAt: now,
    contentHash: "e2e-campus-feed-list-v1",
    fetchedAt: now,
    state: "new"
  };
  const detail = {
    itemId: item.id,
    title: item.title,
    url: item.url,
    text: "这是 CampusOS Electron UI 验收使用的脱敏缓存正文。报名截止时间为 2026 年 9 月 30 日，地点为测试会议室。",
    attachments: [
      {
        name: "E2E 报名说明.pdf",
        url: "https://ugrs.zju.edu.cn/e2e-fixture.pdf"
      }
    ],
    fetchedAt: now,
    contentHash: "e2e-campus-feed-detail-v1",
    stale: false
  };
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const insertItem = database.prepare(`
      INSERT INTO campus_feed_items (
        id, source_id, url, title, summary, published_at, content_hash, fetched_at, state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_id = excluded.source_id,
        url = excluded.url,
        title = excluded.title,
        summary = excluded.summary,
        published_at = excluded.published_at,
        content_hash = excluded.content_hash,
        fetched_at = excluded.fetched_at,
        state = excluded.state
    `);
    insertItem.run(
      item.id,
      item.sourceId,
      item.url,
      item.title,
      item.summary,
      item.publishedAt,
      item.contentHash,
      item.fetchedAt,
      item.state
    );
    for (let index = 1; index <= 60; index++) {
      const date = new Date(Date.now() - index * 60_000).toISOString();
      insertItem.run(`e2e-recent-${index}`, item.sourceId, `https://e2e.invalid/recent/${index}`, `E2E 最近列表 ${index}`, null, date, `recent-${index}`, date, "read");
    }
    const oldDate = new Date(Date.now() - 400 * 86_400_000).toISOString();
    insertItem.run("e2e-old-history", item.sourceId, "https://e2e.invalid/archive/old", "E2E 旧档案条目", "仅列表摘要中的追溯关键词", oldDate, "old-history", oldDate, "read");
    database.prepare(`
      INSERT INTO campus_feed_details (item_id, detail_json, saved_at)
      VALUES (?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        detail_json = excluded.detail_json,
        saved_at = excluded.saved_at
    `).run(item.id, JSON.stringify(detail), now);
  } finally {
    database.close();
  }
};

const extractedField = <T,>(value: T, evidenceText: string | null) => ({
  value,
  confidence: "high",
  source: "explicit",
  evidenceText,
  needsConfirmation: false
});

const petAssistantFixture = {
  intents: [
    {
      intent: "create",
      kind: "deadline",
      title: extractedField("提交桌宠验收报告", "提交桌宠验收报告"),
      description: extractedField("通过桌宠投放的脱敏测试消息", "脱敏测试消息"),
      deadlineAt: extractedField("2026-09-30T12:00:00.000Z", "9 月 30 日 20:00 前"),
      startAt: extractedField(null, null),
      endAt: extractedField(null, null),
      durationMinutes: extractedField(null, null),
      location: extractedField(null, null),
      courseName: extractedField(null, null),
      confidence: "high",
      missingFields: [],
      warnings: []
    }
  ],
  unresolvedQuestions: []
};

const startAssistantFixtureServer = async (): Promise<{
  server: Server;
  baseUrl: string;
}> => {
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "fixture route not found" } }));
      return;
    }
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(petAssistantFixture) } }]
      }));
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Assistant fixture server did not expose a TCP address.");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolveClose, rejectClose) => server.close((error) => {
    if (error) rejectClose(error);
    else resolveClose();
  }));

test("college and academic office subscriptions are complete, and optional interests add sources", async ({ browserName: _browserName }, testInfo) => {
  void _browserName;
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-feed-union-e2e-"));
  const app = await electron.launch({ args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`], env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" } });
  try {
    const page = await app.firstWindow();
    attachRendererGuard(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await prepareFixtureWorkspace(page);
    await page.getByLabel("主导航").getByRole("button", { name: "校园资讯" }).click();
    await page.getByRole("button", { name: "定制偏好" }).click();
    await expect(page.getByRole("button", { name: "教职工", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "其他", exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: /学院或学园/ }).selectOption("材料学院");
    await page.getByRole("button", { name: "查看推荐来源" }).click();
    for (const column of ["党建通知", "本科教学", "研究生教学", "学生事务"]) {
      await expect(page.getByRole("checkbox", { name: `材料学院 · ${column}`, exact: true })).toBeChecked();
    }
    await expect(page.getByText("4 个来源已选", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("materials-all-columns.png") });
    await page.getByRole("button", { name: "返回修改" }).click();
    await page.getByRole("combobox", { name: /学院或学园/ }).selectOption("");
    await page.getByRole("button", { name: "教务考试", exact: true }).click();
    await page.getByRole("button", { name: "奖助评优", exact: true }).click();
    await page.getByRole("button", { name: "查看推荐来源" }).click();
    await expect(page.getByRole("checkbox", { name: "本科生院 · 通识教育通知", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "学工门户 · 评奖评优", exact: true })).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath("optional-identity-interests.png") });
    await page.getByRole("button", { name: "返回修改" }).click();
    await page.getByRole("button", { name: "本科生", exact: true }).click();
    await page.getByRole("button", { name: "查看推荐来源" }).click();
    for (const column of ["通识教育通知", "推免通知", "讲座报名"]) {
      await expect(page.getByRole("checkbox", { name: `本科生院 · ${column}`, exact: true })).toBeChecked();
    }
    await page.getByRole("checkbox", { name: "本科生院 · 推免通知", exact: true }).uncheck();
    await page.getByRole("button", { name: "返回修改" }).click();
    await page.getByRole("button", { name: "校园生活", exact: true }).click();
    await page.getByRole("button", { name: "查看推荐来源" }).click();
    await expect(page.getByRole("checkbox", { name: "本科生院 · 推免通知", exact: true })).not.toBeChecked();
    const selectedNames = await page.locator('input[type="checkbox"]:checked').evaluateAll(inputs => inputs.map(input => input.getAttribute("aria-label")));
    await page.getByRole("button", { name: "订阅所选并进入" }).click();
    await expect.poll(() => page.evaluate(async () => (await window.campusos!.campusFeed!.getSnapshot()).sources.map(source => source.name).sort())).toEqual(selectedNames.sort());
  } finally { await app.close(); await rm(userDataPath, { recursive: true, force: true }); }
});

test("master identity alone does not select unrelated college feeds", async ({ browserName: _browserName }, testInfo) => {
  void _browserName;
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-feed-identity-e2e-"));
  const app = await electron.launch({ args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`], env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" } });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 960 });
    await prepareFixtureWorkspace(page);
    await page.getByLabel("主导航").getByRole("button", { name: "校园资讯" }).click();
    await page.getByRole("button", { name: "定制偏好" }).click();
    await page.getByRole("button", { name: "硕士生", exact: true }).click();
    await page.getByRole("button", { name: "查看推荐来源" }).click();
    await expect(page.getByText("2 个来源已选", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "研究生院 · 全部公告", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "研究生招生 · 通知", exact: true })).toBeChecked();
    await expect(page.locator('input[type="checkbox"][aria-label="历史学院 · 通知公告"]')).not.toBeChecked();
    await expect(page.locator('input[type="checkbox"][aria-label="高分子系 · 通知"]')).not.toBeChecked();
    await expect(page.locator(".campus-feed-reason")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("master-identity-recommendations.png") });
  } finally { await app.close(); await rm(userDataPath, { recursive: true, force: true }); }
});

test("changing to computer science replaces stale college selections and keeps source cards concise", async ({ browserName: _browserName }, testInfo) => {
  void _browserName;
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-feed-college-e2e-"));
  const app = await electron.launch({ args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`], env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" } });
  try {
    const page = await app.firstWindow();
    attachRendererGuard(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await prepareFixtureWorkspace(page);
    await page.evaluate(async () => {
      const feed = window.campusos!.campusFeed!;
      await feed.savePreferences({ profile: { identity: "master", college: "历史学院", interests: [] }, selectedSourceIds: ["ls-tzgg", "mse-tzgg"] });
      for (const id of ["ls-tzgg", "mse-tzgg"]) await feed.updateSource(id, { enabled: true });
    });
    await page.getByLabel("主导航").getByRole("button", { name: "校园资讯" }).click();
    await page.getByRole("tab", { name: "订阅" }).click();
    await page.getByRole("button", { name: "调整身份与兴趣" }).click();
    await page.getByRole("combobox", { name: /学院或学园/ }).selectOption("计算机学院");
    await page.getByRole("button", { name: "就业实习", exact: true }).click();
    await page.getByRole("button", { name: "查看推荐来源" }).click();
    const recommended = page.getByRole("region", { name: "推荐来源" });
    await expect(recommended.getByRole("checkbox", { name: "计算机学院 · 重点提示", exact: true })).toBeChecked();
    await expect(recommended.getByRole("checkbox")).toHaveCount(3);
    await expect(page.locator('input[type="checkbox"]:checked[aria-label^="历史学院"], input[type="checkbox"]:checked[aria-label^="材料学院"], input[type="checkbox"]:checked[aria-label^="建工学院"]')).toHaveCount(0);
    await expect(page.getByText(/已核对|已核验|已迁至|已切换|核对日期/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("computer-science-recommendations.png") });
    await page.getByRole("button", { name: "订阅所选并进入" }).click();
    await expect.poll(() => page.evaluate(async () => (await window.campusos!.campusFeed!.getSnapshot()).sources.map(source => source.id).sort())).toEqual(["cs-csen", "grs-all", "grs-yjszs"]);
    await page.evaluate(() => window.campusos!.campusFeed!.updateSource("cs-csen", { enabled: false, notificationEnabled: false }));
    await page.getByRole("tab", { name: "订阅" }).click();
    await expect(page.getByRole("heading", { name: "重点提示", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "发现来源" }).click();
    const discoverCount = await page.evaluate(async () => { const snapshot = await window.campusos!.campusFeed!.getSnapshot(); return snapshot.catalog!.length - snapshot.sources.length; });
    await expect(page.locator("article.campus-feed-source-row")).toHaveCount(discoverCount);
    await expect(page.getByRole("heading", { name: "重点提示", exact: true })).toHaveCount(0);
    await page.evaluate(() => window.campusos!.campusFeed!.removeSource("cs-csen"));
    await page.getByLabel("搜索信息源").fill("计算机学院");
    await expect(page.getByRole("heading", { name: "重点提示", exact: true })).toBeVisible();
    await page.locator("article.campus-feed-source-row").filter({ has: page.getByRole("heading", { name: "重点提示", exact: true }) }).getByRole("button", { name: "订阅", exact: true }).click();
    await page.evaluate(() => window.campusos!.campusFeed!.updateSource("cs-csen", { enabled: false }));
    await expect(page.getByRole("heading", { name: "重点提示", exact: true })).toHaveCount(0);
    await expect(page.getByText(/已核对|已核验|已迁至|核对日期|最近成功抓取/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("concise-source-catalog.png") });
  } finally { await app.close(); await rm(userDataPath, { recursive: true, force: true }); }
});

test(
  "accepts feed, calendar, and pet in Electron; the pet drop is renderer-synthesized and does not claim OS cross-app drag-and-drop",
  async ({ browserName: _browserName }, testInfo) => {
    void _browserName;
    test.setTimeout(120_000);
    const userDataPath = await mkdtemp(join(tmpdir(), "campusos-collaborator-e2e-"));
    const { server, baseUrl } = await startAssistantFixtureServer();
    let app = await electron.launch({
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
      page.setDefaultTimeout(15_000);
      attachRendererGuard(page);
      await page.setViewportSize({ width: 1440, height: 960 });
      await prepareFixtureWorkspace(page);

      await page.getByLabel("主导航").getByRole("button", { name: "校园资讯" }).click();
      await page.getByRole("button", { name: "定制偏好" }).click();
      const feedSetup = page.getByRole("region", { name: "校园资讯首次设置" });
      await expect(feedSetup).toBeVisible();
      await page.getByRole("button", { name: "本科生", exact: true }).click();
      await page.getByRole("button", { name: "国际交流", exact: true }).click();
      await page.getByRole("button", { name: "查看推荐来源" }).click();
      await expect(page.getByText(/个推荐来源/)).toBeVisible();
      await expect(page.getByRole("region", { name: "推荐来源" })).toBeVisible();

      const recommendedSource = page.getByRole("checkbox", {
        name: /本科生对外交流 · 国际项目/
      });
      await expect(recommendedSource).toBeChecked();
      // Website names now live in the group heading; the checkbox retains the
      // complete accessible source name. Use real sequential input actions.
      const selectedNames = await feedSetup.getByRole("checkbox", { checked: true })
        .evaluateAll(inputs => inputs.map(input => input.getAttribute("aria-label")!));
      for (const name of selectedNames) {
        if (name !== "本科生对外交流 · 国际项目") {
          await feedSetup.getByRole("checkbox", { name, exact: true }).uncheck();
        }
      }
      await expect(recommendedSource).toBeChecked();
      await expect(page.getByText("1 个来源已选", { exact: true })).toBeVisible();
      await feedSetup.screenshot({ path: testInfo.outputPath("campus-feed-recommendations.png") });
      await page.getByRole("button", { name: "订阅所选并进入" }).click();
      await page.evaluate(async () => {
        const feed = window.campusos?.campusFeed;
        if (!feed) throw new Error("Campus feed bridge is unavailable.");
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const snapshot = await feed.getSnapshot();
          if (snapshot.preferences?.onboarding === "completed") {
            const source = snapshot.sources.find((candidate) => candidate.id === "ugrs-dwjl");
            if (!source) throw new Error("Fixture subscription was not saved.");
            // Clear the one-second initial scheduler before it can contact a
            // public website. The E2E remains wholly fixture-backed.
            await feed.updateSource(source.id, { enabled: source.enabled });
            return;
          }
          await new Promise((resolveWait) => setTimeout(resolveWait, 20));
        }
        throw new Error("Campus feed preferences were not persisted in time.");
      });
      await expect(page.getByRole("heading", { name: "校园资讯" })).toBeVisible();

      seedCampusFeedFixture(userDataPath);
      const feedSnapshot = await page.evaluate(async () => {
        const feed = window.campusos?.campusFeed;
        if (!feed) throw new Error("Campus feed bridge is unavailable.");
        const current = await feed.getSnapshot();
        const source = current.sources.find((candidate) => candidate.id === "ugrs-dwjl");
        if (!source) throw new Error("Fixture subscription was not saved.");
        // Broadcast a fresh snapshot containing the externally seeded,
        // sanitized SQLite fixture.
        await feed.updateSource(source.id, { enabled: source.enabled });
        return feed.getSnapshot();
      });
      expect(feedSnapshot.catalog).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "ugrs-dwjl" })
      ]));
      expect(feedSnapshot.preferences).toMatchObject({
        profile: { identity: "undergraduate", interests: ["国际交流"] },
        onboarding: "completed"
      });
      expect(feedSnapshot.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "e2e-campus-feed-detail" })
      ]));

      await page.getByRole("tab", { name: "订阅" }).click();
      await page.getByRole("group", { name: "来源目录" })
        .getByRole("button", { name: "发现来源" }).click();
      const subscribedIds = new Set(feedSnapshot.sources.map(source => source.id));
      const availableSources = feedSnapshot.catalog.filter(source => !subscribedIds.has(source.id));
      await expect(page.locator("article.campus-feed-source-row")).toHaveCount(availableSources.length);
      await expect(page.getByRole("button", { name: "打开 本科生对外交流 · 国际项目 官网", includeHidden: true })).toHaveCount(0);
      await page.locator(".settings-panel").screenshot({
        path: testInfo.outputPath("campus-feed-catalog.png")
      });
      await page.getByRole("textbox", { name: "搜索信息源" }).fill("计算机学院");
      await expect(page.getByRole("heading", { name: "重点提示", exact: true })).toBeVisible();

      await page.getByRole("tab", { name: "资讯" }).click();
      const feedItem = page.getByRole("article").filter({
        has: page.getByRole("heading", { name: "E2E 国际交流项目报名通知" })
      });
      await expect(feedItem).toBeVisible();
      await expect(page.locator("[data-feed-item-id]")).toHaveCount(50);
      await expect(feedItem.getByRole("button", { name: "正文" })).toHaveCount(0);
      await page.keyboard.press("Control+f");
      const searchDialog = page.getByRole("dialog", { name: "全局搜索" });
      await searchDialog.getByRole("searchbox").fill("脱敏缓存正文");
      await expect(searchDialog.getByText("没有匹配结果")).toBeVisible();
      await searchDialog.getByRole("searchbox").fill("追溯关键词");
      await expect(searchDialog.getByText("E2E 旧档案条目")).toBeVisible();
      await expect(searchDialog.getByText(/历史资讯.*条.*已显示/)).toHaveCount(0);
      await page.evaluate(() => window.campusos!.campusFeed!.updateSource("ugrs-dwjl", { enabled: false, notificationEnabled: false }));
      await expect(searchDialog.getByText("E2E 旧档案条目")).toBeVisible();
      await page.evaluate(() => window.campusos!.campusFeed!.removeSource("ugrs-dwjl"));
      await expect(searchDialog.getByText("E2E 旧档案条目")).toHaveCount(0);
      await expect(searchDialog.getByText("没有匹配结果")).toBeVisible();
      await page.evaluate(async () => {
        await window.campusos!.campusFeed!.addSource("ugrs-dwjl");
        await window.campusos!.campusFeed!.updateSource("ugrs-dwjl", { enabled: true });
      });
      await expect(searchDialog.getByText("E2E 旧档案条目")).toBeVisible();
      await searchDialog.screenshot({ path: testInfo.outputPath("campus-feed-history-search.png") });
      await searchDialog.getByText("E2E 旧档案条目").click();
      await expect(page.locator("[data-feed-item-id]")).toHaveCount(1);
      await expect(page.getByRole("heading", { name: "E2E 旧档案条目" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("campus-feed-history-located.png") });
      await page.getByRole("button", { name: "返回每源最近 50 条" }).click();
      await expect(page.locator("[data-feed-item-id]")).toHaveCount(50);

      await page.evaluate(async () => {
        const calendarHost = window.campusos?.desktopCalendarHost;
        if (!calendarHost) throw new Error("Desktop calendar host bridge is unavailable.");
        await calendarHost.start();
      });
      const calendarPage = await waitForWindow(app, "desk-calendar.html");
      await expect.poll(() => page.evaluate(async () =>
        window.campusos?.desktopCalendarHost.status()
      )).toMatchObject({ running: true });
      const calendarData = await calendarPage.evaluate(async () => {
        if (!window.deskCalendar) throw new Error("Desktop calendar bridge is unavailable.");
        return window.deskCalendar.getCalendarData();
      });
      expect(calendarData.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(calendarData.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: "软件工程课程设计" }),
        expect.objectContaining({ title: "软件工程课程设计报告" })
      ]));
      await expect(calendarPage.getByRole("button", { name: "月", exact: true }))
        .toHaveClass("is-active");
      await expect(calendarPage.getByText("软件工程课程设计", { exact: true }).first())
        .toBeVisible();
      await calendarPage.screenshot({
        path: testInfo.outputPath("desktop-calendar-month.png")
      });
      await calendarPage.getByRole("button", { name: "周", exact: true }).click();
      await expect(calendarPage.getByRole("button", { name: "周", exact: true }))
        .toHaveClass("is-active");
      await calendarPage.getByRole("button", { name: "日", exact: true }).click();
      await expect(calendarPage.getByRole("button", { name: "日", exact: true }))
        .toHaveClass("is-active");
      await calendarPage.getByRole("button", { name: "今天", exact: true }).click();
      await calendarPage.getByRole("button", { name: "⚙ 设置" }).click();
      const calendarSettings = calendarPage.getByRole("heading", { name: "日历设置" });
      await expect(calendarSettings).toBeVisible();
      await expect(calendarPage.getByLabel("随 CampusOS 开机恢复")).toBeDisabled();
      const lunarToggle = calendarPage.getByLabel("农历", { exact: true });
      await expect(lunarToggle).not.toBeChecked();
      // The controlled input updates after the settings IPC has persisted the
      // change. check() asserts synchronously after clicking and races that reply.
      await lunarToggle.click();
      await expect(lunarToggle).toBeChecked();
      await expect.poll(() => calendarPage.evaluate(async () =>
        (await window.deskCalendar?.getSettings())?.showLunar
      )).toBe(true);
      await calendarPage.screenshot({
        path: testInfo.outputPath("desktop-calendar-settings.png")
      });
      await calendarPage.getByRole("button", { name: "关闭", exact: true }).click();

      await page.evaluate(async (assistantBaseUrl) => {
        const assistant = window.campusos?.assistant;
        const desktopPet = window.campusos?.desktopPet;
        if (!assistant || !desktopPet) throw new Error("Assistant or desktop pet bridge is unavailable.");
        await assistant.saveSettings({
          apiKey: "fixture-key",
          provider: "openai-compatible",
          protocol: "openai-chat-completions",
          baseUrl: assistantBaseUrl,
          model: "fixture-model"
        });
        await desktopPet.saveSettings({ enabled: true, clickThrough: false });
      }, baseUrl);
      const petPage = await waitForWindow(app, "desktop-pet.html");
      // Keep the click target stable; native input also covers the animated character.
      await petPage.emulateMedia({ reducedMotion: "reduce" });
      const petPanel = await waitForWindow(app, "desktop-pet.html?panel=1");
      const panelWindow = await app.browserWindow(petPanel);
      const characterWindow = await app.browserWindow(petPage);
      await expect.poll(() => panelWindow.evaluate(window => window.isVisible())).toBe(true);
      await petPanel.getByRole("button", { name: "关闭桌宠面板" }).click();
      await expect.poll(() => panelWindow.evaluate(window => window.isVisible())).toBe(false);
      expect(await characterWindow.evaluate(window => window.isVisible())).toBe(true);
      expect(await page.evaluate(async () => (await window.campusos!.desktopPet!.getState()).settings.enabled)).toBe(true);
      await petPage.getByRole("button", { name: "打开桌宠面板" }).click();
      await expect.poll(() => panelWindow.evaluate(window => window.isVisible())).toBe(true);
      await panelWindow.evaluate(window => window.close());
      expect(await characterWindow.evaluate(window => window.isVisible())).toBe(true);
      await page.evaluate(() => window.campusos!.desktopPet!.show());
      await expect.poll(() => panelWindow.evaluate(window => window.isVisible())).toBe(true);
      const petSecurity = await petPage.evaluate(() => ({
        nodeRequire: typeof (window as unknown as { require?: unknown }).require,
        nodeProcess: typeof (window as unknown as { process?: unknown }).process,
        exposedMethods: Object.keys(window.desktopPet ?? {}).sort()
      }));
      expect(petSecurity).toMatchObject({ nodeRequire: "undefined", nodeProcess: "undefined" });
      expect(petSecurity.exposedMethods).not.toContain("getJob");
      const petImage = petPage.getByRole("img", { name: "蓝发鲸鱼女仆桌宠" });
      await expect(petImage).toBeVisible();
      expect(await petImage.evaluate((image) =>
        image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
      )).toBe(true);
      await expect(petPage.locator(".pet-fallback")).toHaveCount(0);

      // Exercise the real settings IPC and locally bundled images, not a
      // renderer fixture for appearances. Each illustration must decode.
      await petPanel.getByRole("button", { name: "桌宠设置" }).click();
      await expect(petPanel.getByText("形态与设置", { exact: true })).toBeVisible();
      const panelSize = await panelWindow.evaluate(window => window.getSize());
      const forms = [
        ["idle", "正面"], ["left", "左侧"], ["back", "背面"],
        ["right", "右侧"], ["smile", "微笑"], ["wave", "挥手"],
        ["think", "思考"], ["celebrate", "开心"], ["puzzled", "疑惑"]
      ] as const;
      const artworkUrls = new Set<string>();
      for (const [appearance, label] of forms) {
        await petPanel.getByRole("button", { name: `形态：${label}`, exact: true }).click();
        await expect(petPage.locator(".pet-character")).toHaveAttribute("data-appearance", appearance);
        await expect.poll(() => petPage.evaluate(async () =>
          (await window.desktopPet?.getState())?.settings.appearance
        )).toBe(appearance);
        await expect.poll(() => petImage.evaluate((image) =>
          image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
        )).toBe(true);
        const artworkUrl = await petImage.evaluate((image) => (image as HTMLImageElement).currentSrc);
        const expectedStem = appearance === "idle" ? "desktop-pet" : `desktop-pet-${appearance}`;
        expect(new URL(artworkUrl).pathname.split("/").at(-1)).toMatch(new RegExp(`^${expectedStem}-[A-Za-z0-9_-]{8}\\.png$`));
        artworkUrls.add(artworkUrl);
        await expect(petPage.locator(".pet-character")).toHaveAttribute("data-appearance", appearance);
        await petPanel.getByRole("button", { name: "收起桌宠设置" }).click();
        await expectPetArtworkContained(petPage);
        await petPage.screenshot({ path: testInfo.outputPath(`desktop-pet-form-${appearance}.png`) });
        await petPanel.getByRole("button", { name: "桌宠设置" }).click();
      }
      expect(artworkUrls.size).toBe(9);
      await petPanel.screenshot({ path: testInfo.outputPath("desktop-pet-forms.png") });
      await petPage.evaluate(async () => { await window.desktopPet?.saveSettings({ scale: 0.65 }); });
      await petPanel.getByRole("button", { name: "形态：背面", exact: true }).click();
      await expect(petPage.locator(".pet-character")).toHaveAttribute("data-appearance", "back");
      await expect.poll(() => petPage.evaluate(() => Math.abs(innerWidth - 221) <= 1 && Math.abs(innerHeight - 299) <= 1)).toBe(true);
      expect(await panelWindow.evaluate(window => window.getSize())).toEqual(panelSize);
      await petPanel.locator(".pet-settings-body").evaluate(body => { body.scrollTop = body.scrollHeight; });
      await expect(petPanel.getByRole("slider", { name: "桌宠大小" })).toBeVisible();
      expect(await petPanel.locator(".pet-settings header").evaluate(header => getComputedStyle(header).position)).toBe("static");
      await petPanel.screenshot({ path: testInfo.outputPath("desktop-pet-forms-small.png") });
      await petPanel.getByRole("button", { name: "收起桌宠设置" }).click();
      await expectPetArtworkContained(petPage);
      await petPage.screenshot({ path: testInfo.outputPath("desktop-pet-form-small.png") });
      await petPage.evaluate(async () => { await window.desktopPet?.saveSettings({ scale: 1 }); });
      await petPage.reload();
      await expect(petPage.locator(".pet-character")).toHaveAttribute("data-appearance", "back");
      await petPanel.getByRole("button", { name: "桌宠设置" }).click();
      await petPanel.getByRole("button", { name: "形态：自动", exact: true }).click();
      await petPanel.getByRole("button", { name: "收起桌宠设置" }).click();

      const petShell = petPage.locator(".pet-shell");
      await petShell.evaluate((shell) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", "请在 9 月 30 日 20:00 前提交桌宠验收报告。");
        shell.dispatchEvent(new DragEvent("dragenter", {
          bubbles: true,
          cancelable: true,
          dataTransfer
        }));
      });
      await expect(petShell).toHaveClass(/is-dragging/);
      await expect(petPage.locator(".pet-character")).toHaveAttribute("data-appearance", "wave");
      await expect(petPage.getByText("松手，交给我", { exact: true })).toBeVisible();
      await petPage.screenshot({ path: testInfo.outputPath("desktop-pet-drop-hint.png") });
      await petShell.evaluate((shell) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", "请在 9 月 30 日 20:00 前提交桌宠验收报告。");
        shell.dispatchEvent(new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer
        }));
      });
      await expect(petPanel.getByText("已整理", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(petPage.locator(".pet-character")).toHaveAttribute("data-appearance", "celebrate");
      await expect(petPanel.getByRole("button", { name: "核对结果" })).toBeVisible();
      await petPanel.screenshot({ path: testInfo.outputPath("desktop-pet-ready.png") });
      const firstJobId = await petPage.evaluate(async () => (await window.desktopPet!.getState()).jobs[0].id);
      await petShell.evaluate((shell) => {
        const transfer = new DataTransfer();
        transfer.setData("text/plain", "第二条脱敏验收消息：9 月 30 日交报告。");
        shell.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      });
      await expect.poll(() => petPage.evaluate(async () => (await window.desktopPet!.getState()).jobs
        .filter((job) => job.status === "ready").length)).toBe(2);
      await petPanel.getByRole("combobox", { name: "待处理消息" }).selectOption(firstJobId);
      await expectPetArtworkContained(petPage);
      await petPanel.screenshot({ path: testInfo.outputPath("desktop-pet-history.png") });
      await petPanel.getByRole("button", { name: "核对结果" }).click();

      await expect(page.getByRole("heading", { name: "AI 助手" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "提交桌宠验收报告" })).toBeVisible();
      await expect(page.getByRole("button", { name: "清除桌宠记录" })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("desktop-pet-assistant-review.png"),
        fullPage: true
      });

      await calendarPage.getByRole("button", { name: "关闭日历" }).click();
      await expect.poll(() => page.evaluate(async () =>
        window.campusos?.desktopCalendarHost.status()
      )).toMatchObject({ running: false });

      // A renderer reload cannot prove disk persistence: restart the whole
      // Electron process with the same isolated profile and restore the pet.
      await petPage.evaluate(async () => { await window.desktopPet?.saveSettings({ appearance: "back" }); });
      const previousPid = app.process().pid;
      await app.close();
      app = await electron.launch({
        args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`],
        env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" }
      });
      expect(app.process().pid).not.toBe(previousPid);
      const restoredPet = await waitForWindow(app, "desktop-pet.html");
      await expect(restoredPet.locator(".pet-character")).toHaveAttribute("data-appearance", "back");
      const restoredPanel = await waitForWindow(app, "desktop-pet.html?panel=1");
      await restoredPanel.getByRole("button", { name: "桌宠设置" }).click();
      await expect(restoredPanel.getByRole("button", { name: "形态：背面", exact: true })).toHaveAttribute("aria-pressed", "true");
    } finally {
      await app.close();
      await closeServer(server);
      await rm(userDataPath, { recursive: true, force: true });
    }
  }
);
