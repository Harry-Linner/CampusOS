import type {
  BriefCachedItem,
  BriefProfile,
  BriefSnapshot
} from "@campusos/shared";
import { isBriefProfile } from "@campusos/shared";
import type { DatabaseService } from "./databaseService";

export interface StoredBriefSnapshot {
  snapshot: BriefSnapshot;
  savedAt: string;
}

export interface BriefStore {
  loadProfile: () => Promise<BriefProfile | null>;
  saveProfile: (profile: BriefProfile) => Promise<BriefProfile>;
  loadSnapshot: () => Promise<StoredBriefSnapshot | null>;
  saveSnapshot: (snapshot: BriefSnapshot) => Promise<void>;
  /** Returns true when the item was newly inserted. */
  upsertItem: (item: BriefCachedItem) => Promise<boolean>;
  findItem: (fingerprint: string) => Promise<BriefCachedItem | null>;
}

const isSnapshot = (value: unknown): value is BriefSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.date === "string" &&
    Number.isFinite(Date.parse(candidate.generatedAt as string)) &&
    Array.isArray(candidate.sections) &&
    Array.isArray(candidate.degradedSources)
  );
};

export const createBriefStore = ({
  database
}: {
  database: DatabaseService;
}): BriefStore => ({
  loadProfile: async () => {
    const stored = database.loadBriefProfile();
    if (!stored) return null;
    const profile = stored.profile;
    return isBriefProfile(profile) ? profile : null;
  },
  saveProfile: async (profile) => {
    const savedAt = new Date().toISOString();
    database.saveBriefProfile(profile, savedAt);
    return { ...profile, savedAt };
  },
  loadSnapshot: async () => {
    const stored = database.loadBriefSnapshot();
    if (!stored) return null;
    return isSnapshot(stored.snapshot)
      ? { snapshot: stored.snapshot, savedAt: stored.savedAt }
      : null;
  },
  saveSnapshot: async (snapshot) => {
    database.saveBriefSnapshot(snapshot, new Date().toISOString());
  },
  upsertItem: async (item) => database.upsertBriefItem(item),
  findItem: async (fingerprint) => database.findBriefItem(fingerprint)
});
