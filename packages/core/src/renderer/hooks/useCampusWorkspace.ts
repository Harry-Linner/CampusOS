import { startTransition, useMemo, useState } from "react";
import type { CampusWorkspaceSnapshot } from "@campusos/shared";
import type { CampusWorkspaceHydratedFrom } from "../../shared/campusBridge";
import {
  hydrateCampusWorkspaceRecord,
  syncCampusWorkspaceRecord
} from "../lib/campusBridge";

interface CampusWorkspaceState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  snapshot: CampusWorkspaceSnapshot | null;
  hydratedFrom: CampusWorkspaceHydratedFrom | null;
  savedAt: string | null;
  storagePath: string | null;
  load: () => Promise<void>;
  sync: () => Promise<void>;
}

export const useCampusWorkspace = (): CampusWorkspaceState => {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CampusWorkspaceSnapshot | null>(null);
  const [hydratedFrom, setHydratedFrom] =
    useState<CampusWorkspaceHydratedFrom | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);

  return useMemo(
    () => ({
      ready,
      loading,
      error,
      snapshot,
      hydratedFrom,
      savedAt,
      storagePath,
      load: async () => {
        setLoading(true);
        try {
          const nextRecord = await hydrateCampusWorkspaceRecord();

          startTransition(() => {
            setSnapshot(nextRecord.snapshot);
            setHydratedFrom(nextRecord.hydratedFrom);
            setSavedAt(nextRecord.savedAt);
            setStoragePath(nextRecord.storagePath);
            setReady(true);
            setError(null);
          });
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "工作区加载失败。"
          );
        } finally {
          setLoading(false);
        }
      },
      sync: async () => {
        setLoading(true);
        try {
          const nextRecord = await syncCampusWorkspaceRecord();

          startTransition(() => {
            setSnapshot(nextRecord.snapshot);
            setHydratedFrom(nextRecord.hydratedFrom);
            setSavedAt(nextRecord.savedAt);
            setStoragePath(nextRecord.storagePath);
            setReady(true);
            setError(null);
          });
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "工作区刷新失败。"
          );
          throw nextError;
        } finally {
          setLoading(false);
        }
      }
    }),
    [error, hydratedFrom, loading, ready, savedAt, snapshot, storagePath]
  );
};
