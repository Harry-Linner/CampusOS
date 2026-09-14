import { protocol } from "electron";
import { getAccountBrowserSession } from "./accountBrowserSession";
import { getOfficialPluginRuntimeService } from "./officialPluginRuntimeService";
import {
  CAMPUSMOD_RENDERER_SCHEME,
  createCampusmodRendererProtocolHandler
} from "./campusmodRendererProtocolPolicy";

export const registerCampusmodRendererScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CAMPUSMOD_RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true
      }
    }
  ]);
};

export const registerCampusmodRendererProtocol = (): void => {
  const runtime = getOfficialPluginRuntimeService();
  const handler = createCampusmodRendererProtocolHandler({
    loadRuntime: () => runtime.load(),
    loadPackages: () => runtime.loadPackages(),
    readPackageFile: (pluginId, relativePath) =>
      runtime.readPackageFile(pluginId, relativePath)
  });

  const browserSession = getAccountBrowserSession();
  browserSession.protocol.handle(CAMPUSMOD_RENDERER_SCHEME, (request) => handler({
    method: request.method,
    url: request.url
  }));

  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
};
