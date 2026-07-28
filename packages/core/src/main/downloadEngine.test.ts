import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadEngine } from "./downloadEngine";

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
});
