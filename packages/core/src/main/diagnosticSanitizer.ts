export const sanitizeDiagnosticText = (value: string): string =>
  value
    .replace(/https?:\/\/[^\s?#]+\?[^\s]*/gi, (url) => url.split("?")[0])
    .replace(
      /\b(password|passwd|pwd|cookie|session|ticket|token|authorization)\s*[:=]\s*[^\s,;|]+/gi,
      "$1=<已隐藏>"
    )
    .replace(/\b\d{8,14}\b/g, "<账号已隐藏>")
    .slice(0, 500);
