import { useCallback, useEffect, useRef, useState } from "react";
import { AlertDialog, Button, Card, Modal, Slider } from "@heroui/react";
import { Check, LoaderCircle, Maximize2, Minimize2, Pin, SlidersHorizontal, Speaker, Volume2 } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DeviceName } from "../components/DeviceName";
import { LyricsView } from "../components/LyricsView";
import { StatusPill } from "../components/StatusPill";
import { UxSelect } from "../components/UiControls";
import { command, isTauri } from "../lib/tauri";
import { parseLyrics } from "../lib/lyrics";
import { lyricsPlaybackTime } from "../lib/lyricsTiming";
import { lyricsSessionKey } from "../lib/trackIdentity";
import { useAppStore } from "../store";
import type { LyricsCandidate } from "../types";

const candidateFileName = (path?: string) => path?.split(/[\\/]/).pop() ?? "Archivo local";
const syncLabel = (syncType: string) => syncType === "word" ? "Palabra a palabra" : syncType === "line" ? "Sincronizada por línea" : "Letra estática";
const sourceLabel = (source: string) => ({ local: "Archivo local", binimum: "BiniLyrics", unison: "Unison", lrclib: "LRCLIB", spicylyrics: "SpicyLyrics" }[source.toLowerCase()] ?? source);

