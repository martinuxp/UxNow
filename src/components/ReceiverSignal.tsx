import type { ServicePhase } from "../types";

const LABELS: Record<ServicePhase, string> = {
  stopped: "Receptor detenido",
  starting: "Iniciando receptor",
  ready: "Listo para recibir",
  connecting: "Conectando",
  streaming: "Recibiendo audio",
  error: "Error del receptor",
};

const DOTS = Array.from({ length: 12 }, (_, index) => {
  const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
  return { cx: 80 + Math.cos(angle) * 45, cy: 60 + Math.sin(angle) * 45 };
});

export function ReceiverSignal({ phase }: { phase: ServicePhase }) {
  return (
    <div className={`receiver-signal signal-${phase}`} role="img" aria-label={LABELS[phase]}>
      <svg viewBox="0 0 160 120" aria-hidden="true">
        <g className="signal-dots">{DOTS.map((dot, index) => <circle key={index} cx={dot.cx} cy={dot.cy} r="3.4" />)}</g>
        <g className="signal-waves">
          <path d="M54 45c-8 9-8 21 0 30" />
          <path d="M42 36c-14 15-14 33 0 48" />
          <path d="M106 45c8 9 8 21 0 30" />
          <path d="M118 36c14 15 14 33 0 48" />
        </g>
        <rect className="signal-capsule" x="60" y="48" width="40" height="24" rx="12" />
        <path className="signal-error-mark" d="M80 46v20m0 9h.01" />
      </svg>
    </div>
  );
}