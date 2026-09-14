const soundUrl = new URL("../assets/download-complete.mp3", import.meta.url).href;

interface AudioPlayer {
  currentTime: number;
  preload: string;
  play: () => Promise<void>;
}

interface DownloadCompletionSoundOptions {
  createAudio?: (source: string) => AudioPlayer;
  now?: () => number;
  cooldownMs?: number;
}

export const createDownloadCompletionSoundPlayer = ({
  createAudio = (source) => new Audio(source),
  now = Date.now,
  cooldownMs = 3_000
}: DownloadCompletionSoundOptions = {}) => {
  let audio: AudioPlayer | null = null;
  let lastPlayedAt = Number.NEGATIVE_INFINITY;

  return async (): Promise<void> => {
    const playedAt = now();
    if (playedAt - lastPlayedAt < cooldownMs) return;
    lastPlayedAt = playedAt;

    try {
      audio ??= createAudio(soundUrl);
      audio.preload = "auto";
      audio.currentTime = 0;
      await audio.play();
    } catch {
      // A sound failure must never affect the completed download state.
    }
  };
};

export const playDownloadCompletionSound =
  createDownloadCompletionSoundPlayer();
