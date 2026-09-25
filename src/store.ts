import { create } from "zustand";
import { DEFAULT_LYRICS_FONT, DEFAULT_UI_FONT } from "./lib/fonts";
import { DEMO_CANDIDATE, DEMO_LINES, DEMO_TRACK } from "./demo";
import { lyricsSessionKey } from "./lib/trackIdentity";
import type { AppConfig, AudioDevice, Diagnostics, LibraryEntry, LyricLine, LyricsCandidate, Page, ServicePhase, TrackMetadata } from "./types";

export const DEFAULT_CONFIG: AppConfig = {
  receiverName: "UxNow",
  uxplayPath: "",
  pinEnabled: false,
  pin: "",
  startWithWindows: false,
  startMinimized: false,
  demoMode: true,
  onlineLyricsConsent: false,
  localLyricsFolders: [],
  providerOrder: ["local", "cache", "binimum", "unison", "lrclib"],
  enabledProviders: ["binimum", "unison", "lrclib"],
  keepAwake: true,
  spicyLyricsEnabled: false,
  uiFont: DEFAULT_UI_FONT,
  lyricsFont: DEFAULT_LYRICS_FONT,
  globalLyricsOffsetMs: 0,
  syncWithUxplayProgress: true,
};

interface AppStore {
  page: Page;
  config: AppConfig;
  servicePhase: ServicePhase;
  serviceMessage: string;
  track?: TrackMetadata;
  positionMs: number;
  devices: AudioDevice[];
  lyrics?: LyricsCandidate;
  lyricLines: LyricLine[];
  lyricsState: "idle" | "searching" | "ready" | "not-found" | "error";
  lyricsError?: string;
  sessionLyricsOffsets: Record<string, number>;
  library: LibraryEntry[];
  diagnostics?: Diagnostics;
  setPage: (page: Page) => void;
  setConfig: (config: AppConfig) => void;
  patchConfig: (patch: Partial<AppConfig>) => void;
  setService: (phase: ServicePhase, message: string) => void;
  setTrack: (track?: TrackMetadata) => void;
  setPosition: (positionMs: number) => void;
  setDevices: (devices: AudioDevice[]) => void;
  setLyrics: (lyrics?: LyricsCandidate, lines?: LyricLine[]) => void;
  setLyricsState: (state: AppStore["lyricsState"]) => void;
  setLyricsError: (error: string) => void;
  setSessionLyricsOffset: (track: TrackMetadata, offsetMs: number) => void;
  setLibrary: (library: LibraryEntry[]) => void;
  setDiagnostics: (diagnostics: Diagnostics) => void;
  activateDemo: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  page: "receiver",
  config: DEFAULT_CONFIG,
  servicePhase: "stopped",
  serviceMessage: "Inicia el receptor para aparecer en AirPlay.",
  positionMs: 0,
  devices: [],
  lyricLines: [],
  lyricsState: "idle",
  sessionLyricsOffsets: {},
  library: [],
  setPage: (page) => set({ page }),
  setConfig: (config) => set({ config }),
  patchConfig: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),
  setService: (servicePhase, serviceMessage) => set({ servicePhase, serviceMessage }),
  setTrack: (track) => set({ track }),
  setPosition: (positionMs) => set({ positionMs }),
  setDevices: (devices) => set({ devices }),
  setLyrics: (lyrics, lyricLines = []) => set({ lyrics, lyricLines, lyricsState: lyrics ? "ready" : "idle", lyricsError: undefined }),
  setLyricsState: (lyricsState) => set({ lyricsState, lyricsError: undefined }),
  setLyricsError: (lyricsError) => set({ lyrics: undefined, lyricLines: [], lyricsState: "error", lyricsError }),
  setSessionLyricsOffset: (track, offsetMs) => set((state) => ({
    sessionLyricsOffsets: { ...state.sessionLyricsOffsets, [lyricsSessionKey(track)]: Math.max(-1000, Math.min(1000, offsetMs)) },
  })),
  setLibrary: (library) => set({ library }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  activateDemo: () => set({
    page: "now-playing",
    servicePhase: "streaming",
    serviceMessage: "Sesión de demostración",
    track: DEMO_TRACK,
    lyrics: DEMO_CANDIDATE,
    lyricLines: DEMO_LINES,
    lyricsState: "ready",
    positionMs: 0,
  }),
}));
