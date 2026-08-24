import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain, safeStorage } from "electron";
import { assertTrustedRenderer } from "./ipcSecurity";

/**
 * 包级运行时不变式注册表（dsh-invariants 式）：
 * 核心子系统声明"必须成立"的不变式，统一在启动与按需时校验；
 * 校验失败记录为可观测问题，不自动修复（fail 可见、fail 不掩盖）。
 */

export type InvariantSeverity = "critical" | "warning";

export interface InvariantResult {
  name: string;
  severity: InvariantSeverity;
  ok: boolean;
  message: string;
  durationMs: number;
}

export type InvariantCheck = () => Promise<string | null> | string | null;

export interface RegisteredInvariant {
  name: string;
  severity: InvariantSeverity;
  check: InvariantCheck;
}

const registry = new Map<string, RegisteredInvariant>();

export const registerInvariant = (
  name: string,
  severity: InvariantSeverity,
  check: InvariantCheck
): void => {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) {
    throw new Error(`不变式名称必须是合法标识符：${name}`);
  }
  if (registry.has(name)) {
    throw new Error(`不变式重复注册：${name}`);
  }
  registry.set(name, { name, severity, check });
};

/** 统一运行全部不变式；单个失败不影响其余执行。 */
export const runInvariants = async (): Promise<InvariantResult[]> => {
  const results: InvariantResult[] = [];
  await Promise.all(
    [...registry.values()].map(async (invariant) => {
      const startedAt = performance.now();
      try {
        const problem = await invariant.check();
        results.push({
          name: invariant.name,
          severity: invariant.severity,
          ok: problem === null || problem === undefined,
          message: problem ?? "ok",
          durationMs: Math.round(performance.now() - startedAt)
        });
      } catch (error) {
        results.push({
          name: invariant.name,
          severity: invariant.severity,
          ok: false,
          message: error instanceof Error ? error.message : "不变式检查抛出异常",
          durationMs: Math.round(performance.now() - startedAt)
        });
      }
    })
  );
  return results.sort((left, right) => left.name.localeCompare(right.name));
};

/** 注册内置不变式：宿主环境与核心子系统。 */
export const registerCoreInvariants = (): void => {
  registerInvariant(
    "user-data-writable",
    "critical",
    async () => {
      const probePath = join(app.getPath("userData"), ".invariant-probe");
      try {
        await writeFile(probePath, "ok", "utf8");
        await rm(probePath, { force: true });
        return null;
      } catch {
        return "userData 目录不可写，应用数据无法持久化。";
      }
    }
  );

  registerInvariant(
    "safe-storage-available",
    "critical",
    () => {
      // 凭证与密钥依赖 OS 级加密；不可用时必须显式可见。
      return app.isReady() && safeStorage.isEncryptionAvailable()
        ? null
        : "系统密钥链（safeStorage）不可用，凭证无法安全保存。";
    }
  );

  registerInvariant(
    "diagnostics-schema",
    "warning",
    async () => {
      try {
        const { loadDiagnosticSnapshot } = await import("./diagnosticLogStore");
        await loadDiagnosticSnapshot();
        return null;
      } catch (error) {
        return `诊断日志存储不可读：${error instanceof Error ? error.message : "未知错误"}`;
      }
    }
  );

  registerInvariant(
    "credential-store-schema",
    "critical",
    async () => {
      try {
        const { readAcademicCredentialRecord } = await import("./academicCredentialStore");
        await readAcademicCredentialRecord();
        return null;
      } catch (error) {
        return `凭证存储不可读：${error instanceof Error ? error.message : "未知错误"}`;
      }
    }
  );
};

/** 校验结果是否全部通过。 */
export const invariantsPass = (results: readonly InvariantResult[]): boolean =>
  results.every((result) => result.ok);

export const invariantFailures = (
  results: readonly InvariantResult[]
): InvariantResult[] => results.filter((result) => !result.ok);

/** 探测临时目录可写（独立于 userData 的环境检查）。 */
export const probeWritableDirectory = async (
  directory: string
): Promise<string | null> => {
  const probePath = join(directory, `.probe-${Date.now()}`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(probePath, "ok", "utf8");
    await rm(probePath, { force: true });
    return null;
  } catch (error) {
    return `${dirname(directory)} 目录不可写：${error instanceof Error ? error.message : "未知错误"}`;
  }
};

export const registerInvariantHandlers = (): void => {
  ipcMain.handle("campusos:invariants:run", async (event) => {
    assertTrustedRenderer(event);
    return runInvariants();
  });
};
