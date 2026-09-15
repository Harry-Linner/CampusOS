import type { CampusPermission, PluginRuntimeStatus } from "@campusos/shared";
import type { PluginPackageInspection } from "../../../shared/pluginBridge";

/**
 * Extension view labels.
 *
 * These four mappings and the size formatter were inlined in the 607-line
 * ExtensionsView.tsx, where only the view's end-to-end and component tests could
 * reach them. They are pure, so this module's interface is the test surface.
 */
export const permissionLabel = (permission: CampusPermission): string => {
  if (permission === "notification") return "桌面通知";
  if (permission === "data:account:academic-profile") {
    return "已验证的学业账号资料";
  }
  if (permission === "storage:domain:calendar") return "日历领域数据";
  if (permission === "storage:domain:materials") return "资料领域数据";
  if (permission.startsWith("storage:domain:")) {
    return `${permission.slice("storage:domain:".length)} 领域数据`;
  }
  if (permission.startsWith("storage:files:")) {
    return `${permission.slice("storage:files:".length)} 文件目录`;
  }
  if (permission === "storage:local") return "插件隔离本地存储";
  if (permission.startsWith("auth:service:")) {
    return `${permission.slice("auth:service:".length)} 业务会话`;
  }
  if (permission.startsWith("network:")) {
    return `访问 ${permission.slice("network:".length)}`;
  }
  return permission;
};

export const formatPackageSize = (bytes: number): string => {
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1
  }).format(value)} ${units[unitIndex]}`;
};

export const statusLabel: Record<PluginRuntimeStatus, string> = {
  active: "已启用",
  blocked: "待处理",
  disabled: "已停用",
  placeholder: "尚未开放"
};

export const signatureLabel: Record<PluginPackageInspection["signatureStatus"], string> = {
  unsigned: "未签名",
  verified: "签名已验证",
  invalid: "签名无效"
};

export const signatureNotice: Record<PluginPackageInspection["signatureStatus"], string> = {
  unsigned: "此包未签名。",
  verified: "开发者签名已验证。",
  invalid: "此包的开发者签名无效。"
};
