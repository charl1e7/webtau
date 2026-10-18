# WebTAU architecture

WebTAU is a browser-based UTAU-style vocal editor: SvelteKit 3 / Svelte 5 on the front, a Rust → WebAssembly
WORLD engine behind workers for synthesis. This page explains how the code is layered, where it can be
extended without touching the core, and what a new kind of voice (for example a neural one) would have to add.

## Layers

```
src/lib/
  core/        Pure logic. No DOM, no Svelte, no I/O. Notes, tempo map, pitch curves, history,
               lyric grammar (lyric-syntax), kana/romaji (kana), ops. Unit-tested in isolation.
  voicebank/   What a voicebank is: types, loaders (registry), AliasIndex (what it can sing).
  plugins/     Extension API, registry, the lyric resolver, built-in plugins.
  render/      Renderer backends: interface, registry, mixing pipeline, the WORLD backend.
  engine/      The WORLD engine itself: wasm bridge, workers, analysis scheduler, feature cache.
               Only render/world.ts knows about it.
  io/          File formats (UST, USTX, MIDI, VSQX, project) and the format registry.
  state/       Reactive application state (Svelte 5 runes) and commands. The only layer that
               wires the others together.
  components/  UI. Reads state, calls commands; never talks to engine/io directly.
```

Dependencies point downwards: `core` imports nothing from the app; `plugins`, `render`, `voicebank` and `io`
import `core` only; `state` imports everything; components import `state`. Anything that needs several of
them lives in `state/`, which keeps the lower layers testable without a browser (most of them run in vitest).

## Extension points

Every one of these is "implement an interface, register it": no core file is edited.

| To add…                         | Implement                              | Register with                                  |
| ------------------------------- | -------------------------------------- | ---------------------------------------------- |
| A file format                   | `FormatEntry` (`io/format-registry`)   | `formats.register(...)` in `state/commands.ts` |
| A voicebank kind                | `VoicebankLoader` (`voicebank/loader`) | `registerVoicebankLoader(...)`                 |
| A synthesis backend             | `RendererBackend` (`render/types`)     | `renderers.register(...)` in `state/renderers` |
| Lyric / phoneme behaviour       | `Plugin` (`plugins/api`)               | `BUILTIN_PLUGINS` or `plugins.register(...)`   |
| A command in Edit ▸ Lyric tools | `PluginCommand` inside a `Plugin`      | (part of the plugin)                           |

### Formats

A `FormatEntry` has extensions, an optional import menu item, an optional export menu item and an `openFile`
handler. The File menu and drag-and-drop are generated from the registry (`state/menus.ts`,
`file.openDropped`). USTX, for instance, is one `register` call next to `parseUstx` / `serializeUstx`.

### Voicebanks and renderers

- `Voicebank.kind` says what kind of bank it is (`'utau'` today). A `VoicebankLoader` recognizes a set of file
  paths (`detect`) and builds the bank (`build`). The first loader that recognizes the files wins.
- A `RendererBackend` has an `id`, `supports(voicebank)`, `load(voicebank)` and
  `render(notes, tempo, hooks) → { promise, cancel }`. Notes arrive in absolute milliseconds with a flat pitch
  contour in cents (`RenderNote`); nothing in the editor's own note model leaks into a backend.
- Each track names its backend (`Track.renderer`, default `world`; unknown ids fall back to the default so
  a project from a newer version still opens). `RendererRegistry.plan` splits the notes per backend and
  `renderMixed` renders the groups in parallel, maps every backend's report back to note ids, aggregates
  progress and mixes the audio. With one backend the buffer is returned untouched, so nothing changed for
  today's single-backend case.
- The WORLD backend (`render/world.ts`) wraps `EngineSession` (workers + wasm + IndexedDB feature cache). It
  takes the session through a provider function, so `render/` has no dependency on application state.

**What a neural backend (DiffSinger) would still need**, none of which requires changing the editor:

1. A `VoicebankLoader` for its folder layout (`dsconfig.yaml`, ONNX files, phoneme list, dictionary).
2. A `RendererBackend` that renders _phrases_ (it already receives the whole group of notes of a track and
   may cache however it likes) using `onnxruntime-web` in a worker.
