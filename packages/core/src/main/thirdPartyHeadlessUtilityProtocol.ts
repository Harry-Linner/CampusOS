import type { ThirdPartyHeadlessSandboxRequest } from "./thirdPartyHeadlessSandbox";

export const HEADLESS_UTILITY_PROTOCOL_VERSION = 1;

export interface HeadlessUtilityReadyMessage {
  kind: "ready";
  protocolVersion: typeof HEADLESS_UTILITY_PROTOCOL_VERSION;
}

export interface HeadlessUtilityRunMessage {
  kind: "run";
  protocolVersion: typeof HEADLESS_UTILITY_PROTOCOL_VERSION;
  requestId: string;
  request: ThirdPartyHeadlessSandboxRequest;
}

export interface HeadlessUtilitySuccessMessage {
  kind: "result";
  protocolVersion: typeof HEADLESS_UTILITY_PROTOCOL_VERSION;
  requestId: string;
  ok: true;
  output: unknown;
}

export interface HeadlessUtilityFailureMessage {
  kind: "result";
  protocolVersion: typeof HEADLESS_UTILITY_PROTOCOL_VERSION;
  requestId: string;
  ok: false;
  error: string;
}

export type HeadlessUtilityResultMessage =
  | HeadlessUtilitySuccessMessage
  | HeadlessUtilityFailureMessage;

const requestIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const pluginIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean => Object.keys(value).every((key) => keys.includes(key));

const isLimits = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "executionTimeMs",
    "memoryLimitBytes",
    "maxInputBytes",
    "maxOutputBytes",
    "maxSourceBytes",
    "stackLimitBytes"
  ])) return false;
  return Object.values(value).every(
    (limit) => typeof limit === "number" && Number.isFinite(limit)
  );
};

export const isHeadlessUtilityReadyMessage = (
  value: unknown
): value is HeadlessUtilityReadyMessage => isRecord(value) &&
  hasOnlyKeys(value, ["kind", "protocolVersion"]) &&
  value.kind === "ready" &&
  value.protocolVersion === HEADLESS_UTILITY_PROTOCOL_VERSION;

export const parseHeadlessUtilityRunMessage = (
  value: unknown
): HeadlessUtilityRunMessage | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["kind", "protocolVersion", "requestId", "request"]) ||
    value.kind !== "run" ||
    value.protocolVersion !== HEADLESS_UTILITY_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !requestIdPattern.test(value.requestId) ||
    !isRecord(value.request) ||
    !hasOnlyKeys(value.request, ["pluginId", "source", "input", "limits"]) ||
    typeof value.request.pluginId !== "string" ||
    !pluginIdPattern.test(value.request.pluginId) ||
    value.request.pluginId.startsWith("org.campusos.") ||
    typeof value.request.source !== "string" ||
    !("input" in value.request) ||
    !isLimits(value.request.limits)
  ) return null;

  return value as unknown as HeadlessUtilityRunMessage;
};

export const parseHeadlessUtilityResultMessage = (
  value: unknown
): HeadlessUtilityResultMessage | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "kind",
      "protocolVersion",
      "requestId",
      "ok",
      ...(value.ok === true ? ["output"] : ["error"])
    ]) ||
    value.kind !== "result" ||
    value.protocolVersion !== HEADLESS_UTILITY_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !requestIdPattern.test(value.requestId)
  ) return null;

  if (value.ok === true && "output" in value) {
    return value as unknown as HeadlessUtilitySuccessMessage;
  }
  if (
    value.ok === false &&
    typeof value.error === "string" &&
    value.error.length > 0 &&
    value.error.length <= 500
  ) {
    return value as unknown as HeadlessUtilityFailureMessage;
  }
  return null;
};
