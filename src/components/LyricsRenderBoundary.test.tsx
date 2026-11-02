import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LyricsRenderBoundary } from "./LyricsRenderBoundary";

function BrokenRenderer(): never { throw new Error("renderer failed"); }

describe("lyrics renderer fallback", () => {
  it("keeps the lyrics readable when the animated renderer throws", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<LyricsRenderBoundary lines={[{ text: "Prueba de letra", startTime: 0, endTime: 1000, words: [] }]}><BrokenRenderer /></LyricsRenderBoundary>);
      expect(screen.getByText("Prueba de letra")).toBeTruthy();
      expect(screen.getByText(/No se pudo animar esta letra/)).toBeTruthy();
    } finally { log.mockRestore(); }
  });
});
