import { protocol, session } from "electron";
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

  protocol.handle(CAMPUSMOD_RENDERER_SCHEME, (request) => handler({
    method: request.method,
    url: request.url
  }));

  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
};
