import type { BaseMessages } from "./locales/es";

// Framework-free translation core. Locales are discovered from ./locales/*.ts,
// so adding a language means adding one file that exports a LocaleDefinition.

export const BASE_LOCALE = "es";

type PluralCategory = "zero" | "one" | "two" | "few" | "many";
export type PluralForms = { other: string } & Partial<Record<PluralCategory, string>>;
type Catalog<T> = { [K in keyof T]: T[K] extends string ? string : T[K] extends { other: string } ? PluralForms : Catalog<T[K]> };

/** Shape every locale must provide: the Spanish catalog with any text in its leaves. */
export type Messages = Catalog<BaseMessages>;

export interface LocaleDefinition {
  /** Language name written in that language, shown in the selector. */
  name: string;
  messages: Messages;
}

type Join<P extends string, K extends string> = P extends "" ? K : `${P}.${K}`;
type TextKeys<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? Join<P, K> : T[K] extends { other: string } ? never : TextKeys<T[K], Join<P, K>>;
}[keyof T & string];
type PluralKeys<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? never : T[K] extends { other: string } ? Join<P, K> : PluralKeys<T[K], Join<P, K>>;
}[keyof T & string];

export type MessageKey = TextKeys<BaseMessages>;
export type PluralKey = PluralKeys<BaseMessages>;
export type Params = Record<string, string | number>;

const modules = import.meta.glob<{ default: LocaleDefinition }>("./locales/*.ts", { eager: true });

export const LOCALES: Record<string, LocaleDefinition> = Object.fromEntries(
  Object.entries(modules).map(([path, module]) => [path.replace(/^.*\/([\w-]+)\.ts$/, "$1"), module.default]),
);

/** Locale codes with the base language first, then by native name. */
export const LOCALE_CODES = Object.keys(LOCALES).sort((a, b) =>
  a === BASE_LOCALE ? -1 : b === BASE_LOCALE ? 1 : LOCALES[a].name.localeCompare(LOCALES[b].name),
);

export function resolveLocale(language?: string | null): string {
  return language && LOCALES[language] ? language : BASE_LOCALE;
}

/** Picks the first supported language from the system preferences, or the base locale. */
export function detectLocale(languages: readonly string[]): string {
  for (const language of languages) {
    const tag = language.toLowerCase();
    if (LOCALES[tag]) return tag;
    const base = tag.split("-")[0];
    if (LOCALES[base]) return base;
  }
  return BASE_LOCALE;
}

type Node = string | { [key: string]: Node };

function lookup(locale: string, key: string): Node | undefined {
  const find = (code: string) => key.split(".").reduce<Node | undefined>(
    (node, part) => (node && typeof node === "object" ? node[part] : undefined),
    LOCALES[code]?.messages as Node | undefined,
  );
  return find(locale) ?? find(BASE_LOCALE);
}

function format(template: string, params?: Record<string, string | number>) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

function pluralTemplate(locale: string, node: Node, count: number): string | undefined {
  if (typeof node === "string") return node;
  const category = new Intl.PluralRules(locale).select(count);
  const form = node[category] ?? node.other;
  return typeof form === "string" ? form : undefined;
}

export function translate(locale: string, key: MessageKey, params?: Params): string {
  const node = lookup(locale, key);
  return typeof node === "string" ? format(node, params) : key;
}

export function translatePlural(locale: string, key: PluralKey, count: number, params?: Params): string {
  const node = lookup(locale, key);
  const template = node === undefined ? undefined : pluralTemplate(locale, node, count);
  return template === undefined ? key : format(template, { count, ...params });
}

/** Splits a message around its placeholders so callers can insert rich values. */
export function templateParts(locale: string, key: MessageKey): Array<{ text: string } | { param: string }> {
  const node = lookup(locale, key);
  const template = typeof node === "string" ? node : key;
  return template.split(/(\{\w+\})/).filter(Boolean).map((part) => {
    const param = /^\{(\w+)\}$/.exec(part)?.[1];
    return param ? { param } : { text: part };
  });
}

// Messages that cross the Rust boundary (and messages kept in the store) travel
// as descriptors: `{"key":"backend.uxplay.stopped","params":{...}}`. Parameter
// values may themselves be descriptors, or arrays of them, which are joined.
// Anything that is not a descriptor (an OS error, a uxPlay log line, text saved
// by an older version) is shown as-is.

type DescriptorParam = string | number | DescriptorParam[];
export interface MessageDescriptor {
  key: string;
  params?: Record<string, DescriptorParam>;
}

export function encodeMessage(key: MessageKey | PluralKey, params?: Params): string {
  return JSON.stringify(params ? { key, params } : { key });
}

export function decodeMessage(raw: string): MessageDescriptor | null {
  if (!raw.startsWith("{") || !raw.includes("\"key\"")) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || typeof (value as MessageDescriptor).key !== "string") return null;
    const params = (value as MessageDescriptor).params;
    if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) return null;
    return value as MessageDescriptor;
  } catch {
    return null;
  }
}

function renderParam(locale: string, value: DescriptorParam): string {
  if (Array.isArray(value)) return value.map((item) => renderParam(locale, item)).join(" · ");
  return typeof value === "number" ? String(value) : translateMessage(locale, value);
}

export function translateMessage(locale: string, raw: string | null | undefined): string {
  if (!raw) return "";
  const descriptor = decodeMessage(raw);
  if (!descriptor) return raw;
  const node = lookup(locale, descriptor.key);
  if (node === undefined) return raw;
  const params = Object.fromEntries(Object.entries(descriptor.params ?? {}).map(([name, value]) => [name, renderParam(locale, value)]));
  const count = Number(descriptor.params?.count);
  const template = pluralTemplate(locale, node, Number.isFinite(count) ? count : 0);
  return template === undefined ? raw : format(template, params);
}

/** True when the message, or any message nested in its parameters, has this key and parameters. */
export function messageMentions(raw: string | null | undefined, key: string, params: Params = {}): boolean {
  const descriptor = raw ? decodeMessage(raw) : null;
  if (!descriptor) return false;
  const own = descriptor.params ?? {};
  if (descriptor.key === key && Object.entries(params).every(([name, value]) => String(own[name]) === String(value))) return true;
  const nested = (value: DescriptorParam): boolean => Array.isArray(value) ? value.some(nested) : typeof value === "string" && messageMentions(value, key, params);
  return Object.values(own).some(nested);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
