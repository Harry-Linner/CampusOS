import { describe, expect, it } from "vitest";
import {
  clearAcademicCredentialRecord,
  connectAcademicCredentialRecord,
  loadAcademicCredentialRecord
} from "./credentialBridge";

describe("credentialBridge without Electron", () => {
  it("fails closed instead of fabricating credential state", async () => {
    await expect(loadAcademicCredentialRecord()).rejects.toThrow("主进程连接不可用");

    await expect(
      connectAcademicCredentialRecord({
        username: "3240100001",
        password: "secret password",
        program: "undergraduate"
      })
    ).rejects.toThrow("主进程连接不可用");
    await expect(clearAcademicCredentialRecord()).rejects.toThrow("主进程连接不可用");
  });
});
