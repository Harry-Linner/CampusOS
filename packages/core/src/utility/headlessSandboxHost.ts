import { runThirdPartyHeadlessSandbox } from "../main/thirdPartyHeadlessSandbox";
import {
  HEADLESS_UTILITY_PROTOCOL_VERSION,
  parseHeadlessUtilityRunMessage,
  type HeadlessUtilityFailureMessage,
  type HeadlessUtilitySuccessMessage
} from "../main/thirdPartyHeadlessUtilityProtocol";

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error("CampusOS headless sandbox host requires a utility parent port.");
}

let handled = false;
parentPort.on("message", (event) => {
  const message = parseHeadlessUtilityRunMessage(event.data);
  if (handled || !message) {
    if (message) {
      const response: HeadlessUtilityFailureMessage = {
        kind: "result",
        protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION,
        requestId: message.requestId,
        ok: false,
        error: handled
          ? "第三方 headless utility 每次只接受一个请求。"
          : "第三方 headless utility 请求无效。"
      };
      parentPort.postMessage(response);
    }
    return;
  }
  handled = true;
  void runThirdPartyHeadlessSandbox(message.request).then(
    (output) => {
      const response: HeadlessUtilitySuccessMessage = {
        kind: "result",
        protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION,
        requestId: message.requestId,
        ok: true,
        output
      };
      parentPort.postMessage(response);
    },
    (error: unknown) => {
      const response: HeadlessUtilityFailureMessage = {
        kind: "result",
        protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION,
        requestId: message.requestId,
        ok: false,
        error: (
          error instanceof Error
            ? error.message
            : "第三方 headless utility 执行失败。"
        ).slice(0, 500)
      };
      parentPort.postMessage(response);
    }
  );
});

parentPort.postMessage({
  kind: "ready",
  protocolVersion: HEADLESS_UTILITY_PROTOCOL_VERSION
});
