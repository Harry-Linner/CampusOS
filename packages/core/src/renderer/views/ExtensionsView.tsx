import { useState } from "react";
import type {
  CampusPermission,
  PluginRuntimeConfigurationInput,
  PluginRuntimeStatus
} from "@campusos/shared";
import { getSandboxedRendererExecutionIssue } from "@campusos/shared";
import type { LoadedPlugin } from "../lib/pluginHost";
import type {
  PluginPackageInspection,
  PluginPackageRegistrySnapshot
} from "../../shared/pluginBridge";

interface ExtensionsViewProps {
  plugins: LoadedPlugin[];
  loading: boolean;
  error: string | null;
  packageRegistry: PluginPackageRegistrySnapshot;
  onConfigure: (input: PluginRuntimeConfigurationInput) => Promise<void>;
  onSelectPackage: () => Promise<PluginPackageInspection | null>;
  onDiscardPackage: (token: string) => Promise<void>;
  onInstallPackage: (token: string) => Promise<void>;
  onUninstallPackage: (pluginId: string) => Promise<void>;
}

const permissionLabel = (permission: CampusPermission): string => {
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

const formatPackageSize = (bytes: number): string => {
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

const statusLabel: Record<PluginRuntimeStatus, string> = {
  active: "已启用",
  blocked: "待处理",
  disabled: "已停用",
  placeholder: "尚未开放"
};

const signatureLabel: Record<PluginPackageInspection["signatureStatus"], string> = {
  unsigned: "未签名",
  verified: "签名已验证",
  invalid: "签名无效"
};

const signatureNotice: Record<PluginPackageInspection["signatureStatus"], string> = {
  unsigned: "此包未签名。",
  verified: "开发者签名已验证。",
  invalid: "此包的开发者签名无效。"
};

export const ExtensionsView = ({
  plugins,
  loading,
  error,
  packageRegistry,
  onConfigure,
  onSelectPackage,
  onDiscardPackage,
  onInstallPackage,
  onUninstallPackage
}: ExtensionsViewProps): JSX.Element => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<
    Record<string, CampusPermission[]>
  >({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [packageInspection, setPackageInspection] = useState<
    PluginPackageInspection | null
  >(null);
  const [uninstallConfirmId, setUninstallConfirmId] = useState<string | null>(null);
  const activeCount = plugins.filter(
    (plugin) => plugin.runtime.status === "active"
  ).length;
  const installedPackageById = new Map(
    packageRegistry.packages.map((installedPackage) => [
      installedPackage.manifest.id,
      installedPackage
    ])
  );
  const inspectionSandboxIssue = packageInspection
    ? getSandboxedRendererExecutionIssue(packageInspection.manifest)
    : null;

  const selectPackage = async (): Promise<void> => {
    setActionError(null);
    try {
      const inspection = await onSelectPackage();
      if (inspection) setPackageInspection(inspection);
    } catch (nextError) {
      setActionError(
        nextError instanceof Error ? nextError.message : "插件包检查失败。"
      );
    }
  };

  const discardPackage = async (): Promise<void> => {
    const token = packageInspection?.token;
    setPackageInspection(null);
    if (token) await onDiscardPackage(token);
  };

  const installPackage = async (): Promise<void> => {
    if (!packageInspection) return;
    setActionError(null);
    try {
      await onInstallPackage(packageInspection.token);
      setPackageInspection(null);
    } catch (nextError) {
      setActionError(
        nextError instanceof Error ? nextError.message : "插件安装失败。"
      );
    }
  };

  const uninstallPackage = async (pluginId: string): Promise<void> => {
    setActionError(null);
    try {
      await onUninstallPackage(pluginId);
      setExpandedId(null);
      setUninstallConfirmId(null);
    } catch (nextError) {
      setActionError(
        nextError instanceof Error ? nextError.message : "插件卸载失败。"
      );
    }
  };

  const openDetails = (plugin: LoadedPlugin): void => {
    setExpandedId((current) => {
      if (current === plugin.manifest.id) return null;

      setDraftPermissions((drafts) => ({
        ...drafts,
        [plugin.manifest.id]: [...plugin.runtime.grantedPermissions]
      }));
      return plugin.manifest.id;
    });
    setActionError(null);
  };

  const submitConfiguration = async (
    plugin: LoadedPlugin,
    enabled: boolean
  ): Promise<void> => {
    setPendingId(plugin.manifest.id);
    setActionError(null);

    try {
      await onConfigure({
        pluginId: plugin.manifest.id,
        enabled,
        grantedPermissions:
          draftPermissions[plugin.manifest.id] ??
          plugin.runtime.grantedPermissions
      });
    } catch (nextError) {
      setActionError(
        nextError instanceof Error ? nextError.message : "插件设置保存失败。"
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="page-shell">
      <header className="page-heading">
        <div>
          <h1>扩展</h1>
        </div>
        <div className="extension-heading-actions">
          <span className="plain-count">
            {loading ? "正在更新" : `${activeCount} 已启用 / ${plugins.length} 已安装`}
          </span>
          <button
            className="primary-button"
            type="button"
            disabled={loading || packageInspection !== null}
            onClick={() => void selectPackage()}
          >
            从文件安装
          </button>
        </div>
      </header>

      {error || actionError ? (
        <p className="error-copy extension-error" role="alert">
          {actionError ?? error}
        </p>
      ) : null}

      {packageRegistry.issues.length > 0 ? (
        <section className="extension-registry-issues" role="alert">
          <strong>部分本地插件目录已被隔离</strong>
          {packageRegistry.issues.map((issue) => (
            <p key={issue.directoryName}>
              {issue.directoryName}：{issue.message}
            </p>
          ))}
        </section>
      ) : null}

      {packageInspection ? (
        <section className="package-review" aria-label="插件安装确认">
          <header>
            <div>
              <span className="eyebrow">本地插件包</span>
              <h2>{packageInspection.manifest.displayName}</h2>
              <p>{packageInspection.manifest.description}</p>
            </div>
            <span className={`package-signature is-${packageInspection.signatureStatus}`}>
              {signatureLabel[packageInspection.signatureStatus]}
            </span>
          </header>
          <dl className="package-review-facts">
            <div>
              <dt>插件 ID</dt>
              <dd>{packageInspection.manifest.id}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{packageInspection.manifest.version}</dd>
            </div>
            <div>
              <dt>归档</dt>
              <dd>{formatPackageSize(packageInspection.archiveSize)}</dd>
            </div>
            <div>
              <dt>解压后</dt>
              <dd>{formatPackageSize(packageInspection.unpackedSize)}</dd>
            </div>
            <div>
              <dt>文件</dt>
              <dd>{packageInspection.fileCount} 个</dd>
            </div>
          </dl>
          <div className="package-review-permissions">
            <strong>声明的权限</strong>
            {packageInspection.manifest.permissions.length > 0 ? (
              packageInspection.manifest.permissions.map((permission) => (
                <span key={permission}>{permissionLabel(permission)}</span>
              ))
            ) : (
              <span>不申请权限</span>
            )}
          </div>
          <p className="package-sandbox-note">
            {inspectionSandboxIssue
              ? `${signatureNotice[packageInspection.signatureStatus]} 确认只会安装并保持停用；当前不能执行：${inspectionSandboxIssue}`
              : `${signatureNotice[packageInspection.signatureStatus]} 安装后仍保持停用；只有逐项授权后，视图才会在无 Node、无网络、拒绝系统权限的独立 origin 沙箱中运行。`}
          </p>
          <div className="package-review-actions">
            <button
              className="primary-button"
              type="button"
              disabled={loading}
              onClick={() => void installPackage()}
            >
              {loading ? "正在安装" : "确认安装"}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={loading}
              onClick={() => void discardPackage()}
            >
              取消
            </button>
          </div>
        </section>
      ) : null}

      {plugins.length === 0 ? (
        <div className="quiet-empty-state">暂无扩展</div>
      ) : (
        <div className="extension-list">
          {plugins.map((plugin) => {
            const expanded = expandedId === plugin.manifest.id;
            const pending = pendingId === plugin.manifest.id;
            const selectedPermissions =
              draftPermissions[plugin.manifest.id] ??
              plugin.runtime.grantedPermissions;
            const installedPackage = installedPackageById.get(plugin.manifest.id);
            const sandboxIssue = installedPackage
              ? getSandboxedRendererExecutionIssue(plugin.manifest)
              : null;
            const sandboxEligible = installedPackage !== undefined && sandboxIssue === null;

            return (
              <article
                key={plugin.manifest.id}
                className={expanded ? "extension-entry is-expanded" : "extension-entry"}
              >
                <div className="extension-summary">
                  <span className="extension-mark" aria-hidden="true">
                    {plugin.manifest.icon.slice(0, 1)}
                  </span>
                  <div className="extension-title">
                    <strong>{plugin.manifest.displayName}</strong>
                    <span className={`extension-status is-${plugin.runtime.status}`}>
                      {statusLabel[plugin.runtime.status]}
                    </span>
                  </div>
                  <button
                    className="text-button extension-details-button"
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => openDetails(plugin)}
                  >
                    {expanded ? "收起" : "详情"}
                  </button>
                </div>

                {expanded ? (
                  <div className="extension-details">
                    <div className="extension-details-copy">
                      <p>{plugin.manifest.description}</p>
                      <dl>
                        <div>
                          <dt>版本</dt>
                          <dd>v{plugin.manifest.version} / API {plugin.manifest.apiVersion}</dd>
                        </div>
                        <div>
                          <dt>类型</dt>
                          <dd>{plugin.manifest.kind === "connector" ? "数据连接器" : "功能插件"}</dd>
                        </div>
                        <div>
                          <dt>依赖</dt>
                          <dd>
                            {plugin.manifest.requires.length > 0
                              ? plugin.manifest.requires.join("、")
                              : "无"}
                          </dd>
                        </div>
                        <div>
                          <dt>来源</dt>
                          <dd>
                            {installedPackage
                              ? `本地 .campusmod · ${signatureLabel[installedPackage.signatureStatus]}`
                              : plugin.manifest.sourceScope.length > 0
                              ? plugin.manifest.sourceScope.join("、")
                              : "本地"}
                          </dd>
                        </div>
                      </dl>
                      {plugin.runtime.issues.length > 0 ? (
                        <ul className="extension-issues" aria-label="阻塞原因">
                          {plugin.runtime.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    <div className="extension-permissions">
                      <h2>权限</h2>
                      {plugin.manifest.permissions.length > 0 ? (
                        <div className="extension-permission-list">
                          {plugin.manifest.permissions.map((permission) => (
                            <label key={permission}>
                              <input
                                type="checkbox"
                                checked={selectedPermissions.includes(permission)}
                                disabled={
                                  pending ||
                                  plugin.runtime.status === "placeholder" ||
                                  (installedPackage !== undefined && !sandboxEligible)
                                }
                                onChange={(event) => {
                                  const checked = event.currentTarget.checked;
                                  setDraftPermissions((drafts) => {
                                    const current =
                                      drafts[plugin.manifest.id] ??
                                      plugin.runtime.grantedPermissions;
                                    const next = checked
                                      ? [...current, permission]
                                      : current.filter((item) => item !== permission);

                                    return {
                                      ...drafts,
                                      [plugin.manifest.id]: next
                                    };
                                  });
                                }}
                              />
                              <span>{permissionLabel(permission)}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="extension-no-permissions">此插件不申请权限。</p>
                      )}

                      {installedPackage ? (
                        <div className="extension-actions extension-package-actions">
                          <p>
                            {sandboxEligible
                              ? "此视图可在独立 origin 的 Chromium 沙箱中运行；Node、网络、系统权限和 CampusOS IPC 均不开放。"
                              : `此包只能安装和审查，不能执行：${sandboxIssue}`}
                          </p>
                          {sandboxEligible ? (
                            <>
                              <button
                                className="primary-button"
                                type="button"
                                disabled={pending || loading}
                                onClick={() => void submitConfiguration(plugin, true)}
                              >
                                {pending
                                  ? "正在保存"
                                  : plugin.runtime.enabled
                                    ? "保存权限"
                                    : "保存并启用沙箱视图"}
                              </button>
                              {plugin.runtime.enabled ? (
                                <button
                                  className="text-button"
                                  type="button"
                                  disabled={pending || loading}
                                  onClick={() => void submitConfiguration(plugin, false)}
                                >
                                  停用
                                </button>
                              ) : null}
                            </>
                          ) : null}
                          {uninstallConfirmId === plugin.manifest.id ? (
                            <>
                              <button
                                className="danger-button"
                                type="button"
                                disabled={pending || loading || plugin.runtime.enabled}
                                onClick={() => void uninstallPackage(plugin.manifest.id)}
                              >
                                确认卸载
                              </button>
                              <button
                                className="text-button"
                                type="button"
                                disabled={pending || loading}
                                onClick={() => setUninstallConfirmId(null)}
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <button
                              className="text-button"
                              type="button"
                              disabled={pending || loading || plugin.runtime.enabled}
                              onClick={() => setUninstallConfirmId(plugin.manifest.id)}
                            >
                              卸载
                            </button>
                          )}
                        </div>
                      ) : plugin.runtime.status !== "placeholder" ? (
                        <div className="extension-actions">
                          <button
                            className="primary-button"
                            type="button"
                            disabled={pending || loading}
                            onClick={() => void submitConfiguration(plugin, true)}
                          >
                            {pending ? "正在保存" : "保存并启用"}
                          </button>
                          {plugin.runtime.enabled ? (
                            <button
                              className="text-button"
                              type="button"
                              disabled={pending || loading}
                              onClick={() => void submitConfiguration(plugin, false)}
                            >
                              停用
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
