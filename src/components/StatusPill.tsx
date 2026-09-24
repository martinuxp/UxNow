import type { ServicePhase } from "../types";

const LABELS: Record<ServicePhase, string> = {
  stopped: "Detenido",
  starting: "Iniciando",
  ready: "Listo",
  connecting: "Conectando",
  streaming: "Recibiendo",
  error: "Revisar",
};

export function StatusPill({ phase, demo = false }: { phase: ServicePhase; demo?: boolean }) {
  return <span className={`status-label status-${phase}`}><i />{demo ? "Modo demo" : LABELS[phase]}</span>;
}