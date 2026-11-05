# Time tracker: the HUD, weather and delving effects

The time engine (`clocks-tracker`) draws one bar at the top of the screen: the
date, the current weather, the clock and the stretch meter, or in delving mode
the turn counter and the featured resource. Weather lives on the left of the bar
and the delve atmosphere on the right; both are live shader effects.

## Look

Every surface is Ink and Signal (docs/adr/0012-ink-and-signal-core.md). The
tokens are aliased as `--glct-*` on the feature's own roots in
`clocks-tracker-hud.css` (the bar, the weather window, the framed apps, the chat
cards, the delve context menu), never on `:root`. The weather and delving sheets
read those aliases.

The bar is an ink slab with a bottom-right chamfer and one hairline on the top
edge. The type is paper on ink, the clock and counts are in the number face, and
the watch is a paper lozenge with a progress rule: the watches have no hue of
their own any more (`WATCHES[].tint` is still published on `timeChanged` for
macros). Hue only ever means something:

- amber: events and holidays (the tabs, calendar bands, the effect note);
- green: a mission goal; red: a mission deadline, ominous weather, an ominous or
  ended delve resource, a blocked hex face;
- info blue: the Hex Flower's start hex;
- a GM-picked weather or resource colour: that condition's icon, its tone edge
  and its hex fill, because the colour names it.

Nothing glows at rest and there is no glass blur. Primary buttons are paper with
ink type; everything else is an ink step. The glitch overlay scrambles in paper
with a red and blue channel split.

## Effects

`weather/effects.js` is the host. `weather/fx/` is pure:

- `looks.mjs` maps each archetype (and a few library kinds) to a look and its
  variant flags, resolves a spec to uniforms, and builds lightning.
- `shaders.mjs` assembles one fragment program per look from shared chunks:
  hashed particle fields that scroll along a direction, periodic value noise for
  veils, and a tinted atmosphere grade under every look.
- `renderer.mjs` owns the single WebGL2 context, compiles a look the first time it
  is drawn, and draws a frame into the corner of its canvas for the host to copy.

The looks: clear (sun bloom and shafts), rain, storm (rain under a cloud deck,
lightning and a flash), snow (and blizzard, dust), hail (and meteors), fog (and
clouds, shadow, miasma, arcane mist), wind (and sand, ripples), embers (and creep,
bubbles), motes (and static, swarm, runes, void, spores) and aurora.

Rules the check holds:

- One frame clock. Shedding is `Budget.ladder("clocks-weather", SHED_ORDER)`:
  `fullRate` (60 to 30 fps), `depth` (the far layer), `haze` (the veil),
  `resolution` (device pixel ratio 2 to 1), `motion` (the field holds still).
- Every surface is registered with `Surfaces`; the shared context is released
  when no surface holds it and rebuilt on the next draw.
- Time reaches the shaders as a phase of a 64 s loop and every rate is a whole
  number of turns, so nothing steps when the loop wraps.
- Edges are antialiased over one device pixel, and no point is smaller than half
  a device pixel.

## Fixed along the way

- A weather or delve change that landed while a player's tab was hidden left the
  layer switched off until the next change, because the paint gated on
  `document.hidden` and nothing repainted on return. The frame loop is
  `requestAnimationFrame`, which a hidden tab does not run, so the gate was
  removed.
- A range event that wraps past the end of the year (last month into the first)
  never matched the days in between, and the calendar view drew its band edges
  wrong at the month boundary.
- A long condition name broke mid-word ("Thunde/rstorm").
- The hex clip path was declared on `:root`; it now sits on the elements that use
  it.
- The empty delve pool's breath animated `filter` on the scrim, repainting the bar
  every frame; it is an opacity pulse on its own layer now.

## Previews

- `node tools/weather-fx-preview.mjs [--old]`, then `/.preview/weather.html`:
  every kind and delve stage at bar and chip size. `?impl=old` shows origin/main's
  renderer, `?seek=12` freezes a frame.
- `node tools/time-tracker-preview.mjs [--old]`, then `/.preview/time.html`: the
  shipped `GlctHud` against stubs. `?wx=storm`, `delve=1`, `collapsed=1`, `gm=0`,
  `seek=11`, `impl=old`.

Serve both with `node tools/preview-server.mjs`; a `file://` page does not run
module scripts.

## What only a live session proves

The real HUD inside Foundry (its own sheet resets and the canvas behind the bar),
the weather walk stepping on `updateWorldTime`, the Surfaces release after the
idle period with a real policy, and the GLSL compiling on each player's GPU.
