import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { encodeMessage } from "../i18n/core";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error(encodeMessage("errors.desktopOnly"));
  return invoke<T>(name, args);
}

export async function onEvent<T>(name: string, callback: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<T>(name, ({ payload }) => callback(payload));
}
