import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Navigation } from "./components/Navigation";
import { WindowChrome } from "./components/WindowChrome";
import { parseLyrics } from "./lib/lyrics";
import { isSameSong } from "./lib/trackIdentity";
import { fontFamilyFor, fontWeightFor } from "./lib/fonts";
import { command, isTauri, onEvent } from "./lib/tauri";
import { LibraryPage } from "./pages/LibraryPage";
import { NowPlayingPage } from "./pages/NowPlayingPage";
import { ReceiverPage } from "./pages/ReceiverPage";
import { SettingsPage } from "./pages/SettingsPage";
import { DEFAULT_CONFIG, useAppStore } from "./store";
import type { AppConfig, AudioDevice, LibraryEntry, LyricsCandidate, TrackMetadata, UxPlayEvent } from "./types";

const PAGES = { receiver: ReceiverPage, "now-playing": NowPlayingPage, library: LibraryPage, settings: SettingsPage };

export default function App() {
  const store = useAppStore();
  const PageComponent = PAGES[store.page];
  const demoActive = Boolean(store.track?.isDemo && store.servicePhase === "streaming");
  const demoDuration = store.track?.durationMs ?? 84_000;

  useEffect(() => {
    const actions = useAppStore.getState();
    let cancelled = false;
    let latestLyricsRequest = 0;
    const unlisten: Array<() => void> = [];
    const boot = async () => {
      if (!isTauri()) { actions.setConfig(DEFAULT_CONFIG); actions.setDevices([{ id: "demo-speakers", name: "Bocinas del escritorio", isDefault: false }, { id: "demo-headphones", name: "Audífonos", isDefault: true }]); return; }
      try {
        const [config, devices, library] = await Promise.all([
          command<AppConfig>("get_config"), command<AudioDevice[]>("list_audio_devices"), command<LibraryEntry[]>("list_library"),
        ]);
        if (!cancelled) { actions.setConfig(config); actions.setDevices(devices); actions.setLibrary(library); }
        unlisten.push(await onEvent<UxPlayEvent>("uxplay://event", (event) => { actions.setService(event.phase, event.message); if (event.positionMs != null) actions.setPosition(event.positionMs); }));
        unlisten.push(await onEvent<TrackMetadata>("metadata://changed", (track) => {
          const previous = useAppStore.getState();
          const keepLyrics = isSameSong(previous.track, track) && (previous.lyricsState === "ready" || previous.lyricsState === "searching");
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
      } catch (error) { actions.setService("error", String(error)); }
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
      } catch (error) { if (!cancelled && requestId === latestLyricsRequest) actions.setLyricsError(String(error)); }
    };
    const importDroppedLyrics = async (path: string) => {
      if (!/\.(ttml|lrc|elrc)$/i.test(path)) return;
      try {
        const candidate = await command<LyricsCandidate>("import_lyrics_for_current_track", { path });
        actions.setLyrics(candidate, parseLyrics(candidate.content, candidate.format));
      } catch (error) { actions.setService("error", String(error)); }
    };
    void boot();
    return () => { cancelled = true; latestLyricsRequest++; unlisten.forEach((dispose) => dispose()); };
  }, []);

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
      const now = performance.now();
      const state = useAppStore.getState();
      state.setPosition(state.positionMs + now - previous);
      previous = now;
    }, 50);
    return () => window.clearInterval(timer);
  }, [demoActive, store.servicePhase]);

  return (
    <div className={`app-shell ${isTauri() ? "has-custom-chrome" : ""}`} style={{ "--app-font": fontFamilyFor(store.config.uiFont), "--app-font-weight": fontWeightFor(store.config.uiFont), "--lyrics-font": fontFamilyFor(store.config.lyricsFont) } as React.CSSProperties}>
      {isTauri() && <WindowChrome />}
      <Navigation page={store.page} onChange={store.setPage} />
      <div className={`page-stage${store.page === "now-playing" ? " now-playing-stage" : ""}`}>
        <div key={store.page} className="page-motion page-enter"><PageComponent /></div>
      </div>
    </div>
  );
}
