import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { assertTrustedRenderer } from "./ipcSecurity";

/** 通道的信任策略：不满足条件时抛错，满足则正常返回。 */
export type IpcTrustPolicy = (event: IpcMainInvokeEvent) => void;

/**
 * Registers an invokable IPC channel that only the trusted CampusOS renderer can
 * reach. Keeping the trust check on the registration path means a new
 * channel cannot be added without it, and handlers stop repeating
 * `assertTrustedRenderer(event)` as their first statement.
 *
 * Handlers receive the invocation payload only. The event is deliberately not
 * forwarded: callers that need the sender register through
 * `registerWindowIpcHandler` below, where the policy is explicit.
 */
export const registerTrustedIpcHandler = <TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => TResult | Promise<TResult>
): void => {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    assertTrustedRenderer(event);
    return await handler(...(args as TArgs));
  });
};

/**
 * Registers a channel whose callers are a specific window rather than the main
 * renderer (desk calendar, desktop pet). The caller supplies its frame policy,
 * so the check still lives on the registration path - a new channel cannot ship
 * without one - and the event is forwarded because those hosts track the sender.
 *
 * The policy runs before the handler, exactly as the hosts' local wrappers did.
 * This wrapper stays synchronous on purpose: both hosts originally threw the
 * policy violation synchronously, and their tests assert that timing.
 */
export const registerWindowIpcHandler = <TArgs extends unknown[], TResult>(
  channel: string,
  assertAllowed: IpcTrustPolicy,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void => {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    assertAllowed(event);
    return handler(event, ...(args as TArgs));
  });
};
