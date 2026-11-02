import { useI18n } from "../i18n";
import type { ServicePhase } from "../types";

export function StatusPill({ phase, demo = false }: { phase: ServicePhase; demo?: boolean }) {
  const { t } = useI18n();
  return <span className={`status-label status-${phase}`}><i />{t(demo ? "status.demo" : `status.${phase}`)}</span>;
}
