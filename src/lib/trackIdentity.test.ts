import { describe, expect, it } from "vitest";
import { isSameSong, lyricsSessionKey } from "./trackIdentity";
import { useAppStore } from "../store";
import type { TrackMetadata } from "../types";

const song: TrackMetadata = { title: "el mundo y yo", artist: "AKRIILA", album: "lucy miró al mundo y notó que está girando", durationMs: 207000 };

describe("song identity", () => {
  it("keeps loaded lyrics when the same song restarts or cover metadata updates", () => {
    expect(isSameSong(song, { ...song, durationMs: 207800, coverDataUrl: "data:image/jpeg;base64,abc" })).toBe(true);
    expect(isSameSong(song, { ...song, durationMs: undefined })).toBe(true);
  });
  it("searches again for a genuinely different track or version", () => {
    expect(isSameSong(song, { ...song, title: "otra canción" })).toBe(false);
    expect(isSameSong(song, { ...song, album: "otro álbum" })).toBe(false);
    expect(isSameSong(song, { ...song, durationMs: 220000 })).toBe(false);
  });
  it("keeps per-song corrections only in app memory", () => {
    useAppStore.setState({ sessionLyricsOffsets: {} });
    useAppStore.getState().setSessionLyricsOffset(song, 350);
    const key = lyricsSessionKey(song);
    expect(useAppStore.getState().sessionLyricsOffsets[key]).toBe(350);
    expect(lyricsSessionKey({ ...song, title: " El Mundo Y Yo ", durationMs: undefined })).toBe(key);
    expect(useAppStore.getState().sessionLyricsOffsets[lyricsSessionKey({ ...song, title: "otra canción" })]).toBeUndefined();
    useAppStore.setState({ sessionLyricsOffsets: {} });
    expect(useAppStore.getState().sessionLyricsOffsets[key]).toBeUndefined();
  });
});
