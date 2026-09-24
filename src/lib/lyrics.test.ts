import { describe, expect, it } from "vitest";
import { parseLrc, parseSpicyLyrics, parseTimestamp, parseTtml, toAmllLines } from "./lyrics";

describe("lyrics parsers", () => {
  it("parses minute timestamps", () => expect(parseTimestamp("01:02.50")).toBe(62_500));
  it("orders LRC lines and derives their end", () => {
    const result = parseLrc("[00:05.00]Dos\n[00:01.00]Uno");
    expect(result.map((line) => line.text)).toEqual(["Uno", "Dos"]);
    expect(result[0].endTime).toBe(5000);
  });
  it("parses word-level TTML", () => {
    const result = parseTtml('<tt><body><p begin="0" end="2"><span begin="0" end="1">Hola </span><span begin="1" end="2">mundo</span></p></body></tt>');
    expect(result[0].words).toHaveLength(2);
    expect(result[0].text).toBe("Hola mundo");
  });
  it("preserves whitespace stored between timed TTML spans", () => {
    const result = parseTtml('<tt><body><p begin="0" end="4"><span begin="0" end="1">Cada</span> <span begin="1" end="2">fin</span> <span begin="2" end="3">de</span> <span begin="3" end="4">semana</span></p></body></tt>');
    expect(result[0].words.map((word) => word.text)).toEqual(["Cada ", "fin ", "de ", "semana"]);
    expect(result[0].text).toBe("Cada fin de semana");
  });
  it("keeps adjacent TTML spans joined for timed syllables", () => {
    const result = parseTtml('<tt><body><p begin="0" end="2"><span begin="0" end="1">ah-</span><span begin="1" end="2">ah</span></p></body></tt>');
    expect(result[0].text).toBe("ah-ah");
  });
  it("separates parenthesized TTML background vocals without duplicating them", () => {
    const result = parseTtml('<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body><div begin="0" end="4"><p begin="0" end="4" itunes:key="L1"><span begin="0" end="2">Principal</span><span ttm:role="x-bg" begin="1" end="4"><span begin="1" end="2">(Voz</span> <span begin="2" end="4">de fondo)</span></span></p></div></body></tt>');
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Principal");
    expect(result[0].isBackground).toBe(false);
    expect(result[1].text).toBe("Voz de fondo");
    expect(result[1].isBackground).toBe(true);
    expect(result[1].words.map((word) => word.text)).toEqual(["Voz ", "de fondo"]);
    expect(toAmllLines(result)[1].isBG).toBe(true);
  });
  it("preserves solo, duet, background and duet-background roles for AMLL", () => {
    const result = parseTtml('<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/></metadata></head><body><div begin="0" end="8"><p begin="0" end="4" ttm:agent="v1" itunes:key="L1"><span begin="0" end="3">Solo</span><span ttm:role="x-bg" begin="1" end="4"><span begin="1" end="4">(fondo)</span></span></p><p begin="4" end="8" ttm:agent="v2" itunes:key="L2"><span begin="4" end="7">Dúo</span><span ttm:role="x-bg" begin="5" end="8"><span begin="5" end="8">(fondo dúo)</span></span></p></div></body></tt>');
    expect(result.map((line) => [line.text, line.isBackground, line.isDuet])).toEqual([
      ["Solo", false, false],
      ["fondo", true, false],
      ["Dúo", false, true],
      ["fondo dúo", true, true],
    ]);
    expect(toAmllLines(result).map((line) => [line.isBG, line.isDuet])).toEqual([
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]);
  });
  it("rejects malformed TTML", () => expect(() => parseTtml("<tt><p>")).toThrow());
  it("converts SpicyLyrics syllables, spaces and background vocals for AMLL", () => {
    const result = parseSpicyLyrics(JSON.stringify({ Content: [{
      Type: "Vocal", OppositeAligned: true,
      Lead: { Syllables: [
        { Text: "el", StartTime: 1, EndTime: 1.2, IsPartOfWord: false },
        { Text: "mun", StartTime: 1.2, EndTime: 1.4, IsPartOfWord: true },
        { Text: "do", StartTime: 1.4, EndTime: 1.6, IsPartOfWord: false },
        { Text: "y", StartTime: 1.6, EndTime: 1.8, IsPartOfWord: false },
        { Text: "yo", StartTime: 1.8, EndTime: 2, IsPartOfWord: false },
      ] },
      Background: [{ Syllables: [{ Text: "eco", StartTime: 1.5, EndTime: 2 }] }],
    }] }));
    expect(result.map((line) => line.text)).toEqual(["el mundo y yo", "eco"]);
    expect(result[0].words.map((word) => word.startTime)).toEqual([1000, 1200, 1400, 1600, 1800]);
    expect(toAmllLines(result).map((line) => [line.isBG, line.isDuet])).toEqual([[false, true], [true, true]]);
  });
});
