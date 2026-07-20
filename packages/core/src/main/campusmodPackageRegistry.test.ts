import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createCampusmodPackageRegistry } from "./campusmodPackageRegistry";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "campusos-campusmod-"));
  temporaryDirectories.push(path);
  return path;
};

const createManifest = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: "dev.example.countdown",
  name: "countdown",
  displayName: "考试倒计时",
  version: "1.0.0",
  apiVersion: 2,
  kind: "feature",
  description: "显示考试倒计时。",
  icon: "计",
  permissions: ["storage:domain:countdown"],
  sourceScope: ["local"],
  releaseStage: "ready",
  provides: [],
  requires: [],
  optionalRequires: [],
  contributes: {
    commands: ["countdown.open"]
  },
  entrypoints: {
    main: "dist/main.js"
  },
  ...overrides
});

const createArchive = (
  manifest: Record<string, unknown> = createManifest(),
  extraEntries: Record<string, Uint8Array> = {}
): Uint8Array => zipSync({
  "manifest.json": strToU8(JSON.stringify(manifest)),
  "dist/main.js": strToU8("export const activate = () => ({ deactivate() {} });"),
  ...extraEntries
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("CampusmodPackageRegistry", () => {
  it("inspects, atomically installs, upgrades and loads a real campusmod archive", async () => {
    const workspace = await createTemporaryDirectory();
    const rootPath = join(workspace, "installed");
    const sourcePath = join(workspace, "countdown.campusmod");
    await writeFile(sourcePath, createArchive(createManifest(), {
      "assets/old.txt": strToU8("old")
    }));
    const registry = createCampusmodPackageRegistry({
      rootPath,
      now: () => new Date("2026-07-19T09:00:00.000Z")
    });

    const inspection = await registry.inspect(sourcePath);
    expect(inspection).toMatchObject({
      manifest: {
        id: "dev.example.countdown",
        version: "1.0.0"
      },
      entrypoints: { main: "dist/main.js" },
      signatureStatus: "unsigned"
    });
    expect(JSON.stringify(inspection)).not.toContain(sourcePath);
    expect(JSON.stringify(inspection)).not.toContain("activate");

    await expect(registry.install(inspection.token)).resolves.toMatchObject({
      manifest: { id: "dev.example.countdown" },
      installedAt: "2026-07-19T09:00:00.000Z",
      sourceFilename: "countdown.campusmod"
    });
    await expect(registry.install(inspection.token)).rejects.toThrow(
      "安装确认已失效"
    );
    await expect(readFile(
      join(rootPath, "dev.example.countdown", "dist", "main.js"),
      "utf8"
    )).resolves.toContain("activate");
    await expect(registry.readFile(
      "dev.example.countdown",
      "dist/main.js"
    )).resolves.toEqual(expect.any(Uint8Array));
    await expect(registry.readFile(
      "dev.example.countdown",
      "../manifest.json"
    )).rejects.toThrow("不安全路径");

    await writeFile(sourcePath, createArchive(createManifest({ version: "1.1.0" }), {
      "assets/new.txt": strToU8("new")
    }));
    const updateInspection = await registry.inspect(sourcePath);
    await registry.install(updateInspection.token);

    await expect(readFile(
      join(rootPath, "dev.example.countdown", "assets", "old.txt"),
      "utf8"
    )).rejects.toMatchObject({ code: "ENOENT" });
    await expect(registry.load()).resolves.toMatchObject({
      packages: [{
        manifest: { id: "dev.example.countdown", version: "1.1.0" },
        entrypoints: { main: "dist/main.js" }
      }],
      issues: []
    });
  });

  it("rejects traversal paths before writing any package directory", async () => {
    const workspace = await createTemporaryDirectory();
    const rootPath = join(workspace, "installed");
    const sourcePath = join(workspace, "unsafe.campusmod");
    await writeFile(sourcePath, createArchive(createManifest(), {
      "../escape.js": strToU8("escaped")
    }));
    const registry = createCampusmodPackageRegistry({ rootPath });

    await expect(registry.inspect(sourcePath)).rejects.toThrow("不安全路径");
    await expect(readFile(join(workspace, "escape.js"), "utf8")).rejects
      .toMatchObject({ code: "ENOENT" });
  });

  it("rejects case collisions and paths that use a file as a parent directory", async () => {
    const workspace = await createTemporaryDirectory();
    const caseCollisionPath = join(workspace, "case-collision.campusmod");
    const parentCollisionPath = join(workspace, "parent-collision.campusmod");
    await writeFile(caseCollisionPath, createArchive(createManifest(), {
      "DIST/main.js": strToU8("duplicate on case-insensitive filesystems")
    }));
    await writeFile(parentCollisionPath, createArchive(createManifest(), {
      "dist": strToU8("cannot also be a directory")
    }));
    const registry = createCampusmodPackageRegistry({
      rootPath: join(workspace, "installed")
    });

    await expect(registry.inspect(caseCollisionPath)).rejects.toThrow(
      "大小写冲突路径"
    );
    await expect(registry.inspect(parentCollisionPath)).rejects.toThrow(
      "同时作为文件和目录"
    );
  });

  it("rejects packages that impersonate the official namespace", async () => {
    const workspace = await createTemporaryDirectory();
    const sourcePath = join(workspace, "official.campusmod");
    await writeFile(sourcePath, createArchive(createManifest({
      id: "org.campusos.fake-official"
    })));
    const registry = createCampusmodPackageRegistry({
      rootPath: join(workspace, "installed")
    });

    await expect(registry.inspect(sourcePath)).rejects.toThrow(
      "不能使用 CampusOS 官方命名空间"
    );
  });

  it("accepts isolated local storage but rejects malformed contribution arrays", async () => {
    const workspace = await createTemporaryDirectory();
    const validPath = join(workspace, "local-storage.campusmod");
    const invalidPath = join(workspace, "invalid-contributions.campusmod");
    await writeFile(validPath, createArchive(createManifest({
      permissions: ["storage:local"]
    })));
    await writeFile(invalidPath, createArchive(createManifest({
      contributes: { commands: "countdown.open" }
    })));
    const registry = createCampusmodPackageRegistry({
      rootPath: join(workspace, "installed")
    });

    await expect(registry.inspect(validPath)).resolves.toMatchObject({
      manifest: { permissions: ["storage:local"] }
    });
    await expect(registry.inspect(invalidPath)).rejects.toThrow(
      "contributes.commands 必须是非空字符串数组"
    );
  });

  it("rejects a package changed after the user inspected its permissions", async () => {
    const workspace = await createTemporaryDirectory();
    const sourcePath = join(workspace, "changed.campusmod");
    await writeFile(sourcePath, createArchive());
    const registry = createCampusmodPackageRegistry({
      rootPath: join(workspace, "installed")
    });
    const inspection = await registry.inspect(sourcePath);

    await writeFile(sourcePath, createArchive(createManifest({ version: "2.0.0" })));
    await expect(registry.install(inspection.token)).rejects.toThrow(
      "确认后发生变化"
    );
  });

  it("isolates a corrupt installed directory without hiding valid packages", async () => {
    const workspace = await createTemporaryDirectory();
    const rootPath = join(workspace, "installed");
    const sourcePath = join(workspace, "valid.campusmod");
    await writeFile(sourcePath, createArchive());
    const registry = createCampusmodPackageRegistry({ rootPath });
    const inspection = await registry.inspect(sourcePath);
    await registry.install(inspection.token);

    await mkdir(join(rootPath, "dev.example.corrupt"), { recursive: true });
    await writeFile(
      join(rootPath, "dev.example.corrupt", ".campusmod-install.json"),
      "not-json",
      "utf8"
    );

    await expect(registry.load()).resolves.toMatchObject({
      packages: [{ manifest: { id: "dev.example.countdown" } }],
      issues: [{ directoryName: "dev.example.corrupt" }]
    });
  });

  it("isolates an installed package when an extracted file is modified", async () => {
    const workspace = await createTemporaryDirectory();
    const rootPath = join(workspace, "installed");
    const sourcePath = join(workspace, "valid.campusmod");
    await writeFile(sourcePath, createArchive());
    const registry = createCampusmodPackageRegistry({ rootPath });
    const inspection = await registry.inspect(sourcePath);
    await registry.install(inspection.token);

    await writeFile(
      join(rootPath, "dev.example.countdown", "dist", "main.js"),
      "tampered",
      "utf8"
    );

    await expect(registry.load()).resolves.toMatchObject({
      packages: [],
      issues: [{
        directoryName: "dev.example.countdown",
        message: expect.stringContaining("摘要不匹配")
      }]
    });
  });

  it("isolates a package when its manifest no longer matches the install record", async () => {
    const workspace = await createTemporaryDirectory();
    const rootPath = join(workspace, "installed");
    const sourcePath = join(workspace, "valid.campusmod");
    await writeFile(sourcePath, createArchive());
    const registry = createCampusmodPackageRegistry({ rootPath });
    await registry.install((await registry.inspect(sourcePath)).token);
    const metadataPath = join(
      rootPath,
      "dev.example.countdown",
      ".campusmod-install.json"
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      manifest: { displayName: string };
    };
    metadata.manifest.displayName = "被修改的名称";
    await writeFile(metadataPath, JSON.stringify(metadata), "utf8");

    await expect(registry.load()).resolves.toMatchObject({
      packages: [],
      issues: [{
        directoryName: "dev.example.countdown",
        message: "安装 manifest 与安装记录不一致。"
      }]
    });
  });

  it("restores an interrupted upgrade backup and cleans transient directories", async () => {
    const workspace = await createTemporaryDirectory();
    const rootPath = join(workspace, "installed");
    const sourcePath = join(workspace, "valid.campusmod");
    await writeFile(sourcePath, createArchive());
    const registry = createCampusmodPackageRegistry({ rootPath });
    await registry.install((await registry.inspect(sourcePath)).token);

    const operationId = "58ac2bea-45ab-497e-85e5-1856063b674d";
    await rename(
      join(rootPath, "dev.example.countdown"),
      join(rootPath, `.backup-dev.example.countdown-${operationId}`)
    );
    await mkdir(join(rootPath, `.staging-${operationId}`));
    await mkdir(join(rootPath, `.trash-${operationId}`));

    const restartedRegistry = createCampusmodPackageRegistry({ rootPath });
    await expect(restartedRegistry.load()).resolves.toMatchObject({
      packages: [{ manifest: { id: "dev.example.countdown" } }],
      issues: []
    });
    await expect(readdir(rootPath)).resolves.toEqual([
      "dev.example.countdown"
    ]);
  });

  it("expires an inspection token instead of installing stale consent", async () => {
    const workspace = await createTemporaryDirectory();
    const sourcePath = join(workspace, "valid.campusmod");
    await writeFile(sourcePath, createArchive());
    let currentTime = new Date("2026-07-19T09:00:00.000Z");
    const registry = createCampusmodPackageRegistry({
      rootPath: join(workspace, "installed"),
      now: () => currentTime
    });
    const inspection = await registry.inspect(sourcePath);
    currentTime = new Date("2026-07-19T09:11:00.000Z");

    await expect(registry.install(inspection.token)).rejects.toThrow(
      "确认已过期"
    );
  });
});
