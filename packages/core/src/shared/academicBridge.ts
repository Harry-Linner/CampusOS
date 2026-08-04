export interface AcademicGpaWeightsRecord {
  weights: Record<string, number>;
  savedAt: string | null;
}

export interface AcademicBridge {
  loadGpaWeights: () => Promise<AcademicGpaWeightsRecord>;
  saveGpaWeights: (
    weights: Record<string, number>
  ) => Promise<AcademicGpaWeightsRecord>;
}
