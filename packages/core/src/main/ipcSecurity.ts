import type { IpcMainInvokeEvent } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));

type TrustedRendererPage = "index.html" | "desk-calendar.html" | "desk-calendar-widget.html";

const isTrustedDevelopmentUrl = (
  senderUrl: URL,
  pages: readonly TrustedRendererPage[]
): boolean => {
  const configuredUrl = process.env.ELECTRON_RENDERER_URL;
  if (!configuredUrl) return false;

  try {
    const expectedUrl = new URL(configuredUrl);
    if (senderUrl.origin !== expectedUrl.origin) return false;
    return pages.some((page) => {
      const expectedPageUrl = page === "index.html"
        ? expectedUrl
        : new URL(page, expectedUrl);
      return senderUrl.pathname === expectedPageUrl.pathname;
    });
  } catch {
    return false;
  }
};

const isTrustedPackagedUrl = (
  senderUrl: URL,
  pages: readonly TrustedRendererPage[]
): boolean => {
  if (
    senderUrl.protocol !== "file:" ||
    senderUrl.search !== "" ||
    senderUrl.hash !== ""
  ) return false;

  try {
    const senderPath = resolve(fileURLToPath(senderUrl));
    return pages.some((page) => senderPath === resolve(
      currentDir,
      "..",
      "renderer",
      page
    ));
  } catch {
    return false;
  }
};

const assertTrustedPages = (
  event: IpcMainInvokeEvent,
  pages: readonly TrustedRendererPage[]
): void => {
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
    !isTrustedDevelopmentUrl(senderUrl, pages) &&
    !isTrustedPackagedUrl(senderUrl, pages)
  ) {
    throw new Error("Credential request rejected from an untrusted origin.");
  }
};

export const assertTrustedRenderer = (event: IpcMainInvokeEvent): void => {
  assertTrustedPages(event, ["index.html"]);
};

export const assertTrustedDeskCalendarCaller = (event: IpcMainInvokeEvent): void => {
  assertTrustedPages(event, ["index.html", "desk-calendar.html"]);
};

export const assertTrustedDeskCalendarWidgetCaller = (event: IpcMainInvokeEvent): void => {
  assertTrustedPages(event, ["desk-calendar-widget.html"]);
};
