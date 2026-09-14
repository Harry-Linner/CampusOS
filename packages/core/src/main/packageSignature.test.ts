import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeSha256,
  generateEd25519KeyPair,
  signPackageContent,
  verifyPackageContent
} from "./packageSignature";

describe("packageSignature", () => {
  it("signs and verifies content correctly", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const content = Buffer.from("test package content");

    const metadata = signPackageContent(content, privateKey);

    expect(metadata.sha256).toBe(computeSha256(content));
    expect(metadata.signature).toBeTruthy();
    expect(metadata.publicKey).toBe(publicKey.toString("base64url"));

    const result = verifyPackageContent(content, metadata);
    expect(result.valid).toBe(true);
  });

  it("rejects tampered content", () => {
    const { privateKey } = generateEd25519KeyPair();
    const content = Buffer.from("original content");
    const tampered = Buffer.from("tampered content");

    const metadata = signPackageContent(content, privateKey);
    const result = verifyPackageContent(tampered, metadata);

    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects content signed by a different key", () => {
    const { privateKey: key1 } = generateEd25519KeyPair();
    const { privateKey: key2 } = generateEd25519KeyPair();
    const content = Buffer.from("content");

    const meta1 = signPackageContent(content, key1);
    const meta2 = signPackageContent(content, key2);

    // Swap the signature
    const crossed = { ...meta1, signature: meta2.signature };
    const result = verifyPackageContent(content, crossed);
    expect(result.valid).toBe(false);
  });

  it("produces deterministic SHA-256", () => {
    const content = randomBytes(1024);
    expect(computeSha256(content)).toBe(computeSha256(content));
  });

  it("fails with corrupted public key", () => {
    const { privateKey } = generateEd25519KeyPair();
    const content = Buffer.from("test");
    const metadata = signPackageContent(content, privateKey);

    const bad = {
      ...metadata,
      publicKey: "not-a-valid-key"
    };
    const result = verifyPackageContent(content, bad);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("异常");
  });
});
