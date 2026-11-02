import { encodeMessage } from "./i18n/core";
import { parseTtml } from "./lib/lyrics";
import type { LyricsCandidate, TrackMetadata } from "./types";

export const DEMO_TRACK: TrackMetadata = {
  title: "Luz de domingo",
  artist: "UxNow Studio",
  album: encodeMessage("demo.album"),
  durationMs: 84_000,
  coverDataUrl: "/demo-cover.svg",
  isDemo: true,
};

export const DEMO_LRC = `[00:00.00]Luz de domingo
[00:06.00]entra despacio por la habitación
[00:12.00]el aire despierta
[00:17.50]y encuentra su propia canción
[00:24.00]No hay prisa
[00:28.00]solo un momento para escuchar
[00:35.00]cada ventana
[00:39.50]deja a la mañana pasar
[00:47.00]Quédate cerca
[00:51.50]la música sabe el camino
[00:58.00]entre las hojas
[01:02.00]vuelve la luz de domingo
[01:10.00]Respira
[01:14.00]todo vuelve a comenzar`;

export const DEMO_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">
  <head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/></metadata></head>
  <body><div begin="00:00.000" end="01:24.000">
    <p begin="00:00.000" end="00:05.800" ttm:agent="v1" itunes:key="L1"><span begin="00:00.000" end="00:01.900">Luz</span> <span begin="00:01.900" end="00:03.300">de</span> <span begin="00:03.300" end="00:05.800">domingo</span><span ttm:role="x-bg" begin="00:02.600" end="00:05.800"><span begin="00:02.600" end="00:03.900">(vuelve</span> <span begin="00:03.900" end="00:05.800">a brillar)</span></span></p>
    <p begin="00:06.000" end="00:11.800" ttm:agent="v2" itunes:key="L2"><span begin="00:06.000" end="00:07.400">entra</span> <span begin="00:07.400" end="00:08.700">despacio</span> <span begin="00:08.700" end="00:09.800">por la</span> <span begin="00:09.800" end="00:11.800">habitación</span><span ttm:role="x-bg" begin="00:08.500" end="00:11.800"><span begin="00:08.500" end="00:09.700">(déjala</span> <span begin="00:09.700" end="00:11.800">pasar)</span></span></p>
    <p begin="00:12.000" end="00:17.300" ttm:agent="v1" itunes:key="L3"><span begin="00:12.000" end="00:14.400">el aire</span> <span begin="00:14.400" end="00:17.300">despierta</span></p>
    <p begin="00:17.500" end="00:23.800" ttm:agent="v2" itunes:key="L4"><span begin="00:17.500" end="00:19.400">y encuentra</span> <span begin="00:19.400" end="00:21.300">su propia</span> <span begin="00:21.300" end="00:23.800">canción</span></p>
    <p begin="00:24.000" end="00:34.800" ttm:agent="v1" itunes:key="L5"><span begin="00:24.000" end="00:27.800">No hay prisa</span> <span begin="00:28.000" end="00:31.400">solo un momento</span> <span begin="00:31.400" end="00:34.800">para escuchar</span></p>
    <p begin="00:35.000" end="00:46.800" ttm:agent="v2" itunes:key="L6"><span begin="00:35.000" end="00:39.200">cada ventana</span> <span begin="00:39.500" end="00:43.100">deja a la mañana</span> <span begin="00:43.100" end="00:46.800">pasar</span></p>
    <p begin="00:47.000" end="00:57.800" ttm:agent="v1" itunes:key="L7"><span begin="00:47.000" end="00:51.200">Quédate cerca</span> <span begin="00:51.500" end="00:54.700">la música sabe</span> <span begin="00:54.700" end="00:57.800">el camino</span></p>
    <p begin="00:58.000" end="01:09.800" ttm:agent="v2" itunes:key="L8"><span begin="00:58.000" end="01:01.800">entre las hojas</span> <span begin="01:02.000" end="01:05.500">vuelve la luz</span> <span begin="01:05.500" end="01:09.800">de domingo</span></p>
    <p begin="01:10.000" end="01:23.500" ttm:agent="v1" itunes:key="L9"><span begin="01:10.000" end="01:13.800">Respira</span> <span begin="01:14.000" end="01:18.200">todo vuelve</span> <span begin="01:18.200" end="01:23.500">a comenzar</span></p>
  </div></body>
</tt>`;

export const DEMO_LINES = parseTtml(DEMO_TTML);

export const DEMO_CANDIDATE: LyricsCandidate = {
  id: "demo-luz-de-domingo",
  title: DEMO_TRACK.title,
  artist: DEMO_TRACK.artist,
  album: DEMO_TRACK.album,
  durationMs: DEMO_TRACK.durationMs,
  syncType: "word",
  format: "ttml",
  content: DEMO_TTML,
  source: "demo",
  attribution: encodeMessage("backend.lyrics.attribution", { source: encodeMessage("demo.lyricsSource") }),
  confidence: 1,
  offsetMs: 0,
};
