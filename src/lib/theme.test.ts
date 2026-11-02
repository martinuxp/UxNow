import { afterEach, describe, expect, it, vi } from "vitest";
import { followSystemTheme, readThemePreference, resolveTheme, saveThemePreference } from "./theme";

function mockSystemDark(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return { set: (dark: boolean) => { query.matches = dark; listeners.forEach((listener) => listener()); }, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.className = "";
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("resolves the system preference and honours explicit choices", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS while set to system and stops when disposed", () => {
    const system = mockSystemDark(false);
    const dispose = followSystemTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    system.set(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    dispose();
    expect(system.listeners.size).toBe(0);
  });

  it("keeps an explicit choice when the OS changes", () => {
    const system = mockSystemDark(true);
    saveThemePreference("light");
    const dispose = followSystemTheme();
    system.set(false);
    system.set(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(readThemePreference()).toBe("light");
    saveThemePreference("system");
    expect(localStorage.getItem("uxnow-theme")).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");
    dispose();
  });
});
