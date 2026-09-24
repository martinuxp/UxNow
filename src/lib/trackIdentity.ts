import type { TrackMetadata } from "../types";

const comparable = (value?: string) => value?.normalize("NFKC").trim().toLocaleLowerCase() ?? "";

export function lyricsSessionKey(track: TrackMetadata): string {
  return JSON.stringify([comparable(track.title), comparable(track.artist)]);
}

export function isSameSong(previous: TrackMetadata | undefined, next: TrackMetadata): boolean {
  if (!previous) return false;
  if (comparable(previous.title) !== comparable(next.title) || comparable(previous.artist) !== comparable(next.artist)) return false;
  if (previous.album && next.album && comparable(previous.album) !== comparable(next.album)) return false;
  if (previous.durationMs != null && next.durationMs != null && Math.abs(previous.durationMs - next.durationMs) > 2000) return false;
  return true;
}
