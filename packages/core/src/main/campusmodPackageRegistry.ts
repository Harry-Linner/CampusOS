import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  validateUserPluginManifestV2,
  type PluginManifestV2
} from "@campusos/shared";
import type { CapabilityAudit } from "../shared/pluginBridge";
import { buildCapabilityAudit } from "./capabilityAudit";
import {
  createCampusmodSigningPayload,
  verifyPackageContent
} from "./packageSignature";

const MANIFEST_PATH = "manifest.json";
const INSTALL_METADATA_PATH = ".campusmod-install.json";

export interface CampusmodPackageInspection {
  token: string;
  manifest: PluginManifestV2;
  entrypoints: CampusmodEntrypoints;
  archiveSize: number;
  unpackedSize: number;
  fileCount: number;
  sha256: string;
  signatureStatus: "unsigned" | "verified" | "invalid";
  capabilityAudit: CapabilityAudit;
}

export interface InstalledCampusmodPackage {
  manifest: PluginManifestV2;
  entrypoints: CampusmodEntrypoints;
  archiveSize: number;
  unpackedSize: number;
  fileCount: number;
  sha256: string;
  signatureStatus: "unsigned" | "verified" | "invalid";
  capabilityAudit: CapabilityAudit;
  installedAt: string;
  sourceFilename: string;
}

export interface CampusmodRegistryIssue {
  directoryName: string;
  message: string;
}

export interface CampusmodRegistrySnapshot {
  packages: InstalledCampusmodPackage[];
  issues: CampusmodRegistryIssue[];
}

interface ParsedCampusmodPackage {
  manifest: PluginManifestV2;
  entrypoints: CampusmodEntrypoints;
  archiveSize: number;
  unpackedSize: number;
  fileCount: number;
  sha256: string;
  entries: Map<string, Uint8Array>;
}

interface PendingCampusmodPackage {
  sourcePath: string;
  sourceFilename: string;
  inspection: CampusmodPackageInspection;
  createdAt: number;
}

interface StoredInstallMetadata extends InstalledCampusmodPackage {
  dataVersion: 1;
  files: Record<string, string>;
}

const determineSignatureStatus = (
  parsed: Pick<ParsedCampusmodPackage, "manifest" | "entrypoints" | "entries">
): CampusmodPackageInspection["signatureStatus"] => {
  const { contentHash, developerSignature, developerPublicKey } = parsed.manifest;
  if (!contentHash || !developerSignature || !developerPublicKey) {
    return "unsigned";
  }

  const payload = createCampusmodSigningPayload(
    { ...parsed.manifest, entrypoints: parsed.entrypoints },
    parsed.entries
  );
  return verifyPackageContent(payload, {
    sha256: contentHash,
    signature: developerSignature,
    publicKey: developerPublicKey
  }).valid
    ? "verified"
    : "invalid";
};

const decodeEntrySource = (bytes: Uint8Array | undefined): string | undefined => {
  if (!bytes) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
};

const determineCapabilityAudit = (
  parsed: Pick<ParsedCampusmodPackage, "manifest" | "entrypoints" | "entries">
): CapabilityAudit =>
  buildCapabilityAudit(
    {
      main: parsed.entrypoints.main
        ? decodeEntrySource(parsed.entries.get(parsed.entrypoints.main))
        : undefined,
      renderer: parsed.entrypoints.renderer
        ? decodeEntrySource(parsed.entries.get(parsed.entrypoints.renderer))
        : undefined
    },
    parsed.manifest.permissions
  );

/** 旧版本安装元数据缺审计字段时的默认值（仅用于已安装列表展示）。 */
const legacyCapabilityAudit: CapabilityAudit = {
  status: "verified",
  findings: []
};

import {
  backupDirectoryPattern,
  normalizeArchivePath,
  sha256,
  stagingDirectoryPattern,
  trashDirectoryPattern
} from "./campusmodArchivePaths";
import { unpackArchive } from "./campusmodArchiveUnpack";
import { defaultLimits, type CampusmodPackageLimits } from "./campusmodPackageLimits";
import {
  parseManifest,
  type CampusmodEntrypoints
} from "./campusmodManifest";

