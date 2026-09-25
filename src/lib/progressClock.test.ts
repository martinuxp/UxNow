import { describe, expect, it } from "vitest";
import { interpolatedProgress } from "./progressClock";

describe("interpolatedProgress", () => {
  it("stays at zero until uxPlay provides a position", () => {
    expect(interpolatedProgress(null, 12_000)).toBe(0);
  });

  it("interpolates from each sample and stops drifting when samples stop", () => {
    const sample = { positionMs: 2_000, receivedAt: 10_000 };
    expect(interpolatedProgress(sample, 10_250)).toBe(2_250);
    expect(interpolatedProgress(sample, 15_000)).toBe(3_200);
  });
});
