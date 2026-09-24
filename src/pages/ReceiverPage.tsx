import { Button } from "@heroui/react";
import { Settings2, Square, Play } from "lucide-react";
import { DeviceName } from "../components/DeviceName";
import { ReceiverSignal } from "../components/ReceiverSignal";
import { command } from "../lib/tauri";
import { useAppStore } from "../store";
import type { ServicePhase } from "../types";

const STATE_TITLES: Record<ServicePhase, string> = {
  stopped: "Receptor detenido",
  starting: "Iniciando receptor",
  ready: "Listo para recibir",
  connecting: "Conectando",
  streaming: "Recibiendo audio",
  error: "No se pudo iniciar",
};

export function ReceiverPage() {
  const { config, servicePhase, serviceMessage, devices, track, setPage, setService } = useAppStore();
  const selected = devices.find((device) => device.id === config.preferredAudioDeviceId);
  const running = ["starting", "ready", "connecting", "streaming"].includes(servicePhase);
  const cover = track?.coverDataUrl;

  const toggleReceiver = async () => {
    try {
      if (running) {
        await command("stop_uxplay");
        setService("stopped", "Inicia el receptor para aparecer en AirPlay.");
      } else {
        setService("starting", "Preparando uxPlay…");
        await command("start_uxplay");
      }
    } catch (error) { setService("error", String(error)); }
  };

  const stateDescription = () => {
    if (servicePhase === "ready") return <>Selecciona <strong>{config.receiverName}</strong> desde AirPlay.</>;
    if (servicePhase === "streaming") return <>El audio está saliendo por <DeviceName name={selected?.name ?? "la salida seleccionada"} className="receiver-inline-device" />.</>;
    if (servicePhase === "connecting") return serviceMessage || "Aceptando la conexión del dispositivo…";
    if (servicePhase === "starting") return serviceMessage || "Preparando uxPlay…";
    if (servicePhase === "error") return serviceMessage || "Revisa uxPlay y GStreamer en Diagnóstico.";
    return "Inicia el receptor para que aparezca en el menú AirPlay.";
  };

  return (
    <main className={`page receiver-page state-${servicePhase}`}>
      <div className="receiver-backdrop" aria-hidden="true">
        {cover && <img className="receiver-backdrop-cover" src={cover} alt="" />}
        <div className="receiver-backdrop-wave" />
        <div className="receiver-backdrop-veil" />
      </div>
      <header className="page-header receiver-header">
        <h1>Receptor</h1>
        <Button isIconOnly variant="ghost" aria-label="Abrir ajustes" onPress={() => setPage("settings")}><Settings2 size={18} /></Button>
      </header>

      <section className="receiver-center" aria-labelledby="receiver-state-title">
        <ReceiverSignal phase={servicePhase} />
        <h2 id="receiver-state-title" aria-live="polite">{STATE_TITLES[servicePhase]}</h2>
        <p className="receiver-description">{stateDescription()}</p>
        <div className="receiver-actions">
          <Button variant={running ? "danger-soft" : "primary"} onPress={toggleReceiver}>
            {running ? <Square size={14} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            {running ? "Detener" : servicePhase === "error" ? "Reintentar" : "Iniciar receptor"}
          </Button>
          {servicePhase === "streaming" && track && (
            <Button variant="secondary" onPress={() => setPage("now-playing")}>Ver canción</Button>
          )}
        </div>
      </section>

      <footer className="receiver-footer">
        <dl className="receiver-meta" aria-label="Configuración actual del receptor">
          <div><dt>Salida de UxNow</dt><dd><DeviceName name={selected?.name ?? "Sin dispositivo seleccionado"} /></dd></div>
          <div><dt>Acceso</dt><dd>{config.pinEnabled ? "PIN activo" : "Sin PIN"}<Button size="sm" variant="ghost" onPress={() => setPage("settings")}>{config.pinEnabled ? "Cambiar" : "Configurar"}</Button></dd></div>
        </dl>
      </footer>
    </main>
  );
}
