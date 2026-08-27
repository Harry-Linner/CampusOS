import type { Page } from "@playwright/test";

/**
 * e2e 构建产物下已知无害、预期出现的 console.error 特征串。
 * 这些是 CSP 拦截或测试故意触发的路径，不能当作渲染器崩溃。
 */
const EXPECTED_CONSOLE_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  // e2e 构建使用严格 CSP（style-src 'self'），React/preload 内联 style 被拦截时
  // Chromium 会打 console.error；拦截本身是预期行为，不影响功能。
  /Applying inline style violates the following Content Security Policy/,
  /Refused to apply inline style/
];

/**
 * 渲染器未捕获异常守卫：pageerror 与「非预期」的 console.error 都视为失败。
 *
 * 背景：React 的运行时崩溃（如 "Rendered more hooks than during the previous
 * render"）只会以 console error 形式出现，不影响可点击元素的可见性，因此
 * 普通 e2e 断言（getByRole 等）永远看不到它——此前 UI 纯色崩溃就是这样
 * 从 CI 溜走的。所有官方 e2e 必须在启动 app 后立即调用本守卫。
 */
export const attachRendererGuard = (page: Page): void => {
  page.on("pageerror", (error) => {
    throw new Error(`渲染器未捕获异常：${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (EXPECTED_CONSOLE_ERROR_PATTERNS.some((pattern) => pattern.test(message.text()))) {
      return;
    }
    throw new Error(`渲染器 console.error：${message.text()}`);
  });
};
