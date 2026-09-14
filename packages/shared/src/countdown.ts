export const formatCountdown = (dueAtIso: string, isCompleted?: boolean, nowMs = Date.now()): string => {
  if (isCompleted) return "已完成";
  const targetMs = Date.parse(dueAtIso);
  if (!Number.isFinite(targetMs)) return "";
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return "已截止";
  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `剩 ${days}天${hours}小时`;
  if (hours > 0) return `剩 ${hours}小时${minutes}分`;
  return `仅剩 ${minutes}分钟`;
};
