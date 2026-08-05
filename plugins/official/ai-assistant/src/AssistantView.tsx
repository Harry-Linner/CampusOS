import { useMemo, useState } from "react";
import type { LocalTaskInput, PluginComponentProps } from "@campusos/shared";
import { parseAssistantMessage, type AssistantDraft } from "./assistantParser";

const shanghaiParts = (value: Date): Record<string, string> => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value])
);

const toDateTimeInput = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = shanghaiParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const fromDateTimeInput = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("请补充有效的日期和时间。");
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`).toISOString();
};

interface EditableDraft {
  title: string;
  description: string;
  type: AssistantDraft["type"];
  startAt: string;
  endAt: string;
  timeNeededMinutes: string;
  location: string;
  courseName: string;
}

const toEditable = (draft: AssistantDraft): EditableDraft => ({
  title: draft.title,
  description: draft.description,
  type: draft.type,
  startAt: toDateTimeInput(draft.startAt),
  endAt: toDateTimeInput(draft.endAt),
  timeNeededMinutes: String(draft.timeNeededMinutes),
  location: draft.location,
  courseName: draft.courseName
});

export const AssistantView = ({ snapshot, schedule }: PluginComponentProps): JSX.Element => {
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [editable, setEditable] = useState<EditableDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const courseNames = useMemo(() => [
    ...(snapshot?.courses.map((course) => course.title) ?? []),
    ...(snapshot?.deadlines.map((deadline) => deadline.courseName ?? "") ?? [])
  ].filter(Boolean), [snapshot]);

  const parse = (): void => {
    setError(null);
    setNotice(null);
    const next = parseAssistantMessage({ text: message, courseNames });
    setDraft(next);
    setEditable(toEditable(next));
  };

  const update = <K extends keyof EditableDraft>(key: K, value: EditableDraft[K]): void => {
    setEditable((current) => current ? { ...current, [key]: value } : current);
  };

  const save = async (): Promise<void> => {
    if (!schedule || !editable) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!editable.title.trim()) throw new Error("请填写任务标题。");
      const startAt = fromDateTimeInput(editable.startAt);
      const endAt = fromDateTimeInput(editable.endAt);
      if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("结束时间必须晚于开始时间。");
      const timeNeededMinutes = Number(editable.timeNeededMinutes);
      if (!Number.isFinite(timeNeededMinutes) || timeNeededMinutes <= 0) throw new Error("预计耗时必须是正数。");
      const input: LocalTaskInput = {
        title: editable.title.trim(),
        description: editable.courseName.trim()
          ? `${editable.description.trim()}\n课程：${editable.courseName.trim()}`
          : editable.description.trim(),
        timeSpentMinutes: 0,
        timeNeededMinutes,
        startAt,
        endAt,
        location: editable.location.trim(),
        breakable: true,
        type: editable.type,
        repeatType: "norepeat",
        repeatPeriod: 1,
        repeatEndsOn: endAt.slice(0, 10),
        blocksPlanning: true
      };
      await schedule.saveTask(input);
      setNotice("任务已写入日程。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务保存失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-shell assistant-page">
      <header className="page-heading assistant-heading">
        <div>
          <p className="eyebrow">Task message</p>
          <h1>AI 助手</h1>
          <p>把一段任务消息整理成可确认的日程草稿。</p>
        </div>
      </header>

      <div className="assistant-layout">
        <section className="assistant-input-panel" aria-label="消息输入">
          <label className="assistant-label" htmlFor="assistant-message">粘贴消息</label>
          <textarea
            id="assistant-message"
            className="assistant-message-input"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="例如：绩效管理作业请于 2026年8月10日晚上八点前提交，地点：管理学院"
          />
          <div className="assistant-actions">
            <button className="primary-button" type="button" disabled={!message.trim()} onClick={parse}>
              解析消息
            </button>
            <span className="meta-line">仅处理本次主动粘贴的文本</span>
          </div>
        </section>

        <section className="assistant-draft-panel" aria-label="任务草稿">
          <header className="section-heading">
            <div>
              <p className="eyebrow">Draft</p>
              <h2>任务草稿</h2>
            </div>
            {draft ? <span className={`assistant-confidence is-${draft.confidence}`}>{draft.confidence === "high" ? "高置信度" : draft.confidence === "medium" ? "中置信度" : "需补充"}</span> : null}
          </header>

          {error ? <p className="workspace-error-banner" role="alert">{error}</p> : null}
          {notice ? <p className="schedule-notice" role="status">{notice}</p> : null}
          {!editable || !draft ? (
            <div className="quiet-empty-state">解析结果会显示在这里，确认后才会写入日程。</div>
          ) : (
            <form className="assistant-draft-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <label>
                <span>标题</span>
                <input value={editable.title} onChange={(event) => update("title", event.target.value)} />
              </label>
              <div className="assistant-form-grid">
                <label>
                  <span>类型</span>
                  <select value={editable.type} onChange={(event) => update("type", event.target.value as EditableDraft["type"])}>
                    <option value="deadline">截止事项</option>
                    <option value="fixed">固定安排</option>
                  </select>
                </label>
                <label>
                  <span>预计耗时（分钟）</span>
                  <input type="number" min="1" value={editable.timeNeededMinutes} onChange={(event) => update("timeNeededMinutes", event.target.value)} />
                </label>
              </div>
              <div className="assistant-form-grid">
                <label>
                  <span>开始时间</span>
                  <input type="datetime-local" value={editable.startAt} onChange={(event) => update("startAt", event.target.value)} />
                </label>
                <label>
                  <span>结束时间</span>
                  <input type="datetime-local" value={editable.endAt} onChange={(event) => update("endAt", event.target.value)} />
                </label>
              </div>
              <div className="assistant-form-grid">
                <label>
                  <span>地点</span>
                  <input value={editable.location} onChange={(event) => update("location", event.target.value)} />
                </label>
                <label>
                  <span>课程</span>
                  <input value={editable.courseName} onChange={(event) => update("courseName", event.target.value)} />
                </label>
              </div>
              <label>
                <span>描述</span>
                <textarea value={editable.description} onChange={(event) => update("description", event.target.value)} />
              </label>

              {draft.missingFields.length > 0 ? <p className="assistant-warning">缺少：{draft.missingFields.join("、")}</p> : null}
              {draft.warnings.map((warning) => <p className="assistant-warning" key={warning}>{warning}</p>)}
              {draft.evidence.length > 0 ? <p className="assistant-evidence">识别依据：{draft.evidence.join(" · ")}</p> : null}
              <div className="assistant-actions assistant-save-actions">
                <button className="primary-button" type="submit" disabled={!schedule || !editable.startAt || !editable.endAt || busy}>
                  {busy ? "正在写入" : "确认并写入日程"}
                </button>
                {!schedule ? <span className="meta-line">日程服务暂不可用</span> : null}
              </div>
            </form>
          )}
        </section>
      </div>
    </section>
  );
};
