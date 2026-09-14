export const extractMeetingNumber = (text?: string | null): string | null => {
  if (!text) return null;
  const prefixMatch = /(?:腾讯会议(?:号|ID)?|会议号|会议ID)[：:\s]*([0-9]{3}[\s-]?[0-9]{3,4}[\s-]?[0-9]{3,4})/i.exec(text);
  if (prefixMatch) {
    const raw = prefixMatch[1].replace(/[\s-]/g, "");
    if (raw.length >= 9 && raw.length <= 11) return raw;
  }
  const standAloneMatch = /\b([0-9]{3}[-\s][0-9]{3,4}[-\s][0-9]{3,4})\b/.exec(text);
  if (standAloneMatch) {
    const raw = standAloneMatch[1].replace(/[\s-]/g, "");
    if (raw.length >= 9 && raw.length <= 11) return raw;
  }
  return null;
};
