import type { CampusAppInfo, UpdateStatus } from "../../../shared/updateBridge";
import { Button } from "../../components/ui/button";

interface SettingsUpdatePanelProps {
  appInfo: CampusAppInfo | null;
  status: UpdateStatus;
  action: { label: string; disabled: boolean };
  onRunAction: () => void | Promise<void>;
}

/** 更新：版本、发布说明与检查/安装动作（Batch 8 从 SettingsView 拆出）。 */
export const SettingsUpdatePanel = ({
  appInfo,
  status,
  action,
  onRunAction
}: SettingsUpdatePanelProps) => (
  <section className="settings-section" aria-labelledby="update-heading">
    <header className="settings-section-heading">
      <h2 id="update-heading">更新</h2>
      <span className="diagnostic-count">
        {appInfo ? `v${appInfo.version}` : "正在读取版本"}
      </span>
    </header>
    <p className="page-copy">
      {status.state === "available"
        ? `发现新版本 v${status.version ?? ""}`
        : status.state === "ready"
          ? `v${status.version ?? "新版本"} 已准备好安装`
          : status.state === "up-to-date"
            ? "当前已是最新版本"
            : "通过 GitHub Releases 检查并安装 CampusOS 更新。"}
    </p>
    {status.releaseNotes?.length ? (
      <details className="update-notes-disclosure">
        <summary>查看更新内容</summary>
        <ul className="update-notes-list">
          {status.releaseNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
        </ul>
      </details>
    ) : null}
    <div className="settings-actions">
      <Button
        type="button"
        disabled={action.disabled}
        onClick={() => void onRunAction()}
      >
        {action.label}
      </Button>
    </div>
    {status.state === "error" ? (
      <p className="error-copy" role="alert">
        {status.error ?? "更新操作失败，请稍后重试。"}
      </p>
    ) : null}
  </section>
);
