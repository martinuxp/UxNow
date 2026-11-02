# UxNow

UxNow is an open-source Windows desktop receiver focused on AirPlay audio. It
runs [uxPlay](https://github.com/FDH2/UxPlay) as an external process and routes
that process to a selected Windows audio endpoint through GStreamer's
`wasapisink`. Your browser, games, calls, and Windows system sounds keep using
their existing output.

> Status: functional MVP. The complete interface and demo work without native
> dependencies. Real AirPlay reception requires a compatible `uxplay.exe` and
> GStreamer installation.

## What works

- Waiting, Now Playing, local lyrics library, and Settings screens.
- A clearly labelled demo session with original artwork and word-timed lyrics.
- Persistent local configuration and SQLite-backed lyric index/cache.
- Independent WASAPI endpoint selection; UxNow never changes the global
  Windows output.
- uxPlay lifecycle management with `-vs 0`, `-md`, `-ca`, optional PIN, and a
  selected `wasapisink` endpoint.
- Replaceable log adapter for the pinned uxPlay snapshot and typed
  service/progress events.
- Metadata and cover-art watcher with stable-read delay.
- TTML, LRC, and ELRC import/indexing and drag-and-drop association.
- Modular providers for AMLL TTML DB, Lyrically, and LRCLIB. LyricsPlus remains
  disabled until a stable public base URL is verified.
- Diagnostics for uxPlay, GStreamer, WASAPI, network, firewall, and audio.
- Per-process stream volume through Windows Core Audio.

## Requirements

- Windows 10 or 11 x64.
- Node.js 22 or later and Rust stable for development.
- Microsoft WebView2.
- For real reception: the pinned uxPlay snapshot and GStreamer 1.24+ with `wasapisink`, ALAC,
  and the plugins required by uxPlay.

The first release intentionally keeps uxPlay and GStreamer external. This
makes installation and license boundaries explicit while the Windows runtime
bundle is hardened.

## Development

```powershell
npm install
npm run tauri dev
```

Web-only demo:

```powershell
npm run dev
```

The web-only preview uses illustrative audio outputs. Native filesystem,
process, diagnostics, and Windows audio features require the Tauri app.

### uxPlay checkout

The official upstream is pinned as a submodule:

```powershell
git submodule update --init --recursive
```

The MVP currently pins commit `57ea83411d5f7e0b38c5841987439340543f025c`
(`v1.73.6-66-g57ea834`). This is newer than the latest numbered tag available
in upstream at the time of the build; the log adapter is intentionally isolated
so it can be updated without changing the UI.

Build it following upstream's Windows/MSYS2 instructions. UxNow looks for the
binary in this order:

1. Path selected in **Ajustes → Ejecutable de uxPlay**.
2. `runtime/uxplay.exe`.
3. `vendor/uxplay/build/uxplay.exe`.
4. `uxplay.exe` available in `PATH`.

UxNow starts it with individual process arguments, never through a shell:

```text
uxplay.exe -n UxNow -nh -vs 0 -md <runtime>/now-playing.txt
  -ca <runtime>/cover.jpg
  -as "wasapisink device=\"<Windows endpoint ID>\" low-latency=true"
```

## Audio routing

UxNow reads active render endpoints through Windows Core Audio and gives the
selected endpoint ID directly to `wasapisink`. It does not alter the Windows
default. Because uxPlay configures its sink at startup, changing output during
an active stream restarts the receiver and requires the sender to reconnect.
There is no silent fallback if a selected device disappears.

## Lyrics and privacy

Search order is local folders, pinned/cache, AMLL TTML DB, Lyrically,
LyricsPlus, and LRCLIB. Provider failures and four-second timeouts fall through
without blocking audio. Online providers receive only title, artist, album,
and duration after explicit consent. Local TTML/LRC/ELRC content never leaves
the PC.

Provider attribution is retained in Now Playing. Local associations, offsets,
cache, and private playback history live in the app data directory. UxNow has
no analytics and does not store audio.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build
```

## Known limits

- UxNow targets audio-only reception. Screen mirroring is intentionally not
  displayed (`-vs 0`).
- uxPlay's current human-readable log is translated by a replaceable
  adapter. A future structured event stream can replace it without changing
  the UI.
- Lyrics progress is interpolated between uxPlay progress reports. Exact
  behaviour varies by sender application.
- LyricsPlus is represented in settings but disabled until a stable,
  documented public endpoint is verified.
- Startup integration and tray controls require validation in an installed
  Windows build.
- UxNow does not expose play, pause, skip, remote-control, or recording.

## Firewall troubleshooting

Use a Private Windows network profile and ensure the sender and PC share the
same network without client isolation. uxPlay requires an inbound firewall
allow rule. UxNow diagnoses but never creates firewall rules automatically.

## License

UxNow is AGPL-3.0-only. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
