export type Page = "receiver" | "now-playing" | "library" | "settings";
export type SyncType = "word" | "line" | "static";
export type ServicePhase = "stopped" | "starting" | "ready" | "connecting" | "streaming" | "error";
export type FontChoice = string;

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface TrackMetadata {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  coverDataUrl?: string;
  isDemo?: boolean;
}

export interface LyricWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface LyricLine {
  text: string;
  startTime: number;
  endTime: number;
  words: LyricWord[];
  translatedText?: string;
  isBackground?: boolean;
  isDuet?: boolean;
}

export interface LyricsCandidate {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  syncType: SyncType;
  format: "ttml" | "lrc" | "elrc" | "text" | "spicy";
  content: string;
  translation?: string;
  source: string;
  attribution: string;
  attributionLinks?: { label: string; url: string }[];
  sourceUrl?: string;
  confidence: number;
  offsetMs: number;
}

export interface LibraryEntry {
  id: number;
  path: string;
  fileName: string;
  format: string;
  parseError?: string;
  associatedTrack?: string;
}

export interface Diagnostics {
  uxplay: DiagnosticItem;
  gstreamer: DiagnosticItem;
  wasapi: DiagnosticItem;
  network: DiagnosticItem;
  firewall: DiagnosticItem;
  audio: DiagnosticItem;
  binimum: DiagnosticItem;
}

export interface DiagnosticItem {
  ok: boolean;
  label: string;
  detail: string;
}

export interface AppConfig {
  receiverName: string;
  uxplayPath: string;
  pinEnabled: boolean;
  pin: string;
  preferredAudioDeviceId?: string;
  startWithWindows: boolean;
  startMinimized: boolean;
  demoMode: boolean;
  onlineLyricsConsent: boolean;
  localLyricsFolders: string[];
  providerOrder: string[];
  enabledProviders: string[];
  keepAwake: boolean;
  spicyLyricsEnabled: boolean;
  uiFont: FontChoice;
  lyricsFont: FontChoice;
  globalLyricsOffsetMs: number;
  syncWithUxplayProgress: boolean;
}


export interface SpotifyLinkStatus {
  connected: boolean;
  linking: boolean;
  message: string;
}

export interface UxPlayEvent {
  message: string;
  phase: ServicePhase;
  clientId?: string;
  positionMs?: number;
  durationMs?: number;
}
