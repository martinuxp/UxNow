import { parseTTML as parseAmllTtml } from "@applemusic-like-lyrics/ttml";
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
  if (!result.lines.length) return parseBasicTtml(content);
  return result.lines.map((line) => {
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
  });
}

function parseBasicTtml(content: string): LyricLine[] {
  const xml = new DOMParser().parseFromString(content, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("El TTML no es XML válido.");
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
  if (!Array.isArray(body.Content)) throw new Error("SpicyLyrics devolvió un formato no reconocido.");
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
  return lines.map((line) => ({
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
