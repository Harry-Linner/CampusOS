const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Shanghai"
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Shanghai"
});

export const formatTimeRange = (startAt: string, endAt: string): string =>
  `${timeFormatter.format(new Date(startAt))} - ${timeFormatter.format(new Date(endAt))}`;

export const formatDateTime = (value: string): string =>
  dateTimeFormatter.format(new Date(value));
