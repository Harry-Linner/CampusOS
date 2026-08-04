import type { AcademicGpaStrategy } from "@campusos/shared";

export interface AcademicGpaWeightsRecord {
  weights: Record<string, number>;
  savedAt: string | null;
}

export interface AcademicGpaStrategyRecord {
  strategy: AcademicGpaStrategy;
  savedAt: string | null;
}

export interface AcademicBridge {
  loadGpaWeights: () => Promise<AcademicGpaWeightsRecord>;
  saveGpaWeights: (
    weights: Record<string, number>
  ) => Promise<AcademicGpaWeightsRecord>;
  loadGpaStrategy: () => Promise<AcademicGpaStrategyRecord>;
  saveGpaStrategy: (
    strategy: AcademicGpaStrategy
  ) => Promise<AcademicGpaStrategyRecord>;
}
