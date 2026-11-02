import { Component, type ErrorInfo, type ReactNode } from "react";
import { currentLocale, translate } from "../i18n";
import type { LyricLine } from "../types";

interface Props {
  lines: LyricLine[];
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class LyricsRenderBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("No se pudo renderizar la letra con AMLL", error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (previous.lines !== this.props.lines && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="lyrics-render-fallback" role="alert">
        <p>{translate(currentLocale(), "lyrics.renderFallback")}</p>
        {import.meta.env.DEV && <code>{this.state.error.message}</code>}
        <div className="lyrics-render-fallback-lines">{this.props.lines.map((line, index) => <p key={`${line.startTime}-${index}`}>{line.text}</p>)}</div>
      </div>
    );
  }
}
