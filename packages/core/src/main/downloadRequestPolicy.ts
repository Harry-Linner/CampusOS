import type { CampusDownloadRequest } from "@campusos/shared";

export type CampusDownloadClassification =
  | { kind: "public" }
  | { kind: "zju-learning"; uploadId: string; referenceId: string };

const parseExactLearningId = (
  value: string | undefined,
  pattern: RegExp
): string | null => {
  if (!value) return null;
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" ||
    target.hostname !== "courses.zju.edu.cn" ||
    target.port ||
    target.username ||
    target.password ||
    target.search ||
    target.hash) {
    return null;
  }
  return pattern.exec(target.pathname)?.[1] ?? null;
};

export const classifyCampusDownloadRequest = (
  input: CampusDownloadRequest
): CampusDownloadClassification => {
  if (input.sourceId !== "learning-platform") return { kind: "public" };

  const referenceId = parseExactLearningId(
    input.url,
    /^\/api\/uploads\/reference\/([1-9]\d*)\/blob$/
  );
  const uploadId = parseExactLearningId(
    input.fallbackUrl,
    /^\/api\/uploads\/([1-9]\d*)\/blob$/
  );
  if (!referenceId || !uploadId) {
    throw new Error("学在浙大课件下载地址无效。");
  }

  return { kind: "zju-learning", uploadId, referenceId };
};
