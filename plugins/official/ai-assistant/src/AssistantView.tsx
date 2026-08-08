import { useEffect, useMemo, useState } from "react";
import type {
  AiAssistantDraft,
  AiAssistantSettingsRecord,
  LocalTaskInput,
  PluginComponentProps
} from "@campusos/shared";
import { AI_ASSISTANT_DEFAULT_MODEL } from "./prompt";
import { AssistantModelFields } from "./AssistantModelFields";

type AssistantSection = "message" | "settings";
type BusyAction = "load-settings" | "save-settings" | "clear-settings" | "test-connection" | "parse" | "save-task" | null;

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
  if (value.length !== 16 || value[4] !== "-" || value[7] !== "-" || value[10] !== "T" || value[13] !== ":") {
    throw new Error("请补充有效的日期和时间。");
  }
  const parsed = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("请补充有效的日期和时间。");
  return parsed.toISOString();
};

interface EditableDraft {
  title: string;
  description: string;
  type: AiAssistantDraft["type"];
  startAt: string;
  endAt: string;
  timeNeededMinutes: string;
  location: string;
  courseName: string;
}

const toEditable = (draft: AiAssistantDraft): EditableDraft => ({
  title: draft.title,
  description: draft.description,
  type: draft.type,
  startAt: toDateTimeInput(draft.startAt),
  endAt: toDateTimeInput(draft.endAt),
  timeNeededMinutes: String(draft.timeNeededMinutes),
  location: draft.location,
  courseName: draft.courseName
});

