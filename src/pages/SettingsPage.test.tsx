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
});
