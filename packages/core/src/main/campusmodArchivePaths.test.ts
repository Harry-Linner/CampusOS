import { describe, expect, it } from "vitest";
import {
  backupDirectoryPattern,
  normalizeArchivePath,
  sha256,
  stagingDirectoryPattern,
  trashDirectoryPattern
} from "./campusmodArchivePaths";

describe("campusmod archive paths", () => {
  it("accepts plain and nested entry names, keeping directory markers", () => {
    expect(normalizeArchivePath("manifest.json")).toBe("manifest.json");
    expect(normalizeArchivePath("dist/renderer.js")).toBe("dist/renderer.js");
    expect(normalizeArchivePath("icons/")).toBe("icons/");
    expect(normalizeArchivePath("资料/说明.md")).toBe("资料/说明.md");
  });

  it("rejects traversal, absolute, drive-letter and backslash paths", () => {
    for (const unsafe of ["../secret", "a/../../b", "/etc/passwd", "C:/Windows", "a\\b", "..", "./a"]) {
      expect(() => normalizeArchivePath(unsafe)).toThrow(/不安全路径/);
    }
  });

  it("rejects empty, over-long, non-NFC and control-character names", () => {
    expect(() => normalizeArchivePath("")).toThrow(/不安全路径/);
    expect(() => normalizeArchivePath("a".repeat(241))).toThrow(/不安全路径/);
    expect(() => normalizeArchivePath("e\u0301.txt")).toThrow(/不安全路径/); // NFD, not NFC
    expect(() => normalizeArchivePath("bad\u0007name")).toThrow(/不安全路径/);
    expect(() => normalizeArchivePath("we?ird*name")).toThrow(/不安全路径/);
  });

  it("rejects Windows reserved names and segments ending in dot or space", () => {
    for (const unsafe of ["con", "NUL.txt", "dir/aux.js", "a./b", "a /b", "dir/lpt1"]) {
      expect(() => normalizeArchivePath(unsafe)).toThrow(/不安全路径/);
    }
  });

  it("hashes bytes and recognises only this registry's own working directories", () => {
    expect(sha256(new Uint8Array([1, 2, 3]))).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(stagingDirectoryPattern.test(`.staging-${id}`)).toBe(true);
    expect(trashDirectoryPattern.test(`.trash-${id}`)).toBe(true);
    expect(backupDirectoryPattern.test(`.backup-official.academic-${id}`)).toBe(true);
    expect(stagingDirectoryPattern.test(`.staging-${id}-extra`)).toBe(false);
    expect(backupDirectoryPattern.test(`.backup-${id}`)).toBe(false);
    expect(backupDirectoryPattern.test(`.backup-academic-${id}`)).toBe(false);
  });
});
