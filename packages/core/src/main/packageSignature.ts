import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";

export interface PackageSignatureMetadata {
  sha256: string;
  signature: string;
  publicKey: string;
}

const SIGNATURE_ENCODING: BufferEncoding = "base64url";
const KEY_ENCODING: BufferEncoding = "base64url";
const signingMetadataKeys = new Set([
  "contentHash",
  "developerSignature",
  "developerPublicKey"
]);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
};

/**
 * Produces the stable content a .campusmod author signs. The signature
 * metadata itself is deliberately excluded to avoid a circular archive
 * signature, while every executable/resource file remains covered by digest.
 */
export const createCampusmodSigningPayload = (
  manifest: Record<string, unknown>,
  entries: ReadonlyMap<string, Uint8Array>
): Buffer => {
  const unsignedManifest = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !signingMetadataKeys.has(key))
  );
  const files = [...entries]
    .filter(([path]) => path !== "manifest.json")
    .map(([path, content]) => ({ path, sha256: computeSha256(Buffer.from(content)) }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return Buffer.from(
    JSON.stringify(canonicalize({ version: 1, manifest: unsignedManifest, files })),
    "utf8"
  );
};

export const generateEd25519KeyPair = (): {
  publicKey: Buffer;
  privateKey: Buffer;
} =>
  generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
  });

export const computeSha256 = (buffer: Buffer): string =>
  createHash("sha256").update(buffer).digest("hex");

export const signPackageContent = (
  content: Buffer,
  privateKeyBuf: Buffer
): PackageSignatureMetadata => {
  const sha256 = computeSha256(content);
  const privateKey = createPrivateKey({
    key: privateKeyBuf,
    format: "der",
    type: "pkcs8"
  });
  const publicKey = createPublicKey(privateKey);

  const sigBuf = sign(null, content, privateKey);
  const signature = sigBuf.toString(SIGNATURE_ENCODING);
  const publicKeyStr = publicKey
    .export({ type: "spki", format: "der" })
    .toString(KEY_ENCODING) as string;

  return { sha256, signature, publicKey: publicKeyStr };
};

export const verifyPackageContent = (
  content: Buffer,
  metadata: PackageSignatureMetadata
): { valid: boolean; reason?: string } => {
  const expectedHash = computeSha256(content);
  if (metadata.sha256 !== expectedHash) {
    return { valid: false, reason: "包内容哈希与签名元数据不匹配。" };
  }

  try {
    const publicKey = createPublicKey({
      key: Buffer.from(metadata.publicKey, KEY_ENCODING),
      format: "der",
      type: "spki"
    });
    const sigBuf = Buffer.from(metadata.signature, SIGNATURE_ENCODING);
    const valid = verify(null, content, publicKey, sigBuf);
    if (!valid) {
      return { valid: false, reason: "Ed25519 签名验证失败。" };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason:
        error instanceof Error
          ? `签名验证异常：${error.message.slice(0, 200)}`
          : "签名验证异常。"
    };
  }
};
