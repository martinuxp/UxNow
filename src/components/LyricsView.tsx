import { LyricPlayer } from "@applemusic-like-lyrics/react";
import { Spinner } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { toAmllLines } from "../lib/lyrics";
import { fontFamilyFor, fontStyleFor, fontWeightFor } from "../lib/fonts";
import type { LyricLine } from "../types";

const BINI_404_MESSAGES = [
  "Parece que hoy te toca aprendértela de memoria.",
  "Hmm, creo que esta no la tenemos.",
  "Esta vez va sin letra, para la proxima.",
  "¿Te la sabes? Esta letra no la tenemos.",
];
let nextBini404Message = 0;

interface LyricsViewProps {
  lines: LyricLine[];
  currentTime: number;
  state: "idle" | "searching" | "ready" | "not-found" | "error";
  cinema?: boolean;
  fontFamily?: string;
  errorMessage?: string;
}

export function LyricsView({ lines, currentTime, state, cinema = false, fontFamily = "system", errorMessage }: LyricsViewProps) {
  const amllLines = useMemo(() => toAmllLines(lines), [lines]);
  const isPortrait = useMediaQuery("(max-aspect-ratio: 9 / 10)");
  const resolvedFontFamily = fontFamilyFor(fontFamily);
  const resolvedFontWeight = fontWeightFor(fontFamily, 600);
  const resolvedFontStyle = fontStyleFor(fontFamily);
  const [friendlyError, setFriendlyError] = useState("");
  const isBini404 = errorMessage?.includes("BiniLyrics respondió HTTP 404") ?? false;

  useEffect(() => {
    if (isBini404) {
      setFriendlyError(BINI_404_MESSAGES[nextBini404Message++ % BINI_404_MESSAGES.length]);
    } else {
      setFriendlyError(errorMessage ?? "");
    }
  }, [errorMessage, isBini404]);

  if (state === "searching") return <div className="lyrics-empty"><Spinner size="md" color="accent" /><p>Buscando letras…</p><span>Consultando fuentes.</span></div>;
  if (state === "not-found") return <div className="lyrics-empty"><p>No hay letras para esta canción.</p><span>Suelta aquí un archivo TTML, LRC o ELRC para usarlo.</span></div>;
  if (state === "error") return <div className="lyrics-empty"><p>{isBini404 ? friendlyError : "No se pudo cargar la letra."}</p>{!isBini404 && <span>{errorMessage || "El audio seguirá reproduciéndose."}</span>}</div>;
  if (!lines.length) return <div className="lyrics-empty"><p>Sin letra por ahora.</p><span>Buscaremos cuando cambie la canción.</span></div>;

  return (
    <div className={`amll-shell${cinema ? " amll-cinema" : ""}`} style={{ fontFamily: resolvedFontFamily, fontWeight: resolvedFontWeight, fontStyle: resolvedFontStyle, "--lyrics-font-weight": resolvedFontWeight } as React.CSSProperties}>
      <LyricPlayer
        key={`${resolvedFontFamily}-${resolvedFontWeight}-${resolvedFontStyle}`}
        style={{ fontFamily: resolvedFontFamily, fontWeight: resolvedFontWeight, fontStyle: resolvedFontStyle }}
        lyricLines={amllLines}
        currentTime={Math.round(currentTime)}
        playing
        alignAnchor="center"
        alignPosition={cinema && isPortrait ? 0.28 : cinema ? 0.46 : 0.42}
        enableSpring
        enableBlur
        enableScale
      />
    </div>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
