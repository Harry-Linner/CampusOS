import { randomUUID } from "node:crypto";
import type { AiAssistantParseResult, AiAssistantSettingsRecord } from "@campusos/shared";
import type { DesktopPetInput, DesktopPetJob, DesktopPetJobSummary } from "../../../shared/src/desktopPet";

type ParsedJob = { result: AiAssistantParseResult; settings: AiAssistantSettingsRecord };
type SessionJob = DesktopPetJob & { input: DesktopPetInput; controller?: AbortController };
const MAX_JOBS = 12;
const MAX_PENDING_JOBS = 5;

export const validateDesktopPetInput = (input: DesktopPetInput): DesktopPetInput => {
  if (input?.kind === "text") {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text || Buffer.byteLength(text, "utf8") > 50_000) throw new Error("请喂入非空文字，最多 50 KB。");
    return { kind: "text", text };
  }
  if (input?.kind === "image" && ["image/png", "image/jpeg", "image/webp"].includes(input.mime)) {
    if (typeof input.base64 !== "string" || !input.base64 || input.base64.length > 11_184_812 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new Error("图片内容无效，最多支持 8 MB 的 PNG、JPEG 或 WebP。");
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.length > 8 * 1024 * 1024 || bytes.length < 12 || bytes.toString("base64") !== input.base64) throw new Error("图片内容无效或超过 8 MB。");
    return { kind: "image", mime: input.mime, base64: input.base64 };
  }
  throw new Error("支持文字、TXT/Markdown 文本和 PNG/JPEG/WebP 图片；请复制消息文字或截图后重试。");
};

export const createDesktopPetService = ({ parse, onChanged = () => undefined }: {
  parse: (input: DesktopPetInput, signal: AbortSignal) => Promise<ParsedJob>;
  onChanged?: () => void;
}) => {
  const jobs = new Map<string, SessionJob>();
  let active = false;
  let disposed = false;
  const summaries = (): DesktopPetJobSummary[] => [...jobs.values()].map(({ id, createdAt, status, kind, label, message }) => ({ id, createdAt, status, kind, label, message })).reverse();
  const pump = async (): Promise<void> => {
    if (active || disposed) return;
    const job = [...jobs.values()].find((item) => item.status === "queued");
    if (!job) return;
    active = true;
    job.status = "processing";
    job.message = job.kind === "image" ? "正在识别图片并整理消息…" : "正在整理消息…";
    const controller = new AbortController();
    job.controller = controller;
    onChanged();
    try {
      const parsed = await parse(job.input, controller.signal);
      if (disposed || controller.signal.aborted || !jobs.has(job.id)) return;
      job.result = parsed.result;
      job.settings = parsed.settings;
      job.status = "ready";
      job.message = parsed.result.intent === "academic-query"
        ? "学业问答已就绪，打开查看回答。"
        : parsed.result.intents.length ? `整理出 ${parsed.result.intents.length} 个事项，核对后再写入。` : "已读完，没有找到可安排的事项。";
    } catch {
      if (disposed || controller.signal.aborted || !jobs.has(job.id)) return;
      job.status = "error";
      // The floating window never receives raw upstream error details: providers may echo request metadata.
      job.message = job.kind === "image"
        ? "图片解析失败，请换用支持图片的视觉模型，或改用文字后重试。"
        : "解析失败，请检查 AI 连接后重试。";
    } finally {
      delete job.controller;
      active = false;
      if (!disposed) { onChanged(); void pump(); }
    }
  };
  return {
    list: summaries,
    get: (id: string): DesktopPetJob | null => {
      const job = jobs.get(id);
      return job ? { ...summaries().find((item) => item.id === id)!, result: job.result, settings: job.settings } : null;
    },
    submit: (raw: DesktopPetInput): string => {
      if (disposed) throw new Error("桌宠已关闭。");
      const input = validateDesktopPetInput(raw);
      if ([...jobs.values()].filter((job) => job.status === "queued" || job.status === "processing").length >= MAX_PENDING_JOBS) throw new Error("已有 5 条消息正在排队，请处理后再喂入。");
      if (jobs.size >= MAX_JOBS) throw new Error("请先查看或清除已处理的桌宠消息，再继续喂入。");
      const id = randomUUID();
      jobs.set(id, { id, input, kind: input.kind, label: input.kind === "image" ? "图片消息" : "文字消息", createdAt: new Date().toISOString(), status: "queued", message: "等待解析…" });
      onChanged();
      void pump();
      return id;
    },
    cancel: (id: string): void => {
      const job = jobs.get(id);
      if (!job || !["queued", "processing"].includes(job.status)) return;
      job.controller?.abort();
      job.status = "cancelled";
      job.message = "已取消，可重试或清除。";
      onChanged();
    },
    retry: (id: string): void => {
      const job = jobs.get(id);
      if (!job || !["error", "cancelled"].includes(job.status)) return;
      if (job.controller) throw new Error("正在结束上一次请求，请稍后重试。");
      if ([...jobs.values()].filter((candidate) => candidate.status === "queued" || candidate.status === "processing").length >= MAX_PENDING_JOBS) throw new Error("已有 5 条消息正在排队，请处理后再重试。");
      job.status = "queued";
      job.message = "等待重试…";
      onChanged();
      void pump();
    },
    dismiss: (id: string): void => { jobs.get(id)?.controller?.abort(); jobs.delete(id); onChanged(); },
    dispose: (): void => { disposed = true; for (const job of jobs.values()) job.controller?.abort(); jobs.clear(); }
  };
};

export type DesktopPetService = ReturnType<typeof createDesktopPetService>;
