/** The saved global correction combines with a per-song correction kept only for this session. */
export function lyricsPlaybackTime(positionMs: number, lyricOffsetMs: number, globalOffsetMs: number): number {
  return Math.max(0, positionMs + lyricOffsetMs + globalOffsetMs);
}
