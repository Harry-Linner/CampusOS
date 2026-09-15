/**
 * Campusmod archive unpacking (Core, main).
 *
 * Split out of campusmodPackageRegistry.ts.
 * Reads a zip archive into an in-memory entry map while enforcing entry count,
 * per-file and total unpacked limits, rejecting duplicate and case-colliding
 * entry names, unsupported compression methods and file/directory path clashes.
 */
import {
  Unzip,
  UnzipInflate,
  UnzipPassThrough,
  type UnzipFile
} from "fflate";
import { normalizeArchivePath } from "./campusmodArchivePaths";
import type { CampusmodPackageLimits } from "./campusmodPackageLimits";

export const unpackArchive = async (
  archive: Uint8Array,
  limits: CampusmodPackageLimits
): Promise<Map<string, Uint8Array>> => new Promise((resolve, reject) => {
  const entries = new Map<string, Uint8Array>();
  const names = new Set<string>();
  const portableNames = new Set<string>();
  const activeFiles = new Set<UnzipFile>();
  let entryCount = 0;
  let unpackedSize = 0;
  let pendingFiles = 0;
  let parsingFinished = false;
  let settled = false;

  const terminate = (): void => {
    for (const file of activeFiles) file.terminate();
    activeFiles.clear();
  };
  const fail = (error: unknown): void => {
    if (settled) return;
    settled = true;
    terminate();
    reject(error instanceof Error ? error : new Error("插件包解压失败。"));
  };
  const finishIfReady = (): void => {
    if (settled || !parsingFinished || pendingFiles !== 0) return;
    for (const path of entries.keys()) {
      const segments = path.split("/");
      for (let index = 1; index < segments.length; index += 1) {
        const parentPath = segments.slice(0, index).join("/");
        if (entries.has(parentPath)) {
          fail(new Error(`插件包路径同时作为文件和目录：${parentPath}`));
          return;
        }
      }
    }
    settled = true;
    resolve(entries);
  };

  const unzipper = new Unzip((file) => {
    try {
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        throw new Error("插件包文件数量超过限制。");
      }

      const name = normalizeArchivePath(file.name);
      if (names.has(name)) {
        throw new Error(`插件包包含重复路径：${name}`);
      }
      names.add(name);
      const portableName = name.replace(/\/$/, "").toLowerCase();
      if (portableNames.has(portableName)) {
        throw new Error(`插件包包含大小写冲突路径：${name}`);
      }
      portableNames.add(portableName);

      if (file.compression !== 0 && file.compression !== 8) {
        throw new Error(`插件包使用了不支持的压缩算法：${file.compression}`);
      }
      if (
        typeof file.originalSize === "number" &&
        file.originalSize > limits.maxFileBytes
      ) {
        throw new Error(`插件包文件超过大小限制：${name}`);
      }

      const chunks: Uint8Array[] = [];
      let fileSize = 0;
      pendingFiles += 1;
      activeFiles.add(file);
      file.ondata = (error, chunk, final) => {
        if (error) {
          fail(error);
          return;
        }
        if (settled) return;

        fileSize += chunk.length;
        unpackedSize += chunk.length;
        if (fileSize > limits.maxFileBytes) {
          fail(new Error(`插件包文件超过大小限制：${name}`));
          return;
        }
        if (unpackedSize > limits.maxUnpackedBytes) {
          fail(new Error("插件包解压后总大小超过限制。"));
          return;
        }
        if (chunk.length > 0) chunks.push(chunk);

        if (final) {
          activeFiles.delete(file);
          pendingFiles -= 1;
          if (!name.endsWith("/")) {
            const data = new Uint8Array(fileSize);
            let offset = 0;
            for (const part of chunks) {
              data.set(part, offset);
              offset += part.length;
            }
            entries.set(name, data);
          }
          finishIfReady();
        }
      };
      file.start();
    } catch (error) {
      fail(error);
    }
  });
  unzipper.register(UnzipPassThrough);
  unzipper.register(UnzipInflate);

  try {
    unzipper.push(archive, true);
    parsingFinished = true;
    finishIfReady();
  } catch (error) {
    fail(error);
  }
});