export const AssistantView = ({ snapshot, schedule, assistant }: PluginComponentProps): JSX.Element => {
  const [section, setSection] = useState<AssistantSection>("message");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<AiAssistantDraft | null>(null);
  const [editable, setEditable] = useState<EditableDraft | null>(null);
  const [settings, setSettings] = useState<AiAssistantSettingsRecord | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(AI_ASSISTANT_DEFAULT_MODEL);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const courseNames = useMemo(() => [
    ...(snapshot?.courses.map((course) => course.title) ?? []),
    ...(snapshot?.deadlines.map((deadline) => deadline.courseName ?? "") ?? [])
  ].filter(Boolean), [snapshot]);

  useEffect(() => {
    if (!assistant) return;
    let active = true;
    setBusy("load-settings");
    void assistant.loadSettings()
      .then((record) => {
        if (!active) return;
        setSettings(record);
        setModel(record.model);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取 AI 助手配置。");
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [assistant]);

  const parse = async (): Promise<void> => {
    if (!assistant) return;
    setBusy("parse");
    setError(null);
    setNotice(null);
    try {
      const next = await assistant.parseMessage({
        text: message,
        courseNames,
        now: new Date().toISOString()
      });
      setDraft(next);
      setEditable(toEditable(next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 解析失败。");
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async (): Promise<void> => {
    if (!assistant) return;
    setBusy("save-settings");
    setError(null);
    setNotice(null);
    try {
      const record = await assistant.saveSettings({ apiKey, model });
      setSettings(record);
      setApiKey("");
      setNotice("AI 助手配置已安全保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 助手配置保存失败。");
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async (): Promise<void> => {
    if (!assistant) return;
    setBusy("test-connection");
    setError(null);
    setNotice(null);
    try {
      const result = await assistant.testConnection({ apiKey, model });
      setNotice(`连接成功 · ${result.model} · ${result.latencyMs} ms`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接测试失败。");
    } finally {
      setBusy(null);
    }
  };

  const clearSettings = async (): Promise<void> => {
    if (!assistant) return;
    setBusy("clear-settings");
    setError(null);
    setNotice(null);
    try {
      const record = await assistant.clearSettings();
      setSettings(record);
      setModel(record.model);
      setApiKey("");
      setDraft(null);
      setEditable(null);
      setNotice("已清除 API Key。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "API Key 清除失败。");
    } finally {
      setBusy(null);
    }
  };

  const update = <K extends keyof EditableDraft>(key: K, value: EditableDraft[K]): void => {
    setEditable((current) => current ? { ...current, [key]: value } : current);
  };

  const saveTask = async (): Promise<void> => {
    if (!schedule || !editable) return;
    setBusy("save-task");
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
      setBusy(null);
    }
  };

  return (
    <section className="page-shell assistant-page">
      <header className="page-heading assistant-heading">
        <div>
          <p className="eyebrow">Task message</p>
          <h1>AI 助手</h1>
          <p>把群聊消息整理成可确认的日程草稿。</p>
        </div>
        <nav className="module-tabs" aria-label="AI 助手视图">
          <button type="button" className={section === "message" ? "is-active" : undefined} aria-pressed={section === "message"} onClick={() => setSection("message")}>消息</button>
          <button type="button" className={section === "settings" ? "is-active" : undefined} aria-pressed={section === "settings"} onClick={() => setSection("settings")}>配置</button>
        </nav>
      </header>

      {error ? <p className="workspace-error-banner" role="alert">{error}</p> : null}
      {notice ? <p className="schedule-notice" role="status">{notice}</p> : null}

      {section === "settings" ? (
        <section className="assistant-settings" aria-label="AI 助手配置">
          <header className="section-heading">
            <div>
              <p className="eyebrow">OpenAI</p>
              <h2>模型配置</h2>
            </div>
            <span className={`assistant-config-state ${settings?.configured ? "is-configured" : ""}`}>
              {busy === "load-settings" ? "读取中" : settings?.configured ? "已配置" : "未配置"}
            </span>
          </header>
          <form className="assistant-settings-form" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
            <AssistantModelFields
              apiKey={apiKey}
              configured={settings?.configured === true}
              model={model}
              onApiKeyChange={setApiKey}
              onModelChange={setModel}
            />
            <p className="assistant-privacy-copy">API Key 使用系统安全存储加密。只有点击“交给 AI 解析”时，当前消息和课程候选会发送给 OpenAI。</p>
            <div className="assistant-actions">
              <button className="primary-button" type="submit" disabled={!assistant || !model.trim() || busy !== null}>
                {busy === "save-settings" ? "正在保存" : "保存配置"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!assistant || (!apiKey.trim() && !settings?.configured) || !model.trim() || busy !== null}
                onClick={() => void testConnection()}
              >
                {busy === "test-connection" ? "正在测试" : "测试连接"}
              </button>
              {settings?.configured ? (
                <button className="text-button is-danger" type="button" disabled={busy !== null} onClick={() => void clearSettings()}>
                  {busy === "clear-settings" ? "正在清除" : "清除 API Key"}
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : (
        <div className="assistant-layout">
          <section className="assistant-input-panel" aria-label="消息输入">
            <label className="assistant-label" htmlFor="assistant-message">粘贴消息</label>
            <textarea
              id="assistant-message"
              className="assistant-message-input"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="粘贴需要安排到日程的群聊消息"
            />
            <div className="assistant-actions">
              <button className="primary-button" type="button" disabled={!assistant || !settings?.configured || !message.trim() || busy !== null} onClick={() => void parse()}>
                {busy === "parse" ? "AI 正在解析" : "交给 AI 解析"}
              </button>
              {!settings?.configured ? <button className="text-button" type="button" onClick={() => setSection("settings")}>先配置 API Key</button> : null}
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

            {!editable || !draft ? (
              <div className="quiet-empty-state">AI 返回的草稿会显示在这里，确认后才会写入日程。</div>
            ) : (
              <form className="assistant-draft-form" onSubmit={(event) => { event.preventDefault(); void saveTask(); }}>
                <label><span>标题</span><input value={editable.title} onChange={(event) => update("title", event.target.value)} /></label>
                <div className="assistant-form-grid">
                  <label><span>类型</span><select value={editable.type} onChange={(event) => update("type", event.target.value as EditableDraft["type"])}><option value="deadline">截止事项</option><option value="fixed">固定安排</option></select></label>
                  <label><span>预计耗时（分钟）</span><input type="number" min="1" value={editable.timeNeededMinutes} onChange={(event) => update("timeNeededMinutes", event.target.value)} /></label>
                </div>
                <div className="assistant-form-grid">
                  <label><span>开始时间</span><input type="datetime-local" value={editable.startAt} onChange={(event) => update("startAt", event.target.value)} /></label>
                  <label><span>结束时间</span><input type="datetime-local" value={editable.endAt} onChange={(event) => update("endAt", event.target.value)} /></label>
                </div>
                <div className="assistant-form-grid">
                  <label><span>地点</span><input value={editable.location} onChange={(event) => update("location", event.target.value)} /></label>
                  <label><span>课程</span><input value={editable.courseName} onChange={(event) => update("courseName", event.target.value)} /></label>
                </div>
                <label><span>描述</span><textarea value={editable.description} onChange={(event) => update("description", event.target.value)} /></label>
                {draft.missingFields.length > 0 ? <p className="assistant-warning">缺少：{draft.missingFields.join("、")}</p> : null}
                {draft.warnings.map((warning) => <p className="assistant-warning" key={warning}>{warning}</p>)}
                {draft.evidence.length > 0 ? <p className="assistant-evidence">识别依据：{draft.evidence.join(" · ")}</p> : null}
                <div className="assistant-actions assistant-save-actions">
                  <button className="primary-button" type="submit" disabled={!schedule || !editable.startAt || !editable.endAt || busy !== null}>
                    {busy === "save-task" ? "正在写入" : "确认并写入日程"}
                  </button>
                  {!editable.startAt || !editable.endAt ? <span className="meta-line">请补全具体时间后再保存</span> : null}
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </section>
  );
};
