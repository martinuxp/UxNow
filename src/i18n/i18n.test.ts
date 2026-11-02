import { describe, expect, it } from "vitest";
import {
  BASE_LOCALE, LOCALES, LOCALE_CODES, decodeMessage, detectLocale, encodeMessage, messageMentions,
  translate, translateMessage, translatePlural,
} from "./core";

type Tree = { [key: string]: string | Tree };

/** Leaf paths with the placeholders each one uses; plural forms collapse into their node. */
function shape(tree: Tree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(path, placeholders(value));
    else if (typeof value.other === "string") result.set(path, placeholders(value.other));
    else shape(value, path).forEach((params, leaf) => result.set(leaf, params));
  }
  return result;
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");

const rustSources = import.meta.glob<string>("../../src-tauri/src/*.rs", { query: "?raw", import: "default", eager: true });

describe("catalogs", () => {
  const base = shape(LOCALES[BASE_LOCALE].messages as unknown as Tree);

  it("ships Spanish as the base and English", () => {
    expect(LOCALE_CODES[0]).toBe("es");
    expect(LOCALE_CODES).toContain("en");
  });

  it.each(LOCALE_CODES)("%s has every key with the same placeholders", (code) => {
    expect(shape(LOCALES[code].messages as unknown as Tree)).toEqual(base);
  });

  it("covers every key that Rust sends", () => {
    const keys = new Set(Object.values(rustSources).flatMap((source) => [...source.matchAll(/"(backend\.[\w.]+)"/g)].map((match) => match[1])));
    expect(keys.size).toBeGreaterThan(40);
    expect([...keys].filter((key) => !base.has(key))).toEqual([]);
  });
});

describe("translation", () => {
  it("fills parameters and plural forms per language", () => {
    expect(translate("en", "nowPlaying.coverAlt", { title: "Luz" })).toBe("Artwork for Luz");
    expect(translatePlural("es", "library.fileCount", 1)).toBe("1 archivo");
    expect(translatePlural("es", "library.fileCount", 3)).toBe("3 archivos");
    expect(translatePlural("en", "library.fileCount", 1)).toBe("1 file");
  });

  it("translates descriptors from Rust, nested and in lists", () => {
    const attribution = encodeMessage("backend.lyrics.attribution", { source: encodeMessage("backend.lyrics.localCollection") });
    expect(translateMessage("es", attribution)).toBe("Letras: colección local");
    expect(translateMessage("en", attribution)).toBe("Lyrics: local collection");
    const failures = JSON.stringify({ key: "backend.list", params: { items: [encodeMessage("backend.binimum.httpStatus", { status: "404" }), "SpicyLyrics: timeout"] } });
    expect(translateMessage("en", failures)).toBe("BiniLyrics responded HTTP 404 · SpicyLyrics: timeout");
    expect(messageMentions(failures, "backend.binimum.httpStatus", { status: 404 })).toBe(true);
    expect(translateMessage("en", JSON.stringify({ key: "backend.diagnostics.audioMissing", params: { count: "1" } }))).toBe("1 active output; select one");
  });

  it("shows raw text and unknown keys unchanged", () => {
    expect(translateMessage("en", "ERROR: no element \"level\"")).toBe("ERROR: no element \"level\"");
    expect(translateMessage("en", "Letras: LRCLIB")).toBe("Letras: LRCLIB");
    expect(decodeMessage("{\"key\":\"backend.nope\"}")).toEqual({ key: "backend.nope" });
    expect(translateMessage("en", "{\"key\":\"backend.nope\"}")).toBe("{\"key\":\"backend.nope\"}");
  });

  it("detects the system language with Spanish as the fallback", () => {
    expect(detectLocale(["en-US", "es-CL"])).toBe("en");
    expect(detectLocale(["es-419"])).toBe("es");
    expect(detectLocale(["ja-JP"])).toBe("es");
    expect(detectLocale([])).toBe("es");
  });

  it("rejects keys that are not in the catalog", () => {
    // @ts-expect-error unknown keys do not type-check
    expect(translate("es", "nav.missing")).toBe("nav.missing");
  });
});
