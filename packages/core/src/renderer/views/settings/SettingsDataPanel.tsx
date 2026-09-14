import { useState } from "react";
import { Button } from "../../components/ui/button";

type RefreshState = "idle" | "refreshing" | "success" | "error";

interface SettingsDataPanelProps {
  refreshState: RefreshState;
  refreshError: string;
  /** 与账号面板共用的工作区刷新链路（还会顺带刷新诊断日志）。 */
  onRefreshData: () => Promise<void>;
}

/** 数据与备份：刷新数据源、导出与恢复备份（Batch 10 从 SettingsView 拆出）。 */
export const SettingsDataPanel = ({
  refreshState,
  refreshError,
  onRefreshData
}: SettingsDataPanelProps) => {
  const [backupMessage, setBackupMessage] = useState("");

  const exportBackup = async (): Promise<void> => {
    if (!window.campusos?.backup) return;
    setBackupMessage("");
    try {
      const result = await window.campusos.backup.export();
      if (result) setBackupMessage(`备份已导出：${result.taskCount} 项本地任务。备份不含密码、Cookie、Session、Token 或 AI Key。`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "备份导出失败。");
    }
  };

  const restoreBackup = async (): Promise<void> => {
    const backup = window.campusos?.backup;
    if (!backup) return;
    setBackupMessage("");
    try {
      const preview = await backup.preview();
      if (!preview) return;
      const replace = window.confirm(`备份包含 ${preview.taskCount} 项任务。确定要替换当前本地任务吗？取消则合并。`);
      const result = await backup.restore(replace ? "replace" : "merge");
      if (result) {
        setBackupMessage(`${replace ? "替换" : "合并"}恢复完成：${result.taskCount} 项任务。`);
        await onRefreshData();
      }
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "备份恢复失败。");
    }
  };

  return (
    <>
      <section className="settings-section" aria-labelledby="data-heading">
        <header className="settings-section-heading">
          <h2 id="data-heading">数据</h2>
        </header>

        <p className="page-copy">重新同步当前数据源，并更新日历中的测试数据。</p>
        <div className="settings-actions">
          <Button
            type="button"
            disabled={refreshState === "refreshing"}
            onClick={() => void onRefreshData()}
          >
            {refreshState === "refreshing" ? "刷新中…" : "刷新数据"}
          </Button>
          {refreshState === "success" ? (
            <span className="save-note" role="status" aria-live="polite">
              刷新完成
            </span>
          ) : null}
        </div>

        {refreshState === "error" ? (
          <p className="error-copy" role="alert">
            {refreshError}
          </p>
        ) : null}
      </section>

      <section className="settings-section" aria-labelledby="backup-heading">
        <header className="settings-section-heading"><h2 id="backup-heading">备份与恢复</h2></header>
        <p className="page-copy">手动导出本地任务、排程和通知索引。备份不加密，请只保存到可信位置，不包含密码、Cookie、Session、Token 或 AI Key。</p>
        <div className="settings-actions"><Button variant="ghost" type="button" onClick={() => void exportBackup()}>导出备份</Button><Button variant="ghost" type="button" onClick={() => void restoreBackup()}>预览并恢复</Button></div>
        {backupMessage ? <p className="save-note" role="status">{backupMessage}</p> : null}
      </section>
    </>
  );
};
