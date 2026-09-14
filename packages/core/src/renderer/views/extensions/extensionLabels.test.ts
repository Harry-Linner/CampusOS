import { describe, expect, it } from "vitest";
import type { CampusPermission } from "@campusos/shared";
import {
  formatPackageSize,
  permissionLabel,
  signatureLabel,
  signatureNotice,
  statusLabel
} from "./extensionLabels";

describe("extension labels", () => {
  it("names known permissions and derives the prefix families", () => {
    expect(permissionLabel("notification")).toBe("桌面通知");
    expect(permissionLabel("data:account:academic-profile")).toBe("已验证的学业账号资料");
    expect(permissionLabel("storage:domain:calendar")).toBe("日历领域数据");
    expect(permissionLabel("storage:domain:materials")).toBe("资料领域数据");
    expect(permissionLabel("storage:domain:grades")).toBe("grades 领域数据");
    expect(permissionLabel("storage:files:reports" as CampusPermission)).toBe("reports 文件目录");
    expect(permissionLabel("storage:local")).toBe("插件隔离本地存储");
    expect(permissionLabel("auth:service:zju")).toBe("zju 业务会话");
    expect(permissionLabel("network:zju.edu.cn")).toBe("访问 zju.edu.cn");
    expect(permissionLabel("unknown:permission" as CampusPermission)).toBe("unknown:permission");
  });

  it("formats package sizes with the unit that fits", () => {
    expect(formatPackageSize(0)).toBe("0 B");
    expect(formatPackageSize(1023)).toBe("1,023 B");
    expect(formatPackageSize(1024)).toBe("1 KB");
    expect(formatPackageSize(1536)).toBe("1.5 KB");
    expect(formatPackageSize(1024 * 1024)).toBe("1 MB");
    expect(formatPackageSize(1_572_864)).toBe("1.5 MB");
  });

  it("keeps a label for every runtime status and signature state", () => {
    expect(Object.keys(statusLabel).sort()).toEqual(["active", "blocked", "disabled", "placeholder"]);
    expect(statusLabel.active).toBe("已启用");
    expect(Object.keys(signatureLabel).sort()).toEqual(["invalid", "unsigned", "verified"]);
    expect(signatureNotice.invalid).toContain("签名无效");
  });
});
