# Locations

Theatre-of-mind backdrop travel. The party stays on one scene; the GM changes
*where they are* by swapping the scene's background behind a cinematic curtain,
with a location name card on the reveal.

- **id** `locations` · **prefix** `loc.` · **i18n** `GLLOC.*` · system-agnostic · off by default
- No `requires`, no `requiresFeature`. Stage integration is implicit — see below.

## The load-bearing decision

Travel writes the **real** background field on the scene document.

Nothing else in the feature would work the way it does without that. Foundry
replicates the document change to every client, so there is no custom state
replication and no reconciliation for late joiners. Stage's own hooks re-grade
the cast on each client independently, and Stage caches its background samples
by path, so a new backdrop is a natural cache miss. **No Stage API is called and
no Stage code changed.**

The cost is that Foundry treats the background as a redraw key, so the canvas
hard-redraws — which recreates every token. Fine for theatre of mind, disruptive
mid-combat on a tactical map. The flicker itself lands inside the curtain.

### Where that field actually lives

The one piece of version awareness in the feature, in `deck.mjs`:

| | v13 | v14 |
|---|---|---|
| read | `scene.background.src` | `level.background.src` |
| write | `scene.update({"background.src"})` | `level.update({"background.src"})` |
| fit | `background.fit` | `textures.fit` |

v14 moved the backdrop onto an embedded **Level** document. `Scene#background`
survives only as a read-only getter that logs a deprecation warning, and
`scene.update({background: …})` there silently does nothing — the Scene schema
has no such field, so the change is discarded without an error. `readBackground`
forks on `scene.levels`, which v13 does not have at all.

The redraw signal is `canvasReady` on both versions: a v13 Scene background write
and a v14 Level background write both end in `canvas.draw()`.

## The curtain: one phase, not three

The curtain mounts a **plate** — a still of the outgoing backdrop — over the live
canvas. It is identical to what the canvas already shows, so mounting is
invisible. The document write, the camera fit and Stage's relight all happen
behind it. Only then does the transition run, and every transition is one thing:
**a way of destroying the plate** to reveal a canvas that is already correct
underneath.

That is what collapses cover/hold/lift into a single animation per style, and it
is why a style can be a table row instead of a timeline. Even a fade to black
fits: the veil rides 0 → 1 → 0 while the plate cuts at the midpoint, so the
audience sees old → black → new with the seam hidden inside the black.

The lift is gated on the local redraw plus `loc.settle`, and capped at **4
seconds**. The cap is not optional: without it one failed image load blinds a
player for the rest of the session.

`loc.settle` is a setting rather than a constant because it is a taste call.
Hades pairs every 0.67s room wipe with a colour-grade ramp of 1–4s that
deliberately outlasts it — the room arrives still warming up, and that is the
effect. Stage's 620ms relight is structurally the same thing. At **0** the reveal
starts the moment the canvas is ready and the cast visibly re-lights in the open;
at **700** the relight is hidden and they are simply correct by the time you see
them. Which reads better depends on the art and the table.

Cross-client frame sync is deliberately not attempted. Nobody at the table sees
another player's screen, and not showing someone a half-drawn canvas is worth
more than showing everyone the same frame.

### `--gl-loc-t`

One `@property`-registered custom property animates 0% → 100% on the curtain root
and inherits down; masks read it inside `calc()`. Three constraints shape
everything built on it:

1. **`filter` applies before `mask`** on the same element, so they cannot roughen
   each other. Mask on the inner element, filter on its wrapper.
2. **`opacity` applies after `filter`**, so an opacity ramp that must *feed* a
   filter has to sit on the inner element with the filter on the wrapper.
3. **SVG filter primitive attributes are not CSS-animatable** and cannot read
   custom properties. Every filter is static; only the gradient underneath it
   moves. `ripple` is the sole exception and needs SMIL.

Also: a filter deforms its own element's rectangle, which on a full-screen effect
reads as rounded corners. Filtered layers are oversized past the viewport and
`.gl-loc-stage` clips the ragged edge away.

`mask-image: url(#svgMaskId)` on an HTML div does **not** work in current
Chromium despite the docs claiming otherwise. Gradient masks only.

## The catalogue

Twenty-one presets over seven mechanisms. `mech` picks the machinery, the style
id selects its parameters within it.

| mechanism | styles |
|---|---|
| Colour field — solid plate, opacity envelope | `cut` `fade` `bleach` `flash` |
| Plate opacity — a true cross-fade | `dissolve` |
| Gradient mask — linear / radial / conic / repeating | `wipe` `slash` `iris` `clock` `shutter` `shoji` |
| Transform — translate / scale / blur | `push` `whip` `defocus` |
| Ink flood — black layer, static turbulence filter | `ink-bleed` `ink-brush` |
| Threshold dissolve — noise matte under an alpha threshold | `noise-dissolve` `paper-tear` `film-burn` |
| Chromatic split — `feOffset` ×2, channel isolate, screen | `glitch` |
| SMIL displacement *(the exception)* | `ripple` |

