import type { AcademicGpaStrategy } from "@campusos/shared";

export interface AcademicGpaStrategyRecord {
  strategy: AcademicGpaStrategy;
  savedAt: string | null;
}

export interface AcademicBridge {
  loadGpaStrategy: () => Promise<AcademicGpaStrategyRecord>;
  saveGpaStrategy: (
    strategy: AcademicGpaStrategy
  ) => Promise<AcademicGpaStrategyRecord>;
}
