# Third-party notices

## Design reference

The fullscreen presentation of UxNow was independently implemented with Spicy Lyrics by Spikerko as a visual and interaction reference. No Spicy Lyrics assets or branding are distributed with UxNow. Spicy Lyrics is available under the AGPL-3.0 license: https://github.com/Spikerko/spicy-lyrics

UxNow is distributed under **AGPL-3.0-only**. The following primary components
retain their own copyright notices and licenses.

## uxPlay

- Project: <https://github.com/FDH2/UxPlay>
- License: GNU General Public License v3.0 or later; some components are
  LGPL-2.1+ or MIT as documented upstream.
- Role: external AirPlay receiver process. UxNow does not reimplement or
  modify the AirPlay protocol.

The normal installer does not bundle the uxPlay executable. An optional
integrated installer profile requires a reviewed runtime and a
`runtime/bundled-candidate/RUNTIME_SOURCES.md` inventory with exact build and
source details. That candidate is installed under `_internal`.
A pinned upstream checkout is kept in `vendor/uxplay` for reproducible
development and license review.

## Apple Music-like Lyrics (AMLL)

- Project: <https://github.com/amll-dev/applemusic-like-lyrics>
- Packages: `@applemusic-like-lyrics/react`,
  `@applemusic-like-lyrics/ttml`, and `@applemusic-like-lyrics/lyric`
- License: GNU Affero General Public License v3.0 only.
- Role: lyric parsing/conversion and synchronized lyric rendering. UxNow does
  not use Apple names, logos, artwork, or other proprietary assets as branding.

## Google Sans Flex

- Project: <https://github.com/googlefonts/googlesans-flex>
- Version: 4.007 variable font, bundled locally as `src/assets/fonts/GoogleSansFlex-v4.007.ttf`.
- License: SIL Open Font License 1.1; full text and copyright in `src/assets/fonts/OFL.txt`.
- Role: default interface and lyrics typography. The font is not loaded from an external service.

## Tauri and Rust/JavaScript dependencies

Tauri, React, Lucide, Zustand, rusqlite, reqwest, notify, and their
transitive dependencies are used under the licenses contained in their source
distributions and package metadata. Release automation must generate a full
dependency license inventory before publishing binaries.

## Online lyric services

BiniLyrics, Unison, LRCLIB, and (when configured) SpicyLyrics are external services.
Their results keep their source attribution in the interface. UxNow never
uploads a local lyric file and makes no online request until the user grants
consent.

### BiniLyrics

- API documentation: <https://lyrics.binimum.org/developers>
- API: <https://lyrics-api.binimum.org/>
- Role: read-only metadata lookup and TTML retrieval without credentials.
- Visible attribution: `Letras: BiniLyrics · lyrics.binimum.org`.
- The external service and its catalogue remain subject to the operator's terms
  and availability; UxNow does not redistribute the catalogue.

### Unison

- Project: <https://github.com/better-lyrics/unison>
- API: <https://unison.boidu.dev/docs>
- License: source code AGPL-3.0; its public lyric corpus is ODbL-1.0 for open
  produced works with attribution.
- Required visible attribution: `Lyrics from Unison (https://unison.boidu.dev)`.
- Role: optional, read-only online lookup by song metadata. UxNow does not use
  Unison's signed write, vote, report, or submission endpoints.
