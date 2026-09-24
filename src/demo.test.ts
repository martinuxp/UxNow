import { describe, expect, it } from "vitest";
import { DEMO_LINES, DEMO_TTML } from "./demo";
import { parseTtml, toAmllLines } from "./lib/lyrics";

describe("lyrics demo", () => {
  it("exercises solo, duet, background and duet-background rendering", () => {
    const lines = parseTtml(DEMO_TTML);
    const roles = toAmllLines(lines).map((line) => [line.isBG, line.isDuet]);

    expect(DEMO_LINES).toEqual(lines);
    expect(roles).toContainEqual([false, false]);
    expect(roles).toContainEqual([false, true]);
    expect(roles).toContainEqual([true, false]);
    expect(roles).toContainEqual([true, true]);
  });

  it("puts both background cases in the first twelve seconds", () => {
    const backgroundLines = DEMO_LINES.filter((line) => line.isBackground);
    expect(backgroundLines).toHaveLength(2);
    expect(backgroundLines.every((line) => line.startTime < 12_000)).toBe(true);
  });
});
