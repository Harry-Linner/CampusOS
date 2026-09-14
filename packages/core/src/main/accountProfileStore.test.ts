import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createAccountProfileStore } from "./accountProfileStore";

const roots: string[] = [];
const root = () => { const path = mkdtempSync(join(tmpdir(), "campusos-accounts-")); roots.push(path); return path; };
const a = { username: "test-account-a", program: "undergraduate" };
const b = { username: "test-account-b", program: "undergraduate" };
const credential = (identity: typeof a) => {
  const now = new Date().toISOString();
  return { ...identity, dataVersion: 4, encryptedPassword: "fixture", savedAt: now, verifiedAt: now,
    provider: "zju-unified-auth", verifiedService: "undergraduate-academic-affairs",
    authenticatedProfile: { source: "zju-quality-development", studentId: identity.username, fetchedAt: now, secondClassPoints: 0, thirdClassPoints: 0, fourthClassPoints: 0 } };
};
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("account profile isolation", () => {
  it("retains the legacy workspace and restores it only when A is selected again", () => {
    const base = root();
    mkdirSync(join(base, "secure"));
    writeFileSync(join(base, "secure", "academic-affairs.json"), JSON.stringify(credential(a)));
    writeFileSync(join(base, "retained-data.txt"), "account A data");
    const session = createAccountProfileStore(base);
    expect(session.directory).toBe(base);
    session.signOut();
    const guest = createAccountProfileStore(base);
    expect(guest.signedOut).toBe(true);
    expect(guest.directory).not.toBe(base);
    expect(guest.credentialPath(b)).not.toContain(guest.directory);
    mkdirSync(dirname(guest.credentialPath(b)), { recursive: true });
    writeFileSync(guest.credentialPath(b), JSON.stringify(credential(b)));
    expect(guest.activate(b)).toBe(true);
    const accountB = createAccountProfileStore(base);
    expect(accountB.signedOut).toBe(false);
    expect(accountB.directory).not.toBe(base);
    accountB.signOut();
    const guestAgain = createAccountProfileStore(base);
    expect(guestAgain.directory).not.toBe(guest.directory);
    expect(guestAgain.activate(a)).toBe(true);
    expect(createAccountProfileStore(base).directory).toBe(base);
    expect(readFileSync(join(base, "retained-data.txt"), "utf8")).toBe("account A data");
  });

  it("never overwrites A's credential when connecting B directly", () => {
    const base = root();
    const profile = createAccountProfileStore(base);
    expect(profile.activate(a)).toBe(false);
    expect(profile.credentialPath(a)).toBe(join(base, "secure", "academic-affairs.json"));
    expect(profile.credentialPath(b)).not.toBe(profile.credentialPath(a));
    expect(profile.activate(b)).toBe(true);
    expect(readFileSync(join(base, "account-profiles.json"), "utf8")).not.toContain(a.username);
  });

  it("keeps same-account reauthentication in the current profile", () => {
    const base = root();
    const profile = createAccountProfileStore(base);
    profile.activate(a);
    mkdirSync(join(base, "secure"));
    writeFileSync(join(base, "secure", "academic-affairs.json"), JSON.stringify(credential(a)));
    expect(createAccountProfileStore(base).activate(a)).toBe(false);
  });

  it("hides legacy data whose credential was already cleared, without deleting it", () => {
    const base = root();
    writeFileSync(join(base, "campusos.sqlite"), "retained legacy fixture");
    const profile = createAccountProfileStore(base);
    expect(profile.signedOut).toBe(true);
    expect(profile.directory).not.toBe(base);
    expect(profile.credentialPath(b)).not.toBe(join(base, "secure", "academic-affairs.json"));
    expect(readFileSync(join(base, "campusos.sqlite"), "utf8")).toBe("retained legacy fixture");
  });

  it("treats legacy workspace and notification files as owned data", () => {
    const base = root();
    mkdirSync(join(base, "workspace"));
    writeFileSync(join(base, "workspace", "campus-workspace.json"), "legacy workspace");
    mkdirSync(join(base, "notifications"));
    writeFileSync(join(base, "notifications", "notifications.json"), "[]");
    const profile = createAccountProfileStore(base);
    expect(profile.signedOut).toBe(true);
    expect(profile.directory).not.toBe(base);
    expect(readFileSync(join(base, "workspace", "campus-workspace.json"), "utf8")).toBe("legacy workspace");
  });

  it("rejects malformed or path-traversing profile indexes instead of loading old data", () => {
    const base = root();
    writeFileSync(join(base, "account-profiles.json"), JSON.stringify({ version: 1, legacyOwner: null, active: { kind: "account", id: "../../outside" } }));
    expect(() => createAccountProfileStore(base)).toThrow(/索引损坏/);
  });
});
