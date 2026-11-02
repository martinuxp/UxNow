import { Button, Card, Input, Slider, TextField } from "@heroui/react";
import { Activity, Check, Database, FlaskConical, Info, KeyRound, Link2, MonitorUp, Network, Paintbrush, Radio, RefreshCw, ShieldCheck, Speaker, Sparkles, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { disable as disableAutostart, enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import { useEffect, useMemo, useRef, useState } from "react";
import { UxSelect, UxSwitch } from "../components/UiControls";
import { command, isTauri, onEvent } from "../lib/tauri";
import { FALLBACK_FONT_OPTIONS, fontFamilyFor, fontLabel, fontStyleFor, fontWeightFor } from "../lib/fonts";
import { encodeMessage, errorText, LOCALE_CODES, LOCALES, useI18n, type MessageKey } from "../i18n";
import { readThemePreference, saveThemePreference, type ThemePreference } from "../lib/theme";
import { useAppStore } from "../store";
import type { AppConfig, Diagnostics, FontChoice, SpotifyLinkStatus } from "../types";

const LYRIC_PROVIDERS: ReadonlyArray<{ id: string; name: string; detail: MessageKey }> = [
  { id: "binimum", name: "BiniLyrics", detail: "settings.lyrics.providers.binimum" },
  { id: "unison", name: "Unison", detail: "settings.lyrics.providers.unison" },
  { id: "lrclib", name: "LRCLIB", detail: "settings.lyrics.providers.lrclib" },
];
const LANGUAGE_OPTIONS = LOCALE_CODES.map((code) => ({ id: code, label: LOCALES[code].name }));

interface UxPlayExecutable {
  effectivePath: string | null;
  bundledPath: string | null;
}

export function SettingsPage() {
  const { config, devices, diagnostics, patchConfig, setConfig, setDiagnostics, activateDemo } = useAppStore();
  const { locale, t, tm } = useI18n();
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);
  const [systemFonts, setSystemFonts] = useState<FontChoice[]>(FALLBACK_FONT_OPTIONS);
  const [spotify, setSpotify] = useState<SpotifyLinkStatus>({ connected: false, linking: false, message: encodeMessage("backend.spotify.notLinked") });
  const [diagnosing, setDiagnosing] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [uxplayExecutable, setUxplayExecutable] = useState<UxPlayExecutable | null>(null);
  const [globalOffset, setGlobalOffset] = useState(config.globalLyricsOffsetMs);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveRevision = useRef(0);

  useEffect(() => {
    if (!isTauri()) return;
    void command<FontChoice[]>("list_system_fonts").then((fonts) => setSystemFonts([...FALLBACK_FONT_OPTIONS, ...fonts])).catch(() => setSystemFonts(FALLBACK_FONT_OPTIONS));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void command<UxPlayExecutable>("get_uxplay_executable").then(setUxplayExecutable).catch(() => setUxplayExecutable(null));
  }, [config.uxplayPath]);

  useEffect(() => {
    if (!isTauri()) return;
    let dispose: () => void = () => undefined;
    void command<SpotifyLinkStatus>("get_spotify_link_status").then(setSpotify).catch(() => undefined);
    void onEvent<SpotifyLinkStatus>("spotify://link-state", setSpotify).then((unlisten) => { dispose = unlisten; });
    return () => dispose();
  }, []);

  useEffect(() => setGlobalOffset(config.globalLyricsOffsetMs), [config.globalLyricsOffsetMs]);

  const fontOptions = useMemo(() => [...new Set([...systemFonts, config.uiFont, config.lyricsFont])], [systemFonts, config.uiFont, config.lyricsFont]);

  const persist = async (patch: Partial<AppConfig>) => {
    setSettingsError("");
    patchConfig(patch);
    if (!isTauri()) return;
    const revision = ++saveRevision.current;
    const operation = saveQueue.current.then(() => command<AppConfig>("update_config", { patch }));
    saveQueue.current = operation.then(() => undefined, () => undefined);
    try {
      const saved = await operation;
      if (revision === saveRevision.current) {
        setConfig(saved);
        if ("uxplayPath" in patch) {
          void command<UxPlayExecutable>("get_uxplay_executable").then(setUxplayExecutable).catch(() => undefined);
        }
      }
    } catch (error) {
      if (revision === saveRevision.current) {
        try { setConfig(await command<AppConfig>("get_config")); } catch { /* Keep the last visible value if reload fails. */ }
        setSettingsError(encodeMessage("settings.saveFailed", { error: errorText(error) }));
      }
    }
  };

  const chooseBinary = async () => {
    const selected = await open({ multiple: false, filters: [{ name: "uxPlay", extensions: ["exe"] }], title: t("settings.receiver.pickExecutable") });
    if (selected && !Array.isArray(selected)) await persist({ uxplayPath: selected });
  };

  const runDiagnostics = async () => {
    if (!isTauri()) return;
    setDiagnosing(true);
    try { setDiagnostics(await command<Diagnostics>("run_diagnostics")); }
    finally { setDiagnosing(false); }
  };

  const setAutostart = async (value: boolean) => {
    try {
      if (isTauri()) { if (value) await enableAutostart(); else await disableAutostart(); }
      await persist({ startWithWindows: value });
    } catch (error) {
      setSettingsError(encodeMessage("settings.autostartFailed", { error: errorText(error) }));
    }
  };

  const setProviderEnabled = (provider: string, enabled: boolean) => {
    const current = useAppStore.getState().config.enabledProviders;
    const enabledProviders = enabled ? [...new Set([...current, provider])] : current.filter((value) => value !== provider);
    void persist({ enabledProviders });
  };

  const linkSpotify = async () => { if (isTauri()) setSpotify(await command<SpotifyLinkStatus>("start_spotify_link")); };
  const deviceOptions = devices.map((device) => ({ id: device.id, label: tm(device.name), description: device.isDefault ? t("settings.output.windowsDefault") : undefined }));
  const fonts = fontOptions.map((font) => ({ id: font, label: tm(fontLabel(font)) }));
  const uxplayDescription = config.uxplayPath && uxplayExecutable?.effectivePath === config.uxplayPath
    ? t("settings.receiver.chosen", { path: config.uxplayPath })
    : uxplayExecutable?.bundledPath && uxplayExecutable.effectivePath === uxplayExecutable.bundledPath
      ? t(config.uxplayPath ? "settings.receiver.bundledOverride" : "settings.receiver.bundled", { path: uxplayExecutable.bundledPath })
      : uxplayExecutable?.effectivePath
        ? t("settings.receiver.detected", { path: uxplayExecutable.effectivePath })
        : t("settings.receiver.missing");

  return (
    <main className="page settings-page">
      <header className="page-header"><div><h1>{t("settings.title")}</h1><p>{t("settings.subtitle")}</p></div></header>
      {settingsError && <p className="settings-error" role="alert">{tm(settingsError)}</p>}
      <div className="settings-layout">
        <div className="settings-stack">
          <SettingsSection title={t("settings.appearance.title")} icon={<Paintbrush />}>
            <SettingRow title={t("settings.appearance.language")} description={t("settings.appearance.languageDescription")}><UxSelect className="setting-control" value={locale} options={LANGUAGE_OPTIONS} label={t("settings.appearance.language")} onChange={(language) => { if (language) void persist({ language }); }} /></SettingRow>
            <SettingRow title={t("settings.appearance.theme")} description={t("settings.appearance.themeDescription")}><UxSelect className="setting-control" value={theme} options={[{ id: "system", label: t("settings.appearance.themeSystem"), description: t("settings.appearance.themeSystemDescription") }, { id: "light", label: t("settings.appearance.themeLight") }, { id: "dark", label: t("settings.appearance.themeDark") }]} label={t("settings.appearance.theme")} onChange={(value) => { const next = value as ThemePreference; setTheme(next); saveThemePreference(next); }} /></SettingRow>
            <SettingRow title={t("settings.appearance.uiFont")} description={t("settings.appearance.uiFontDescription")}><UxSelect className="setting-control font-select" value={config.uiFont} options={fonts} label={t("settings.appearance.uiFont")} onChange={(uiFont) => void persist({ uiFont })} /></SettingRow>
            <SettingRow title={t("settings.appearance.lyricsFont")} description={t("settings.appearance.lyricsFontDescription")}><UxSelect className="setting-control font-select" value={config.lyricsFont} options={fonts} label={t("settings.appearance.lyricsFont")} onChange={(lyricsFont) => void persist({ lyricsFont })} /></SettingRow>
            <div className="font-preview" aria-label={t("settings.appearance.previewLabel")}>
              <div style={{ fontFamily: fontFamilyFor(config.uiFont), fontWeight: fontWeightFor(config.uiFont), fontStyle: fontStyleFor(config.uiFont) }}><span>{t("settings.appearance.previewUi")}</span><strong>{t("settings.appearance.previewUiTitle")}</strong><small>{t("settings.appearance.previewUiDetail")}</small></div>
              <div style={{ fontFamily: fontFamilyFor(config.lyricsFont), fontWeight: fontWeightFor(config.lyricsFont, 600), fontStyle: fontStyleFor(config.lyricsFont) }}><span>{t("settings.appearance.previewLyrics")}</span><strong>{t("settings.appearance.previewLyricsTitle")}</strong><small>{t("settings.appearance.previewLyricsDetail")}</small></div>
            </div>
          </SettingsSection>

          <SettingsSection title={t("settings.receiver.title")} icon={<Radio />}>
            <SettingRow title={t("settings.receiver.name")} description={t("settings.receiver.nameDescription")}>
              <TextField className="setting-control" value={config.receiverName} onChange={(receiverName) => patchConfig({ receiverName })} onBlur={() => void persist({ receiverName: config.receiverName })} aria-label={t("settings.receiver.name")}><Input /></TextField>
            </SettingRow>
            <SettingRow title={t("settings.receiver.executable")} description={t("settings.receiver.executableDescription", { source: uxplayDescription })}><div className="setting-control-actions"><Button size="sm" variant="secondary" onPress={chooseBinary}>{t("settings.receiver.chooseOther")}</Button>{config.uxplayPath && uxplayExecutable?.bundledPath && <Button size="sm" variant="secondary" onPress={() => void persist({ uxplayPath: "" })}>{t("settings.receiver.useBundled")}</Button>}</div></SettingRow>

          </SettingsSection>

          <SettingsSection title={t("settings.output.title")} icon={<Speaker />}>
            <SettingRow title={t("settings.output.device")} description={t("settings.output.deviceDescription")}><UxSelect className="setting-control" value={config.preferredAudioDeviceId ?? ""} options={deviceOptions} label={t("settings.output.device")} placeholder={t("settings.output.devicePlaceholder")} onChange={(preferredAudioDeviceId) => void persist({ preferredAudioDeviceId })} /></SettingRow>
            <div className="setting-note"><Info size={17} /><p>{t("settings.output.note")}</p></div>
          </SettingsSection>

          <SettingsSection title={t("settings.startup.title")} icon={<ShieldCheck />}>
            <SettingRow title={t("settings.startup.withWindows")} description={t("settings.startup.withWindowsDescription")}><UxSwitch label={t("settings.startup.withWindows")} selected={config.startWithWindows} onChange={(value) => void setAutostart(value)} /></SettingRow>
            <SettingRow title={t("settings.startup.minimized")} description={t("settings.startup.minimizedDescription")}><UxSwitch label={t("settings.startup.minimized")} selected={config.startMinimized} onChange={(startMinimized) => void persist({ startMinimized })} /></SettingRow>
            <div className="setting-note"><Info size={17} /><p>{t("settings.startup.trayNote")}</p></div>
            <SettingRow title={t("settings.startup.keepAwake")} description={t("settings.startup.keepAwakeDescription")}><UxSwitch label={t("settings.startup.keepAwake")} selected={config.keepAwake} onChange={(keepAwake) => void persist({ keepAwake })} /></SettingRow>
          </SettingsSection>

          <SettingsSection title={t("settings.access.title")} icon={<KeyRound />}>
            <SettingRow title={t("settings.access.pin")} description={t("settings.access.pinDescription")}><UxSwitch label={t("settings.access.pin")} selected={config.pinEnabled} onChange={(pinEnabled) => void persist({ pinEnabled })} /></SettingRow>
            {config.pinEnabled && <SettingRow title={t("settings.access.fixedPin")} description={t("settings.access.fixedPinDescription")}><TextField className="setting-control pin-field" value={config.pin} onChange={(pin) => patchConfig({ pin: pin.replace(/\D/g, "").slice(0, 4) })} onBlur={() => void persist({ pin: config.pin })} aria-label={t("settings.access.fixedPin")}><Input inputMode="numeric" placeholder={t("settings.access.fixedPinPlaceholder")} /></TextField></SettingRow>}
          </SettingsSection>

          <SettingsSection title={t("settings.lyrics.title")} icon={<Database />}>
            <SettingRow title={t("settings.lyrics.sync")} description={t("settings.lyrics.syncDescription")}><UxSwitch label={t("settings.lyrics.syncLabel")} selected={config.syncWithUxplayProgress} onChange={(syncWithUxplayProgress) => void persist({ syncWithUxplayProgress })} /></SettingRow>
            <SettingRow title={t("settings.lyrics.globalOffset")} description={t("settings.lyrics.globalOffsetDescription")}><div className="global-offset-control"><Slider className="offset-slider" aria-label={t("settings.lyrics.globalOffsetLabel")} minValue={-5000} maxValue={5000} step={50} value={globalOffset} onChange={(value) => setGlobalOffset(Number(value))} onChangeEnd={(value) => void persist({ globalLyricsOffsetMs: Number(value) })}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider><output>{globalOffset >= 0 ? "+" : ""}{(globalOffset / 1000).toFixed(2)} s</output></div></SettingRow>
            <SettingRow title={t("settings.lyrics.online")} description={t("settings.lyrics.onlineDescription")}><UxSwitch label={t("settings.lyrics.onlineLabel")} selected={config.onlineLyricsConsent} onChange={(onlineLyricsConsent) => void persist({ onlineLyricsConsent })} /></SettingRow>
            <div className="provider-list" aria-label={t("settings.lyrics.providersLabel")}>
              {LYRIC_PROVIDERS.map((provider) => <div key={provider.id}><div><strong>{provider.name}</strong><small>{t(provider.detail)}</small></div><UxSwitch label={t("settings.lyrics.enableProvider", { name: provider.name })} selected={config.enabledProviders.includes(provider.id)} onChange={(value) => setProviderEnabled(provider.id, value)} /></div>)}
            </div>
            <div className="spicy-connection"><div className="spicy-icon"><Sparkles size={17} /></div><div><strong>SpicyLyrics</strong><p>{t("settings.lyrics.spicyDescription")}</p><small>{tm(spotify.message)}</small>{!spotify.connected && <Button className="spicy-link" size="sm" variant="secondary" isDisabled={spotify.linking} isPending={spotify.linking} onPress={linkSpotify}><Link2 size={15} />{t(spotify.linking ? "settings.lyrics.spotifyWaiting" : "settings.lyrics.spotifyLink")}</Button>}</div><UxSwitch label={t("settings.lyrics.enableProvider", { name: "SpicyLyrics" })} selected={config.spicyLyricsEnabled} onChange={(spicyLyricsEnabled) => void persist({ spicyLyricsEnabled })} /></div>
            <SettingRow title={t("settings.lyrics.cache")} description={t("settings.lyrics.cacheDescription")}><Button size="sm" variant="danger-soft" onPress={() => void command("clear_lyrics_cache")}><Trash2 size={15} />{t("settings.lyrics.clearCache")}</Button></SettingRow>
          </SettingsSection>
          <SettingsSection title={t("settings.testing.title")} icon={<FlaskConical />}>
            <SettingRow title={t("settings.testing.demoMode")} description={t("settings.testing.demoModeDescription")}><UxSwitch label={t("settings.testing.demoMode")} selected={config.demoMode} onChange={(demoMode) => void persist({ demoMode })} /></SettingRow>
            <SettingRow title={t("settings.testing.demoSession")} description={t("settings.testing.demoSessionDescription")}><Button size="sm" variant="secondary" isDisabled={!config.demoMode} onPress={activateDemo}>{t("settings.testing.openDemo")}</Button></SettingRow>
          </SettingsSection>
        </div>

        <Card className="diagnostics ux-card" variant="secondary">
          <Card.Header><span className="icon-well"><Activity /></span><div><Card.Title>{t("settings.diagnostics.title")}</Card.Title><Card.Description>{t("settings.diagnostics.description")}</Card.Description></div></Card.Header>
          <Card.Content>
            <Button fullWidth variant="secondary" onPress={runDiagnostics} isPending={diagnosing}><RefreshCw size={16} />{t(diagnosing ? "settings.diagnostics.checking" : "settings.diagnostics.check")}</Button>
            {diagnostics ? <DiagnosticResults diagnostics={diagnostics} /> : <div className="diagnostic-placeholder"><Network /><p>{t("settings.diagnostics.placeholder")}</p></div>}
            <div className="privacy-card"><MonitorUp /><div><strong>{t("settings.diagnostics.privacyTitle")}</strong><p>{t("settings.diagnostics.privacyBody")}</p></div></div>
          </Card.Content>
        </Card>
      </div>
    </main>
  );
}

function SettingsSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <Card className="settings-section ux-card" variant="secondary"><Card.Header>{icon}<Card.Title>{title}</Card.Title></Card.Header><Card.Content>{children}</Card.Content></Card>;
}
function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div>{children}</div>; }
function DiagnosticResults({ diagnostics }: { diagnostics: Diagnostics }) { const { tm } = useI18n(); return <div className="diagnostic-results">{Object.entries(diagnostics).map(([key, item]) => <div className={item.ok ? "ok" : "warn"} key={key}><i>{item.ok ? <Check size={12} /> : "!"}</i><span><strong>{tm(item.label)}</strong><small>{tm(item.detail)}</small></span></div>)}</div>; }
