import type { CampusWorkspaceRecord, CampusosBridge } from "../../shared/campusBridge";

const resolveCampusosBridge = (): CampusosBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.campusos ?? null;
};

const requireCampusosBridge = (): CampusosBridge => {
  const bridge = resolveCampusosBridge();

  if (!bridge) {
    throw new Error("CampusOS 主进程连接不可用，无法读取或同步工作台数据。");
  }

  return bridge;
};

export const hydrateCampusWorkspaceRecord =
  async (): Promise<CampusWorkspaceRecord> => {
    return requireCampusosBridge().workspace.hydrate();
  };

export const syncCampusWorkspaceRecord =
  async (): Promise<CampusWorkspaceRecord> => {
    return requireCampusosBridge().workspace.sync();
  };
