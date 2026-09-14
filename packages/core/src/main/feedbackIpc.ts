import { shell } from "electron";
import { registerTrustedIpcHandler } from "./trustedIpc";

const FEEDBACK_URL = "https://github.com/Harry-Linner/CampusOS/issues/new?template=bug_report.md";

export const registerFeedbackHandlers = (): void => {
  registerTrustedIpcHandler("campusos:feedback:open", async () => {
    const url = new URL(FEEDBACK_URL);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== "/Harry-Linner/CampusOS/issues/new") {
      throw new Error("反馈入口地址不受信任。");
    }
    await shell.openExternal(url.toString());
  });
};
