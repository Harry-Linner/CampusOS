/**
 * Shared formatting for the settings panels.
 *
 * `formatVerificationTime` is used both by the account panel (credential
 * verification time) and the diagnostic panel (log timestamps), so it lives
 * here rather than in either panel.
 */
export const formatVerificationTime = (value: string): string =>
  new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
