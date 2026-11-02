import { Button } from "@heroui/react";
import { Settings2, Square, Play } from "lucide-react";
import { DeviceName } from "../components/DeviceName";
import { ReceiverSignal } from "../components/ReceiverSignal";
import { encodeMessage, errorText, useI18n } from "../i18n";
import { command } from "../lib/tauri";
import { useAppStore } from "../store";

export function ReceiverPage() {
  const { config, servicePhase, serviceMessage, devices, track, setPage, setService } = useAppStore();
  const { t, tr, tm } = useI18n();
  const selected = devices.find((device) => device.id === config.preferredAudioDeviceId);
  const running = ["starting", "ready", "connecting", "streaming"].includes(servicePhase);
  const cover = track?.coverDataUrl;

  const toggleReceiver = async () => {
    try {
      if (running) {
        await command("stop_uxplay");
        setService("stopped", encodeMessage("receiver.startHint"));
      } else {
        setService("starting", encodeMessage("receiver.preparing"));
        await command("start_uxplay");
      }
    } catch (error) { setService("error", errorText(error)); }
  };

  const stateDescription = () => {
    if (servicePhase === "ready") return tr("receiver.readyDescription", { name: <strong>{config.receiverName}</strong> });
    if (servicePhase === "streaming") return tr("receiver.streamingDescription", { device: <DeviceName name={selected ? tm(selected.name) : t("receiver.selectedOutput")} className="receiver-inline-device" /> });
    if (servicePhase === "connecting") return tm(serviceMessage) || t("receiver.connectingFallback");
    if (servicePhase === "starting") return tm(serviceMessage) || t("receiver.preparing");
    if (servicePhase === "error") return tm(serviceMessage) || t("receiver.errorFallback");
    return t("receiver.stoppedDescription");
  };

  return (
    <main className={`page receiver-page state-${servicePhase}`}>
      <div className="receiver-backdrop" aria-hidden="true">
        {cover && <img className="receiver-backdrop-cover" src={cover} alt="" />}
        <div className="receiver-backdrop-wave" />
        <div className="receiver-backdrop-veil" />
      </div>
      <header className="page-header receiver-header">
        <h1>{t("receiver.title")}</h1>
        <Button isIconOnly variant="ghost" aria-label={t("receiver.openSettings")} onPress={() => setPage("settings")}><Settings2 size={18} /></Button>
      </header>

      <section className="receiver-center" aria-labelledby="receiver-state-title">
        <ReceiverSignal phase={servicePhase} />
        <h2 id="receiver-state-title" aria-live="polite">{t(`receiver.states.${servicePhase}`)}</h2>
        <p className="receiver-description">{stateDescription()}</p>
        <div className="receiver-actions">
          <Button variant={running ? "danger-soft" : "primary"} onPress={toggleReceiver}>
            {running ? <Square size={14} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            {t(running ? "receiver.stop" : servicePhase === "error" ? "receiver.retry" : "receiver.start")}
          </Button>
          {servicePhase === "streaming" && track && (
            <Button variant="secondary" onPress={() => setPage("now-playing")}>{t("receiver.viewSong")}</Button>
          )}
        </div>
      </section>

      <footer className="receiver-footer">
        <dl className="receiver-meta" aria-label={t("receiver.metaLabel")}>
          <div><dt>{t("receiver.output")}</dt><dd><DeviceName name={selected ? tm(selected.name) : t("receiver.noDevice")} /></dd></div>
          <div><dt>{t("receiver.access")}</dt><dd>{t(config.pinEnabled ? "receiver.pinOn" : "receiver.pinOff")}<Button size="sm" variant="ghost" onPress={() => setPage("settings")}>{t(config.pinEnabled ? "receiver.change" : "receiver.configure")}</Button></dd></div>
        </dl>
      </footer>
    </main>
  );
}
