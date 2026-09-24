import { describe, expect, it } from "vitest";
import { fontFaceFor, fontFamilyFor, fontLabel, fontWeightFor } from "./fonts";

describe("font personalization", () => {
  it("keeps legacy choices readable", () => {
    expect(fontLabel("geometric")).toBe("Bahnschrift");
    expect(fontFamilyFor("serif")).toContain('"Georgia"');
  });

  it("creates a safe CSS stack for installed font names", () => {
    expect(fontFamilyFor('Aptos"; color: red')).toBe(
      '"Aptos color: red", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
    );
  });

  it("maps installed faces to their actual CSS family and weight", () => {
    expect(fontFaceFor("Segoe UI Variable Text Bold Italic")).toEqual({ family: "Segoe UI Variable Text", weight: 700, style: "italic" });
    expect(fontFaceFor("Google Sans Flex SemiBold")).toEqual({ family: "Google Sans Flex", weight: 600, style: "normal" });
    expect(fontWeightFor("system", 600)).toBe(600);
    expect(fontFamilyFor("Arial Bold")).toContain('"Arial"');
    expect(fontLabel("Google Sans Flex SemiBold")).toContain("semibold");
  });
});
