import { ipcMain } from "electron";
import type { AcademicGpaStrategy } from "@campusos/shared";
import type {
  AcademicGpaStrategyRecord,
  AcademicGpaWeightsRecord
} from "../shared/academicBridge";
import { assertTrustedRenderer } from "./ipcSecurity";
import { readAcademicCredentialRecord } from "./academicCredentialStore";
import { getOfficialDatabaseService } from "./officialDatabaseService";

const emptyWeights: AcademicGpaWeightsRecord = { weights: {}, savedAt: null };
const defaultStrategy: AcademicGpaStrategyRecord = {
  strategy: "first",
  savedAt: null
};

const currentAccountId = async (): Promise<string | null> => {
  const record = await readAcademicCredentialRecord();
  if (record.verificationState !== "verified" || !record.authenticatedProfile) {
    return null;
  }
  const studentId = record.authenticatedProfile.studentId.trim();
  return studentId || null;
};

const normalizeWeights = (input: unknown): Record<string, number> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("GPA 权重参数无效。");
  }
  const weights: Record<string, number> = {};
  for (const [courseId, rawWeight] of Object.entries(input)) {
    const normalizedId = courseId.trim();
    if (!normalizedId) continue;
    if (typeof rawWeight !== "number" || !Number.isFinite(rawWeight) || rawWeight < 0 || rawWeight > 100) {
      throw new Error("GPA 权重必须是 0 到 100 之间的有限数值。");
    }
    weights[normalizedId] = rawWeight;
  }
  return weights;
};

const normalizeStrategy = (input: unknown): AcademicGpaStrategy => {
  if (input !== "best" && input !== "first") {
    throw new Error("GPA é‡ä¿®ç­–ç•¥å¿…é¡»æ˜¯å–é¦–æ¬¡æˆ–å–æœ€é«˜ã€‚");
  }
  return input;
};

export const registerAcademicGpaHandlers = (): void => {
  ipcMain.handle("campusos:academic:gpa-weights:load", async (event) => {
    assertTrustedRenderer(event);
    const accountId = await currentAccountId();
    if (!accountId) return emptyWeights;
    const stored = getOfficialDatabaseService().loadAcademicGpaWeights(accountId);
    return stored ?? emptyWeights;
  });
  ipcMain.handle(
    "campusos:academic:gpa-weights:save",
    async (event, input: unknown) => {
      assertTrustedRenderer(event);
      const accountId = await currentAccountId();
      if (!accountId) throw new Error("请先连接并验证学业账号。");
      const weights = normalizeWeights(input);
      const savedAt = new Date().toISOString();
      getOfficialDatabaseService().saveAcademicGpaWeights(accountId, weights, savedAt);
      return { weights, savedAt } satisfies AcademicGpaWeightsRecord;
    }
  );
  ipcMain.handle("campusos:academic:gpa-strategy:load", async (event) => {
    assertTrustedRenderer(event);
    const accountId = await currentAccountId();
    if (!accountId) return defaultStrategy;
    return getOfficialDatabaseService().loadAcademicGpaStrategy(accountId) ?? defaultStrategy;
  });
  ipcMain.handle(
    "campusos:academic:gpa-strategy:save",
    async (event, input: unknown) => {
      assertTrustedRenderer(event);
      const accountId = await currentAccountId();
      if (!accountId) throw new Error("è¯·å…ˆè¿žæŽ¥å¹¶éªŒè¯å­¦ä¸šè´¦å·ã€‚");
      const strategy = normalizeStrategy(input);
      const savedAt = new Date().toISOString();
      getOfficialDatabaseService().saveAcademicGpaStrategy(
        accountId,
        strategy,
        savedAt
      );
      return { strategy, savedAt } satisfies AcademicGpaStrategyRecord;
    }
  );
};
