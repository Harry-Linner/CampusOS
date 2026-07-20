import type { IpcMainInvokeEvent } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));

const isTrustedDevelopmentUrl = (senderUrl: URL): boolean => {
  const configuredUrl = process.env.ELECTRON_RENDERER_URL;
  if (!configuredUrl) return false;

  try {
    const expectedUrl = new URL(configuredUrl);
    return (
      senderUrl.origin === expectedUrl.origin &&
      senderUrl.pathname === expectedUrl.pathname
    );
  } catch {
    return false;
  }
};

const isTrustedPackagedUrl = (senderUrl: URL): boolean => {
  if (
    senderUrl.protocol !== "file:" ||
    senderUrl.search !== "" ||
    senderUrl.hash !== ""
  ) return false;

  const expectedPath = resolve(
    currentDir,
    "..",
    "renderer",
    "index.html"
  );
  try {
    return resolve(fileURLToPath(senderUrl)) === expectedPath;
  } catch {
    return false;
  }
};

export const assertTrustedRenderer = (event: IpcMainInvokeEvent): void => {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) {
    throw new Error("Credential request rejected from an untrusted frame.");
  }

  let senderUrl: URL;
  try {
    senderUrl = new URL(frame.url);
  } catch {
    throw new Error("Credential request rejected from an invalid origin.");
  }

  if (
    !isTrustedDevelopmentUrl(senderUrl) &&
    !isTrustedPackagedUrl(senderUrl)
  ) {
    throw new Error("Credential request rejected from an untrusted origin.");
  }
};
