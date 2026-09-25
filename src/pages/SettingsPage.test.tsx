import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, useAppStore } from "../store";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  useAppStore.getState().setConfig({ ...DEFAULT_CONFIG, enabledProviders: [...DEFAULT_CONFIG.enabledProviders] });
});

describe("settings switches", () => {
  it("changes a boolean setting in both directions", () => {
    useAppStore.getState().setConfig({ ...DEFAULT_CONFIG });
    render(<SettingsPage />);
    const switchElement = screen.getByRole("switch", { name: "Buscar letras online" });
    fireEvent.click(switchElement);
    expect(useAppStore.getState().config.onlineLyricsConsent).toBe(true);
    fireEvent.click(switchElement);
    expect(useAppStore.getState().config.onlineLyricsConsent).toBe(false);
  });

  it("allows disabling every online provider", () => {
    useAppStore.getState().setConfig({ ...DEFAULT_CONFIG, enabledProviders: [...DEFAULT_CONFIG.enabledProviders] });
    render(<SettingsPage />);
    for (const name of ["BiniLyrics", "Unison", "LRCLIB"]) {
      fireEvent.click(screen.getByRole("switch", { name: "Activar " + name }));
    }
    expect(useAppStore.getState().config.enabledProviders).toEqual([]);
  });

  it("allows toggling uxPlay progress synchronization independently of the global offset", () => {
    useAppStore.getState().setConfig({ ...DEFAULT_CONFIG, globalLyricsOffsetMs: 750 });
    render(<SettingsPage />);
    const toggle = screen.getByRole("switch", { name: "Sincronizar con el progreso de uxPlay" });
    fireEvent.click(toggle);
    expect(useAppStore.getState().config.syncWithUxplayProgress).toBe(false);
    expect(useAppStore.getState().config.globalLyricsOffsetMs).toBe(750);
    fireEvent.click(toggle);
    expect(useAppStore.getState().config.syncWithUxplayProgress).toBe(true);
  });
});
