import { useState } from "react";
import type {
  CampusDownloadTask,
  CampusMaterialRecord,
  PluginComponentProps
} from "@campusos/shared";

export { manifest } from "./manifest";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const statusLabel: Record<CampusDownloadTask["status"], string> = {
  queued: "等待下载",
  syncing: "下载中",
  paused: "已暂停",
  failed: "下载失败",
  ready: "已完成"
};

const renderEmptyState = (title: string, detail: string): JSX.Element => (
  <li className="data-row">
    <div>
      <strong>{title}</strong>
      <span className="meta-line">{detail}</span>
    </div>
  </li>
);

export const Component = ({
  downloads,
  loading,
  onRefresh,
  snapshot
}: PluginComponentProps): JSX.Element => {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const runAction = async (id: string, action: () => Promise<void>): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await action();
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "下载操作失败。");
    } finally {
      setBusyId(null);
    }
  };

  const renderMaterialRow = (material: CampusMaterialRecord): JSX.Element => (
    <li key={material.id} className="data-row">
      <div>
        <strong>{material.title}</strong>
        <span className="meta-line">
          {material.courseName} · {dateTimeFormatter.format(new Date(material.updatedAt))}
        </span>
      </div>
      {material.downloadUrl && downloads ? (
        <button
          className="text-button"
          type="button"
          disabled={busyId === material.id}
          onClick={() => void runAction(material.id, () => downloads.enqueue({
            url: material.downloadUrl!,
            title: material.title,
            courseName: material.courseName,
            sourceId: material.sourceId,
            semester: material.semester
          }))}
        >
          {busyId === material.id ? "加入中…" : "下载"}
        </button>
      ) : (
        <span className="meta-line">来源未提供下载入口</span>
      )}
    </li>
  );

  const renderDownloadRow = (download: CampusDownloadTask): JSX.Element => (
    <li key={download.id} className="data-row">
      <div>
        <strong>{download.title}</strong>
        <span className="meta-line">{download.targetPath}</span>
      </div>
      <div className="row-side">
        <strong>{download.progress}% · {statusLabel[download.status]}</strong>
        {downloads && download.status !== "ready" ? (
          <span className="inline-actions">
            {download.status === "paused" ? (
              <button
                className="text-button"
                type="button"
                disabled={busyId === download.id}
                onClick={() => void runAction(download.id, () => downloads.resume(download.id))}
              >
                继续
              </button>
            ) : (
              <button
                className="text-button"
                type="button"
                disabled={busyId === download.id}
                onClick={() => void runAction(download.id, () => downloads.pause(download.id))}
              >
                暂停
              </button>
            )}
            <button
              className="text-button"
              type="button"
              disabled={busyId === download.id}
              onClick={() => void runAction(download.id, () => downloads.cancel(download.id))}
            >
              取消
            </button>
          </span>
        ) : null}
      </div>
    </li>
  );

  if (!snapshot) {
    return (
      <section className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Materials</p>
            <h1>资料归档与下载队列</h1>
          </div>
          <p className="page-copy">
            {loading ? "正在读取本地资料索引和下载任务。" : "工作台快照暂时还没有加载完成。"}
          </p>
        </header>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Materials</p>
          <h1>资料归档与下载队列</h1>
        </div>
        <p className="page-copy">资料索引来自工作台，下载队列由本地下载引擎持久化管理。</p>
      </header>

      {actionError ? <p className="error-copy" role="alert">{actionError}</p> : null}

      <div className="card-grid">
        <article className="panel-card">
          <h2>Archive summary</h2>
          <div className="badge-row">
            <span className="badge">{snapshot.materials.length} materials</span>
            <span className="badge">
              {snapshot.downloads.filter((item) => item.status !== "ready").length} active downloads
            </span>
            <span className="badge">{snapshot.summary.materialsReady} discovered</span>
          </div>
          <p className="muted">下载文件按 学期/课程/文件名 保存到本地资料目录。</p>
        </article>

        <article className="panel-card">
          <h2>Download queue</h2>
          <ul className="data-list">
            {snapshot.downloads.length > 0
              ? snapshot.downloads.map(renderDownloadRow)
              : renderEmptyState("暂无下载任务", "从带有下载入口的资料记录加入队列。")}
          </ul>
        </article>
      </div>

      <article className="panel-card">
        <h2>Recent materials</h2>
        <ul className="data-list">
          {snapshot.materials.length > 0
            ? snapshot.materials.slice(0, 8).map(renderMaterialRow)
            : renderEmptyState("暂无资料", "同步来源返回资料后会显示在这里。")}
        </ul>
      </article>
    </section>
  );
};
