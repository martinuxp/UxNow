import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useI18n } from "../i18n";

export function WindowChrome() {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const syncMaximized = async () => {
      const next = await appWindow.isMaximized();
      if (mounted) setMaximized(next);
    };
    void syncMaximized();
    void appWindow.onResized(syncMaximized).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const appWindow = getCurrentWindow();
  return (
    <header className="window-chrome" aria-label={t("window.label")}>
      <div className="window-drag-region" data-tauri-drag-region>
        <span className="window-chrome-mark" aria-hidden="true"><span /></span>
        <span className="window-chrome-title" data-tauri-drag-region>UxNow</span>
      </div>
      <div className="window-controls">
        <button type="button" aria-label={t("window.minimize")} title={t("window.minimizeShort")} onClick={() => void appWindow.minimize()}>
          <Minus size={15} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t(maximized ? "window.restore" : "window.maximize")} title={t(maximized ? "window.restoreShort" : "window.maximizeShort")} onClick={() => void appWindow.toggleMaximize()}>
          {maximized ? <span className="window-restore-icon" aria-hidden="true" /> : <Square size={12} strokeWidth={1.6} aria-hidden="true" />}
        </button>
        <button className="window-close" type="button" aria-label={t("window.hide")} title={t("window.hideShort")} onClick={() => void appWindow.close()}>
          <X size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
