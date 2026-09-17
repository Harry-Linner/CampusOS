import { chromium, expect, type ElectronApplication, type Page } from "@playwright/test";
import { createServer } from "node:net";

export async function desktopPort(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No desktop test port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return String(address.port);
}

export async function connectDesktop(app: ElectronApplication, port: string): Promise<Page> {
  if (process.platform !== "win32") {
    await expect.poll(() => app.windows().find(page => page.url().endsWith("desk-calendar.html"))?.url()).toBeTruthy();
    return app.windows().find(page => page.url().endsWith("desk-calendar.html"))!;
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await expect.poll(() => browser.contexts()[0]?.pages().find(page => page.url().endsWith("desk-calendar.html"))?.url()).toBeTruthy();
  const page = browser.contexts()[0].pages().find(page => page.url().endsWith("desk-calendar.html"))!;
  page.setDefaultTimeout(15000);
  return page;
}

export async function calendarPanel(app: ElectronApplication, desktop: Page, action: () => Promise<unknown>): Promise<Page> {
  if (process.platform !== "win32") { await action(); return desktop; }
  const opened = app.waitForEvent("window");
  await action();
  const page = await opened;
  await page.waitForURL(/desk-calendar\.html\?panel=1$/);
  return page;
}

export async function closeCalendarPanel(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: "关闭", exact: true }).click();
  if (process.platform !== "win32") {
    await close;
    return;
  }
  try {
    await close;
  } catch (error) {
    // Closing the native panel can destroy its page before Playwright receives
    // the click acknowledgement. The closed page is the expected outcome.
    if (!page.isClosed()) throw error;
  }
  await expect.poll(() => page.isClosed()).toBe(true);
}