export interface CampusmodPackageRegistry {
  inspect: (sourcePath: string) => Promise<CampusmodPackageInspection>;
  discard: (token: string) => void;
  install: (token: string) => Promise<InstalledCampusmodPackage>;
  load: () => Promise<CampusmodRegistrySnapshot>;
  readFile: (pluginId: string, relativePath: string) => Promise<Uint8Array>;
  uninstall: (pluginId: string) => Promise<CampusmodRegistrySnapshot>;
}

export interface CreateCampusmodPackageRegistryOptions {
  rootPath: string;
  limits?: Partial<CampusmodPackageLimits>;
  now?: () => Date;
}

const parseArchive = async (
  archive: Uint8Array,
  limits: CampusmodPackageLimits
): Promise<ParsedCampusmodPackage> => {
  if (archive.length === 0 || archive.length > limits.maxArchiveBytes) {
    throw new Error("插件包为空或超过归档大小限制。");
  }
  const entries = await unpackArchive(archive, limits);
  const manifestBytes = entries.get(MANIFEST_PATH);
  if (!manifestBytes) throw new Error("插件包根目录缺少 manifest.json。");
  if (entries.has(INSTALL_METADATA_PATH)) {
    throw new Error("插件包包含保留的安装元数据路径。");
  }

  const { manifest, entrypoints } = parseManifest(
    manifestBytes,
    entries,
    limits
  );
  const unpackedSize = [...entries.values()].reduce(
    (total, entry) => total + entry.length,
    0
  );
  return {
    manifest,
    entrypoints,
    archiveSize: archive.length,
    unpackedSize,
    fileCount: entries.size,
    sha256: sha256(archive),
    entries
  };
};

const isMissingPathError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const writeStagingDirectory = async (
  stagingPath: string,
  parsed: ParsedCampusmodPackage,
  metadata: StoredInstallMetadata
): Promise<void> => {
  await mkdir(stagingPath, { recursive: false });
  for (const [relativePath, data] of parsed.entries) {
    const targetPath = join(stagingPath, ...relativePath.split("/"));
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, data, { flag: "wx" });
  }
  await writeFile(
    join(stagingPath, INSTALL_METADATA_PATH),
    JSON.stringify(metadata, null, 2),
    { encoding: "utf8", flag: "wx" }
  );
};

const parseInstalledMetadata = (value: unknown): StoredInstallMetadata => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("安装元数据不是对象。");
  }
  const candidate = value as Partial<StoredInstallMetadata>;
  const validation = validateUserPluginManifestV2(candidate.manifest);
  if (
    candidate.dataVersion !== 1 ||
    !validation.ok ||
    typeof candidate.installedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.installedAt)) ||
    typeof candidate.sourceFilename !== "string" ||
    candidate.sourceFilename !== basename(candidate.sourceFilename) ||
    candidate.sourceFilename.length > 255 ||
    typeof candidate.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.sha256) ||
    (candidate.signatureStatus !== "unsigned" &&
      candidate.signatureStatus !== "verified" &&
      candidate.signatureStatus !== "invalid") ||
    !Number.isSafeInteger(candidate.archiveSize) ||
    (candidate.archiveSize ?? -1) < 0 ||
    !Number.isSafeInteger(candidate.unpackedSize) ||
    (candidate.unpackedSize ?? -1) < 0 ||
    !Number.isSafeInteger(candidate.fileCount) ||
    (candidate.fileCount ?? -1) < 0 ||
    typeof candidate.entrypoints !== "object" ||
    candidate.entrypoints === null ||
    typeof candidate.files !== "object" ||
    candidate.files === null ||
    Array.isArray(candidate.files)
  ) {
    throw new Error("安装元数据格式无效。");
  }
  const manifest = candidate.manifest as PluginManifestV2;
  if (
    !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(manifest.id) ||
    manifest.id.startsWith("org.campusos.")
  ) {
    throw new Error("安装元数据包含无效的第三方插件 ID。");
  }

  const entrypoints: CampusmodEntrypoints = {};
  const entrypointCandidate = candidate.entrypoints as Record<string, unknown>;
  if (Object.keys(entrypointCandidate).some((key) => key !== "main" && key !== "renderer")) {
    throw new Error("安装元数据包含未知 entrypoint。");
  }
  for (const key of ["main", "renderer"] as const) {
    const path = entrypointCandidate[key];
    if (path === undefined) continue;
    if (typeof path !== "string") throw new Error("安装 entrypoint 格式无效。");
    const normalized = normalizeArchivePath(path);
    if (normalized.endsWith("/") || !/\.(?:js|mjs)$/.test(normalized)) {
      throw new Error("安装 entrypoint 格式无效。");
    }
    entrypoints[key] = normalized;
  }

  const files: Record<string, string> = {};
  for (const [path, digest] of Object.entries(candidate.files)) {
    const normalized = normalizeArchivePath(path);
    if (
      normalized.endsWith("/") ||
      normalized === INSTALL_METADATA_PATH ||
      typeof digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(digest)
    ) {
      throw new Error("安装文件摘要格式无效。");
    }
    files[normalized] = digest;
  }
  if (Object.keys(files).length !== candidate.fileCount) {
    throw new Error("安装文件数量与元数据不一致。");
  }
  for (const path of Object.values(entrypoints)) {
    if (path && !files[path]) throw new Error("安装 entrypoint 缺少文件摘要。");
  }

  return {
    dataVersion: 1,
    manifest,
    entrypoints,
    archiveSize: candidate.archiveSize as number,
    unpackedSize: candidate.unpackedSize as number,
    fileCount: candidate.fileCount as number,
    sha256: candidate.sha256,
    signatureStatus: candidate.signatureStatus,
    capabilityAudit: candidate.capabilityAudit ?? legacyCapabilityAudit,
    installedAt: candidate.installedAt,
    sourceFilename: candidate.sourceFilename,
    files
  };
};

