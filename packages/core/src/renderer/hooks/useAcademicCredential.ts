import { useEffect, useMemo, useState } from "react";
import type {
  AcademicCredentialInput,
  AcademicCredentialRecord
} from "../../shared/credentialBridge";
import {
  clearAcademicCredentialRecord,
  connectAcademicCredentialRecord,
  loadAcademicCredentialRecord
} from "../lib/credentialBridge";

interface AcademicCredentialState {
  loading: boolean;
  record: AcademicCredentialRecord | null;
  error: string | null;
  load: () => Promise<void>;
  connect: (input: AcademicCredentialInput) => Promise<AcademicCredentialRecord>;
  clear: () => Promise<void>;
}

export const useAcademicCredential = (): AcademicCredentialState => {
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<AcademicCredentialRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const nextRecord = await loadAcademicCredentialRecord();
        setRecord(nextRecord);
        setError(null);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "无法读取统一认证账号。"
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return useMemo(
    () => ({
      loading,
      record,
      error,
      load: async () => {
        setLoading(true);
        try {
          const nextRecord = await loadAcademicCredentialRecord();
          setRecord(nextRecord);
          setError(null);
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "无法读取统一认证账号。"
          );
        } finally {
          setLoading(false);
        }
      },
      connect: async (input) => {
        setLoading(true);
        try {
          const nextRecord = await connectAcademicCredentialRecord(input);
          setRecord(nextRecord);
          setError(null);
          return nextRecord;
        } catch (nextError) {
          const message =
            nextError instanceof Error
              ? nextError.message
              : "统一认证连接失败，请重试。";
          setError(message);
          throw nextError instanceof Error ? nextError : new Error(message);
        } finally {
          setLoading(false);
        }
      },
      clear: async () => {
        setLoading(true);
        try {
          const nextRecord = await clearAcademicCredentialRecord();
          setRecord(nextRecord);
          setError(null);
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "无法清除统一认证账号。"
          );
        } finally {
          setLoading(false);
        }
      }
    }),
    [error, loading, record]
  );
};
