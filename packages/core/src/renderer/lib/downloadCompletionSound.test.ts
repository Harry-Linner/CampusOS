import { describe, expect, it, vi } from "vitest";
import { createDownloadCompletionSoundPlayer } from "./downloadCompletionSound";

describe("download completion sound", () => {
  it("reuses one audio element and throttles duplicate completion events", async () => {
    let timestamp = 10_000;
    const audio = {
      currentTime: 12,
      preload: "none",
      play: vi.fn(async () => undefined)
    };
    const createAudio = vi.fn(() => audio);
    const play = createDownloadCompletionSoundPlayer({
      createAudio,
      now: () => timestamp,
      cooldownMs: 3_000
    });

    await play();
    await play();
    timestamp += 3_000;
    await play();

    expect(createAudio).toHaveBeenCalledTimes(1);
    expect(audio.preload).toBe("auto");
    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("does not reject when the platform refuses playback", async () => {
    const play = createDownloadCompletionSoundPlayer({
      createAudio: () => ({
        currentTime: 0,
        preload: "none",
        play: vi.fn(async () => { throw new Error("blocked"); })
      })
    });

    await expect(play()).resolves.toBeUndefined();
  });
});
