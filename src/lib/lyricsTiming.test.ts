import { describe, expect, it } from "vitest";
import { lyricsPlaybackTime } from "./lyricsTiming";

describe("lyricsPlaybackTime", () => {
  it("adds the global and per-lyric corrections without changing either", () => {
    expect(lyricsPlaybackTime(10_000, 350, -200)).toBe(10_150);
    expect(lyricsPlaybackTime(10_000, 350, 0)).toBe(10_350);
  });

  it("never sends negative playback time to the renderer", () => {
    expect(lyricsPlaybackTime(200, -500, -300)).toBe(0);
  });
});
