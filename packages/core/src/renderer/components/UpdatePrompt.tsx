import { useEffect, useState } from "react";
import type { UpdateStatus } from "../../shared/updateBridge";
import { Button } from "../components/ui/button";

export const UpdatePrompt = (): JSX.Element | null => {
  const bridge = window.campusos?.updates;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return undefined;
    let active = true;
    void bridge.getAppInfo().then((info) => { if (active) setCurrentVersion(info.version); });
    void bridge.getStatus().then((next) => { if (active) setStatus(next); });
    const unsubscribe = bridge.subscribe((next) => { if (active) setStatus(next); });
    return () => { active = false; unsubscribe(); };
  }, [bridge]);

  const visible = status && (status.state === "available" || status.state === "ready") &&
    status.prompt === true && Boolean(status.version);
  if (!bridge || !visible || !status.version) return null;

  const run = async (operation: () => Promise<UpdateStatus | void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      if (next) setStatus(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "更新操作失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };
  const ready = status.state === "ready";

  return (
    <div className="update-prompt-backdrop" role="presentation">
      <section className="update-prompt" role="dialog" aria-modal="true" aria-labelledby="update-prompt-heading">
        <header>
          <h2 id="update-prompt-heading">{ready ? "更新已下载" : "发现新版本"} v{status.version}</h2>
          <span className="update-prompt-current">当前 v{currentVersion ?? "—"}</span>
        </header>
        <p>{ready ? "新版本已经准备好。你可以现在重启安装，也可以稍后从设置中安装。" : "更新不会删除任务、通知、窗口布局或桌面日历状态。选择“下载更新”后才会开始下载。"}</p>
        {status.releaseNotes?.length ? (
          <div className="update-prompt-notes">
            <ul>{status.releaseNotes.slice(0, showNotes ? undefined : 5).map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
            {status.releaseNotes.length > 5 ? <Button variant="ghost" type="button" onClick={() => setShowNotes((value) => !value)}>
              {showNotes ? "收起完整日志" : "查看完整日志"}
            </Button> : null}
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          <Button variant="ghost" type="button" disabled={busy} onClick={() => void run(() => bridge.dismiss(status.version!))}>稍后</Button>
          <Button type="button" disabled={busy} onClick={() => void run(() => ready ? bridge.install() : bridge.download())}>
            {busy ? "处理中" : ready ? "重启并安装" : "下载更新"}
          </Button>
        </footer>
      </section>
    </div>
  );
};
