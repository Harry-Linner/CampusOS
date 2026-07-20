import { describe, expect, it } from "vitest";
import { sanitizeDiagnosticText } from "./diagnosticSanitizer";

describe("diagnostic log sanitizer", () => {
  it("removes credentials, account identifiers and URL query values", () => {
    const sanitized = sanitizeDiagnosticText(
      "password=secret Cookie:SESSION=abc session=xyz ticket=ST-private " +
        "token=bearer https://zju.edu.cn/callback?ticket=ST-private&uid=3240100001 " +
        "account 3240100001"
    );

    for (const privateValue of [
      "secret",
      "SESSION=abc",
      "xyz",
      "ST-private",
      "bearer",
      "3240100001",
      "?ticket="
    ]) {
      expect(sanitized).not.toContain(privateValue);
    }
    expect(sanitized).toContain("https://zju.edu.cn/callback");
    expect(sanitized).toContain("<已隐藏>");
    expect(sanitized).toContain("<账号已隐藏>");
  });
});
