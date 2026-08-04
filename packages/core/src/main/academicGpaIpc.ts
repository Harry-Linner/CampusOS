import { ipcMain } from "electron";
import type { AcademicGpaStrategy } from "@campusos/shared";
import type {
  AcademicGpaStrategyRecord
} from "../shared/academicBridge";
import { assertTrustedRenderer } from "./ipcSecurity";
import { readAcademicCredentialRecord } from "./academicCredentialStore";
import { getOfficialDatabaseService } from "./officialDatabaseService";

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

const normalizeStrategy = (input: unknown): AcademicGpaStrategy => {
  if (input !== "best" && input !== "first") {
    throw new Error("GPA é‡ä¿®ç­–ç•¥å¿…é¡»æ˜¯å–é¦–æ¬¡æˆ–å–æœ€é«˜ã€‚");
  }
  return input;
};

export const registerAcademicGpaHandlers = (): void => {
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
