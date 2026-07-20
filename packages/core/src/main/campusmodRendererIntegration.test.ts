import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { getSandboxedRendererExecutionIssue } from "@campusos/shared";
import { createCampusmodPackageRegistry } from "./campusmodPackageRegistry";
import { createCampusmodRendererProtocolHandler } from "./campusmodRendererProtocolPolicy";
import { createPluginRuntimeRepository } from "./pluginRuntimeRepository";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "campusos-renderer-e2e-"));
  temporaryDirectories.push(path);
  return path;
};

const manifest = {
  id: "dev.example.hello",
  name: "hello",
  displayName: "Hello CampusOS",
  version: "1.0.0",
  apiVersion: 2,
  kind: "feature",
  description: "Renderer sandbox integration fixture.",
  icon: "Box",
  permissions: ["storage:local"],
  sourceScope: ["local"],
  releaseStage: "ready",
  provides: [],
  requires: [],
  optionalRequires: [],
  contributes: {
    views: [{
      id: "hello-main",
      title: "Hello",
      icon: "Box",
      location: "activity",
      activityTarget: "mod-dev-example-hello"
    }]
  },
  entrypoints: {
    renderer: "dist/renderer.js"
  }
} as const;

const rendererSource = `export const mount = (root, context) => {
  root.textContent = "mounted:" + context.apiVersion + ":" + context.pluginId;
  return () => { root.textContent = "disposed"; };
};`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("campusmod renderer installation-to-mount integration", () => {
  it("installs, grants, activates, serves and mounts a real package entrypoint", async () => {
    const workspace = await createTemporaryDirectory();
    const sourcePath = join(workspace, "hello.campusmod");
    const registry = createCampusmodPackageRegistry({
      rootPath: join(workspace, "installed")
    });
    await writeFile(sourcePath, zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "dist/renderer.js": strToU8(rendererSource)
    }));

    const inspection = await registry.inspect(sourcePath);
    await registry.install(inspection.token);

    const runtime = createPluginRuntimeRepository({
      storagePath: join(workspace, "runtime-state.json"),
      loadManifests: async () => (await registry.load()).packages.map(
        (installedPackage) => installedPackage.manifest
      ),
      coreCapabilities: [],
      isEnabledByDefault: () => false,
      canEnable: getSandboxedRendererExecutionIssue
    });
    await runtime.configure({
      pluginId: manifest.id,
      enabled: true,
      grantedPermissions: ["storage:local"]
    });

    const handler = createCampusmodRendererProtocolHandler({
      loadRuntime: runtime.load,
      loadPackages: registry.load,
      readPackageFile: registry.readFile
    });
    const page = await handler({
      method: "GET",
      url: `campusmod://${manifest.id}/`
    });
    const bootstrap = await handler({
      method: "GET",
      url: `campusmod://${manifest.id}/__campusos__/bootstrap.js`
    });
    const entrypoint = await handler({
      method: "GET",
      url: `campusmod://${manifest.id}/dist/renderer.js`
    });

    expect(page.status).toBe(200);
    expect(await bootstrap.text()).toContain(
      'await import("/dist/renderer.js")'
    );
    expect(entrypoint.status).toBe(200);
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(
      await entrypoint.text(),
      "utf8"
    ).toString("base64")}`;
    const pluginModule = await import(moduleUrl) as {
      mount: (
        root: { textContent: string },
        context: { apiVersion: number; pluginId: string }
      ) => () => void;
    };
    const root = { textContent: "" };
    const dispose = pluginModule.mount(root, {
      apiVersion: 1,
      pluginId: manifest.id
    });

    expect(root.textContent).toBe("mounted:1:dev.example.hello");
    dispose();
    expect(root.textContent).toBe("disposed");
    expect((await runtime.load()).plugins[0]).toMatchObject({
      id: manifest.id,
      enabled: true,
      status: "active",
      grantedPermissions: ["storage:local"]
    });
  });
});