`fade`, `bleach` and `flash` are **one implementation**. Colour codes the event
(black ends a chapter, white is arrival) and *duration codes the tone*: white at
1200ms is transcendence, the same white at 70ms is a blow landing.

### The ink flood

The photograph is never filtered. A flat ink layer floods *over* it and the
filter is applied to the ink alone, so the art stays sharp — which is also how
Ōkami and Ghost of Tsushima do it: they flood the frame with ink, they do not
cross-fade through it.

In `#gl-loc-ink`, each primitive earns its place. The **blur** turns the mask
circle's hard edge into an alpha ramp; without it the displacement merely wobbles
a circle instead of bleeding. The **displacement** pushes that ramp around
following the noise, which is where the lobes and tendrils come from. The **alpha
matrix** snaps it back to a crisp ink edge — and that multiplier is Ren'Py's
`ramplen`. Raise it for a dry cut-paper edge (`60 -28`), lower it for a wet
still-spreading one (`12 -5`). The same integer separates a crisp slatted wipe
from a gauzy shimmer in every VN engine surveyed.

The anisotropic `baseFrequency="0.014 0.018"` is deliberate: unequal x/y gives
the blot a directional grain like paper fibre, where equal frequencies look
synthetic.

**`ink-bleed` retracts.** The stroke swells across the frame, covers it, and
lifts back along the path it came. That reversal is the entire reason it reads as
a hand rather than an edit — two phases over one driver, no architectural change.

### Timing

Durations are `--gl-d-*` tokens; the `ms` column in `STYLES` mirrors each token's
scale-1 value so `scaledMs()` keeps the JS teardown locked to the CSS. Both are
scaled by one **scoped** `--gl-motion-scale` on the curtain root: the client's
motion tier times the world's `loc.pace`. A tier of `off` is 0×, which makes
every style a hard cut for free — no branch in the JS does that.

`loc.motion` is an explicit user choice, not an OS `prefers-reduced-motion` sniff,
consistent with the suite rule.

## Data

`loc.deck` (world, `config:false`):

```js
{ entries: [{
    id: "blackfen", name: "Blackfen Crossing",
    subtitle: "three days east of the capital",   // optional
    img: "worlds/x/blackfen.webp",                // image or video
    style: "ink-bleed",
    accent: "#7a4be0",     // optional — scopes --gl-accent on the curtain
    darkness: 0.6,         // optional — unset means "don't touch it"
    playlistId: "abc123"   // optional
}]}
```

Scene flags under `SUITE_ID`: `loc.home` (`{src, fit}`, captured on the **first**
trip only, so "return to base" means the scene as its author built it) and
`loc.current` (cleared when a backdrop change arrives that we did not cause).

## API

```js
const loc = game.modules.get("gluniverse-foundry-modules").api.features.locations;

await loc.goto("blackfen", { style: "ink-bleed" });
await loc.goto({ img: "path/to.webp", name: "The Docks" });   // ad-hoc
await loc.announce("Blackfen Crossing", "three days east");   // card only
await loc.home();
loc.list();
loc.styles();
```

`goto` resolves when the reveal completes, so a macro can sequence narration
after it. Non-GM callers no-op with a console warning.

## Validation

```bash
node tools/locations-check.mjs
```

Zero problems required. It cross-checks the things that fail *silently*: a style
whose CSS duration disagrees with its `ms` mirror, a `url(#…)` naming a filter
that does not exist, an `animation:` naming a missing `@keyframes`, a style with
no i18n key, and one specific trap that shipped once already — `feComposite`
works on premultiplied colour and `arithmetic` multiplies the RGB channels too,
so compositing the plate against a zero-RGB matte renders it solid black while
the alpha maths looks perfectly correct.

What it cannot check is how any of it *looks*:

```bash
node tools/locations-check.mjs --sheet=/tmp/locations.html
```

writes a self-contained page with every style frozen mid-transition over a test
image. Open it. The ink edge and the shred threshold are judgements, not
assertions, and neither is how a transition reads on real painted art.

One thing is still open and needs a real table:

- **The plate does not match the canvas transform.** It is a full-frame `cover`
  layer, not a pixel-aligned copy of the viewport, so the reveal can pop if the
  camera is zoomed. `loc.recenter` closes the gap by fitting the camera under the
  curtain; matching the transform exactly is fiddly maths for a worse result.
