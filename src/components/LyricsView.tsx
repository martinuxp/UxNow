import { LyricPlayer } from "@applemusic-like-lyrics/react";
import { Spinner } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { toAmllLines } from "../lib/lyrics";
import { fontFamilyFor, fontStyleFor, fontWeightFor } from "../lib/fonts";
import { messageMentions, useI18n, type MessageKey } from "../i18n";
import { LyricsRenderBoundary } from "./LyricsRenderBoundary";
import type { LyricLine } from "../types";

const BINI_404_MESSAGES: MessageKey[] = [
  "lyrics.missingJokes.memorize",
  "lyrics.missingJokes.notHere",
  "lyrics.missingJokes.nextTime",
  "lyrics.missingJokes.knowIt",
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
  // Reduced motion keeps line-by-line scrolling but drops the spring overshoot and scaling.
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const resolvedFontFamily = fontFamilyFor(fontFamily);
  const resolvedFontWeight = fontWeightFor(fontFamily, 600);
  const resolvedFontStyle = fontStyleFor(fontFamily);
  const { t, tm } = useI18n();
  const [friendlyError, setFriendlyError] = useState<MessageKey | null>(null);
  const isBini404 = messageMentions(errorMessage, "backend.binimum.httpStatus", { status: 404 });

  useEffect(() => {
    setFriendlyError(isBini404 ? BINI_404_MESSAGES[nextBini404Message++ % BINI_404_MESSAGES.length] : null);
  }, [errorMessage, isBini404]);

  if (state === "searching") return <div className="lyrics-empty"><Spinner size="md" color="accent" /><p>{t("lyrics.searching")}</p><span>{t("lyrics.searchingDetail")}</span></div>;
  if (state === "not-found") return <div className="lyrics-empty"><p>{t("lyrics.notFound")}</p><span>{t("lyrics.notFoundDetail")}</span></div>;
  if (state === "error") return <div className="lyrics-empty"><p>{isBini404 ? (friendlyError ? t(friendlyError) : "") : t("lyrics.loadFailed")}</p>{!isBini404 && <span>{tm(errorMessage) || t("lyrics.loadFailedDetail")}</span>}</div>;
  if (!lines.length) return <div className="lyrics-empty"><p>{t("lyrics.empty")}</p><span>{t("lyrics.emptyDetail")}</span></div>;

  return (
    <div className={`amll-shell${cinema ? " amll-cinema" : ""}`} style={{ fontFamily: resolvedFontFamily, fontWeight: resolvedFontWeight, fontStyle: resolvedFontStyle, "--lyrics-font-weight": resolvedFontWeight } as React.CSSProperties}>
      <LyricsRenderBoundary lines={lines}><LyricPlayer
        key={`${resolvedFontFamily}-${resolvedFontWeight}-${resolvedFontStyle}`}
        style={{ fontFamily: resolvedFontFamily, fontWeight: resolvedFontWeight, fontStyle: resolvedFontStyle }}
        lyricLines={amllLines}
        currentTime={Math.round(currentTime)}
        playing
        alignAnchor="center"
        alignPosition={cinema && isPortrait ? 0.28 : cinema ? 0.46 : 0.42}
        enableSpring={!reduceMotion}
        enableBlur
        enableScale={!reduceMotion}
      /></LyricsRenderBoundary>
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
