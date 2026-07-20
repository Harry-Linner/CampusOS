import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});