export function NowPlayingPage() {
  const { track, lyrics, lyricLines, lyricsState, lyricsError, positionMs, config, devices, patchConfig, setService, sessionLyricsOffsets, setSessionLyricsOffset } = useAppStore();
  const [alternatives, setAlternatives] = useState<LyricsCandidate[] | null>(null);
  const [loadingAlternatives, setLoadingAlternatives] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [volume, setVolumeValue] = useState(0.8);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [pendingOutput, setPendingOutput] = useState<string | null>(null);
  const controlsTimer = useRef<number | undefined>(undefined);
  const offset = track ? (sessionLyricsOffsets[lyricsSessionKey(track)] ?? 0) : 0;
  const selected = devices.find((device) => device.id === config.preferredAudioDeviceId);
  const outputOptions = devices.map((device) => ({ id: device.id, label: device.name, description: device.isDefault ? "Predeterminado de Windows" : undefined }));

  const setFullscreenMode = useCallback(async (next: boolean) => {
    if (isTauri()) await getCurrentWindow().setFullscreen(next);
    setIsFullscreen(next);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(controlsTimer.current);
    if (isFullscreen) controlsTimer.current = window.setTimeout(() => setControlsVisible(false), 2400);
  }, [isFullscreen]);

  useEffect(() => {
    document.documentElement.classList.toggle("is-now-fullscreen", isFullscreen);
    if (!isFullscreen) { window.clearTimeout(controlsTimer.current); setControlsVisible(true); } else revealControls();
    return () => { document.documentElement.classList.remove("is-now-fullscreen"); window.clearTimeout(controlsTimer.current); };
  }, [isFullscreen, revealControls]);

  useEffect(() => {
    if (!isTauri()) return;
    const windowRef = getCurrentWindow();
    let dispose: (() => void) | undefined;
    void windowRef.isFullscreen().then(setIsFullscreen);
    void windowRef.onResized(async () => setIsFullscreen(await windowRef.isFullscreen())).then((unlisten) => { dispose = unlisten; });
    return () => dispose?.();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, button")) return;
      if (event.key.toLowerCase() === "f") { event.preventDefault(); void setFullscreenMode(!isFullscreen); }
      else if (event.key === "Escape" && isFullscreen) void setFullscreenMode(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isFullscreen, setFullscreenMode]);

  if (!track) return (
    <main className="page empty-now-playing">
      <div className="empty-disc"><span /></div><h1>Esperando música</h1><p>Conecta un dispositivo por AirPlay y aquí aparecerán la portada y las letras.</p>
    </main>
  );

  const applyOutput = async (deviceId: string) => {
    setPendingOutput(null);
    patchConfig({ preferredAudioDeviceId: deviceId });
    if (!isTauri() || track.isDemo) return;
    try { await command("update_config", { patch: { preferredAudioDeviceId: deviceId } }); await command("restart_uxplay"); }
    catch (error) { setService("error", String(error)); }
  };

  const requestOutput = (deviceId: string) => {
    if (!deviceId || deviceId === config.preferredAudioDeviceId) return;
    if (track.isDemo) void applyOutput(deviceId); else setPendingOutput(deviceId);
  };

  const togglePin = async () => {
    if (!isTauri()) return;
    const windowRef = getCurrentWindow();
    await windowRef.setAlwaysOnTop(!(await windowRef.isAlwaysOnTop()));
  };

  const changeVolume = async (value: number) => {
    setVolumeValue(value);
    if (!track.isDemo) await command("set_stream_volume", { volume: value });
  };

  const showAlternatives = async () => {
    setSelectionError("");
    if (track.isDemo) { setAlternatives(lyrics ? [lyrics] : []); return; }
    setLoadingAlternatives(true);
    try { setAlternatives(await command<LyricsCandidate[]>("search_lyrics_alternatives", { track })); }
    catch (error) { setService("error", String(error)); }
    finally { setLoadingAlternatives(false); }
  };

  const selectLyrics = async (candidate: LyricsCandidate) => {
    setSavingSelection(true);
    setSelectionError("");
    try {
      const lines = parseLyrics(candidate.content, candidate.format);
      if (!track.isDemo) await command("pin_lyrics_candidate", { track, candidate });
      useAppStore.getState().setLyrics(candidate, lines);
      setAlternatives(null);
    } catch (error) {
      setSelectionError("No se pudo guardar esta letra: " + String(error));
    } finally {
      setSavingSelection(false);
    }
  };

  const durationMs = Math.max(track.durationMs ?? lyrics?.durationMs ?? 0, 1);
  const progress = Math.min(1, Math.max(0, positionMs / durationMs));
  const formatTime = (milliseconds: number) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };

  return (
    <main className={`page now-playing${isFullscreen ? " is-fullscreen" : ""}${isFullscreen && !controlsVisible ? " controls-hidden" : ""}`} style={{ "--cover": `url(${track.coverDataUrl ?? "/demo-cover.svg"})` } as React.CSSProperties} onPointerMove={revealControls} onPointerDown={revealControls}>
      <div className="ambient" aria-hidden="true" />
      <header className="now-toolbar">
        <div className="toolbar-status"><StatusPill phase="streaming" demo={track.isDemo} /><span>F para {isFullscreen ? "salir" : "pantalla completa"}</span></div>
        <div className="toolbar-actions"><Button variant="secondary" onPress={togglePin}><Pin size={16} />Mantener encima</Button><Button isIconOnly variant="secondary" aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"} onPress={() => void setFullscreenMode(!isFullscreen)}>{isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</Button></div>
      </header>

      <div className="player-layout">
        <section className="track-column">
          <div className="cover-stage"><img className="cover" src={track.coverDataUrl ?? "/demo-cover.svg"} alt={`Portada de ${track.title}`} /></div>
          <div className="cinema-progress" role="progressbar" aria-label="Progreso de la canción" aria-valuemin={0} aria-valuemax={durationMs} aria-valuenow={Math.round(positionMs)}><time>{formatTime(positionMs)}</time><span><i style={{ transform: `scaleX(${progress})` }} /></span><time>{formatTime(durationMs)}</time></div>
          <div className="track-copy"><p className="airplay-label"><i />AirPlay{track.isDemo ? " · Demo" : ""}</p><h1 title={track.title}>{track.title}</h1><h2 title={track.artist}>{track.artist}</h2>{track.album && <p title={track.album}>{track.album}</p>}</div>
          <Card className="playback-tools ux-card" variant="secondary"><Card.Content>
            <div className="output-select"><Speaker size={18} /><span><small>Salida de AirPlay</small><strong><DeviceName name={selected?.name ?? "Sin seleccionar"} /></strong></span><UxSelect value={config.preferredAudioDeviceId ?? ""} options={outputOptions} label="Salida de audio" placeholder="Seleccionar" onChange={requestOutput} /></div>
            <div className="volume-control"><Volume2 size={18} /><Slider aria-label="Volumen del stream" minValue={0} maxValue={1} step={0.01} value={volume} onChange={(value) => void changeVolume(Number(value))}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider></div>
          </Card.Content></Card>
        </section>

        <Card className="lyrics-column ux-card" variant="secondary" aria-label="Letras sincronizadas"><Card.Content>
          <div className="lyrics-heading"><span className="lyrics-source">{lyrics?.attribution ?? "Buscando letra"}{lyrics?.attributionLinks?.map((link) => <span key={link.url}> · <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></span>)}</span><Button size="sm" variant="ghost" onPress={showAlternatives} isDisabled={loadingAlternatives} isPending={loadingAlternatives}>{loadingAlternatives ? <LoaderCircle className="spin" size={16} /> : <SlidersHorizontal size={16} />}Cambiar letra</Button></div>
          <LyricsView lines={lyricLines} currentTime={lyricsPlaybackTime(positionMs, offset, config.globalLyricsOffsetMs)} state={lyricsState} cinema={isFullscreen} fontFamily={config.lyricsFont} errorMessage={lyricsError} />
          {lyrics && <div className="offset-row"><span>Esta canción</span><Slider aria-label="Offset de esta canción durante la sesión" minValue={-1000} maxValue={1000} step={50} value={offset} onChange={(value) => setSessionLyricsOffset(track, Number(value))}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider><output>{offset >= 0 ? "+" : ""}{(offset / 1000).toFixed(2)} s</output></div>}
        </Card.Content></Card>
      </div>

      <Modal><Modal.Backdrop variant="blur" isOpen={alternatives !== null} onOpenChange={(open) => { if (!open) setAlternatives(null); }}><Modal.Container size="md"><Modal.Dialog className="lyrics-picker"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>Cambiar letra</Modal.Heading></Modal.Header><Modal.Body><p className="picker-description">Elige un archivo o una fuente. UxNow recordará tu elección para esta canción.</p>{selectionError && <p role="alert" className="picker-description">{selectionError}</p>}<div className="candidate-list">{alternatives?.map((candidate) => <Button variant={candidate.id === lyrics?.id ? "secondary" : "ghost"} className={candidate.id === lyrics?.id ? "is-selected" : ""} key={candidate.id} isDisabled={savingSelection} onPress={() => void selectLyrics(candidate)}><span className="candidate-copy"><span className="candidate-source">{sourceLabel(candidate.source)}</span><strong>{candidate.source === "local" ? candidateFileName(candidate.sourceUrl) : candidate.attribution.replace(/^Letras:\s*/i, "")}</strong><small>{syncLabel(candidate.syncType)} · {candidate.format.toUpperCase()} · {Math.round(candidate.confidence * 100)}% de coincidencia</small>{candidate.source === "local" && <small className="candidate-path" title={candidate.sourceUrl}>{candidate.sourceUrl}</small>}</span>{candidate.id === lyrics?.id && <Check size={17} aria-label="Letra actual" />}</Button>)}{alternatives?.length === 0 && <p className="no-candidates">No hay otra letra disponible para esta canción.</p>}</div></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>

      <AlertDialog><AlertDialog.Backdrop variant="blur" isOpen={Boolean(pendingOutput)} onOpenChange={(open) => { if (!open) setPendingOutput(null); }}><AlertDialog.Container size="sm"><AlertDialog.Dialog><AlertDialog.Header><AlertDialog.Icon status="warning"><Speaker size={20} /></AlertDialog.Icon><AlertDialog.Heading>Cambiar la salida de AirPlay</AlertDialog.Heading></AlertDialog.Header><AlertDialog.Body><p>UxNow reiniciará el receptor. Después tendrás que volver a conectar AirPlay desde tu dispositivo.</p></AlertDialog.Body><AlertDialog.Footer><Button variant="tertiary" onPress={() => setPendingOutput(null)}>Cancelar</Button><Button onPress={() => pendingOutput && void applyOutput(pendingOutput)}>Cambiar salida</Button></AlertDialog.Footer></AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop></AlertDialog>
    </main>
  );
}
