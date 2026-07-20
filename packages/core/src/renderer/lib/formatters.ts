const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit"
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export const formatTimeRange = (startAt: string, endAt: string): string =>
  `${timeFormatter.format(new Date(startAt))} - ${timeFormatter.format(new Date(endAt))}`;

export const formatDateTime = (value: string): string =>
  dateTimeFormatter.format(new Date(value));

export const formatRelativeToNow = (
  value: string,
  now = new Date()
): string => {
  const diff = new Date(value).getTime() - now.getTime();
  const minutes = Math.round(diff / (60 * 1000));
  const absMinutes = Math.abs(minutes);

  if (absMinutes < 60) {
    return minutes >= 0 ? `${absMinutes} 分钟后` : `${absMinutes} 分钟前`;
  }

  const hours = Math.round(absMinutes / 60);

  if (hours < 24) {
    return minutes >= 0 ? `${hours} 小时后` : `${hours} 小时前`;
  }

  const days = Math.round(hours / 24);
  return minutes >= 0 ? `${days} 天后` : `${days} 天前`;
};

export const formatSyncLabel = (value: string): string =>
  `最近同步 ${formatDateTime(value)}`;
