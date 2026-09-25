# UxNow

UxNow is an open-source Windows desktop receiver focused on AirPlay audio. It
runs [uxPlay](https://github.com/FDH2/UxPlay) as an external process and routes
that process to a selected Windows audio endpoint through GStreamer's
`wasapisink`. Your browser, games, calls, and Windows system sounds keep using
their existing output.

> Status: functional MVP. The complete interface and demo work without native
> dependencies. The integrated Windows installer includes uxPlay and GStreamer;
> source-development builds may use a separately installed runtime.

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
- Modular providers for BiniLyrics, Unison, and LRCLIB. SpicyLyrics remains a
  separate Spotify integration.
- Diagnostics for uxPlay, GStreamer, WASAPI, network, firewall, and audio.
- Per-process stream volume through Windows Core Audio.
- Closing the window hides UxNow in the system tray while the receiver keeps
  running. Use **Salir** from the tray icon to stop uxPlay and exit completely.

## Requirements

- Windows 10 or 11 x64.
- Node.js 22 or later and Rust stable for development.
- Microsoft WebView2.
- For real reception: the pinned uxPlay snapshot and GStreamer 1.24+ with `wasapisink`, ALAC,
  and the plugins required by uxPlay.

The GitHub release installer is built with `npm run build:bundled` and includes
uxPlay 1.74 and GStreamer under `_internal`. A plain `npm run tauri build`
does not include them. AirPlay playback and installation still need checking
on a clean Windows 10/11 PC; the local smoke test only checks the packaged
executables and WASAPI plugin.

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

### Typography

UxNow bundles the variable Google Sans Flex font for offline use. New installs
use it at regular weight for the interface and semibold for synchronized lyrics.
Settings also lists installed Windows font faces, including available Bold and
Italic variants; selecting one applies its family, weight, and style. Older
`system` font preferences continue to use the bundled default. The font and
its OFL license are in `src/assets/fonts/`.

### uxPlay checkout

The official upstream is pinned as a submodule:

```powershell
git submodule update --init --recursive
```

The MVP currently pins commit `57ea83411d5f7e0b38c5841987439340543f025c`
(`v1.73.6-66-g57ea834`), which reports version 1.74. This checkout contains
the three corrections from upstream advisory GHSA-479c-ww7g-wgp8. Its log
adapter is isolated so it can be updated without changing the UI.

Build it following upstream's Windows/MSYS2 instructions. UxNow looks for the
binary in this order:

1. Path selected in **Ajustes → Ejecutable de uxPlay**.
2. `_internal/bin/uxplay.exe` in the packaged resource directory, when bundled.
3. `_internal/bin/uxplay.exe` at the repository root during development.
4. `runtime/uxplay.exe`.
5. `vendor/uxplay/build/uxplay.exe`.
6. `uxplay.exe` available in `PATH`.

If `_internal/bin` also contains GStreamer and `_internal/lib/gstreamer-1.0`
contains the WASAPI plugin, UxNow sets their paths only for its uxPlay child
process. The locally supplied `_internal` is for development testing only and
is not copied into release installers. The integrated build uses the separately
staged `runtime/bundled-candidate` and includes its source and license inventory.

### Building the official Windows runtime

The pinned upstream source supports Windows x64 through MSYS2 UCRT64. Install
[MSYS2](https://www.msys2.org/), open its **UCRT64** terminal, update it, then
install the build and audio dependencies:

```sh
pacman -Syu
pacman -S mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-ninja mingw-w64-ucrt-x86_64-libplist mingw-w64-ucrt-x86_64-gstreamer mingw-w64-ucrt-x86_64-gst-plugins-base mingw-w64-ucrt-x86_64-gst-libav mingw-w64-ucrt-x86_64-gst-plugins-good mingw-w64-ucrt-x86_64-gst-plugins-bad
cd /d/UxNow/vendor/uxplay
cmake -S . -B build -G Ninja
cmake --build build
./build/uxplay.exe -v
```

The last four commands assume you are in the repository root; adjust the
path if necessary. If MSYS2 asks to close and reopen its terminal after
`pacman -Syu`, do that before installing packages. The pinned upstream
snapshot uses its built-in Windows mDNS implementation, so this build does not
require Bonjour. See [upstream's Windows instructions](https://github.com/FDH2/UxPlay/blob/master/README.md#building-uxplay-on-microsoft-windows-using-msys2-with-the-mingw-64-compiler) for details.

To prepare an integrated installer, run
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stage-uxplay-runtime.ps1`.
It copies the new executable, plugins checked at startup and used by the
audio pipeline, the plugin scanner, and recursive
UCRT64 DLL dependencies to `runtime/bundled-candidate` without touching the
older `_internal` used for development. Do not mix new and old DLLs.
The runtime in the installer still appears under `_internal`.

The audio-only candidate pulls in FFmpeg transitive libraries. The staging
script generates `runtime/bundled-candidate/RUNTIME_SOURCES.md` with the exact
uxPlay revision, MSYS2 package versions, licenses, and corresponding source
archives, and copies the installed license texts. The bundle script also
generates `THIRD_PARTY_DEPENDENCIES.md` for npm and Rust dependencies. Then run:

```powershell
npm run build:bundled
```

That command checks uxPlay is at least 1.73.7, verifies the checkout
has the three fixes from GHSA-479c-ww7g-wgp8, and checks the minimum GStreamer
files and source inventory before bundling the candidate as `_internal`.
It does **not** prove that every DLL is present or
that playback works; verify the resulting NSIS/MSI on a clean Windows 10/11
machine with no separate GStreamer installation before distributing it.

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

Search order is local folders, pinned/cache, BiniLyrics, Unison, and LRCLIB. Word-timed lyrics always win over line-timed or static results; ties keep that source order.
Provider failures and four-second timeouts fall through
without blocking audio. Online providers receive only title, artist, album,
and duration after explicit consent. Local TTML/LRC/ELRC content never leaves
the PC. Unison's read API can return TTML, LRC, or plain text; UxNow keeps its
required visible attribution with each result.

BiniLyrics requires no account or API key. UxNow searches by title, artist,
album, and duration, downloads only validated TTML from its documented storage
host, and shows `Letras: BiniLyrics · lyrics.binimum.org` with each result.

Provider attribution is retained in Now Playing. Local associations, the global
lyrics offset, synchronization mode, cache, and private playback history live in the app data directory.
The per-song offset stays only in memory until UxNow closes. UxNow has
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
  behaviour varies by sender application. In Settings, “Sincronizar con uxPlay”
  waits for the first real progress sample and prevents the clock running ahead;
  the switch can be turned off independently of the saved global lyrics offset.
- BiniLyrics, Unison, and LRCLIB require no key. Availability and catalogue
  coverage depend on each external service.
- SpicyLyrics requires Spotify OAuth (PKCE), online-lyrics consent, and its
  separate switch in Settings. UxNow uses a publishable client key, not a
  secret key. Spotify is linked for the current app session only; relink after
  restarting UxNow. SpicyLyrics is queried before the other online providers
  when enabled, while local and pinned/cached word-level lyrics keep priority.
  Its API may intermittently return 503; UxNow retries briefly, then continues
  with the next source. Community syncs display the available uploader/maker
  links beside the provider name, as required by the
  [SpicyLyrics attribution rules](https://developers.spicylyrics.org/docs/attribution).
- Choosing a lyric in “Cambiar letra” saves that exact local file or online
  result for the song (title and artist), ahead of automatic source priority.
  The choice survives song changes and app restarts; the song's sync offset
  lasts only for the current app session. The saved global offset applies to all
  songs and can be adjusted by up to 5 seconds. Clearing the ordinary lyrics
  cache does not remove the chosen lyric. Re-announcing the same song
  while lyrics are loaded keeps them on screen without another provider search.
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
