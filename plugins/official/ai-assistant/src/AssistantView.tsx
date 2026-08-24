import { useEffect, useMemo, useState } from "react";
import type {
  AiAssistantAcademicQueryResult,
  AiAssistantExtractionResult,
  AiAssistantProvider,
  AiAssistantProtocol,
  AiAssistantSettingsRecord,
  EditableIntent,
  PluginComponentProps
} from "@campusos/shared";
import {
  findUniqueTask,
  makeTaskInput,
  toDateTimeInput,
  toEditable
} from "@campusos/shared";
import { AssistantModelFields } from "./AssistantModelFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_ASSISTANT_DEFAULT_BASE_URL,
  AI_ASSISTANT_DEFAULT_MODEL,
  AI_ASSISTANT_DEFAULT_PROVIDER,
  AI_ASSISTANT_DEFAULT_PROTOCOL
} from "./prompt";

type AssistantSection = "message" | "settings";
type BusyAction = "load-settings" | "save-settings" | "clear-settings" | "test-connection" | "discover-models" | "parse" | "save-task" | null;

export const AssistantView = ({ snapshot, schedule, assistant }: PluginComponentProps): JSX.Element => {
  const [section, setSection] = useState<AssistantSection>("message");
  const [message, setMessage] = useState("");
  const [sourceSentAt, setSourceSentAt] = useState("");
  const [extraction, setExtraction] = useState<AiAssistantExtractionResult | null>(null);
  const [academicResult, setAcademicResult] = useState<AiAssistantAcademicQueryResult | null>(null);
  const [editable, setEditable] = useState<EditableIntent[]>([]);
  const [settings, setSettings] = useState<AiAssistantSettingsRecord | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<AiAssistantProvider>(AI_ASSISTANT_DEFAULT_PROVIDER);
  const [protocol, setProtocol] = useState<AiAssistantProtocol>(AI_ASSISTANT_DEFAULT_PROTOCOL);
  const [baseUrl, setBaseUrl] = useState(AI_ASSISTANT_DEFAULT_BASE_URL);
  const [model, setModel] = useState(AI_ASSISTANT_DEFAULT_MODEL);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const courseNames = useMemo(() => [...new Set([...(snapshot?.courses.map((course) => course.title) ?? []), ...(snapshot?.deadlines.map((deadline) => deadline.courseName ?? "") ?? [])].filter(Boolean))], [snapshot]);

  useEffect(() => {
    if (!assistant) return;
    let active = true;
    setBusy("load-settings");
    void assistant.loadSettings().then((record) => {
      if (!active) return;
      setSettings(record); setProvider(record.provider); setProtocol(record.protocol); setBaseUrl(record.baseUrl); setModel(record.model); setError(null);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "无法读取 AI 助手配置。"); }).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [assistant]);

  const parse = async (): Promise<void> => {
    if (!assistant) return;
    setBusy("parse"); setError(null); setNotice(null);
    try {
      const next = await assistant.parseMessage({ text: message, courseNames, now: new Date().toISOString(), source: { app: "manual", sentAt: sourceSentAt ? new Date(`${sourceSentAt}:00+08:00`).toISOString() : null } });
      if (next.intent === "academic-query") {
        setAcademicResult(next); setExtraction(null); setEditable([]);
        if (next.degraded) setNotice("数据问答模式：没有可查询的本地学业数据。");
      } else {
        setExtraction(next); setEditable(next.intents.map(toEditable)); setAcademicResult(null);
        if (next.intents.length === 0) setNotice("没有识别出可确认的日程事项。");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 解析失败。"); } finally { setBusy(null); }
  };

  const saveSettings = async (): Promise<void> => {
    if (!assistant) return;
    setBusy("save-settings"); setError(null); setNotice(null);
    try { const record = await assistant.saveSettings({ apiKey, provider, protocol, baseUrl, model }); setSettings(record); setApiKey(""); setNotice("AI 连接配置已安全保存。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "AI 连接配置保存失败。"); }
    finally { setBusy(null); }
  };

  const testConnection = async (): Promise<void> => {
    if (!assistant) return;
    setBusy("test-connection"); setError(null); setNotice(null);
    try { const result = await assistant.testConnection({ apiKey, provider, protocol, baseUrl, model }); setNotice(`结构化能力可用 · ${result.provider} / ${result.model} · ${result.latencyMs} ms`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "连接测试失败。"); }
    finally { setBusy(null); }
  };

  const discoverModels = async (): Promise<void> => {
    if (!assistant) return;
    setBusy("discover-models"); setError(null); setNotice(null);
    try { const result = await assistant.discoverModels({ apiKey, provider, protocol, baseUrl }); setDiscoveredModels(result.models); setNotice(`已发现 ${result.models.length} 个模型 · ${result.latencyMs} ms`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "模型列表获取失败；可以继续手动填写模型 ID。"); }
    finally { setBusy(null); }
  };

  const clearSettings = async (): Promise<void> => {
    if (!assistant) return;
    setBusy("clear-settings"); setError(null); setNotice(null);
    try { const record = await assistant.clearSettings(); setSettings(record); setProvider(record.provider); setProtocol(record.protocol); setBaseUrl(record.baseUrl); setModel(record.model); setApiKey(""); setExtraction(null); setEditable([]); setAcademicResult(null); setNotice("已清除 AI 连接密钥。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "连接清除失败。"); }
    finally { setBusy(null); }
  };

  const update = <K extends keyof EditableIntent>(id: string, key: K, value: EditableIntent[K]): void => setEditable((current) => current.map((item) => item.id === id ? { ...item, [key]: value, needsConfirmation: true } : item));

  const commit = async (intent: EditableIntent): Promise<void> => {
    if (!schedule || !settings) return;
    if (intent.intent === "cancel" || intent.intent === "update") {
      const tasks = await schedule.loadTasks();
      const target = findUniqueTask(tasks.tasks, intent);
      if (intent.intent === "cancel") { await schedule.mutateTask({ id: target.id, status: "deleted" }); setNotice(`已取消：${target.title}`); return; }
      await schedule.saveTask({ ...makeTaskInput(intent, settings), id: target.id });
      setNotice(`已更新：${target.title}`); return;
    }
    const result = await schedule.saveTask(makeTaskInput(intent, settings));
    setNotice(result.operation?.kind === "deduplicated" ? "这条消息已经写入过日程，已阻止重复创建。" : "事项已写入日程。");
  };

  const saveIntent = async (intent: EditableIntent): Promise<void> => {
    setBusy("save-task"); setError(null); setNotice(null);
    try { await commit(intent); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "日程写入失败。"); }
    finally { setBusy(null); }
  };

  return (
    <section className="page-shell assistant-page">
      <header className="page-heading assistant-heading">
        <div><h1>AI 助手</h1><p>把群聊消息整理成可确认的日程事项。</p></div>
        <nav className="module-tabs" aria-label="AI 助手视图">
          <button type="button" className={section === "message" ? "is-active" : undefined} aria-pressed={section === "message"} onClick={() => setSection("message")}>消息</button>
          <button type="button" className={section === "settings" ? "is-active" : undefined} aria-pressed={section === "settings"} onClick={() => setSection("settings")}>设置</button>
        </nav>
      </header>
      {error ? <p className="workspace-error-banner" role="alert">{error}</p> : null}
      {notice ? <p className="schedule-notice" role="status">{notice}</p> : null}
      {section === "settings" ? (
        <div className="space-y-6">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">AI 助手独立使用这里的服务商与模型，把粘贴的群聊消息整理成可确认的日程事项；不读取早报或校园资讯的 AI 配置。</p>
          <section aria-labelledby="assistant-model-heading" className="space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="assistant-model-heading" className="text-base font-semibold leading-7">模型连接</h2>
              <span className="text-xs text-muted-foreground">{busy === "load-settings" ? "读取中" : settings?.configured ? "已配置" : "未配置"}</span>
            </div>
            <div className="settings-fields"><AssistantModelFields apiKey={apiKey} configured={settings?.configured === true} provider={provider} protocol={protocol} baseUrl={baseUrl} model={model} discoveredModels={discoveredModels} onApiKeyChange={setApiKey} onProviderChange={(value) => { setProvider(value); setDiscoveredModels([]); }} onProtocolChange={(value) => { setProtocol(value); setDiscoveredModels([]); }} onBaseUrlChange={(value) => { setBaseUrl(value); setDiscoveredModels([]); }} onModelChange={setModel} /></div>
            <p className="text-xs leading-5 text-muted-foreground">输入和粘贴不会自动上传；只有解析或连接测试会把请求发送到上面选定的服务商。API Key 由系统安全存储加密。</p>
            <div className="settings-actions">
              <Button variant="outline" type="button" disabled={!assistant || (!apiKey.trim() && !settings?.configured) || !model.trim() || !baseUrl.trim() || busy !== null} onClick={() => void testConnection()}>{busy === "test-connection" ? "正在测试" : "测试结构化能力"}</Button>
              <Button variant="outline" type="button" disabled={!assistant || (!apiKey.trim() && !settings?.configured) || !baseUrl.trim() || busy !== null} onClick={() => void discoverModels()}>{busy === "discover-models" ? "正在获取模型" : "获取模型列表"}</Button>
              {settings?.configured ? <Button variant="ghost" className="text-destructive" type="button" disabled={busy !== null} onClick={() => void clearSettings()}>{busy === "clear-settings" ? "正在清除" : "清除 API Key"}</Button> : null}
            </div>
          </section>
          <div className="flex justify-end"><Button type="button" disabled={!assistant || !model.trim() || !baseUrl.trim() || busy !== null} onClick={() => void saveSettings()}>{busy === "save-settings" ? "正在保存" : "保存设置"}</Button></div>
        </div>
      ) : (
        <div className="assistant-layout">
          <section className="assistant-input-panel" aria-label="消息输入">
            <Label htmlFor="assistant-message">粘贴消息</Label>
            <Textarea id="assistant-message" className="min-h-[220px]" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="粘贴需要安排到日程的群聊消息" />
            <div className="assistant-time-context">
              <div className="assistant-time-copy">
                <Label htmlFor="assistant-sent-at">消息发送时间</Label>
                <p>消息里有“明天、下周五”时填写；没有相对日期可以留空。</p>
              </div>
              <div className="assistant-time-control">
                <Input id="assistant-sent-at" type="datetime-local" value={sourceSentAt} onChange={(event) => setSourceSentAt(event.target.value)} />
                <Button variant="ghost" type="button" onClick={() => setSourceSentAt(toDateTimeInput(new Date().toISOString()))}>使用当前时间</Button>
                {sourceSentAt ? <Button variant="ghost" type="button" onClick={() => setSourceSentAt("")}>清除</Button> : null}
              </div>
            </div>
            <div className="assistant-actions"><Button type="button" disabled={!assistant || !settings?.configured || !message.trim() || busy !== null} onClick={() => void parse()}>{busy === "parse" ? "AI 正在解析" : "交给 AI 解析"}</Button>{!settings?.configured ? <Button variant="ghost" type="button" onClick={() => setSection("settings")}>先配置 AI 连接</Button> : null}</div>
          </section>
          <section className="assistant-draft-panel" aria-label="提取结果">
            <header className="section-heading"><div><h2>{academicResult ? "数据问答" : "待确认事项"}</h2></div>{academicResult ? <span className="assistant-mode-badge">数据问答 · 只读本地数据</span> : extraction ? <span className="assistant-confidence">{extraction.intents.length} 个候选 · Schema {extraction.schemaVersion}</span> : null}</header>
            {academicResult ? (
              <div className="assistant-academic-result">
                {academicResult.degraded ? <p className="assistant-academic-degraded" role="status">{academicResult.answer}</p> : <>
                  <p className="assistant-academic-answer">{academicResult.answer}</p>
                  {academicResult.evidence.length ? <div className="assistant-evidence-block"><strong className="assistant-evidence-title">证据引用</strong><ul className="assistant-evidence-sources">{academicResult.evidence.map((item) => <li key={item.capability}><span className="assistant-evidence-source">{item.label}<time dateTime={item.capturedAt}> · {new Date(item.capturedAt).toLocaleString("zh-CN", { hour12: false })}</time></span>{item.values?.length ? <span className="assistant-evidence-list">{item.values.map((value) => <mark key={value}>{value}</mark>)}</span> : null}</li>)}</ul></div> : null}
                </>}
                <p className="assistant-quiet-copy">数据问答只读取本地课表、成绩、考试与日程；可以继续追问，也可以问普通日程问题切回通用模式。</p>
              </div>
            ) : extraction?.unresolvedQuestions.length ? <div className="assistant-warning-block"><strong>需要补充</strong>{extraction.unresolvedQuestions.map((question) => <p key={question}>{question}</p>)}</div> : null}
            {!extraction && !academicResult ? <div className="quiet-empty-state">AI 返回的多个候选事项会显示在这里，确认后才会写入日程。</div> : extraction && editable.length === 0 ? <div className="quiet-empty-state">没有识别出可确认的日程事项。</div> : extraction ? <div className="assistant-candidate-list">{editable.map((item) => {
              const original = extraction.intents.find((candidate) => candidate.id === item.id);
              const evidence = original ? [original.title, original.description, original.deadlineAt, original.startAt, original.endAt, original.durationMinutes, original.location, original.courseName].flatMap((field) => field.evidence ? [field.evidence.text] : []) : [];
              return <article className="assistant-candidate" key={item.id}>
                <header className="assistant-candidate-heading"><div><span className="assistant-candidate-kind">{item.intent === "create" ? "新建" : item.intent === "update" ? "更新" : "取消"} · {item.kind}</span><h3>{item.title || "未命名事项"}</h3></div><span className={`assistant-confidence ${item.needsConfirmation ? "is-low" : "is-high"}`}>{item.needsConfirmation ? "需要确认" : "可确认"}</span></header>
                <form className="assistant-draft-form" onSubmit={(event) => { event.preventDefault(); void saveIntent(item); }}>
                  <label><span>标题</span><input value={item.title} onChange={(event) => update(item.id, "title", event.target.value)} /></label>
                  <div className="assistant-form-grid"><label><span>类型</span><select value={item.kind} onChange={(event) => update(item.id, "kind", event.target.value as EditableIntent["kind"])}><option value="deadline">截止事项</option><option value="event">固定安排</option><option value="task">任务</option><option value="reminder">提醒</option></select></label><label><span>预计耗时（分钟）</span><input type="number" min="1" value={item.durationMinutes} placeholder="未提供" onChange={(event) => update(item.id, "durationMinutes", event.target.value)} /></label></div>
                  <div className="assistant-form-grid"><label><span>截止时间</span><input type="datetime-local" value={item.deadlineAt} onChange={(event) => update(item.id, "deadlineAt", event.target.value)} /></label><label><span>开始时间</span><input type="datetime-local" value={item.startAt} onChange={(event) => update(item.id, "startAt", event.target.value)} /></label></div>
                  <div className="assistant-form-grid"><label><span>结束时间</span><input type="datetime-local" value={item.endAt} onChange={(event) => update(item.id, "endAt", event.target.value)} /></label><label><span>地点</span><input value={item.location} onChange={(event) => update(item.id, "location", event.target.value)} /></label></div>
                  <div className="assistant-form-grid"><label><span>课程</span><input value={item.courseName} list="assistant-course-candidates" onChange={(event) => update(item.id, "courseName", event.target.value)} /></label><label><span>描述</span><input value={item.description} onChange={(event) => update(item.id, "description", event.target.value)} /></label></div>
                  {evidence.length ? <p className="assistant-evidence"><span>原文证据：</span><span className="assistant-evidence-list">{[...new Set(evidence)].map((text) => <mark key={text}>{text}</mark>)}</span></p> : null}
                  {original?.warnings.map((warning) => <p className="assistant-warning" key={warning}>{warning}</p>)}
                  <div className="assistant-actions assistant-save-actions"><Button type="submit" disabled={!schedule || busy !== null}>{busy === "save-task" ? "正在写入" : item.intent === "create" ? "确认并写入" : item.intent === "update" ? "确认更新" : "确认取消"}</Button></div>
                </form>
              </article>;
            })}</div> : null}
            <datalist id="assistant-course-candidates">{courseNames.map((courseName) => <option value={courseName} key={courseName} />)}</datalist>
          </section>
        </div>
      )}
    </section>
  );
};
