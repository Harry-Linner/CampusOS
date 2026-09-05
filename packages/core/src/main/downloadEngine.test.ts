import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadEngine, type DownloadQueueItem } from "./downloadEngine";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("DownloadEngine", () => {
  it("downloads a queued file atomically and restores its completed record", async () => {
    const payload = Buffer.from("CampusOS download fixture", "utf8");
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-length": String(payload.byteLength),
        "content-type": "application/octet-stream"
      });
      response.end(payload);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Fixture server did not expose a TCP address.");
    }

    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-download-test-"));
    temporaryDirectories.push(storageRoot);
    let changeCount = 0;
    const options = {
      downloadRoot: join(storageRoot, "materials"),
      persistencePath: join(storageRoot, "queue.json"),
      maxConcurrent: 1,
      onChanged: () => {
        changeCount += 1;
      }
    };
    const engine = new DownloadEngine(options);

    try {
      await engine.enqueue({
        url: `http://127.0.0.1:${address.port}/lecture.pdf`,
        title: "lecture.pdf",
        courseName: "Software Engineering",
        sourceId: "academic-affairs",
        semester: "2026-fall"
      });
      await engine.waitForIdle();

      expect(engine.getSummary()).toEqual([
        expect.objectContaining({
          title: "lecture.pdf",
          progress: 100,
          status: "ready"
        })
      ]);
      expect(changeCount).toBeGreaterThanOrEqual(2);
      const targetPath = engine.getSummary()[0]?.targetPath;
      expect(targetPath).toBeDefined();
      await expect(readFile(targetPath!, "utf8")).resolves.toBe(payload.toString("utf8"));

      const restored = new DownloadEngine(options);
      await restored.loadPersisted();
      expect(restored.getSummary()).toEqual(engine.getSummary());
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it("downloads through the main-process response resolver with its fallback URL", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-auth-download-test-"));
    temporaryDirectories.push(storageRoot);
    const requests: Array<{ url: string; fallbackUrl?: string; range?: string }> = [];
    const engine = new DownloadEngine({
      downloadRoot: join(storageRoot, "materials"),
      persistencePath: join(storageRoot, "queue.json"),
      maxConcurrent: 1,
      resolveResponse: async (request) => {
        requests.push({
          url: request.item.url,
          fallbackUrl: request.item.fallbackUrl,
          range: request.headers.Range
        });
        return new Response("authenticated-courseware", {
          status: 200,
          headers: { "content-length": "24" }
        });
      }
    });

    await engine.enqueue({
      url: "https://courses.zju.edu.cn/api/uploads/reference/929150/blob",
      fallbackUrl: "https://courses.zju.edu.cn/api/uploads/908844/blob",
      title: "lecture.pdf",
      courseName: "Computer Networks",
      sourceId: "learning-platform",
      semester: "2026-fall"
    });
    await engine.waitForIdle();

    expect(requests).toEqual([{
      url: "https://courses.zju.edu.cn/api/uploads/reference/929150/blob",
      fallbackUrl: "https://courses.zju.edu.cn/api/uploads/908844/blob",
      range: undefined
    }]);
    const targetPath = engine.getSummary()[0]?.targetPath;
    expect(targetPath).toBeDefined();
    await expect(readFile(targetPath!, "utf8")).resolves.toBe("authenticated-courseware");
    expect(engine.allTasks[0]?.fallbackUrl).toBe(
      "https://courses.zju.edu.cn/api/uploads/908844/blob"
    );
  });

  it("redownloads a ready courseware file when the discovered size changes", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-updated-download-test-"));
    temporaryDirectories.push(storageRoot);
    let payload = "first";
    const resolveResponse = vi.fn(async () => new Response(payload, {
      status: 200,
      headers: { "content-length": String(Buffer.byteLength(payload)) }
    }));
    const engine = new DownloadEngine({
      downloadRoot: join(storageRoot, "materials"),
      persistencePath: join(storageRoot, "queue.json"),
      maxConcurrent: 1,
      resolveResponse
    });
    const request = {
      url: "https://courses.zju.edu.cn/api/uploads/reference/929150/blob",
      fallbackUrl: "https://courses.zju.edu.cn/api/uploads/908844/blob",
      title: "lecture.pdf",
      courseName: "Computer Networks",
      sourceId: "learning-platform" as const,
      semester: "2026-fall"
    };

    await engine.enqueue({ ...request, expectedBytes: Buffer.byteLength(payload) });
    await engine.waitForIdle();
    payload = "updated-courseware";
    await engine.enqueue({ ...request, expectedBytes: Buffer.byteLength(payload) });
    await engine.waitForIdle();

    expect(resolveResponse).toHaveBeenCalledTimes(2);
    const targetPath = engine.getSummary()[0]?.targetPath;
    await expect(readFile(targetPath!, "utf8")).resolves.toBe(payload);
  });

  it("accepts the authenticated preview response size when it differs from upload metadata", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-preview-download-test-"));
    temporaryDirectories.push(storageRoot);
    const preview = "preview-courseware";
    const resolveResponse = vi.fn(async () => new Response(preview, {
      status: 200,
      headers: { "content-length": String(Buffer.byteLength(preview)) }
    }));
    const engine = new DownloadEngine({
      downloadRoot: join(storageRoot, "materials"),
      persistencePath: join(storageRoot, "queue.json"),
      maxConcurrent: 1,
      resolveResponse
    });
    const request = {
      url: "https://courses.zju.edu.cn/api/uploads/reference/929150/blob",
      fallbackUrl: "https://courses.zju.edu.cn/api/uploads/908844/blob",
      expectedBytes: 10_000,
      title: "lecture.pdf",
      courseName: "Computer Networks",
      sourceId: "learning-platform" as const,
      semester: "2026-fall"
    };

    await engine.enqueue(request);
    await engine.waitForIdle();
    expect(engine.allTasks[0]?.status).toBe("ready");
    const targetPath = engine.getSummary()[0]?.targetPath;
    await expect(readFile(targetPath!, "utf8")).resolves.toBe(preview);

    await engine.enqueue(request);
    await engine.waitForIdle();
    expect(engine.allTasks[0]?.status).toBe("ready");
    await expect(readFile(targetPath!, "utf8")).resolves.toBe(preview);
    expect(resolveResponse).toHaveBeenCalledTimes(2);
  });

  it("restarts an active download when it is resumed before abort cleanup finishes", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-pause-resume-test-"));
    temporaryDirectories.push(storageRoot);
    let releaseFirstRequest: (() => void) | null = null;
    const firstRequestStarted = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    let confirmAbortObserved: (() => void) | null = null;
    const abortObserved = new Promise<void>((resolve) => {
      confirmAbortObserved = resolve;
    });
    let releaseAbortCleanup!: () => void;
    const abortCleanupReleased = new Promise<void>((resolve) => {
      releaseAbortCleanup = resolve;
    });
    let attempt = 0;
    const resolveResponse = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      attempt += 1;
      if (attempt === 1) {
        releaseFirstRequest?.();
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            confirmAbortObserved?.();
            resolve();
          }, { once: true });
        });
        await abortCleanupReleased;
        throw new DOMException("Aborted", "AbortError");
      }
      return new Response("resumed", {
        status: 200,
        headers: { "content-length": "7" }
      });
    });
    const engine = new DownloadEngine({
      downloadRoot: join(storageRoot, "materials"),
      persistencePath: join(storageRoot, "queue.json"),
      maxConcurrent: 1,
      queuePersistence: {
        load: async () => [],
        save: async () => undefined
      },
      resolveResponse
    });

    const item = await engine.enqueue({
      url: "https://example.com/resumable.bin",
      title: "resumable.bin",
      courseName: "Systems",
      sourceId: "academic-affairs",
      semester: "2026-fall"
    });
    await firstRequestStarted;
    await expect(engine.pause(item.id)).resolves.toBe(true);
    await abortObserved;
    await expect(engine.resume(item.id)).resolves.toBe(true);
    releaseAbortCleanup();
    await engine.waitForIdle();

    expect(resolveResponse).toHaveBeenCalledTimes(2);
    expect(engine.allTasks[0]?.status).toBe("ready");
    await expect(readFile(engine.allTasks[0]!.targetPath, "utf8")).resolves.toBe("resumed");
  });

  it("resumes an interrupted persisted download from its partial file after restart", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-restart-resume-test-"));
    temporaryDirectories.push(storageRoot);
    const targetPath = join(storageRoot, "materials", "2026-fall", "Systems", "restart.bin");
    const temporaryPath = `${targetPath}.part`;
    await mkdir(join(targetPath, ".."), { recursive: true });
    await writeFile(temporaryPath, "partial", "utf8");
    const persistedItem = {
      id: "restart-task",
      url: "https://example.com/restart.bin",
      expectedBytes: 11,
      title: "restart.bin",
      courseName: "Systems",
      sourceId: "academic-affairs" as const,
      semester: "2026-fall",
      targetPath,
      temporaryPath,
      totalBytes: 11,
      downloadedBytes: 4,
      status: "syncing" as const,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:01:00.000Z"
    };
    const save = vi.fn(async () => undefined);
    const resolveResponse = vi.fn(async ({ headers }: { headers: Record<string, string> }) => {
      expect(headers.Range).toBe("bytes=7-");
      return new Response("-end", {
        status: 206,
        headers: { "content-length": "4" }
      });
    });
    const engine = new DownloadEngine({
      downloadRoot: join(storageRoot, "materials"),
      persistencePath: join(storageRoot, "queue.json"),
      maxConcurrent: 1,
      queuePersistence: {
        load: async () => [persistedItem],
        save
      },
      resolveResponse
    });

    await engine.loadPersisted();
    await engine.waitForIdle();

    expect(resolveResponse).toHaveBeenCalledTimes(1);
    expect(engine.allTasks[0]?.status).toBe("ready");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("partial-end");
    expect(save).toHaveBeenCalled();
  });

  it("exposes a failed download reason in the renderer task summary", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-download-error-test-"));
    temporaryDirectories.push(storageRoot);
    let attempt = 0;
    const engine = new DownloadEngine({
      downloadRoot: join(storageRoot, "materials"),
      persistencePath: join(storageRoot, "queue.json"),
      maxConcurrent: 1,
      resolveResponse: async () => {
        attempt += 1;
        return attempt === 1
          ? new Response(null, { status: 503 })
          : new Response("retried", {
              status: 200,
              headers: { "content-length": "7" }
            });
      }
    });

    await engine.enqueue({
      url: "https://example.com/unavailable.bin",
      title: "unavailable.bin",
      courseName: "Systems",
      sourceId: "academic-affairs",
      semester: "2026-fall"
    });
    await engine.waitForIdle();

    expect(engine.getSummary()).toEqual([
      expect.objectContaining({
        status: "failed",
        failureMessage: "下载失败：HTTP 503"
      })
    ]);
    const taskId = engine.allTasks[0]!.id;
    await expect(engine.resume(taskId)).resolves.toBe(true);
    await engine.waitForIdle();
    expect(engine.getSummary()[0]).toEqual(expect.objectContaining({
      status: "ready",
      progress: 100,
      failureMessage: undefined
    }));
  });

  it("clears every record, aborts active downloads, removes partial files, and keeps completed files", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-clear-download-test-"));
    temporaryDirectories.push(storageRoot);
    const save = vi.fn(async () => undefined);
    let activeRequestStarted!: () => void;
    const activeStarted = new Promise<void>((resolve) => {
      activeRequestStarted = resolve;
    });
    const baseItem = (id: string, status: DownloadQueueItem["status"]): DownloadQueueItem => ({
      id,
      url: `https://example.com/${id}.bin`,
      title: `${id}.bin`,
      courseName: "Systems",
      sourceId: "academic-affairs",
      semester: "2026-fall",
      targetPath: join(storageRoot, "materials", `${id}.bin`),
      temporaryPath: join(storageRoot, "materials", `${id}.bin.part`),
      totalBytes: 1,
      downloadedBytes: status === "ready" ? 1 : 0,
      status,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z"
    });
    const engine = new DownloadEngine({
      downloadRoot: join(storageRoot, "materials"),
      persistencePath: join(storageRoot, "queue.json"),
      queuePersistence: {
        load: async () => [
          baseItem("ready", "ready"),
          baseItem("failed", "failed"),
          baseItem("paused", "paused")
        ],
        save
      },
      maxConcurrent: 1,
      resolveResponse: async ({ signal }) => {
        activeRequestStarted();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
        throw new Error("unreachable");
      }
    });

    await engine.loadPersisted();
    const completedPath = engine.allTasks.find((item) => item.id === "ready")!.targetPath;
    await mkdir(join(completedPath, ".."), { recursive: true });
    await writeFile(completedPath, "completed", "utf8");
    const active = await engine.enqueue({
      url: "https://example.com/active.bin",
      title: "active.bin",
      courseName: "Systems",
      sourceId: "academic-affairs",
      semester: "2026-fall"
    });
    await activeStarted;
    await mkdir(join(active.temporaryPath, ".."), { recursive: true });
    await writeFile(active.temporaryPath, "partial", "utf8");

    await expect(engine.clearAll()).resolves.toBe(4);
    expect(engine.allTasks).toEqual([]);
    expect(save).toHaveBeenLastCalledWith([]);
    await expect(readFile(active.temporaryPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(completedPath, "utf8")).resolves.toBe("completed");
  });
});
