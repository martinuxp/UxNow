import { Button, Tooltip } from "@heroui/react";
import { BookOpenText, Radio, Settings, Sparkles } from "lucide-react";
import type { Page } from "../types";

const ITEMS: Array<{ page: Page; label: string; icon: typeof Radio }> = [
  { page: "receiver", label: "Receptor", icon: Radio },
  { page: "now-playing", label: "Sonando ahora", icon: Sparkles },
  { page: "library", label: "Letras locales", icon: BookOpenText },
  { page: "settings", label: "Ajustes", icon: Settings },
];

export function Navigation({ page, onChange }: { page: Page; onChange: (page: Page) => void }) {
  return (
    <nav className="nav" aria-label="Navegación principal">
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
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="right">{label}</Tooltip.Content>
          </Tooltip>
        ))}
      </div>
      <p className="nav-foot">AirPlay de audio<br />en tu red local</p>
    </nav>
  );
}