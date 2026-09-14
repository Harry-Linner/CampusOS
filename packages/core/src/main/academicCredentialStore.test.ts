import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountProfileStore } from "./accountProfileStore";

const state = vi.hoisted(() => ({ directory: "", failAuth: false }));
vi.mock("electron", () => ({ app: { getPath: () => state.directory }, safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, "")
} }));
vi.mock("./trustedIpc", () => ({ registerTrustedIpcHandler: vi.fn() }));
vi.mock("./zjuUnifiedAuth", () => ({ createZjuUnifiedAuthClient: () => ({
  clearServiceSessions: vi.fn(),
  authenticate: async (input: { username: string; program: string }) => {
    if (state.failAuth) throw new Error("fixture authentication rejected");
    const now = new Date().toISOString();
    return { username: input.username, program: input.program, authenticatedAt: now,
      provider: "zju-unified-auth", verifiedService: "undergraduate-academic-affairs",
      authenticatedProfile: { source: "zju-quality-development", studentId: input.username, fetchedAt: now, secondClassPoints: 0, thirdClassPoints: 0, fourthClassPoints: 0 } };
  }
}) }));
import { clearAcademicCredentialRecord, connectAcademicCredentialRecord, readAcademicCredentialRecord, registerAcademicCredentialHandlers } from "./academicCredentialStore";

beforeEach(async () => { state.directory = await mkdtemp(join(tmpdir(), "campusos-credential-profile-")); state.failAuth = false; });
afterEach(async () => { registerAcademicCredentialHandlers(); await rm(state.directory, { recursive: true, force: true }); });

it("isolates authenticated credential writes and signs out without deleting workspace data", async () => {
  const profiles = createAccountProfileStore(state.directory);
  const changed = vi.fn();
  registerAcademicCredentialHandlers({ profiles, onProfileChange: changed });
  await connectAcademicCredentialRecord({ username: "fixture-a", password: "test-password", program: "undergraduate" });
  await writeFile(join(state.directory, "retained.txt"), "retained A data");
  const aCredential = await readFile(profiles.credentialPath({ username: "fixture-a" }), "utf8");
  await connectAcademicCredentialRecord({ username: "fixture-b", password: "test-password-b", program: "undergraduate" });
  expect(changed).toHaveBeenCalledOnce();
  expect((await readAcademicCredentialRecord()).username).toBe("fixture-a");
  expect(await readFile(join(state.directory, "secure", "academic-affairs.json"), "utf8")).toBe(aCredential);
  await clearAcademicCredentialRecord();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(createAccountProfileStore(state.directory).signedOut).toBe(true);
  expect(await readFile(join(state.directory, "retained.txt"), "utf8")).toBe("retained A data");
});

it("does not switch the workspace or write a credential when authentication fails", async () => {
  const profiles = createAccountProfileStore(state.directory);
  const changed = vi.fn();
  registerAcademicCredentialHandlers({ profiles, onProfileChange: changed });
  const before = await readFile(join(state.directory, "account-profiles.json"), "utf8");
  state.failAuth = true;
  await expect(connectAcademicCredentialRecord({ username: "fixture-b", password: "rejected", program: "undergraduate" })).rejects.toThrow("rejected");
  expect(changed).not.toHaveBeenCalled();
  expect(await readFile(join(state.directory, "account-profiles.json"), "utf8")).toBe(before);
});
