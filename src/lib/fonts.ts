import type { FontChoice } from "../types";

export const DEFAULT_UI_FONT = "Google Sans Flex";
export const DEFAULT_LYRICS_FONT = "Google Sans Flex SemiBold";

export const FALLBACK_FONT_OPTIONS: FontChoice[] = [
  DEFAULT_UI_FONT,
  DEFAULT_LYRICS_FONT,
  "Google Sans Flex Bold",
  "windows-system",
  "Segoe UI Variable Text",
  "Segoe UI",
  "Aptos",
  "Bahnschrift",
  "Georgia",
];

const ALIASES: Record<string, string> = {
  system: DEFAULT_UI_FONT, // Existing installations used this as their default.
  "windows-system": "Segoe UI Variable Text",
  humanist: "Aptos",
  geometric: "Bahnschrift",
  serif: "Georgia",
};

const LABELS: Record<string, string> = {
  system: "Google Sans Flex · predeterminada",
  "Google Sans Flex": "Google Sans Flex · variable",
  "Google Sans Flex SemiBold": "Google Sans Flex · semibold",
  "Google Sans Flex Bold": "Google Sans Flex · bold",
  "windows-system": "Fuente de Windows · Segoe UI",
  humanist: "Aptos",
  geometric: "Bahnschrift",
  serif: "Georgia",
};

const WEIGHTS: Record<string, number> = {
  thin: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  heavy: 900,
};

export function fontFaceFor(choice: FontChoice | undefined) {
  const value = ALIASES[choice ?? "system"] ?? choice ?? DEFAULT_UI_FONT;
  const styleMatch = value.match(/\s+(Italic|Oblique)$/i);
  const withoutStyle = styleMatch ? value.slice(0, -styleMatch[0].length) : value;
  const weightMatch = withoutStyle.match(/\s+(Extra Light|Ultra Light|Semi Bold|Demi Bold|Extra Bold|Ultra Bold|Thin|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Heavy)$/i);
  const family = weightMatch ? withoutStyle.slice(0, -weightMatch[0].length) : withoutStyle;
  const weightKey = weightMatch?.[1].replace(/\s/g, "").toLowerCase();
  return {
    family: family || DEFAULT_UI_FONT,
    weight: weightKey ? WEIGHTS[weightKey] ?? 400 : 400,
    style: styleMatch ? "italic" as const : "normal" as const,
  };
}

export const fontLabel = (choice: FontChoice) => LABELS[choice] ?? choice;

export const fontFamilyFor = (choice: FontChoice | undefined) => {
  const safe = fontFaceFor(choice).family.replace(/["'`;\\\r\n]/g, "").trim();
  if (!safe) return '"Google Sans Flex", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  return `"${safe}", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
};

export const fontWeightFor = (choice: FontChoice | undefined, defaultWeight = 400) => {
  if (!choice || choice === "system") return defaultWeight;
  return fontFaceFor(choice).weight;
};

export const fontStyleFor = (choice: FontChoice | undefined) => fontFaceFor(choice).style;