3. A phonemizer as a `Plugin`. The `Plugin.candidates` hook already exists for "lyric → what the voice sings";
   a neural voice's version would return phoneme sequences instead of oto aliases (the hook's `alias` is a string).
4. Parameter curves per track (energy, breathiness, tension). The drawn track pitch curve
   (`Track.pitchCurve`) is already the shape of that; it would be generalized to named curves.

### Lyrics: the plugin pipeline

A note's lyric is what the user typed; what the voice sings is _resolved_ from it, non-destructively:

```
typed lyric ──► grammar (core/lyric-syntax) ──► rest | continuation (+) | text [hint]
                                                      │
              exact alias in the voicebank?  ─── yes ─┤ (plain banks; VCV banks let plugins choose first)
                                                      ▼
              every active plugin proposes Candidate{alias, score, why, auto}
                                                      ▼
              best candidate that really exists (AliasIndex.has, prefix.map aware) ──► sung alias
              nothing exists → "missing", with near matches kept as suggestions
```

- `AliasIndex` (`voicebank/alias-index.ts`) is the only thing plugins see of a voicebank: aliases split into
  `lead` (VCV vowel), `core` (the syllable) and `base` (without the pitch affix of `prefix.map`), a lookup by
  canonical syllable key, and `find(alias, pitch)` which applies `prefix.map` exactly like the engine does.
- `syllableKey` (`core/kana.ts`) gives one key to every spelling of a sound: ら, ラ, ra and RA are the same key;
  し, shi, si as well. That is what lets "ra" find ら (and the other way round) without a table per voicebank.
- `NoteResolver` resolves a whole project in one pass so each note knows the sound of the one before it
  (VCV banks need the previous vowel), and memoizes per distinct (lyric, pitch affix, previous sound).
- Plugins are plain objects with optional hooks: `candidates` (lyric → spellings), `suggest` (lyric box),
  `commands` (Edit ▸ Lyric tools). They get data in and return data out; a plugin that throws is skipped. They can be
  switched off in Settings (stored as `disabledPlugins`); the resolver still keeps an exact match working, so
  switching everything off never breaks a plain bank.
- Built-ins: `core.search` (suggestions by spelling, then by sound, with the reading of each alias),
  `ja.script-bridge` (kana ⇄ romaji, CV and VCV selection), `core.near-match` (one-letter-off aliases, only ever
  _offered_, never applied silently), `core.lyric-tools` (fix lyrics, rewrite as aliases, convert between
  hiragana, katakana and romaji).

User-facing results: lyrics the bank can sing under another spelling just work (and say "Sung as ‘ka’"); lyrics it
cannot sing are marked red immediately, not after a render; after an import with a voicebank loaded the _Fix
lyrics_ dialog proposes the nearest alias per distinct lyric, applied as one undoable step.

## How neighbouring notes are laid out (engine)

`crates/w-synth/src/timing.rs` decides, per track and from the oto values (scaled by velocity), where each sound
starts and ends. A UTAU sample is placed so that its preutterance point meets the note start, so the sound of a note
begins `preutter` ms early; the previous note therefore ends `preutter − overlap` ms early and the two cross-fade over
`overlap`. When the previous note is too short for the full preutterance (short notes with a VCV bank) the
preutterance and overlap are squeezed so that the consonant takes at most half of it, and a small gap limits the
preutterance to the gap. The result is passed to `render_note` as a `NoteTiming` (effective lead, fades, tail) and
reported back as `spans`, which the e2e tests use to assert that two notes are never at full level together.
Pitch points are in note time (they may be negative) and are mapped onto the render with the lead taken into account.

The lead-in is sung at the pitch of the note that is still sounding there, as in OpenUtau's flat pitch curve: before
a note's start the pitch is the previous note's (`PitchEntry` in `src/lib/core/pitch.ts`, filled in by
`toEngineNotes`), a note that follows directly glides in over 50 ms centred on its start, and the note's own pitch
points take over where they begin. Without it a VCV lead-in ("i ら") is sung at the new pitch while the previous note
fades out at its own, which is heard as two different notes at once.

