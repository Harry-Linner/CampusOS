import { StrictMode, useEffect, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopPetAppearance, DesktopPetBridge, DesktopPetForm, DesktopPetInput, DesktopPetJobSummary, DesktopPetState } from "../../../shared/src/desktopPet";
import "./styles/desktop-pet.css";

declare global { interface Window { desktopPet?: DesktopPetBridge } }

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
};
const supportedImage = (type: string): type is "image/png" | "image/jpeg" | "image/webp" => ["image/png", "image/jpeg", "image/webp"].includes(type);
export const inputFromDrop = async (event: Pick<DataTransfer, "files" | "getData">): Promise<DesktopPetInput> => {
  const file = [...event.files].find((candidate) => supportedImage(candidate.type) || candidate.type === "text/plain" || candidate.type === "text/markdown" || /\.(?:txt|md)$/i.test(candidate.name));
  if (file) {
    if (supportedImage(file.type)) {
      if (file.size > 8 * 1024 * 1024) throw new Error("图片最多支持 8 MB。");
      return { kind: "image", mime: file.type, base64: toBase64(new Uint8Array(await file.arrayBuffer())) };
    }
    if (file.size > 50 * 1024) throw new Error("文本文件最多支持 50 KB。");
    return { kind: "text", text: await file.text() };
  }
  const text = event.getData("text/plain").trim();
  if (text) return { kind: "text", text };
  throw new Error("没有读到可解析内容，请复制消息文字或截图后点“读取剪贴板”。");
};

const stateText = (job: DesktopPetJobSummary): string => ({ queued: "排队中", processing: "解析中", ready: "已整理", error: "失败", cancelled: "已取消" })[job.status];
const formAssets: Record<DesktopPetForm, string> = {
  idle: new URL("./assets/desktop-pet.png", import.meta.url).href,
  left: new URL("./assets/desktop-pet-left.png", import.meta.url).href,
  right: new URL("./assets/desktop-pet-right.png", import.meta.url).href,
  back: new URL("./assets/desktop-pet-back.png", import.meta.url).href,
  smile: new URL("./assets/desktop-pet-smile.png", import.meta.url).href,
  wave: new URL("./assets/desktop-pet-wave.png", import.meta.url).href,
  think: new URL("./assets/desktop-pet-think.png", import.meta.url).href,
  celebrate: new URL("./assets/desktop-pet-celebrate.png", import.meta.url).href,
  puzzled: new URL("./assets/desktop-pet-puzzled.png", import.meta.url).href
};
const appearanceLabels: Record<DesktopPetAppearance, string> = { auto: "自动", idle: "正面", left: "左侧", back: "背面", right: "右侧", smile: "微笑", wave: "挥手", think: "思考", celebrate: "开心", puzzled: "疑惑" };
const idleForms: readonly DesktopPetForm[] = ["idle", "smile", "left", "back", "right"];

