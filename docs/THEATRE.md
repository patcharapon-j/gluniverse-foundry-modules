# Theatre

Theatre of the mind on one scene. A Theatre scene holds an ordered list of
**shots** — an image or video with an eyebrow, a title and a subtitle — and the
GM cuts between them with a cinematic transition and a typographic title card.
The players never leave the scene, so there is no pile of one-image scenes to
build, and nothing on their side reloads.

Feature id `theatre`, settings and flags `th.`, i18n `GLTH.*`, CSS `glth-`.

## The scene

A Theatre scene is an ordinary Scene flagged `th.enabled`. Create one from the
Scenes directory (**Create Theatre scene**) or convert an existing scene from its
context menu (**Convert to Theatre** / **Leave Theatre**). A Theatre scene is laid
out on a fixed 16:9 world rectangle (`FRAME`, 3840 × 2160), gridless, with token
vision off and padding 0. Converting stores what it replaced in `th.restore`, and
Leave puts it back.

Tokens, drawings, notes and sounds all keep working on top of the picture — a
Theatre scene is a scene. Whether anything sits on it is the GM's choice.

| Flag         | Holds |
|--------------|-------|
| `th.enabled` | this scene is a Theatre scene |
| `th.shots`   | the ordered shot list (`model.mjs`) |
| `th.config`  | scene defaults: style, face (`null` = the GM's default), hold, letterbox, corner tag |
| `th.state`   | the shot on screen and the last cue |
| `th.restore` | what Convert replaced |

Every normaliser in `model.mjs` is total. Foundry merges a flag update, so a key
a shot lacked would otherwise survive the write; the store writes every map as a
forced replacement and reads it back off the document.

## Shots

| Field       | Meaning |
|-------------|---------|
| `src`       | image or video (video plays muted and looping) |
| `eyebrow`   | act / chapter / time line above the title |
| `title`, `subtitle` | the card |
| `notes`     | GM only; never drawn for a player |
| `style`, `face`, `hold` | per-shot overrides of the scene default (`null` = default) |
| `focus`     | the point of the image kept in frame when it is cropped to cover |
| `shake`     | camera shake strength 0–1 (`null` = the GM's default) |
| `treatment` | the backdrop's own look: exposure, saturation, tint, vignette, blur, letterbox |
| `grade`     | the Stage character grade this shot relights to (`null` leaves Stage alone) |

The treatment is the picture's grade and the Stage grade is the characters'.
They are separate on purpose: the backdrop needs a few broad dials that make a
still read as a film frame, the portraits need Stage's full stack so they sit in
it, and running Stage's pipeline over a full-screen plate would cost a great deal
for nothing visible. A neutral treatment is an exact no-op.

## Cues

Everything the GM fires is a **cue**: a new shot, the current title again, a text
card, black, or clear. A cue is one scene update to `th.state`:

```js
{ shotId, cue: { seq, at, kind, shotId, style, text } }
```

`at` is the **server** time the cue starts, stamped `TIMING.cueLead` ahead so
every client begins together. A client converts it to its own clock and starts
at that moment or when the image has loaded, whichever is later. A client that
receives a cue more than `TIMING.lateGrace` after its start — or loads the scene
with a cue already played — settles on the end state with no animation. Every
client preloads every shot of the scene it is looking at.

The GM chooses the next shot privately in the filmstrip (a GM-only preview with
the title and notes), then presses Go.

## The timeline

`timeline.mjs` is the only statement of when anything in a transition happens,
and three renderers read it: the PIXI shot layer (the image), the DOM overlay
(black, bars, title, card) and Stage (the relight). A beat moved there moves
everywhere; a beat restated anywhere else drifts. Times are ms at motion scale 1
and are scaled with `motionScale()`.

| Style       | Image | Title |
|-------------|-------|-------|
| `centre` (default) | dip to black, swap behind it | centred; tracking collapses, rules draw out |
| `chapter`   | push-in dissolve | lower left; band wipe, accent underline |
| `credits`   | letterbox bars close, swap, reopen | credit line in the lower bar, letter by letter |
| `wipe`      | soft diagonal wipe | upper right; words rise |
| `cut`       | 120 ms crossfade | centred |
| `interlude` | unchanged | a text card over black |

The title holds for `hold` ms (4 s by default) after it has arrived, then leaves.
Players cannot skip it; the GM can cut early. An optional corner tag keeps the
location on screen after the title has gone.

## Layers

- **The picture** is a container in `canvas.primary` at `TILES − 1` with the
  background's elevation — above the scene background, beneath tiles and tokens,
  exactly where hexcrawl draws its map. `scene.background` is never touched while
  Theatre is on: changing it redraws the whole canvas, which is a flash and a
  stall, not a transition.
- **The overlay** — title, black, letterbox bars, text card, corner tag — is DOM,
  above Stage's character overlay, so the black dip hides the portraits while
  they relight. At rest it sits below Foundry's UI, so the corner tag and a
  resting letterbox never cover a control. While a cue plays it is **live**
  (`.glth-overlay--live`) and rises over the UI columns, the chat sidebar and
  ordinary windows, so the transition fills the whole screen; it drops back when
  the cue's last beat ends. It never takes the pointer. It is DOM because the
  title needs real typography.

## Stage

When the stage feature is enabled, a shot added to the scene samples a Stage
grade from its own image once, and the GM can capture the current grade into a
shot or re-sample it. On a cut, the GM's single scene update writes `th.state`
**and** the Stage grade, with update options carrying the tween timing
(`TWEEN_OPTION`), so every client relights the portraits at the timeline's
`relight` beat — behind the black, or at a wipe's midpoint. See
`docs/STAGE_LIGHTING.md` for the API. Theatre runs without Stage; Stage runs
without Theatre.

The relight is pinned to the cue's clock, not to each client's image-ready
start. A client that is still loading the image when the cue begins waits for it
(up to `LOAD_TIMEOUT`) before playing the picture and the title, but its
portraits relight on schedule — before its own black. Preloading every shot of
the scene is what keeps that rare.

Create and Convert write a starting Stage grade (the first shot's, else the
world default), because Stage seeds an ungraded scene from its background the
first time it shows a character, and a Theatre scene's background is black.

## Camera

Players are locked to the frame and cannot pan or zoom it. The GM gets the same
framing with a free-pan toggle for placing tokens.

How the 16:9 frame meets a display that is not 16:9 is the **framing**:

- **Fill** (the default): the frame covers the screen; whatever overhangs is cropped.
- **Fit**: the whole frame is shown, inset by a **padding** (per cent of the
  screen's shorter side, 0–`PADDING_MAX`, which is 30). The space around it is the
  **backdrop** — the same picture cover-fitted to the whole view, blurred hard
  (`BACKDROP.blur`) and darkened (`BACKDROP.gain`). It follows the frame's mix and
  wipe line exactly, so a transition sweeps the surround with the picture.

The GM sets the default framing and padding for everyone (`th.defaultFraming`,
`th.defaultPadding`, world). Each viewer's own `th.framing` (client) starts at
"Use the GM's default", which takes **both** of the GM's values; choosing Fill or
Fit overrides them, with the viewer's own `th.padding`. `frameView()` in
`camera.mjs` is the one statement of the maths.

The backdrop is a second mesh on `canvas.stage` beneath `canvas.root`, not in
the shot layer: Foundry masks `canvas.primary` to the scene rect (padding is 0
on a Theatre scene), which is exactly where the backdrop is not. It draws only
while the view reaches past the frame — Fit, or a GM zoomed out — and is the
last entry of `SHED_ORDER` (shed, it reads one deep-mip tap instead of a disc).
The stream broadcast is a player client, so it is locked the same way, and the
stream's auto-camera stands down while the viewed scene is a Theatre scene.

## Camera shake

Between cues the picture sways like a handheld camera: slow, small and never
repeating (three sines per axis at unrelated frequencies, `SHAKE` in
`render/shot-renderer.mjs`). It moves the picture inside the frame only; the
frame itself and the blurred backdrop around a fitted one stay put. The picture
is scaled about the frame centre just enough that the sway never shows an edge,
whatever the image's width and height.

The GM sets the default strength for every shot (`th.defaultShake`, world, per
cent, 30 by default; 0 holds the picture still) and a shot can set its own in the
editor. The strength eases toward its target over `TIMING.shakeEase`, and the
sway's speed rides on the eased strength, so a scene always starts slow and
subtle. Its clock is integrated each frame, so a change of strength never jumps
the picture. Paused ambient motion or a shed shake holds it still where it is.

## Type

Five bundled faces, all OFL and declared once in `styles/gl-fonts.css`: Google
Sans Flex (the default), Archivo, Cinzel, Cormorant Garamond and Oxanium. Each
title face carries its own paired secondary for the eyebrow and subtitle
(`FACES` in `constants.mjs`). The GM sets the default face (`th.defaultFace`,
world) that every scene follows unless it picks its own, and each shot can
override that again. Scene configs before v2 stored the old default face on every
scene; one still on it reads as following the GM's default (`CONFIG_VERSION` in
`model.mjs`). A browser only fetches a face something actually uses.

## Performance

The camera shake is the first entry of `SHED_ORDER` on the shared frame budget
and the backdrop the last, and the layer claims motion while it shakes, a
transition runs or a video plays, so Balanced does not stutter it.

## Checks

```bash
node tools/theatre-check.mjs
```

```bash
node tools/theatre-preview.mjs --out=.preview/theatre.html && node tools/preview-server.mjs
```

Serve the preview — a `file://` page does not run its module script.