## Progressive rendering (playback while it renders)

A render is a **stream**, not a batch (`RenderStream`, `src/lib/render/types.ts`). The engine first returns a plan
(per note: where its sound lies in the output, which sample it needs); JS (`EngineStream`, `src/lib/engine/stream.ts`)
then asks the engine to render notes in batches of its own choosing, always the unrendered notes nearest to the
**focus** (the playhead). Samples are analysed on demand just before the batch that needs them. After each batch every
stretch of time that no unrendered note can still touch is _final_ and may be read and played
(`src/lib/render/intervals.ts`). Seeking calls `focus()`: the order changes at the next batch, nothing is restarted.
Previews (`render_oneshot`) bypass the running session, so piano keys keep working during a render.

`playback.svelte.ts` plays final audio in short chunks. When the playhead reaches audio that is not final yet it
holds position and sets `buffering` (spinner in the top bar, message with the reason); it resumes by itself. The ruler
shows the ready ranges. After running dry (and at the start) playback does not go on the moment one more note is ready: it waits for a lead
of 2 s of final audio (`LEAD_MS`), so it does not stutter forward note by note.

Clipping is handled by `src/lib/render/limiter.ts`, a look-ahead peak limiter applied to every piece just before it
goes to the sound card. It is stateless: the gain at a moment depends only on the audio within ~300 ms around it, so the
result is identical however the song is cut into pieces, in whatever order it was rendered and wherever the playhead
jumps; no whole-song peak search and nothing is re-rendered. Audio below the ceiling is untouched (gain exactly 1). A
piece may be handed over once `LIMITER_LOOKAHEAD` of final audio exists after it. WAV export uses the same limiter.

Edits made while playing (solo, mute, track volume, notes…) are picked up by `followEdits` in the transport tick: once
the changes settle (150 ms, at most 800 ms for a burst such as a dragged slider) a new render starts from the playhead,
which reuses the engine's per-note cache. The old audio keeps playing until the new render has its lead at the point
where the sound card is fed next, then the feed switches seamlessly (`feed` vs `run`). If the old audio runs out first,
playback waits for the new render instead.

By default an unfinished render stops when playback pauses (the cache keeps its work and playing again continues from
it); the setting _Keep rendering while paused_ (`backgroundRender`) lets it finish in the background.

Only one streaming backend gets this; several backends fall back to the batch path.
Playback is not peak-normalised any more (the whole song is not known yet), it is limited instead (above).

## How this compares with OpenUtau

OpenUtau's phonemizers turn lyrics into phonemes inside the renderer pipeline, language by language, with
`[hint]`, `+` and `prefix.map` handling spread over them. WebTAU keeps those ideas but separates concerns:

- the **grammar** (rest, continuation, hint) is one small module shared by every language;
- **spelling bridges** work on a voicebank-derived index instead of per-language tables, so they work for any
  bank without configuration, and resolution never rewrites what the user typed unless asked (_Rewrite lyrics_);
- **suggestions, resolution, import repair and batch edits** are separate hooks of one plugin, so a language
  pack is a single object rather than a phonemizer plus UI patches;
- validation is **live** (derived state), the doctor is **optional** and **undoable**.

## Testing

- `vitest` (`npm test`): core, plugins, render pipeline, formats, voicebank index. They need no browser.
- `playwright` (`npm run test:e2e`): the real app on a desktop and an emulated phone viewport, including touch
  gestures, with a synthetic voicebank generated in `tests/e2e/global-setup.ts`.
- `cargo test`: the engine (timing properties on random lines, flags fuzzing, oto parsing, pitch accuracy of rendered
  notes, cache keys, progressive sessions).
- Property tests (`src/lib/testing/rng.ts`, seeded: a failure names its seed) cover tempo maps, note operations, the
  limiter, intervals, pitch curves, all file formats (random round trips, truncated and junk input), the plugin
  resolver and the project store with its undo history.

When adding an extension point, add its registry-level unit test (see `render/render.test.ts`,
`plugins/plugins.test.ts`) and one e2e that goes through the UI.
