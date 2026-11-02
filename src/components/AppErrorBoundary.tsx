import { Component, type ErrorInfo, type ReactNode } from "react";
import { currentLocale, translate } from "../i18n";

interface State { error: Error | null }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UxNow encontró un error en la interfaz", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const locale = currentLocale();
    return <main className="app-error" role="alert">
      <h1>{translate(locale, "errors.appTitle")}</h1>
      <p>{translate(locale, "errors.appBody")}</p>
      {import.meta.env.DEV && <pre>{this.state.error.stack ?? this.state.error.message}</pre>}
      <button type="button" onClick={() => window.location.reload()}>{translate(locale, "errors.reload")}</button>
    </main>;
  }
}
