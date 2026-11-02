import { Fragment, createElement, useMemo, type ReactNode } from "react";
import { useAppStore } from "../store";
import {
  resolveLocale, templateParts, translate, translateMessage, translatePlural,
  type MessageKey, type Params, type PluralKey,
} from "./core";

export * from "./core";

/** Locale of the saved language, for code outside React (error boundaries, dialogs). */
export const currentLocale = () => resolveLocale(useAppStore.getState().config.language);

export function useI18n() {
  const locale = resolveLocale(useAppStore((state) => state.config.language));
  return useMemo(() => ({
    locale,
    /** Plain text for a catalog key. */
    t: (key: MessageKey, params?: Params) => translate(locale, key, params),
    /** Plural text; `{count}` is filled in. */
    tp: (key: PluralKey, count: number, params?: Params) => translatePlural(locale, key, count, params),
    /** Text with React nodes (links, bold text, line breaks) in its placeholders. */
    tr: (key: MessageKey, params: Record<string, ReactNode>): ReactNode => templateParts(locale, key).map((part, index) =>
      createElement(Fragment, { key: index }, "text" in part ? part.text : params[part.param] ?? `{${part.param}}`)),
    /** A message descriptor from Rust or the store, or raw text shown unchanged. */
    tm: (raw: string | null | undefined) => translateMessage(locale, raw),
  }), [locale]);
}
