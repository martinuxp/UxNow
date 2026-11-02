import { Button, Tooltip } from "@heroui/react";
import { BookOpenText, Radio, Settings, Sparkles } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import type { Page } from "../types";

const ITEMS: Array<{ page: Page; label: MessageKey; icon: typeof Radio }> = [
  { page: "receiver", label: "nav.receiver", icon: Radio },
  { page: "now-playing", label: "nav.nowPlaying", icon: Sparkles },
  { page: "library", label: "nav.library", icon: BookOpenText },
  { page: "settings", label: "nav.settings", icon: Settings },
];

export function Navigation({ page, onChange, live = false }: { page: Page; onChange: (page: Page) => void; live?: boolean }) {
  const { t, tr } = useI18n();
  return (
    <nav className="nav" aria-label={t("nav.label")}>
      <div className="brand" aria-label="UxNow">
        <span className="brand-mark"><span /></span>
        <span>UxNow</span>
      </div>
      <div className="nav-items">
        {ITEMS.map(({ page: itemPage, label, icon: Icon }) => (
          <Tooltip key={itemPage} delay={450}>
            <Tooltip.Trigger>
              <Button
                className={`nav-item ${page === itemPage ? "is-active" : ""}`}
                variant="ghost"
                size="md"
                onPress={() => onChange(itemPage)}
                aria-current={page === itemPage ? "page" : undefined}
                data-page={itemPage}
                data-live={itemPage === "now-playing" && live ? "true" : undefined}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{t(label)}</span>
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="right">{t(label)}</Tooltip.Content>
          </Tooltip>
        ))}
      </div>
      <p className="nav-foot">{tr("nav.foot", { br: <br /> })}</p>
    </nav>
  );
}