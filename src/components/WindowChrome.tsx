import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

export function WindowChrome() {
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
    <header className="window-chrome" aria-label="Ventana de UxNow">
      <div className="window-drag-region" data-tauri-drag-region>
        <span className="window-chrome-mark" aria-hidden="true"><span /></span>
        <span className="window-chrome-title" data-tauri-drag-region>UxNow</span>
      </div>
      <div className="window-controls">
        <button type="button" aria-label="Minimizar ventana" title="Minimizar" onClick={() => void appWindow.minimize()}>
          <Minus size={15} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button type="button" aria-label={maximized ? "Restaurar ventana" : "Maximizar ventana"} title={maximized ? "Restaurar" : "Maximizar"} onClick={() => void appWindow.toggleMaximize()}>
          {maximized ? <span className="window-restore-icon" aria-hidden="true" /> : <Square size={12} strokeWidth={1.6} aria-hidden="true" />}
        </button>
        <button className="window-close" type="button" aria-label="Ocultar UxNow en la bandeja" title="Ocultar en la bandeja" onClick={() => void appWindow.close()}>
          <X size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
