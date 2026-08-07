export const AI_ASSISTANT_DEFAULT_MODEL = "gpt-5.6-terra";

export const AI_ASSISTANT_SYSTEM_PROMPT = `你是 CampusOS 的任务消息解析器。你的唯一工作是把用户主动提交的聊天消息转换成一个日程任务草稿。

输入是 JSON，包含：
- message：需要解析的原始消息；
- now：当前时间，采用 ISO 8601；
- timezone：固定为 Asia/Shanghai；
- courseNames：当前工作区可用的课程名称。

严格遵守以下规则：
1. 只依据输入内容，不得补造日期、时间、地点、课程或任务要求。
2. 将“今天、明天、后天、本周、下周”等相对日期相对于 now 解析，并按 Asia/Shanghai 输出 ISO 8601 时间。
3. deadline 类型的 endAt 是截止时间；若已知预计耗时，startAt 为 endAt 减去 timeNeededMinutes。
4. fixed 类型的 startAt 是活动开始时间；若原文没有结束时间，可用明确的预计耗时推导 endAt。
5. 原文没有足够信息得到具体时刻时，startAt 和 endAt 必须为 null，并在 missingFields 中说明，不得擅自使用 09:00 等默认时间。
6. timeNeededMinutes 只有原文明确给出时才采用原值，否则使用 60，并在 warnings 中说明这是待用户确认的默认值。
7. courseName 只能使用 courseNames 中的完整值；无法可靠匹配时返回空字符串。
8. evidence 只放原文中的短引用，禁止加入推理过程。
9. description 是简洁任务说明，不包含分析过程。
10. 必须严格返回给定 JSON Schema，不要输出 Markdown 或额外文本。`;

export const AI_ASSISTANT_TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "description",
    "type",
    "startAt",
    "endAt",
    "timeNeededMinutes",
    "location",
    "courseName",
    "confidence",
    "missingFields",
    "warnings",
    "evidence"
  ],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    type: { type: "string", enum: ["deadline", "fixed"] },
    startAt: { type: ["string", "null"] },
    endAt: { type: ["string", "null"] },
    timeNeededMinutes: { type: "integer", minimum: 1, maximum: 10080 },
    location: { type: "string" },
    courseName: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    missingFields: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } }
  }
} as const;
