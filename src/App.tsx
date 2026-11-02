import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { I18nProvider } from "@heroui/react";
import { Navigation } from "./components/Navigation";
import { WindowChrome } from "./components/WindowChrome";
import { parseLyrics } from "./lib/lyrics";
import { interpolatedProgress, type ProgressSample } from "./lib/progressClock";
import { isSameSong } from "./lib/trackIdentity";
import { fontFamilyFor, fontWeightFor } from "./lib/fonts";
import { command, isTauri, onEvent } from "./lib/tauri";
import { followSystemTheme } from "./lib/theme";
import { detectLocale, encodeMessage, errorText, translate, useI18n } from "./i18n";
import { LibraryPage } from "./pages/LibraryPage";
import { NowPlayingPage } from "./pages/NowPlayingPage";
import { ReceiverPage } from "./pages/ReceiverPage";
import { SettingsPage } from "./pages/SettingsPage";
import { DEFAULT_CONFIG, useAppStore } from "./store";
import type { AppConfig, AudioDevice, LibraryEntry, LyricsCandidate, TrackMetadata, UxPlayEvent } from "./types";

const PAGES = { receiver: ReceiverPage, "now-playing": NowPlayingPage, library: LibraryPage, settings: SettingsPage };

export default function App() {
  const store = useAppStore();
  const { locale } = useI18n();
  const PageComponent = PAGES[store.page];
  const demoActive = Boolean(store.track?.isDemo && store.servicePhase === "streaming");
  const demoDuration = store.track?.durationMs ?? 84_000;
  const progressSample = useRef<ProgressSample | null>(null);

  useEffect(() => {
    const actions = useAppStore.getState();
    let cancelled = false;
    let latestLyricsRequest = 0;
    const unlisten: Array<() => void> = [];
    const boot = async () => {
      const systemLanguage = detectLocale(navigator.languages ?? [navigator.language]);
      if (!isTauri()) { actions.setConfig({ ...DEFAULT_CONFIG, language: systemLanguage }); actions.setDevices([{ id: "demo-speakers", name: encodeMessage("demo.speakers"), isDefault: false }, { id: "demo-headphones", name: encodeMessage("demo.headphones"), isDefault: true }]); return; }
      try {
        const [loaded, devices, library] = await Promise.all([
          command<AppConfig>("get_config"), command<AudioDevice[]>("list_audio_devices"), command<LibraryEntry[]>("list_library"),
        ]);
        // The first start has no saved language: adopt the system one and keep it.
        const config = loaded.language ? loaded : await command<AppConfig>("update_config", { patch: { language: systemLanguage } }).catch(() => ({ ...loaded, language: systemLanguage }));
        if (!cancelled) { actions.setConfig(config); actions.setDevices(devices); actions.setLibrary(library); }
        unlisten.push(await onEvent<UxPlayEvent>("uxplay://event", (event) => {
          actions.setService(event.phase, event.message);
          if (event.positionMs != null) {
            progressSample.current = { positionMs: event.positionMs, receivedAt: performance.now() };
            actions.setPosition(event.positionMs);
          } else if (event.phase !== "streaming") {
            progressSample.current = null;
            actions.setPosition(0);
          }
        }));
        unlisten.push(await onEvent<TrackMetadata>("metadata://changed", (track) => {
          const previous = useAppStore.getState();
          const sameSong = isSameSong(previous.track, track);
          const keepLyrics = sameSong && (previous.lyricsState === "ready" || previous.lyricsState === "searching");
          if (!sameSong) {
            progressSample.current = null;
            actions.setPosition(0);
          }
          actions.setTrack(track);
          actions.setPage("now-playing");
          if (!keepLyrics) void resolveLyrics(track);
        }));
        unlisten.push(await onEvent<AudioDevice[]>("audio://devices-changed", actions.setDevices));
        const dragUnlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "drop" && event.payload.paths.length) void importDroppedLyrics(event.payload.paths[0]);
        });
        unlisten.push(dragUnlisten);
        await command("start_uxplay");
      } catch (error) { actions.setService("error", errorText(error)); }
    };
    const resolveLyrics = async (track: TrackMetadata) => {
      const requestId = ++latestLyricsRequest;
      actions.setLyrics(undefined);
      actions.setLyricsState("searching");
      try {
        const candidate = await command<LyricsCandidate | null>("resolve_lyrics", { track });
        if (cancelled || requestId !== latestLyricsRequest) return;
        if (!candidate) { actions.setLyrics(undefined); actions.setLyricsState("not-found"); return; }
        actions.setLyrics(candidate, parseLyrics(candidate.content, candidate.format));
      } catch (error) { if (!cancelled && requestId === latestLyricsRequest) actions.setLyricsError(errorText(error)); }
    };
    const importDroppedLyrics = async (path: string) => {
      if (!/\.(ttml|lrc|elrc)$/i.test(path)) return;
      try {
        const candidate = await command<LyricsCandidate>("import_lyrics_for_current_track", { path });
        actions.setLyrics(candidate, parseLyrics(candidate.content, candidate.format));
      } catch (error) { actions.setService("error", errorText(error)); }
    };
    void boot();
    return () => { cancelled = true; latestLyricsRequest++; unlisten.forEach((dispose) => dispose()); };
  }, []);

  useEffect(() => followSystemTheme(), []);

  useEffect(() => {
    document.documentElement.lang = locale;
    if (!isTauri()) return;
    // Rust draws the tray menu and the Spotify callback page itself.
    void command("set_native_strings", {
      strings: {
        trayShow: translate(locale, "native.trayShow"),
        trayStart: translate(locale, "native.trayStart"),
        trayStop: translate(locale, "native.trayStop"),
        trayQuit: translate(locale, "native.trayQuit"),
        trayTooltip: translate(locale, "native.trayTooltip"),
        spotifyLinkedPage: translate(locale, "native.spotifyLinkedPage"),
        spotifyMismatchPage: translate(locale, "native.spotifyMismatchPage"),
      },
    }).catch(() => undefined);
  }, [locale]);

  useEffect(() => {
    if (!demoActive) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const state = useAppStore.getState();
      state.setPosition((state.positionMs + now - previous) % demoDuration);
      previous = now;
    }, 50);
    return () => window.clearInterval(timer);
  }, [demoActive, demoDuration]);

  useEffect(() => {
    if (demoActive || store.servicePhase !== "streaming") return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const state = useAppStore.getState();
      const now = performance.now();
      if (state.track && !state.track.isDemo) {
        if (state.config.syncWithUxplayProgress) {
          if (progressSample.current) state.setPosition(interpolatedProgress(progressSample.current, now));
        } else {
          state.setPosition(state.positionMs + now - previous);
        }
      }
      previous = now;
    }, 50);
    return () => window.clearInterval(timer);
  }, [demoActive, store.servicePhase]);

  return (
    <I18nProvider locale={locale}>
      <div className={`app-shell ${isTauri() ? "has-custom-chrome" : ""}`} style={{ "--app-font": fontFamilyFor(store.config.uiFont), "--app-font-weight": fontWeightFor(store.config.uiFont), "--lyrics-font": fontFamilyFor(store.config.lyricsFont) } as React.CSSProperties}>
        {isTauri() && <WindowChrome />}
        <Navigation page={store.page} onChange={store.setPage} live={Boolean(store.track) && store.servicePhase === "streaming"} />
        <div className={`page-stage${store.page === "now-playing" ? " now-playing-stage" : ""}`}>
          <div key={store.page} className="page-motion page-enter"><PageComponent /></div>
        </div>
      </div>
    </I18nProvider>
  );
}
