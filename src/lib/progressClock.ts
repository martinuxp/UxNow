export interface ProgressSample {
  positionMs: number;
  receivedAt: number;
}

/** uxPlay reports whole seconds. Smooth only until the next expected sample. */
export function interpolatedProgress(sample: ProgressSample | null, now: number): number {
  if (!sample) return 0;
  return sample.positionMs + Math.min(1200, Math.max(0, now - sample.receivedAt));
}
