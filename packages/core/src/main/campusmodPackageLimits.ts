/**
 * Campusmod package limits (Core, main).
 *
 * Split out of campusmodPackageRegistry.ts so
 * the archive unpacker and the registry enforce the same numbers.
 */

export interface CampusmodPackageLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxFileBytes: number;
  maxUnpackedBytes: number;
  maxManifestBytes: number;
}

export const defaultLimits: CampusmodPackageLimits = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxEntries: 256,
  maxFileBytes: 5 * 1024 * 1024,
  maxUnpackedBytes: 30 * 1024 * 1024,
  maxManifestBytes: 256 * 1024
};
