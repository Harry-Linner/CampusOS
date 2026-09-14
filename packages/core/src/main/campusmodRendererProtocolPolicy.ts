import {
  getSandboxedRendererExecutionIssue,
  type PluginRuntimeSnapshot
} from "@campusos/shared";
import type { CampusmodRegistrySnapshot } from "./campusmodPackageRegistry";

export const CAMPUSMOD_RENDERER_SCHEME = "campusmod";

const SANDBOX_INDEX_PATH = "__campusos__/index.html";
const SANDBOX_BOOTSTRAP_PATH = "__campusos__/bootstrap.js";
const thirdPartyPluginIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

const responseHeaders = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; "),
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
});

interface CampusmodProtocolRequest {
  method: string;
  url: string;
}

export interface CampusmodRendererProtocolDependencies {
  loadRuntime: () => Promise<PluginRuntimeSnapshot>;
  loadPackages: () => Promise<CampusmodRegistrySnapshot>;
  readPackageFile: (
    pluginId: string,
    relativePath: string
  ) => Promise<Uint8Array>;
}

const createResponse = (
  body: BodyInit | null,
  status: number,
  contentType: string
): Response => new Response(body, {
  status,
  headers: {
    ...responseHeaders,
    "Content-Type": contentType
  }
});

const textResponse = (message: string, status: number): Response =>
  createResponse(message, status, "text/plain; charset=utf-8");

const resolveContentType = (path: string): string => {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const types: Record<string, string> = {
    css: "text/css; charset=utf-8",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2"
  };
  return types[extension] ?? "application/octet-stream";
};

const createSandboxHtml = (): string => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CampusOS 隔离插件</title>
    <style>
      :root { color-scheme: light; font-family: sans-serif; background: #f7f5ef; color: #18211d; }
      * { box-sizing: border-box; }
      html, body, #campusmod-root { min-height: 100%; margin: 0; }
      body { padding: 24px; }
      .campusmod-error { border: 1px solid #c86b68; background: #fff4f3; padding: 14px; color: #983b38; }
    </style>
  </head>
  <body>
    <main id="campusmod-root"></main>
    <script type="module" src="/${SANDBOX_BOOTSTRAP_PATH}"></script>
  </body>
</html>`;

const createBootstrapScript = (
  pluginId: string,
  rendererEntrypoint: string
): string => `const root = document.getElementById("campusmod-root");
const showError = () => {
  root.className = "campusmod-error";
  root.textContent = "插件视图启动失败。请停用插件并检查安装包。";
};

try {
  const pluginModule = await import(${JSON.stringify(`/${rendererEntrypoint}`)});
  if (typeof pluginModule.mount !== "function") {
    throw new TypeError("Sandboxed renderer entrypoint must export mount().");
  }
  const dispose = await pluginModule.mount(root, Object.freeze({
    apiVersion: 1,
    pluginId: ${JSON.stringify(pluginId)}
  }));
  if (dispose !== undefined && typeof dispose !== "function") {
    throw new TypeError("mount() must return a dispose function or undefined.");
  }
  if (typeof dispose === "function") {
    window.addEventListener("pagehide", () => {
      try { dispose(); } catch { /* The sandbox is being discarded. */ }
    }, { once: true });
  }
} catch (error) {
  console.error("CampusOS sandboxed plugin failed to mount.", error);
  showError();
}`;

const parseRequest = (request: CampusmodProtocolRequest): {
  pluginId: string;
  relativePath: string;
} | null => {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  try {
    const url = new URL(request.url);
    if (
      url.protocol !== `${CAMPUSMOD_RENDERER_SCHEME}:` ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !thirdPartyPluginIdPattern.test(url.hostname) ||
      url.hostname.startsWith("org.campusos.")
    ) {
      return null;
    }
    const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (relativePath.includes("\\") || relativePath.split("/").includes("..")) {
      return null;
    }
    return {
      pluginId: url.hostname,
      relativePath: relativePath || SANDBOX_INDEX_PATH
    };
  } catch {
    return null;
  }
};

export const createCampusmodRendererProtocolHandler = (
  dependencies: CampusmodRendererProtocolDependencies
) => async (request: CampusmodProtocolRequest): Promise<Response> => {
  const parsed = parseRequest(request);
  if (!parsed) return textResponse("Bad request", 400);

  const [runtime, registry] = await Promise.all([
    dependencies.loadRuntime(),
    dependencies.loadPackages()
  ]);
  const runtimeRecord = runtime.plugins.find(
    (plugin) => plugin.id === parsed.pluginId
  );
  const installedPackage = registry.packages.find(
    (plugin) => plugin.manifest.id === parsed.pluginId
  );
  if (
    !runtimeRecord ||
    runtimeRecord.status !== "active" ||
    !installedPackage ||
    getSandboxedRendererExecutionIssue(installedPackage.manifest) !== null ||
    !installedPackage.entrypoints.renderer
  ) {
    return textResponse("Plugin is not active", 403);
  }

  let body: BodyInit;
  let contentType: string;
  if (parsed.relativePath === SANDBOX_INDEX_PATH) {
    body = createSandboxHtml();
    contentType = "text/html; charset=utf-8";
  } else if (parsed.relativePath === SANDBOX_BOOTSTRAP_PATH) {
    body = createBootstrapScript(
      parsed.pluginId,
      installedPackage.entrypoints.renderer
    );
    contentType = "text/javascript; charset=utf-8";
  } else {
    try {
      const fileBytes = await dependencies.readPackageFile(
        parsed.pluginId,
        parsed.relativePath
      );
      const fileBody = new ArrayBuffer(fileBytes.byteLength);
      new Uint8Array(fileBody).set(fileBytes);
      body = fileBody;
    } catch {
      return textResponse("Plugin resource was not found", 404);
    }
    contentType = resolveContentType(parsed.relativePath);
  }

  return createResponse(
    request.method === "HEAD" ? null : body,
    200,
    contentType
  );
};
