<div align="center">
  <img src="./static/favicon.png" alt="WebTAU logo" width="72" height="72" />
  <h1>WebTAU</h1>

  <p>
    A browser-based vocal synthesizer for <b>UTAU voicebanks</b>.<br />
    Everything runs locally in your browser — Rust + WebAssembly engine, Svelte UI.
  </p>

  <p>
    <a href="https://charl1e7.github.io/webtau/"><strong>🌐 Open WebTAU</strong></a>
  </p>

  <img src="./docs/screenshot.png" alt="WebTAU on desktop" width="860" />
  <br />
  <img src="./docs/screenshot-mobile.png" alt="WebTAU on a phone" width="260" />
</div>

---

## ✨ Features

- **Voicebanks** — load a `.zip` or a folder (drag & drop works too). Shift-JIS / UTF-8 `oto.ini`,
  `prefix.map` (prefix + suffix), `character.txt` and portrait are understood. Missing `oto.ini` is generated.
- **Fast sample analysis** — samples are analyzed _lazily_ (only what your song uses), on a pool of
  workers, optionally in the background, and **cached in IndexedDB**: a voicebank is analyzed once per browser.
  Choose _Accurate_ (Harvest) or _Fast_ (DIO) quality in Settings.
- **Incremental rendering** — rendered notes are cached by the engine, so after an edit only the
  changed notes are re-synthesized.
- **Piano roll for desktop and touch** — select / draw / pitch / erase tools, drag to move, grab either
  edge to stretch (large handles on touch), rubber-band selection, copy / paste / duplicate, snapping
  (incl. triplets), zoom with wheel or pinch, long-press / right-click context menus, undo / redo.
- **Pitch** — draggable pitch points with linear / smooth shapes, auto-portamento, vibrato with
  fade-in/out, per-note flags (`B`reathiness, `t` pitch offset), velocity, volume, modulation.
- **Import / export** — UST (import & export, pitch curves, vibrato, tempo changes), MIDI (import with
  track picker & lyrics, export), project files (`.webtau.json`), WAV export.
- **Tempo map** & time signatures, batch lyric filling (kana is split into morae).
- **Installable & offline** — works as a PWA after the first visit; the UI adapts from phones to desktops.

## 🛠️ Development

Requirements: Node 22+, Rust (stable) with the `wasm32-unknown-emscripten` target and
[Emscripten](https://emscripten.org/) 4.x (`emsdk`) for the engine.

```bash
git clone --recursive https://github.com/charl1e7/webtau   # the WORLD vocoder is a git submodule
cd webtau
npm install

# build the engine (Rust -> WebAssembly) into src/lib/engine/wasm
source /path/to/emsdk/emsdk_env.sh
npm run build:wasm            # ./build.sh release

npm run dev                   # http://localhost:5173
```

| Command                                    | What it does                                  |
| ------------------------------------------ | --------------------------------------------- |
| `npm run dev` / `npm run build`            | Vite dev server / production build (`build/`) |
| `npm run lint` · `npm run check`           | Prettier + ESLint · svelte-check              |
| `npm test`                                 | Unit tests (core, UST, MIDI, project files)   |
| `cargo test -p w-synth --release`          | Unit tests of the Rust engine                 |
| `node scripts/bench-analysis.mjs <dir> 15` | Benchmark of the sample analyzer in Node      |

Set `BASE_PATH=/webtau` when building for GitHub Pages. Opening the app with `?debug` exposes the
state modules as `window.webtau` for debugging.

### Architecture

```
crates/w-synth        Rust engine: oto/prefix parsing, WORLD analysis (chunked), note renderer,
                      stepwise synthesis sessions with a per-note render cache  → WebAssembly
src/lib/core          Pure editor logic: notes, tempo map, pitch curves, history, lyrics, ops
src/lib/io            UST, MIDI, project file, WAV, text decoding
src/lib/voicebank     Voicebank loading from zip / folders / drops (lazy sample access)
src/lib/engine        Workers, analysis scheduler, IndexedDB feature cache, engine session
src/lib/state         Svelte 5 rune state: project, view, playback, voicebank, settings, commands
src/lib/components    UI (canvas piano roll in components/roll)
```

### Engine benchmark

Analysis of a synthetic 15 s sample in Node, old engine vs. new (median of 3 runs):

| Engine                  | Time   | Cache size |
| ----------------------- | ------ | ---------- |
| before (Harvest)        | 13.3 s | 1.7 MB     |
| now, accurate (Harvest) | 9.5 s  | 0.84 MB    |
| now, fast (DIO)         | 4.5 s  | 0.84 MB    |

On top of that, the voicebank no longer has to be analyzed up front, and results are cached across sessions.

## 🗺️ Roadmap

- [ ] Tempo marker editing directly on the ruler
- [ ] More resampler flags (gender, tremolo, fry)
- [ ] Multiple tracks, VSQX import
- [ ] Note preview when clicking the piano keys

## Feedback

Questions, ideas or bugs? Please [open an issue](https://github.com/charl1e7/webtau/issues/new).

## Credits

- **Straycat engine** — this project builds on [straycat-rs](https://github.com/UtaUtaUtau/straycat-rs).
- **Rust-WORLD** — [Rust-WORLD](https://github.com/BiggieBoo18/Rust-WORLD) bindings.
- **WORLD** — the [WORLD](https://github.com/mmorise/World) vocoder for speech analysis/synthesis.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
