import { parseTTML as parseAmllTtml } from "@applemusic-like-lyrics/ttml";
import { encodeMessage } from "../i18n/core";
import type { LyricLine } from "../types";

export function parseTimestamp(value: string): number {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000);
  return Math.round(parts[0] * 1000);
}

export function parseLrc(content: string): LyricLine[] {
  const entries = content
    .split(/\r?\n/)
    .flatMap((raw) => {
      const timestamps = [...raw.matchAll(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
      const text = raw.replace(/\[[^\]]+\]/g, "").trim();
      if (!text || timestamps.length === 0) return [];
      return timestamps.map((match) => ({ startTime: parseTimestamp(match[1]), text }));
    })
    .sort((a, b) => a.startTime - b.startTime);

  return entries.map((entry, index) => {
    const endTime = entries[index + 1]?.startTime ?? entry.startTime + 5000;
    return {
      ...entry,
      endTime,
      words: [{ text: entry.text, startTime: entry.startTime, endTime }],
    };
  });
}

export function parseTtml(content: string): LyricLine[] {
  const result = parseAmllTtml(content);
  if (!result.lines.length) return normalizeLyricLines(parseBasicTtml(content));
  return normalizeLyricLines(result.lines.map((line) => {
    const words = line.words.map((word) => ({
      text: word.word,
      startTime: word.startTime,
      endTime: word.endTime,
    }));
    return {
      text: words.map((word) => word.text).join("").trim(),
      startTime: line.startTime,
      endTime: line.endTime,
      words,
      translatedText: line.translatedLyric || undefined,
      isBackground: line.isBG,
      isDuet: line.isDuet,
    };
  }));
}

// Some community TTML files contain reversed word ranges or zero timestamps
// inside otherwise valid lines. AMLL's animation engine expects finite,
// increasing ranges; repair those ranges while preserving every word.
export function normalizeLyricLines(lines: LyricLine[]): LyricLine[] {
  return lines.map((line) => {
    const firstWordStart = line.words.find((word) => Number.isFinite(word.startTime) && word.startTime >= 0)?.startTime ?? 0;
    const startTime = Number.isFinite(line.startTime) && line.startTime >= 0 ? line.startTime : firstWordStart;
    const lastWordEnd = Math.max(startTime, ...line.words.map((word) => Number.isFinite(word.endTime) ? word.endTime : startTime));
    const endTime = Number.isFinite(line.endTime) && line.endTime > startTime ? line.endTime : Math.max(startTime + 1, lastWordEnd);
    let cursor = startTime;
    const words = line.words.map((word) => {
      const rawStart = Number.isFinite(word.startTime) && word.startTime >= startTime && word.startTime < endTime ? word.startTime : cursor;
      const wordStart = Math.min(endTime - 1, Math.max(cursor, rawStart));
      const rawEnd = Number.isFinite(word.endTime) && word.endTime > wordStart ? word.endTime : wordStart + 1;
      const wordEnd = Math.min(endTime, Math.max(wordStart + 1, rawEnd));
      cursor = wordEnd;
      return { ...word, startTime: wordStart, endTime: wordEnd };
    });
    return { ...line, startTime, endTime, words };
  });
}

function parseBasicTtml(content: string): LyricLine[] {
  const xml = new DOMParser().parseFromString(content, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error(encodeMessage("lyrics.parse.invalidXml"));
  return [...xml.querySelectorAll("p")].map((node) => {
    const startTime = parseTimestamp(node.getAttribute("begin") ?? "0");
    const endTime = parseTimestamp(node.getAttribute("end") ?? "0") || startTime + 5000;
    const spans = [...node.querySelectorAll(":scope > span[begin]")];
    const words = spans.length
      ? spans.map((span) => {
          const separator = span.nextSibling?.nodeType === 3 && /\s/.test(span.nextSibling.textContent ?? "") && span.nextElementSibling
            ? " "
            : "";
          const text = span.textContent ?? "";
          return {
            text: `${text}${separator && !/\s$/.test(text) ? separator : ""}`,
            startTime: parseTimestamp(span.getAttribute("begin") ?? String(startTime / 1000)),
            endTime: parseTimestamp(span.getAttribute("end") ?? String(endTime / 1000)),
          };
        })
      : [{ text: node.textContent?.trim() ?? "", startTime, endTime }];
    return { text: words.map((word) => word.text).join("").trim(), startTime, endTime, words };
  });
}

export function parseLyrics(content: string, format: string): LyricLine[] {
  if (format === "ttml") return parseTtml(content);
  if (format === "lrc" || format === "elrc") return parseLrc(content);
  if (format === "spicy") return parseSpicyLyrics(content);
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((text, index) => ({
      text,
      startTime: index * 5000,
      endTime: (index + 1) * 5000,
      words: [{ text, startTime: index * 5000, endTime: (index + 1) * 5000 }],
    }));
}

interface SpicySyllable {
  Text?: string;
  StartTime?: number;
  EndTime?: number;
  IsPartOfWord?: boolean;
}
interface SpicyVoice {
  Syllables?: SpicySyllable[];
  Text?: string;
  StartTime?: number;
  EndTime?: number;
  TranslatedText?: string;
}
interface SpicyBlock {
  Type?: string;
  OppositeAligned?: boolean;
  Lead?: SpicyVoice;
  Background?: SpicyVoice[];
  Text?: string;
  StartTime?: number;
  EndTime?: number;
}

function spicyVoiceLine(voice: SpicyVoice, background: boolean, duet: boolean): LyricLine | null {
  const syllables = voice.Syllables?.filter((syllable) => typeof syllable.Text === "string") ?? [];
  const startTime = Math.max(0, Math.round((voice.StartTime ?? syllables[0]?.StartTime ?? 0) * 1000));
  const endTime = Math.max(startTime + 1, Math.round((voice.EndTime ?? syllables.at(-1)?.EndTime ?? (startTime / 1000 + 5)) * 1000));
  const words = syllables.length
    ? syllables.map((syllable, index) => {
        const next = syllables[index + 1];
        const raw = syllable.Text ?? "";
        const separator = next && !syllable.IsPartOfWord && !/\s$/.test(raw) && !/^\s/.test(next.Text ?? "") ? " " : "";
        return {
          text: raw + separator,
          startTime: Math.max(0, Math.round((syllable.StartTime ?? startTime / 1000) * 1000)),
          endTime: Math.max(0, Math.round((syllable.EndTime ?? endTime / 1000) * 1000)),
        };
      })
    : [{ text: voice.Text ?? "", startTime, endTime }];
  const text = words.map((word) => word.text).join("").trim();
  if (!text) return null;
  return { text, startTime, endTime, words, translatedText: voice.TranslatedText, isBackground: background, isDuet: duet };
}

export function parseSpicyLyrics(content: string): LyricLine[] {
  const body = JSON.parse(content) as { Content?: SpicyBlock[] };
  if (!Array.isArray(body.Content)) throw new Error(encodeMessage("lyrics.parse.spicyFormat"));
  return body.Content.flatMap((block) => {
    const lines: LyricLine[] = [];
    if (block.Lead) {
      const line = spicyVoiceLine(block.Lead, false, Boolean(block.OppositeAligned));
      if (line) lines.push(line);
    } else if (block.Text) {
      const line = spicyVoiceLine(block, false, false);
      if (line) lines.push(line);
    }
    for (const voice of block.Background ?? []) {
      const line = spicyVoiceLine(voice, true, Boolean(block.OppositeAligned));
      if (line) lines.push(line);
    }
    return lines;
  }).sort((a, b) => a.startTime - b.startTime);
}

export function toAmllLines(lines: LyricLine[]) {
  return normalizeLyricLines(lines).map((line) => ({
    words: line.words.map((word) => ({
      word: word.text,
      startTime: Math.round(word.startTime),
      endTime: Math.round(word.endTime),
      romanWord: "",
      obscene: false,
    })),
    translatedLyric: line.translatedText ?? "",
    romanLyric: "",
    isBG: line.isBackground ?? false,
    isDuet: line.isDuet ?? false,
    startTime: Math.round(line.startTime),
    endTime: Math.round(line.endTime),
  }));
}
