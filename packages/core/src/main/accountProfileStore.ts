import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isVerifiedAcademicCredentialPayload } from "./academicCredentialService";

interface ProfileIndex {
  version: 1;
  legacyOwner: string | null;
  active: { kind: "account" | "guest" | "local"; id: string };
}
export interface AccountIdentity { username: string; program?: string | null }
const accountId = (identity: AccountIdentity): string => createHash("sha256").update(`zju\0${identity.username.trim()}\0${identity.program ?? "undergraduate"}`).digest("hex");
const readJson = (path: string): unknown => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const isId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{64}$/.test(id);

// These are the pre-profile stores that can contain user-visible or account-scoped
// data. Chromium cache files and Electron lock files are deliberately excluded.
const legacyBusinessDataPaths = [
  "campusos.sqlite",
  "secure", "workspace", "notifications", "downloads", "settings", "diagnostics", "plugins",
  "Local Storage", "IndexedDB"
] as const;

const hasLegacyBusinessData = (root: string): boolean =>
  legacyBusinessDataPaths.some((path) => existsSync(join(root, path)));

/** Route the entire Electron profile before any database or browser session opens. */
export const createAccountProfileStore = (root: string) => {
  const indexPath = join(root, "account-profiles.json");
  const raw = readJson(indexPath) as ProfileIndex | null;
  if (raw && (raw.version !== 1 || (raw.legacyOwner !== null && !isId(raw.legacyOwner)) || !raw.active || !["account", "guest", "local"].includes(raw.active.kind) || !isId(raw.active.id))) {
    throw new Error("账号数据目录索引损坏，已停止加载，避免显示错误账号的数据。");
  }
  let index: ProfileIndex | null = raw;
  const save = (next: ProfileIndex): void => {
    mkdirSync(root, { recursive: true });
    const temporary = `${indexPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, indexPath);
    index = next;
  };
  // Bind the existing development/install profile without moving or deleting data.
  if (!index) {
    const credential = readJson(join(root, "secure", "academic-affairs.json")) as { username?: unknown; program?: unknown } | null;
    if (credential && typeof credential.username === "string" && credential.username.trim()) {
      const id = accountId({ username: credential.username, program: typeof credential.program === "string" ? credential.program : null });
      save({ version: 1, legacyOwner: id, active: isVerifiedAcademicCredentialPayload(credential) ? { kind: "account", id } : { kind: "guest", id: createHash("sha256").update(randomUUID()).digest("hex") } });
    } else {
      // Unowned data from the old logout implementation stays archived at root.
      // Only a genuinely new local workspace can be bound on first connection.
      save({ version: 1, legacyOwner: null, active: { kind: hasLegacyBusinessData(root) ? "guest" : "local", id: createHash("sha256").update(randomUUID()).digest("hex") } });
    }
  }
  const directoryFor = (id: string): string => index?.legacyOwner === id ? root : join(root, "account-profiles", id);
  if (index?.active.kind === "account") {
    const credential = readJson(join(directoryFor(index.active.id), "secure", "academic-affairs.json")) as { username?: unknown; program?: unknown } | null;
    if (!isVerifiedAcademicCredentialPayload(credential) || accountId(credential) !== index.active.id) {
      save({ ...index, active: { kind: "guest", id: createHash("sha256").update(randomUUID()).digest("hex") } });
    }
  }
  const currentDirectory = (): string => !index || index.active.kind === "local" ? root : index.active.kind === "account" ? directoryFor(index.active.id) : join(root, "account-profiles", `signed-out-${index.active.id}`);
  const initialDirectory = currentDirectory();
  mkdirSync(initialDirectory, { recursive: true });
  return {
    directory: initialDirectory,
    signedOut: index?.active.kind === "guest",
    credentialPath(identity: AccountIdentity): string {
      const id = accountId(identity);
      return join(!index || index.active.kind === "local" ? root : directoryFor(id), "secure", "academic-affairs.json");
    },
    activate(identity: AccountIdentity): boolean {
      const id = accountId(identity);
      save({ version: 1, legacyOwner: !index || index.active.kind === "local" ? id : index.legacyOwner, active: { kind: "account", id } });
      return currentDirectory() !== initialDirectory;
    },
    signOut(): void {
      // A new empty guest profile prevents old onboarding/search/browser state resurfacing.
      save({ version: 1, legacyOwner: index?.legacyOwner ?? null, active: { kind: "guest", id: createHash("sha256").update(randomUUID()).digest("hex") } });
    }
  };
};

export type AccountProfileStore = ReturnType<typeof createAccountProfileStore>;
