/**
 * Campusmod archive path safety (Core, main).
 *
 * Split out of campusmodPackageRegistry.ts in batch 19 of the ADR-0006 program.
 * Every archive entry name passes through `normalizeArchivePath` before it is
 * written to disk; the directory-name patterns identify this registry's own
 * staging, trash and backup directories. Pure string work - no filesystem, no
 * package types.
 */
import { createHash } from "node:crypto";

export const sha256 = (data: Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const uuidPathPattern = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
export const stagingDirectoryPattern = new RegExp(`^\\.staging-${uuidPathPattern}$`, "i");
export const trashDirectoryPattern = new RegExp(`^\\.trash-${uuidPathPattern}$`, "i");
export const backupDirectoryPattern = new RegExp(
  `^\\.backup-([a-z][a-z0-9]*(?:[.-][a-z0-9]+)+)-${uuidPathPattern}$`,
  "i"
);

export const normalizeArchivePath = (value: string): string => {
  if (
    value.length === 0 ||
    value.length > 240 ||
    value !== value.normalize("NFC") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    [...value].some((character) => character.charCodeAt(0) <= 31) ||
    /[<>:"|?*]/.test(value)
  ) {
    throw new Error(`插件包包含不安全路径：${value || "<empty>"}`);
  }

  const directory = value.endsWith("/");
  const path = directory ? value.slice(0, -1) : value;
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        windowsReservedName.test(segment)
    )
  ) {
    throw new Error(`插件包包含不安全路径：${value}`);
  }

  return directory ? `${segments.join("/")}/` : segments.join("/");
};
