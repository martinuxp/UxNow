import { Button, Card, Input, Slider, TextField } from "@heroui/react";
import { Activity, Check, Database, FlaskConical, Info, KeyRound, Link2, MonitorUp, Network, Paintbrush, Radio, RefreshCw, ShieldCheck, Speaker, Sparkles, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { disable as disableAutostart, enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import { useEffect, useMemo, useRef, useState } from "react";
import { UxSelect, UxSwitch } from "../components/UiControls";
import { command, isTauri, onEvent } from "../lib/tauri";
import { FALLBACK_FONT_OPTIONS, fontFamilyFor, fontLabel, fontStyleFor, fontWeightFor } from "../lib/fonts";
import { useAppStore } from "../store";
import type { AppConfig, Diagnostics, FontChoice, SpotifyLinkStatus } from "../types";

const LYRIC_PROVIDERS = [
  { id: "binimum", name: "BiniLyrics", detail: "TTML por palabra o por línea, sin clave." },
  { id: "unison", name: "Unison", detail: "TTML, LRC y texto aportado por la comunidad." },
  { id: "lrclib", name: "LRCLIB", detail: "Respaldo sincronizado y estático." },
] as const;

export function SettingsPage() {
  const { config, devices, diagnostics, patchConfig, setConfig, setDiagnostics, activateDemo } = useAppStore();
  const [systemFonts, setSystemFonts] = useState<FontChoice[]>(FALLBACK_FONT_OPTIONS);
  const [spotify, setSpotify] = useState<SpotifyLinkStatus>({ connected: false, linking: false, message: "Vincula Spotify para usar SpicyLyrics." });
  const [diagnosing, setDiagnosing] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [globalOffset, setGlobalOffset] = useState(config.globalLyricsOffsetMs);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveRevision = useRef(0);

  useEffect(() => {
    if (!isTauri()) return;
    void command<FontChoice[]>("list_system_fonts").then((fonts) => setSystemFonts([...FALLBACK_FONT_OPTIONS, ...fonts])).catch(() => setSystemFonts(FALLBACK_FONT_OPTIONS));
  }, []);

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
      if (revision === saveRevision.current) setConfig(saved);
    } catch (error) {
      if (revision === saveRevision.current) {
        try { setConfig(await command<AppConfig>("get_config")); } catch { /* Keep the last visible value if reload fails. */ }
        setSettingsError("No se pudo guardar el ajuste. Vuelve a intentarlo. " + String(error));
      }
    }
  };

  const chooseBinary = async () => {
    const selected = await open({ multiple: false, filters: [{ name: "uxPlay", extensions: ["exe"] }], title: "Selecciona uxplay.exe" });
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
      setSettingsError("No se pudo cambiar el inicio con Windows. " + String(error));
    }
  };

  const setProviderEnabled = (provider: string, enabled: boolean) => {
    const current = useAppStore.getState().config.enabledProviders;
    const enabledProviders = enabled ? [...new Set([...current, provider])] : current.filter((value) => value !== provider);
    void persist({ enabledProviders });
  };

  const linkSpotify = async () => { if (isTauri()) setSpotify(await command<SpotifyLinkStatus>("start_spotify_link")); };
  const deviceOptions = devices.map((device) => ({ id: device.id, label: device.name, description: device.isDefault ? "Salida predeterminada de Windows" : undefined }));
  const fonts = fontOptions.map((font) => ({ id: font, label: fontLabel(font) }));

  return (
    <main className="page settings-page">
      <header className="page-header"><div><h1>Ajustes</h1><p>Configura el receptor, la salida de audio y las fuentes de letras.</p></div></header>
      {settingsError && <p className="settings-error" role="alert">{settingsError}</p>}
      <div className="settings-layout">
        <div className="settings-stack">
          <SettingsSection title="Apariencia" icon={<Paintbrush />}>
            <SettingRow title="Fuente de la interfaz" description="Navegación, ajustes y controles."><UxSelect className="setting-control font-select" value={config.uiFont} options={fonts} label="Fuente de la interfaz" onChange={(uiFont) => void persist({ uiFont })} /></SettingRow>
            <SettingRow title="Fuente de las letras" description="También cambia las letras sincronizadas."><UxSelect className="setting-control font-select" value={config.lyricsFont} options={fonts} label="Fuente de las letras" onChange={(lyricsFont) => void persist({ lyricsFont })} /></SettingRow>
            <div className="font-preview" aria-label="Vista previa de tipografías">
              <div style={{ fontFamily: fontFamilyFor(config.uiFont), fontWeight: fontWeightFor(config.uiFont), fontStyle: fontStyleFor(config.uiFont) }}><span>Interfaz</span><strong>Texto de la aplicación</strong><small>Botones, navegación y ajustes.</small></div>
              <div style={{ fontFamily: fontFamilyFor(config.lyricsFont), fontWeight: fontWeightFor(config.lyricsFont, 600), fontStyle: fontStyleFor(config.lyricsFont) }}><span>Letras</span><strong>Letra sincronizada</strong><small>Vista previa del reproductor.</small></div>
            </div>
          </SettingsSection>

          <SettingsSection title="Receptor" icon={<Radio />}>
            <SettingRow title="Nombre en AirPlay" description="Así lo encontrarás desde el teléfono.">
              <TextField className="setting-control" value={config.receiverName} onChange={(receiverName) => patchConfig({ receiverName })} onBlur={() => void persist({ receiverName: config.receiverName })} aria-label="Nombre en AirPlay"><Input /></TextField>
            </SettingRow>
            <SettingRow title="Ejecutable de uxPlay" description={config.uxplayPath || "UxNow lo buscará automáticamente si no eliges uno."}><Button size="sm" variant="secondary" onPress={chooseBinary}>Seleccionar archivo</Button></SettingRow>

          </SettingsSection>

          <SettingsSection title="Salida de UxNow" icon={<Speaker />}>
            <SettingRow title="Dispositivo preferido" description="Solo el audio recibido por AirPlay usará esta salida."><UxSelect className="setting-control" value={config.preferredAudioDeviceId ?? ""} options={deviceOptions} label="Dispositivo preferido" placeholder="Selecciona una salida" onChange={(preferredAudioDeviceId) => void persist({ preferredAudioDeviceId })} /></SettingRow>
            <div className="setting-note"><Info size={17} /><p>La salida principal de Windows no cambia. Si eliges otro dispositivo durante una sesión, tendrás que volver a conectar AirPlay.</p></div>
          </SettingsSection>

          <SettingsSection title="Inicio y privacidad" icon={<ShieldCheck />}>
            <SettingRow title="Iniciar con Windows" description="Abre UxNow al entrar a tu cuenta."><UxSwitch label="Iniciar con Windows" selected={config.startWithWindows} onChange={(value) => void setAutostart(value)} /></SettingRow>
            <SettingRow title="Iniciar minimizado" description="Deja UxNow disponible en la bandeja."><UxSwitch label="Iniciar minimizado" selected={config.startMinimized} onChange={(startMinimized) => void persist({ startMinimized })} /></SettingRow>
            <div className="setting-note"><Info size={17} /><p>La X oculta UxNow en la bandeja; el receptor sigue activo. Para cerrar la app, usa «Salir» en el menú del icono.</p></div>
            <SettingRow title="Mantener la pantalla activa" description="Solo mientras llega audio por AirPlay."><UxSwitch label="Mantener la pantalla activa" selected={config.keepAwake} onChange={(keepAwake) => void persist({ keepAwake })} /></SettingRow>
          </SettingsSection>

          <SettingsSection title="Acceso" icon={<KeyRound />}>
            <SettingRow title="Solicitar PIN" description="Pide autenticación al conectar un dispositivo nuevo."><UxSwitch label="Solicitar PIN" selected={config.pinEnabled} onChange={(pinEnabled) => void persist({ pinEnabled })} /></SettingRow>
            {config.pinEnabled && <SettingRow title="PIN fijo" description="Déjalo vacío para generar uno nuevo."><TextField className="setting-control pin-field" value={config.pin} onChange={(pin) => patchConfig({ pin: pin.replace(/\D/g, "").slice(0, 4) })} onBlur={() => void persist({ pin: config.pin })} aria-label="PIN fijo"><Input inputMode="numeric" placeholder="Aleatorio" /></TextField></SettingRow>}
          </SettingsSection>

          <SettingsSection title="Letras" icon={<Database />}>
            <SettingRow title="Ajuste global de sincronización" description="Se aplica a todas las canciones. El ajuste de Sonando ahora es temporal."><div className="global-offset-control"><Slider aria-label="Ajuste global de sincronización de letras" minValue={-5000} maxValue={5000} step={50} value={globalOffset} onChange={(value) => setGlobalOffset(Number(value))} onChangeEnd={(value) => void persist({ globalLyricsOffsetMs: Number(value) })}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider><output>{globalOffset >= 0 ? "+" : ""}{(globalOffset / 1000).toFixed(2)} s</output></div></SettingRow>
            <SettingRow title="Buscar en internet" description="Envía título, artista, álbum y duración; nunca archivos locales."><UxSwitch label="Buscar letras online" selected={config.onlineLyricsConsent} onChange={(onlineLyricsConsent) => void persist({ onlineLyricsConsent })} /></SettingRow>
            <div className="provider-list" aria-label="Proveedores de letras online">
              {LYRIC_PROVIDERS.map((provider) => <div key={provider.id}><div><strong>{provider.name}</strong><small>{provider.detail}</small></div><UxSwitch label={`Activar ${provider.name}`} selected={config.enabledProviders.includes(provider.id)} onChange={(value) => setProviderEnabled(provider.id, value)} /></div>)}
            </div>
            <div className="spicy-connection"><div className="spicy-icon"><Sparkles size={17} /></div><div><strong>SpicyLyrics</strong><p>Busca en la colección comunitaria usando Spotify.</p><small>{spotify.message}</small></div>{spotify.connected ? <UxSwitch label="Activar SpicyLyrics" selected={config.spicyLyricsEnabled} onChange={(spicyLyricsEnabled) => void persist({ spicyLyricsEnabled })} /> : <Button size="sm" variant="secondary" isDisabled={spotify.linking} isPending={spotify.linking} onPress={linkSpotify}><Link2 size={15} />{spotify.linking ? "Esperando" : "Vincular Spotify"}</Button>}</div>
            <SettingRow title="Caché local" description="Resultados y asociaciones guardados en este PC."><Button size="sm" variant="danger-soft" onPress={() => void command("clear_lyrics_cache")}><Trash2 size={15} />Vaciar caché</Button></SettingRow>
          </SettingsSection>
          <SettingsSection title="Pruebas" icon={<FlaskConical />}>
            <SettingRow title="Modo demo" description="Permite probar la interfaz sin iniciar uxPlay."><UxSwitch label="Modo demo" selected={config.demoMode} onChange={(demoMode) => void persist({ demoMode })} /></SettingRow>
            <SettingRow title="Sesión de prueba" description="Abre Sonando ahora con datos y letras de ejemplo."><Button size="sm" variant="secondary" isDisabled={!config.demoMode} onPress={activateDemo}>Abrir demo</Button></SettingRow>
          </SettingsSection>
        </div>

        <Card className="diagnostics ux-card" variant="secondary">
          <Card.Header><span className="icon-well"><Activity /></span><div><Card.Title>Diagnóstico</Card.Title><Card.Description>Comprobaciones de solo lectura.</Card.Description></div></Card.Header>
          <Card.Content>
            <Button fullWidth variant="secondary" onPress={runDiagnostics} isPending={diagnosing}><RefreshCw size={16} />{diagnosing ? "Comprobando" : "Comprobar sistema"}</Button>
            {diagnostics ? <DiagnosticResults diagnostics={diagnostics} /> : <div className="diagnostic-placeholder"><Network /><p>Revisa uxPlay, GStreamer, la red y las salidas de audio cuando algo no cuadre.</p></div>}
            <div className="privacy-card"><MonitorUp /><div><strong>Datos locales</strong><p>Sin analíticas, grabación ni subida de letras.</p></div></div>
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
function DiagnosticResults({ diagnostics }: { diagnostics: Diagnostics }) { return <div className="diagnostic-results">{Object.entries(diagnostics).map(([key, item]) => <div className={item.ok ? "ok" : "warn"} key={key}><i>{item.ok ? <Check size={12} /> : "!"}</i><span><strong>{item.label}</strong><small>{item.detail}</small></span></div>)}</div>; }
