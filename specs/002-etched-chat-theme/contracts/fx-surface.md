# Contract: FX Surface (shared renderer + per-card canvas)

The interface for rendering the glass-fracture effect onto a chat card without ever
opening a per-card WebGL context. Reuses the initiative tracker's proven blit pipeline
(CardFXManager mechanism) and the **shared GLSL** now in `scripts/core/fx-glsl.mjs`
(`FX_FRAG_BREAK` + Voronoi/noise helpers + mesh builder, re-exported by
`initiative/gl.mjs`). Home: `scripts/features/etched-chat/fx-card.mjs` — a
**feature-local** renderer (its own PIXI WebGL context; two contexts total across the
suite, never per-card; see Research D). It imports the shader only, not initiative's
render loop.

## Renderer surface

```js
/** Lazily creates (once per client) a single feature-local offscreen PIXI renderer
 *  running FX_FRAG_BREAK from core/fx-glsl.mjs. Mirrors initiative CardFXManager. */
export const fxRenderer = {
  /** @returns {boolean} false if WebGL/PIXI unavailable → callers use CSS fallback. */
  get supported(),

  /**
   * Mount an animated fracture onto a card's 2D canvas. Adds the canvas to the
   * shared rAF loop until the animation window elapses, then settles to a static
   * final frame and removes it from the loop.
   * @param {HTMLCanvasElement} canvasEl  the <canvas class="glec-fx"> over the card
   * @param {object} opts
   * @param {"gold"|"red"} opts.color     selects uBreakAmber/uBreakHot uniforms
   * @param {[number,number]} [opts.impact] normalized impact point; default randomized
   * @param {number} [opts.durationMs=1000] animation window before settle
   * @returns {() => void} disposer (idempotent)
   */
  mountAnimated(canvasEl, opts),

  /**
   * Paint a single static cracked still onto a card's 2D canvas (no rAF entry).
   * Used on re-render of an already-animated fracture card.
   */
  mountStatic(canvasEl, opts),

  /** Remove a card from the loop and release its 2D entry (not the shared renderer). */
  unmount(canvasEl),

  /** Tear down the shared renderer + loop. Called on feature disable / teardown. */
  destroy(),
};
```

## Color → uniforms

| `color` | Uniforms (from `core/fx-glsl.mjs` FX_FRAG_BREAK) |
|---------|--------------------------------------------------|
| `"gold"` | `uBreakAmber` warm gold, `uBreakHot` white-hot (initiative default amber) |
| `"red"` | `uBreakAmber` deep red, `uBreakHot` violet/purple core |

The GLSL itself is **not** forked — both features import `FX_FRAG_BREAK` from
`core/fx-glsl.mjs`; only uniform values differ. The shared shader MUST keep its colors
as `uBreakAmber`/`uBreakHot` uniforms (not hard-coded constants) so the gold/red recolor
is a pure uniform swap; the extraction step verifies this.

## Impact origin — re-anchored to the verdict bar  *(v2, FR-030)*

The shatter MUST nucleate at the **verdict-bar / total band**, not the top-right corner.
This requires two coordinated changes — the WebGL `uImpact` origin AND the CSS mask must
both point at the verdict band so the visual crack and its fade agree:

| Surface | v1 (was) | v2 (now) |
|---------|----------|----------|
| GLSL `uImpact` (normalized uv; 0,0 = top-left) | `[0.65, 0.34]` default; entries seeded in the **top-right quadrant** (`[0.82+…, 0.08+…]`) | the normalized position of the **verdict-bar band** within the card (mid-width, lower band) |
| CSS `mask-image` | radial fade from the **top-right** corner | gradient fade radiating from the **verdict-bar band** outward |

The fracture is paired with the gold/red verdict bar so the shatter and the verdict color
read as one event (Research J/N). `mountAnimated`/`mountStatic` accept an `opts.impact`
override; when omitted, the default MUST resolve to the verdict-band origin rather than the
corner. The CSS-crack fallback's crack/fade geometry MUST be re-anchored to match. The rest
of the pipeline (feature-local renderer, blit, settle-to-static, two contexts total) is
unchanged — only the impact origin and the mask move.

## Per-card lifecycle

`freshIds` is the in-memory Set populated by the `createChatMessage` hook (every
client). It is the ONLY thing that distinguishes a live crit (animate) from a
historical/scrollback render (static).

```
createChatMessage(message):        // every client; no author gate
  freshIds.add(message.id)

renderChatMessageHTML(message, root):
  { tier, fracture } = classifyMessage(message)   // sole classifier (Research A)
  stamp .glec-card + data-glec-tier[/data-glec-frac]; apply baseline/dying CSS
  if tier not in {fracture-gold, fracture-red}: return            // no canvas
  if !fxRenderer.supported:                                        // FR-013 floor
      add `.glec-crack-css` (CSS/SVG crack via existing gluni-…-crack keyframes); return
  canvas = ensure <canvas class="glec-fx"> over the card art
  if freshIds.has(message.id):                                     // live crit
      freshIds.delete(message.id)                                  // play once
      fxRenderer.mountAnimated(canvas, { color: fracture })        // ~1s then settle
  else:                                                            // scrollback / late join
      fxRenderer.mountStatic(canvas, { color: fracture })          // frozen cracked still
```

## Guarantees (map to requirements)

- **One feature-local WebGL context** for etched-chat (two total across the suite with
  initiative; never one per card). The rAF loop only iterates **currently animating**
  cards — idle cracked cards cost zero GPU (FR-012, SC-006).
- **Settle-to-static**: after `durationMs`, capture the final frame and drop the rAF
  entry; the last blit stays painted (or is snapshotted to a `background-image`)
  (User Story 2, FR-012).
- **Graceful fallback**: `supported === false` ⇒ CSS/SVG crack, no console errors, no
  empty canvas (FR-013, SC-005, User Story 3).
- **Re-render safe**: `mountStatic` on already-animated cards prevents animation
  replay on scrollback/edit (FR-017).
- **Teardown on disable**: `destroy()` releases the renderer; no leaked PIXI
  resources (mirrors CardFXManager `destroy()`); disabled feature is inert (FR-014).
- **Cleanup on card removal**: `unmount` drops the 2D entry when a message element is
  detached (deleteChatMessage / chat re-render), preventing Map growth.

## Non-goals

- No render-to-`background-image` per animation frame (per-frame `toDataURL` is too
  costly; acceptable only for the single static snapshot).
- No dependency on `canvas.app.renderer` or a loaded scene (the dedicated renderer is
  scene-independent — see Research C; this is why the spec's "no scene" fallback
  trigger does not apply).
