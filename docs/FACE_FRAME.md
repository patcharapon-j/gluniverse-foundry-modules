# Portrait Face Framing

Portraits across the suite are framed on the character's head instead of a fixed
crop. One shared locator (`scripts/core/face-frame.mjs`) finds the head; each
feature turns the result into its own CSS.

| Where | Shot | How it is applied |
|---|---|---|
| Initiative cards | band across the face (resting), head and shoulders (active) | `--gluni-portrait-*` x/y/scale, plus `--gluni-portrait-*-mask-x/y` for the boss mask |
| Stage comms card | 3:4 bust | `--gp-auto-pos` / `--gp-auto-scale` under the GM's framing transform |
| Stage GM panel thumbnails | 3:4 bust, 28px head | `frameImage()` |
| Stream chat avatar | head | `frameImage()` |
| Stream roll cards | the card's own shot (`CARD_HEAD_FRAME`) | first of three passes, before MediaPipe and smartcrop |

Hand-set framing always wins: the initiative `init.portraitFrame` flag, the comms
scale/offsets (applied on top), and the roll cards' `portraitFocus`.

## Setting

**Portrait Face Framing** (`core.faceFrame`, world): *Off*, *Character heads*
(default) or *Character and creature heads*. Heads use two YOLOv11 detectors, one
for anime and one for realistic art (about 80 MB, downloaded once per browser).
Creatures add OWLv2 (about 310 MB), which only runs on WebGPU; without WebGPU
the creature pass stays off.

## Caching and who runs the models

- Results are keyed by image path. A GM client writes its results to the hidden
  world setting `core.faceFrameCache` (batched, capped at 800 images), so every
  client reuses them.
- A player's client that needs an image sends `request` to the active GM over
  the suite socket. The GM answers every request with `result` (its entry, or
  null if its analysis failed) and makes sure the world cache has it. The player
  analyses locally only when no GM is online, the GM failed, or no answer comes
  within 45 s.
- The GM only analyses art that an actor, prototype token or placed token in the
  world uses: socket senders are not attested, so a player must not be able to
  make the GM's browser fetch arbitrary URLs. A forged `result` can at worst
  misframe a portrait on the client that asked, for one session.
- GM writes are batched: a result after a quiet spell is written at once, then
  later results wait for 3 s of quiet (12 s at most).
- Each browser also keeps its own results in `localStorage`, written after 2 s
  of quiet (10 s at most) and flushed when the page is hidden. Failures
  (network, CORS, models) are kept for the session only.
- Entries record the mode they were found in. After switching to creatures,
  art where the head pass found nothing is analysed again.
- Turning the setting off drops queued work without caching anything.
- Art replaced under the same path keeps its old framing until
  `faceLocator.forget(src)`; the roll cards' **Detect** button does this. On a
  player it hides the world entry locally and asks the GM to analyse again.
- The roll cards give the locator 2.5 s, then frame with MediaPipe/smartcrop; a
  head that arrives later replaces that framing on the cards showing it.

## Threading

Fetching, decoding and inference run in a module worker
(`scripts/core/face-frame-worker.mjs`), so a burst of new portraits at combat
start does not block the canvas. The worker and the main thread share
`scripts/core/face-frame-runtime.mjs`, which resolves onnxruntime's paths from
`import.meta.url` and builds the result entry, so both paths return identical
entries. If a worker or `OffscreenCanvas` is unavailable, the locator falls back
to the main thread for the session, running in idle time and yielding between
stages; a single WASM model run still blocks there. The worker must never be
listed in `module.json`'s `esmodules`, or Foundry runs it on the main thread.

## Offline worlds

The locator loads models and onnxruntime's WebAssembly from
`Data/face-frame-models/` first, then from Hugging Face and jsDelivr. To run
offline, run `pnpm models` in the face-frame repo and copy its `models/` folder
there (it includes `ort/`). The roll cards still have MediaPipe, which is
bundled, when the locator cannot load.

## Geometry

`scripts/core/face-frame-math.mjs` is pure and covered by
`tests/face-frame-math.test.mjs`; the GM/player protocol is covered by
`tests/face-frame-locator.test.mjs`. `cropFor` asks the library for a crop that
never leaves the image; `coverPlacement` solves for the `object-position` /
`transform-origin` and `scale()` that show that crop in a cover-fitted element
(only the box's aspect matters). `frameImage` uses `object-view-box` so the
image's parent need not clip, and falls back to `object-position` alone in
browsers without it.
