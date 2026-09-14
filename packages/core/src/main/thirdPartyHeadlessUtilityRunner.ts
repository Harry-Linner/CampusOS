import { app, utilityProcess } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createThirdPartyHeadlessUtilityCoordinator,
  type SpawnedHeadlessUtility,
  type ThirdPartyHeadlessUtilityRunner
} from "./thirdPartyHeadlessUtilityCoordinator";

const currentDir = dirname(fileURLToPath(import.meta.url));

const spawnUtility = (): SpawnedHeadlessUtility => {
  const child = utilityProcess.fork(
    join(currentDir, "headlessSandboxHost.js"),
    [],
    {
      cwd: app.getPath("temp"),
      env: {
        NODE_ENV: app.isPackaged ? "production" : "development"
      },
      execArgv: [],
      serviceName: "CampusOS Third-Party Plugin Sandbox",
      stdio: "ignore"
    }
  );
  return {
    get pid() {
      return child.pid;
    },
    postMessage: (message) => child.postMessage(message),
    kill: () => child.kill(),
    onMessage: (listener) => {
      child.on("message", listener);
    },
    onExit: (listener) => {
      child.on("exit", listener);
    },
    onError: (listener) => {
      child.on("error", (type, location) => {
        listener(`${type}${location ? ` at ${location}` : ""}`);
      });
    }
  };
};

export const createElectronThirdPartyHeadlessUtilityRunner = (
): ThirdPartyHeadlessUtilityRunner => createThirdPartyHeadlessUtilityCoordinator({
  spawn: spawnUtility,
  getResidentSetBytes: (pid) => {
    const metric = app.getAppMetrics().find((candidate) => candidate.pid === pid);
    return metric ? metric.memory.workingSetSize * 1024 : undefined;
  }
});