const verifyInstalledFiles = async (
  pluginPath: string,
  files: Readonly<Record<string, string>>
): Promise<Map<string, Uint8Array>> => {
  const pendingDirectories: Array<{ absolute: string; relative: string }> = [
    { absolute: pluginPath, relative: "" }
  ];
  const actualFiles = new Set<string>();
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop() as {
      absolute: string;
      relative: string;
    };
    for (const entry of await readdir(directory.absolute, { withFileTypes: true })) {
      const relativePath = directory.relative
        ? `${directory.relative}/${entry.name}`
        : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`安装目录包含符号链接：${relativePath}`);
      }
      if (entry.isDirectory()) {
        pendingDirectories.push({
          absolute: join(directory.absolute, entry.name),
          relative: relativePath
        });
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`安装目录包含非常规文件：${relativePath}`);
      }
      if (relativePath !== INSTALL_METADATA_PATH) actualFiles.add(relativePath);
    }
  }

  const expectedFiles = Object.keys(files);
  if (
    actualFiles.size !== expectedFiles.length ||
    expectedFiles.some((path) => !actualFiles.has(path))
  ) {
    throw new Error("安装目录文件集合与安装记录不一致。");
  }
  const entries = new Map<string, Uint8Array>();
  for (const [relativePath, digest] of Object.entries(files)) {
    const data = await readFile(join(pluginPath, ...relativePath.split("/")));
    if (sha256(data) !== digest) {
      throw new Error(`安装文件摘要不匹配：${relativePath}`);
    }
    entries.set(relativePath, data);
  }
  return entries;
};