export function DesktopPet({ surface = new URLSearchParams(window.location.search).get("panel") === "1" ? "panel" : "pet" }: { surface?: "pet" | "panel" } = {}): JSX.Element {
  const isPanel = surface === "panel";
  const bridge = window.desktopPet;
  const [state, setState] = useState<DesktopPetState | null>(null);
  const [error, setError] = useState(bridge ? "" : "桌宠桥未就绪，请重新启动 CampusOS。");
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [missingForms, setMissingForms] = useState<ReadonlySet<DesktopPetForm>>(() => new Set());
  const [idleIndex, setIdleIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeReminder, setActiveReminder] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.getState().then((next) => { if (active) setState(next); }).catch((reason) => setError(reason instanceof Error ? reason.message : "桌宠状态读取失败。"));
    const unsubscribe = bridge.subscribe((next) => setState(next));
    const unsubReminder = bridge.onReminder?.((reminder) => {
      setActiveReminder({ title: reminder.title, body: reminder.body });
    });
    return () => {
      active = false;
      unsubscribe();
      unsubReminder?.();
    };
  }, [bridge]);

  useEffect(() => {
    if (!activeReminder) return;
    const timer = window.setTimeout(() => setActiveReminder(null), 10000);
    return () => window.clearTimeout(timer);
  }, [activeReminder]);
  const jobs = state?.jobs ?? [];
  const latest = jobs.find((job) => job.id === selectedJobId) ?? jobs[0];
  const preference = state?.settings.appearance ?? "auto";
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateMotion = (): void => setReducedMotion(media?.matches ?? false);
    const updateVisibility = (): void => setVisible(!document.hidden);
    media?.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => { media?.removeEventListener("change", updateMotion); document.removeEventListener("visibilitychange", updateVisibility); };
  }, []);
  useEffect(() => {
    if (preference !== "auto" || latest || dragging || error || reducedMotion || !visible) return;
    const timer = window.setInterval(() => setIdleIndex((index) => (index + 1) % idleForms.length), 12000);
    return () => window.clearInterval(timer);
  }, [preference, latest, dragging, error, reducedMotion, visible]);
  const automaticForm: DesktopPetForm = dragging ? "wave" : error ? "puzzled" : activeReminder ? "wave" : latest
    ? ({ queued: "think", processing: "think", ready: "celebrate", error: "puzzled", cancelled: "puzzled" } as const)[latest.status]
    : reducedMotion ? "idle" : idleForms[idleIndex];
  const requestedForm = preference === "auto" ? automaticForm : preference;
  const displayedForm = missingForms.has(requestedForm) ? "idle" : requestedForm;
  const markMissing = (form: DesktopPetForm): void => setMissingForms((previous) => new Set([...previous, form]));
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setError("");
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败，请重试。"); }
  };
  const drop = (event: DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    if (!bridge) return;
    void run(async () => { await bridge.submit(await inputFromDrop(event.dataTransfer)); await bridge.openPanel(); });
  };
  const startMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!bridge || event.button !== 0) return;
    lastPointer.current = { x: event.screenX, y: event.screenY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>): void => {
    const previous = lastPointer.current;
    if (!bridge || !previous) return;
    const delta = { x: event.screenX - previous.x, y: event.screenY - previous.y };
    if (!delta.x && !delta.y) return;
    lastPointer.current = { x: event.screenX, y: event.screenY };
    void bridge.move(delta).catch(() => undefined);
  };
  const finishMove = (): void => { lastPointer.current = null; };

  return <main className={`${isPanel ? "pet-panel" : "pet-shell"}${dragging ? " is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { const related = event.relatedTarget; if (!(related instanceof Node) || !event.currentTarget.contains(related)) setDragging(false); }} onDrop={drop}>
    {isPanel && !settingsOpen ? <section className="pet-bubble" aria-live="polite">
      <header>
        <strong>{activeReminder ? activeReminder.title : latest ? stateText(latest) : "把消息喂给我吧"}</strong>
        <div className="pet-actions"><button type="button" aria-label="桌宠设置" onClick={() => bridge && void run(async () => { await bridge.setPanelView("settings"); setSettingsOpen(true); })}>⚙</button><button type="button" aria-label="关闭桌宠面板" onClick={() => bridge && void run(() => bridge.closePanel())}>×</button></div>
      </header>
      {jobs.length > 1 ? <select className="pet-job-picker" aria-label="待处理消息" value={latest?.id} onChange={(event) => setSelectedJobId(event.target.value)}>
        {jobs.map((job, index) => <option key={job.id} value={job.id}>{index + 1}. {job.label} · {stateText(job)}</option>)}
      </select> : null}
      <p>{activeReminder ? activeReminder.body : error || latest?.message || "拖入文字、TXT/Markdown 或图片，也可以显式读取一次剪贴板。"}</p>
      {latest ? <div className="pet-job-actions">
        {latest.status === "processing" || latest.status === "queued" ? <button type="button" onClick={() => bridge && void run(() => bridge.cancel(latest.id))}>取消</button> : null}
        {latest.status === "error" || latest.status === "cancelled" ? <button type="button" onClick={() => bridge && void run(() => bridge.retry(latest.id))}>重试</button> : null}
        {latest.status === "ready" ? <button className="is-primary" type="button" onClick={() => bridge && void run(() => bridge.openReview(latest.id))}>核对结果</button> : null}
        {latest.status !== "processing" && latest.status !== "queued" ? <button type="button" onClick={() => bridge && void run(() => bridge.dismiss(latest.id))}>清除</button> : null}
      </div> : <button className="pet-clipboard" type="button" onClick={() => bridge && void run(() => bridge.parseClipboard())}>读取剪贴板</button>}
    </section> : null}
      {isPanel && settingsOpen && state ? <section className="pet-settings" aria-label="桌宠外观与设置">
        <header><strong>形态与设置</strong><div className="pet-actions"><button type="button" aria-label="收起桌宠设置" onClick={() => bridge && void run(async () => { await bridge.setPanelView("message"); setSettingsOpen(false); })}>←</button><button type="button" aria-label="关闭桌宠面板" onClick={() => bridge && void run(() => bridge.closePanel())}>×</button></div></header>
        <div className="pet-settings-body">
        <div className="pet-form-gallery" role="group" aria-label="选择桌宠形态">
          {(Object.keys(appearanceLabels) as DesktopPetAppearance[]).map((appearance) => <button key={appearance} type="button" aria-label={`形态：${appearanceLabels[appearance]}`} aria-pressed={preference === appearance} disabled={appearance !== "auto" && missingForms.has(appearance)} title={appearance !== "auto" && missingForms.has(appearance) ? "素材未能加载，暂时使用正面形态" : appearanceLabels[appearance]} onClick={() => bridge && void run(async () => { setState(await bridge.saveSettings({ appearance })); })}>
            {appearance === "auto" ? <span className="pet-auto-icon" aria-hidden="true">↻</span> : missingForms.has(appearance) ? <span className="pet-auto-icon" aria-hidden="true">🐳</span> : <img src={formAssets[appearance]} alt="" draggable={false} onError={() => markMissing(appearance)} />}
            <span>{appearanceLabels[appearance]}{appearance !== "auto" && missingForms.has(appearance) ? " · 不可用" : ""}</span>
          </button>)}
        </div>
        <small>自动：闲时换姿态，收到消息后随解析进度变化。选择其他形态可固定外观。</small>
        <label>大小 <input aria-label="桌宠大小" type="range" min="0.65" max="1.5" step="0.05" value={state.settings.scale} onChange={(event) => bridge && void run(() => bridge.saveSettings({ scale: Number(event.target.value) }))} /></label>
        <label><input type="checkbox" checked={state.settings.alwaysOnTop} onChange={(event) => bridge && void run(() => bridge.saveSettings({ alwaysOnTop: event.target.checked }))} /> 总在最前</label>
        <label><input type="checkbox" checked={state.settings.clickThrough} onChange={(event) => bridge && void run(() => bridge.saveSettings({ clickThrough: event.target.checked }))} /> 点击穿透</label>
        <small>开启穿透后，用 {state.shortcutRegistered ? state.settings.shortcut : "CampusOS 托盘菜单"} 恢复交互；穿透时不能接收拖放。</small>
        </div>
      </section> : null}
    {!isPanel ? <>
      {activeReminder ? (
        <div className="pet-reminder-bubble" onClick={() => setActiveReminder(null)} role="status">
          <strong>{activeReminder.title}</strong>
          <p>{activeReminder.body}</p>
        </div>
      ) : null}
      {error ? <p className="pet-error" role="alert">{error}</p> : null}
      <button className="pet-move" type="button" aria-label="移动桌宠" onPointerDown={startMove} onPointerMove={move} onPointerUp={finishMove} onPointerCancel={finishMove}>⠿ 移动</button>
    <button type="button" className="pet-character" aria-label="打开桌宠面板" onClick={() => bridge && void run(() => bridge.openPanel())} data-appearance={missingForms.has(displayedForm) ? "fallback" : displayedForm}>
      {missingForms.has(displayedForm) ? <div className="pet-fallback" aria-hidden="true">🐳</div> : <img key={displayedForm} src={formAssets[displayedForm]} title={appearanceLabels[displayedForm]} alt="蓝发鲸鱼女仆桌宠" draggable={false} onError={() => markMissing(displayedForm)} />}
    </button></> : null}
    <div className="pet-drop-hint"><strong>松手，交给我</strong><span>支持文字与图片</span></div>
  </main>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><DesktopPet /></StrictMode>);