export const createCampusmodPackageRegistry = ({
  rootPath,
  limits: limitOverrides = {},
  now = () => new Date()
}: CreateCampusmodPackageRegistryOptions): CampusmodPackageRegistry => {
  const limits = { ...defaultLimits, ...limitOverrides };
  const pendingPackages = new Map<string, PendingCampusmodPackage>();
  const inspectionTtlMs = 10 * 60 * 1000;
  const maxPendingInspections = 8;
  let mutationQueue: Promise<void> = Promise.resolve();
  let recoveryPromise: Promise<void> | null = null;

  const recoverInterruptedMutations = async (): Promise<void> => {
    let directories;
    try {
      directories = await readdir(rootPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }

    for (const directory of directories.sort((left, right) =>
      left.name.localeCompare(right.name))) {
      if (!directory.isDirectory()) continue;
      const interruptedPath = join(rootPath, directory.name);
      if (
        stagingDirectoryPattern.test(directory.name) ||
        trashDirectoryPattern.test(directory.name)
      ) {
        await rm(interruptedPath, { recursive: true, force: true });
        continue;
      }

      const backupMatch = backupDirectoryPattern.exec(directory.name);
      const pluginId = backupMatch?.[1];
      if (!pluginId) continue;
      const targetPath = join(rootPath, pluginId);
      try {
        await stat(targetPath);
        await rm(interruptedPath, { recursive: true, force: true });
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
        await rename(interruptedPath, targetPath);
      }
    }
  };

  const ensureRecovered = (): Promise<void> => {
    recoveryPromise ??= recoverInterruptedMutations();
    return recoveryPromise;
  };

  const readVerifiedPackage = async (directoryName: string): Promise<{
    installedPackage: InstalledCampusmodPackage;
    entries: Map<string, Uint8Array>;
  }> => {
    const pluginPath = join(rootPath, directoryName);
    const metadataPath = join(pluginPath, INSTALL_METADATA_PATH);
    const metadata = parseInstalledMetadata(
      JSON.parse(await readFile(metadataPath, "utf8")) as unknown
    );
    if (metadata.manifest.id !== directoryName) {
      throw new Error("插件目录名与 manifest ID 不一致。");
    }
    const entries = await verifyInstalledFiles(pluginPath, metadata.files);
    const manifestBytes = entries.get(MANIFEST_PATH);
    if (!manifestBytes) throw new Error("安装目录缺少 manifest.json。");
    const parsedManifest = parseManifest(manifestBytes, entries, limits);
    if (
      !isDeepStrictEqual(parsedManifest.manifest, metadata.manifest) ||
      !isDeepStrictEqual(parsedManifest.entrypoints, metadata.entrypoints)
    ) {
      throw new Error("安装 manifest 与安装记录不一致。");
    }
    if (determineSignatureStatus({
      manifest: parsedManifest.manifest,
      entrypoints: parsedManifest.entrypoints,
      entries
    }) !== metadata.signatureStatus) {
      throw new Error("安装包签名状态与安装记录不一致。");
    }
    return {
      installedPackage: {
        manifest: metadata.manifest,
        entrypoints: metadata.entrypoints,
        archiveSize: metadata.archiveSize,
        unpackedSize: metadata.unpackedSize,
        fileCount: metadata.fileCount,
        sha256: metadata.sha256,
        signatureStatus: metadata.signatureStatus,
        capabilityAudit: metadata.capabilityAudit,
        installedAt: metadata.installedAt,
        sourceFilename: metadata.sourceFilename
      },
      entries
    };
  };

  const load = async (): Promise<CampusmodRegistrySnapshot> => {
    await mutationQueue;
    await ensureRecovered();
    let directories;
    try {
      directories = await readdir(rootPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) return { packages: [], issues: [] };
      throw error;
    }

    const packages: InstalledCampusmodPackage[] = [];
    const issues: CampusmodRegistryIssue[] = [];
    for (const directory of directories.sort((left, right) =>
      left.name.localeCompare(right.name))) {
      if (!directory.isDirectory() || directory.name.startsWith(".")) continue;
      try {
        packages.push((await readVerifiedPackage(directory.name)).installedPackage);
      } catch (error) {
        issues.push({
          directoryName: directory.name,
          message: error instanceof Error ? error.message : "插件目录损坏。"
        });
      }
    }
    return { packages, issues };
  };

  return {
    inspect: async (sourcePath) => {
      const currentTime = now().getTime();
      for (const [token, pending] of pendingPackages) {
        if (currentTime - pending.createdAt > inspectionTtlMs) {
          pendingPackages.delete(token);
        }
      }
      while (pendingPackages.size >= maxPendingInspections) {
        const oldestToken = pendingPackages.keys().next().value as string;
        pendingPackages.delete(oldestToken);
      }
      if (typeof sourcePath !== "string" || !sourcePath.toLowerCase().endsWith(".campusmod")) {
        throw new Error("请选择 .campusmod 插件包。");
      }
      const archiveStat = await stat(sourcePath);
      if (!archiveStat.isFile() || archiveStat.size > limits.maxArchiveBytes) {
        throw new Error("插件包不是普通文件或超过归档大小限制。");
      }
      const archive = await readFile(sourcePath);
      const parsed = await parseArchive(archive, limits);
      const token = randomUUID();

      const signatureStatus = determineSignatureStatus(parsed);
      const capabilityAudit = determineCapabilityAudit(parsed);

      const inspection: CampusmodPackageInspection = {
        token,
        manifest: parsed.manifest,
        entrypoints: parsed.entrypoints,
        archiveSize: parsed.archiveSize,
        unpackedSize: parsed.unpackedSize,
        fileCount: parsed.fileCount,
        sha256: parsed.sha256,
        signatureStatus,
        capabilityAudit
      };
      pendingPackages.set(token, {
        sourcePath,
        sourceFilename: basename(sourcePath),
        inspection,
        createdAt: currentTime
      });
      return inspection;
    },
    discard: (token) => {
      pendingPackages.delete(token);
    },
    install: async (token) => {
      const pending = pendingPackages.get(token);
      pendingPackages.delete(token);
      if (!pending) throw new Error("插件安装确认已失效，请重新选择文件。");
      if (now().getTime() - pending.createdAt > inspectionTtlMs) {
        throw new Error("插件安装确认已过期，请重新选择文件。");
      }

      let installedPackage: InstalledCampusmodPackage | undefined;
      const operation = mutationQueue.then(async () => {
        await ensureRecovered();
        const archive = await readFile(pending.sourcePath);
        const parsed = await parseArchive(archive, limits);
        if (
          parsed.sha256 !== pending.inspection.sha256 ||
          parsed.manifest.id !== pending.inspection.manifest.id ||
          parsed.manifest.version !== pending.inspection.manifest.version ||
          determineSignatureStatus(parsed) !== pending.inspection.signatureStatus
        ) {
          throw new Error("插件包在确认后发生变化，请重新选择。");
        }

        const installedAt = now().toISOString();
        installedPackage = {
          manifest: parsed.manifest,
          entrypoints: parsed.entrypoints,
          archiveSize: parsed.archiveSize,
          unpackedSize: parsed.unpackedSize,
          fileCount: parsed.fileCount,
          sha256: parsed.sha256,
          signatureStatus: pending.inspection.signatureStatus,
          capabilityAudit: determineCapabilityAudit(parsed),
          installedAt,
          sourceFilename: pending.sourceFilename
        };
        const metadata: StoredInstallMetadata = {
          dataVersion: 1,
          ...installedPackage,
          files: Object.fromEntries(
            [...parsed.entries].map(([path, data]) => [path, sha256(data)])
          )
        };

        await mkdir(rootPath, { recursive: true });
        const suffix = randomUUID();
        const stagingPath = join(rootPath, `.staging-${suffix}`);
        const backupPath = join(
          rootPath,
          `.backup-${parsed.manifest.id}-${suffix}`
        );
        const targetPath = join(rootPath, parsed.manifest.id);
        let movedExisting = false;
        try {
          await writeStagingDirectory(stagingPath, parsed, metadata);
          try {
            await rename(targetPath, backupPath);
            movedExisting = true;
          } catch (error) {
            if (!isMissingPathError(error)) throw error;
          }
          try {
            await rename(stagingPath, targetPath);
          } catch (error) {
            if (movedExisting) await rename(backupPath, targetPath);
            throw error;
          }
          if (movedExisting) {
            await rm(backupPath, { recursive: true, force: true }).catch(
              () => undefined
            );
          }
        } catch (error) {
          await rm(stagingPath, { recursive: true, force: true });
          throw error;
        }
      });
      mutationQueue = operation.then(
        () => undefined,
        () => undefined
      );
      await operation;
      return installedPackage as InstalledCampusmodPackage;
    },
    load,
    readFile: async (pluginId, relativePath) => {
      if (
        !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(pluginId) ||
        pluginId.startsWith("org.campusos.")
      ) {
        throw new Error("第三方插件 ID 无效。");
      }
      const normalizedPath = normalizeArchivePath(relativePath);
      if (
        normalizedPath.endsWith("/") ||
        normalizedPath === INSTALL_METADATA_PATH
      ) {
        throw new Error("插件文件路径无效。");
      }
      await mutationQueue;
      await ensureRecovered();
      const { entries } = await readVerifiedPackage(pluginId);
      const data = entries.get(normalizedPath);
      if (!data) throw new Error("插件文件不存在。");
      return data.slice();
    },
    uninstall: async (pluginId) => {
      if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(pluginId)) {
        throw new Error("插件 ID 无效。");
      }
      const operation = mutationQueue.then(async () => {
        await ensureRecovered();
        const targetPath = join(rootPath, pluginId);
        const trashPath = join(rootPath, `.trash-${randomUUID()}`);
        try {
          await rename(targetPath, trashPath);
        } catch (error) {
          if (isMissingPathError(error)) throw new Error("插件尚未安装。");
          throw error;
        }
        await rm(trashPath, { recursive: true, force: true });
      });
      mutationQueue = operation.then(
        () => undefined,
        () => undefined
      );
      await operation;
      return load();
    }
  };
};
