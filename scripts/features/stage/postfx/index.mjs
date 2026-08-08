/**
 * Stage post-processing — orchestration.
 *
 * Ties the three pieces together: the scene sampler decides what the room looks
 * like, the normal-map prepass invents a surface for each character, and the GL
 * pass shades one against the other.
 *
 * Degradation is layered and always silent to players:
 *   full   — normal map + GL shading
 *   css    — art pixels unreadable (cross-origin without CORS) or no WebGL;
 *            falls back to masked CSS overlays: ambient tint + directional wash
 *   off    — disabled, opted out, or nothing samplable; renders exactly as before
 */

import { clamp01 } from "../../../core/util.mjs";
import { scaledMs } from "../../../core/theme.mjs";
import { sampleScene, columnAt, NEUTRAL_SAMPLE, invalidateSceneSamples } from "./scene-sample.mjs";
import { getNormalMap, invalidateNormalMap } from "./normal-map.mjs";
import { assetReason } from "./asset.mjs";
import { StageGL } from "./gl.mjs";

/** Matches the `--gl-d-reveal` rung; routed through the motion scale. */
const TWEEN_MS = 620;

// ── Where a character stands in the scene ──
// Stage art is composited over the background rather than placed in it, so
// nothing tells us where the figure "is". These two numbers are the model, and
// everything geometric derives from them: a standing figure's feet land near the
// bottom of the frame, and the figure spans about half the frame's height. They
// hold for the painted VN-style backgrounds this feature targets, where the
// horizon sits high and the foreground floor fills the lower third.

/** Scene Y where a standing figure's feet land. */
const FEET_SCENE_Y = 0.94;

/** How much of the background's height a whole standing figure covers. */
const BODY_SCENE_HEIGHT = 0.52;

/**
 * Where light is measured from when the figure's real extent is unknown — the
 * middle of the body, not its feet. Only the CSS fallback uses this; the shader
 * path measures the silhouette instead.
 */
export const SLOT_ANCHOR_Y = FEET_SCENE_Y - BODY_SCENE_HEIGHT * 0.5;

const LUMA = [0.2126, 0.7152, 0.0722];

/**
 * How hard each term of the character pass is driven, in the semi-realistic
 * style. See `CEL_SHADER_STRENGTHS` for the cel/anime set and why it is not the
 * same numbers.
 *
 * Exported because the preview harness has to render the picture a world
 * actually gets: a second copy of these numbers is a second chance for the
 * contact sheet to be reassuring about a build nobody is running.
 *
 * The first three add in linear light, where mid-grey is 0.22 rather than 0.5 —
 * they are not comparable to the gamma-space strengths they replaced and look
 * far too large next to them.
 */
export const SHADER_STRENGTHS = Object.freeze({
  /** The wide rim lobe — the halo the core sits inside. */
  rim: 1.45,
  /** The tight core, in encoded light and on its own scale: it is added past the
   *  strength dial's crossfade rather than through it, for the reason set out in
   *  the shader. Bright enough that the outermost texels of a backlit shoulder
   *  clip to white, and no brighter — drive this and the edge stops looking like
   *  light landing on a figure and starts looking like a cut-out being traced. */
  rimEdge: 0.72,
  /** Light spilling past the outline. Free, in the sense that the falloff it
   *  needs is the prepass's blurred alpha, which already extends past the
   *  silhouette — see the note in the shader. */
  glow: 0.85,
  /** Interior contours. Deliberately small: this term traces every form edge the
   *  art draws, and past roughly 0.5 it starts finding facial lineart too and
   *  reads as an outline filter rather than as light. */
  contour: 0.4,
  spec: 0.33,
  sheen: 0.12,
  /** Style blend. 0 is this model exactly; see the cel set below. */
  cel: 0,
  /** Ditto: 0 lets the key shade the body, which is what this model is. */
  rimOnly: 0,
});

/**
 * The same terms, driven for cel/anime art.
 *
 * These are lower than the realistic set almost across the board, and that is
 * not a taste judgement — it is arithmetic. Every banded term is *flat* over its
 * shape where the term it replaces was a falloff peaking at one contour, so it
 * delivers several times the light for the same strength. Carrying the realistic
 * numbers over blows the rim into a white bar and the specular into a plate.
 *
 * Where a number does go up it is because the style leans on that term rather
 * than because the maths asked for it: the core, which is the hard line cel
 * shading is recognised by, and the contour, which is the nearest thing this
 * model has to ink.
 */
export const CEL_SHADER_STRENGTHS = Object.freeze({
  /** A flat band, not a falloff — roughly half, for the same light. */
  rim: 0.7,
  /** Up: the drawn line is the whole look, and it should clip to white. */
  rimEdge: 0.8,
  /** Down: cel spills a band along the contour, it doesn't fog the air. */
  glow: 0.55,
  /** Up: form edges reading as drawn lines is a signature of the style. */
  contour: 0.5,
  /** Down: a flat shape covers far more of the lobe than the lobe's own peak. */
  spec: 0.26,
  /** Up in absolute terms, down against the area it now covers — this is the
   *  hard band across hair, which cel art always has and realism rarely does. */
  sheen: 0.2,
  cel: 1,
  rimOnly: 0,
});

/**
 * The same terms again, for art that should be graded by the room but not lit
 * by it — the key touches the outline and nothing else.
 *
 * The three zeroes are the mode. Contour, specular and sheen all draw *inside*
 * the silhouette, and no amount of tuning makes an interior highlight not be
 * one, so they are switched off outright rather than driven low. What the
 * shader's `u_rimOnly` then removes is the rest: the diffuse gradient, the
 * contact darkening, the directional half of the ambient split and the
 * grounding shadow. Between them there is no term left that puts a gradient on
 * the body from the lamp's direction.
 *
 * The three that survive go *up*, and for one reason: they are now carrying the
 * whole effect. With no diffuse gradient there is no bright side for a modest
 * rim to sit on top of, so the same numbers that read as a lit edge in the
 * semi-realistic model read as a faint outline here.
 */
export const RIM_SHADER_STRENGTHS = Object.freeze({
  /** Up, but the shader's narrowing is what does the work here: past a certain
   *  tightness the halo is thin enough that its own gain barely moves the
   *  picture, and the core is what the eye lands on. Measured, the difference
   *  between 1.3 and 1.7 is a tenth of a pixel of reach. */
  rim: 1.7,
  /** Up: with nothing else drawing, the core is what the eye lands on. */
  rimEdge: 0.95,
  /** Up: the spill is the half of the glow that lands outside the art, and it
   *  is the half this mode can spend freely — nothing out there is the
   *  character's own painted detail. */
  glow: 1.0,
  contour: 0,
  spec: 0,
  sheen: 0,
  cel: 0,
  rimOnly: 1,
});

/** The strength set for a style id, falling back to the semi-realistic one. */
export function shaderStrengths(style) {
  if (style === "cel") return CEL_SHADER_STRENGTHS;
  if (style === "rim") return RIM_SHADER_STRENGTHS;
  return SHADER_STRENGTHS;
}

/**
 * Style ids, and the class each one puts on the wrap for the CSS fallback.
 *
 * Listed in one place so nothing can add a style the teardown paths don't know
 * to clean up — a stale style class survives every subsequent render, since the
 * fallback only ever *sets* the one it wants.
 */
const STYLE_CLASS = Object.freeze({ realistic: "", cel: "glstage-pp-cel", rim: "glstage-pp-rim" });
const STYLE_CLASSES = Object.values(STYLE_CLASS).filter(Boolean);

/**
 * Drop the custom properties the CSS fallback writes onto the wrap itself.
 *
 * The layer's own properties leave with the layer; these outlive it, and one of
 * them drives a `filter` on the `<img>` — so a slot that graduates from the
 * fallback to the shader would otherwise keep a stale glow around art the
 * shader is already rimming.
 */
function clearWrapVars(wrap) {
  wrap.style?.removeProperty?.("--glstage-pp-exposure");
  wrap.style?.removeProperty?.("--glstage-pp-rim-glow");
}

function luma(rgb) {
  return LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2];
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Turn a sampled background colour into something that reads as a *light*.
 * Raw background colour is too dark and too desaturated to key with, so the hue
 * is kept, the brightest channel is normalised up, and the result is scaled by
 * how bright the source actually was.
 */
function toKeyLight(rgb) {
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 0.001);
  const normalised = [rgb[0] / peak, rgb[1] / peak, rgb[2] / peak];
  // Pull partway back toward white — real key light is less saturated than the
  // surface it bounced off.
  const desaturated = mixRgb(normalised, [1, 1, 1], 0.35);
  const strength = 0.35 + luma(rgb) * 0.75;
  return desaturated.map((c) => clamp01(c * strength));
}

/**
 * The colour of light arriving from the side the key *isn't* on.
 *
 * Nothing in a room is lit by one lamp and nothing else — the rest arrives
 * bounced off walls and floor, and it arrives carrying the room's colour rather
 * than the lamp's. Giving the shadow side its own hue is what stops a figure
 * reading as one flat tint with a bright edge.
 *
 * The result is luminance-matched to the ambient it came from, deliberately: it
 * is a colour separation, not a second light. If it changed brightness it would
 * compete with the key term for the shape of the figure, and the exposure of the
 * whole stage would drift with the background's hue.
 *
 * Exported for testing.
 */
export function bounceLight(ambient, key) {
  const peak = Math.max(key[0], key[1], key[2], 0.001);
  // What the key is *not* made of. A warm lamp bounces cool, and vice versa.
  const complement = [1 - key[0] / peak, 1 - key[1] / peak, 1 - key[2] / peak];
  // Biased toward cool: skylight and painted VN interiors both fill blue, and a
  // pure complement of a blue key would read as a second orange lamp.
  const tinted = mixRgb(complement, [0.55, 0.65, 0.9], 0.5);
  // Mostly still the room's own colour — this is a nudge, not a repaint.
  const mixed = mixRgb(ambient, tinted, 0.45);

  const target = luma(ambient);
  const current = luma(mixed);
  let gain = current > 1e-4 ? target / current : 1;
  // Never let the match clip a channel; a clipped bounce is no longer matched.
  gain = Math.min(gain, 1 / Math.max(mixed[0], mixed[1], mixed[2], 1e-4));
  return mixed.map((c) => clamp01(c * gain));
}

/**
 * Direction from a character toward the scene's brightest region.
 *
 * Y stays in image space (+Y downward) — the same convention the normal map's
 * green channel is encoded in, so `dot(N, L)` in the shader compares like with
 * like. A light above the character therefore yields a negative Y.
 *
 * Exported for testing; `_slotLighting` is the only caller in production.
 *
 * @param {[number,number]} centroid  Luminance centroid, 0..1 in image space.
 * @param {number} position           Slot's horizontal position, 0..1.
 * @returns {[number,number]} Unit vector toward the light.
 */
export function keyDirection(centroid, position, anchorY = SLOT_ANCHOR_Y) {
  let dx = centroid[0] - position;
  let dy = centroid[1] - anchorY;
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

/**
 * Place the key light inside the art's own coordinate space.
 *
 * The shader shades one character at a time in its own texture, but the light
 * lives in the *background*. This is the bridge: it works out where that light
 * would fall if the art were standing in the scene, and expresses it in art
 * coordinates the fragment shader can subtract from `v_uv`.
 *
 * Both spaces are made isotropic first (X multiplied by aspect), because a step
 * of 0.1 across a 16:9 background is nearly twice the distance of 0.1 down it,
 * and mixing the two would skew every angle.
 *
 * The figure's measured silhouette is the yardstick between the two spaces: its
 * on-screen height is known in art units, and the scene model says what fraction
 * of a body that is. This is what makes framing matter — a knee-up crop and a
 * full body at the same pixel height are *not* the same distance from the lamp,
 * and the light lands higher above the head on the crop because less of the body
 * is between them.
 *
 * Exported for testing.
 *
 * @param {[number,number]} centroid  Luminance centroid of the background.
 * @param {number} position           Slot's horizontal position across the stage, 0..1.
 * @param {object} figure             From `describeFigure` in the normal-map prepass.
 * @param {number} artAspect          Character art width / height.
 * @param {number} bgAspect           Background width / height.
 */
export function lightPlacement(centroid, position, figure, artAspect, bgAspect) {
  const visibleSpan = BODY_SCENE_HEIGHT * figure.bodyFraction;
  const headY = FEET_SCENE_Y - BODY_SCENE_HEIGHT;

  // Art units per scene unit, taken from the one measurement both spaces share:
  // how tall the visible figure is.
  const figHeight = Math.max(figure.y1 - figure.y0, 1e-4);
  const scale = figHeight / Math.max(visibleSpan, 1e-4);

  // Figure centre, in each space.
  const artCx = ((figure.x0 + figure.x1) / 2) * artAspect;
  const artCy = (figure.y0 + figure.y1) / 2;
  const sceneCx = position * bgAspect;
  const sceneCy = headY + visibleSpan / 2;

  const lightP = [
    artCx + (centroid[0] * bgAspect - sceneCx) * scale,
    artCy + (centroid[1] - sceneCy) * scale,
  ];

  // The light is in the room, not on the art plane. Scaling its depth by the
  // figure's size keeps the wrap consistent across art of any resolution.
  const lightZ = figHeight * 0.55;

  const refDist = Math.hypot(lightP[0] - artCx, lightP[1] - artCy, lightZ);

  return {
    lightP,
    lightZ,
    refDist,
    uvScale: [artAspect, 1],
    figTop: figure.y0,
    figBottom: figure.y1,
    // Floor shadow needs a floor. Cubed so a knee-up crop, whose feet are out
    // of frame, gets essentially none rather than a dark band across its hem.
    ground: 0.32 * figure.bodyFraction ** 3,
  };
}

/**
 * The CSS gradient angle that puts the lit colour on the lit side.
 *
 * CSS gradient angles run clockwise from "to top", and a gradient's 0% stop
 * sits at the end *opposite* the angle. The lit colour is at 0%, so the
 * gradient must point away from the light.
 *
 * Exported for testing.
 */
export function cssGradientAngle(keyDir) {
  const deg = (Math.atan2(-keyDir[0], keyDir[1]) * 180) / Math.PI;
  // Normalise to [0, 360). A centroid sitting exactly above the slot makes the
  // X component negative zero, which would otherwise emit -180deg — equivalent
  // to CSS, but not something to leave to chance.
  return (deg % 360 + 360) % 360;
}

/** Scene-level values that tween when the background changes. */
function sceneParams(sample) {
  const ambient = sample.ambient;
  const darkness = clamp01(sample.darkness);
  return {
    // Pulled toward white only enough to stop a saturated room turning the art
    // monochrome. Kept deliberately low: a character standing in a green room
    // reads as *being* in it because the room's colour is all over them, and
    // washing the ambient out is the fastest way to lose that.
    ambient: mixRgb(ambient, [1, 1, 1], 0.15),
    centroid: sample.centroid,
    // Perceptual, because the CSS fallback feeds it straight to `brightness()`.
    // The shader wants it in linear light and squares it up on the way in.
    exposure: 1 - darkness * 0.65,
    // Colour vision goes before acuity does, so a properly dark scene should
    // desaturate as well as dim. Squared: it should be absent at dusk and only
    // arrive when the scene is genuinely night.
    night: darkness * darkness * 0.55,
    // Dimmed characters recede toward a cool, darkened version of the room.
    shadowColor: mixRgb(mixRgb(ambient, [0.06, 0.08, 0.14], 0.6), [0, 0, 0], 0.25),
  };
}

function lerpParams(a, b, t) {
  return {
    ambient: mixRgb(a.ambient, b.ambient, t),
    centroid: [
      a.centroid[0] + (b.centroid[0] - a.centroid[0]) * t,
      a.centroid[1] + (b.centroid[1] - a.centroid[1]) * t,
    ],
    exposure: a.exposure + (b.exposure - a.exposure) * t,
    night: a.night + (b.night - a.night) * t,
    shadowColor: mixRgb(a.shadowColor, b.shadowColor, t),
  };
}

export class StagePostFX {
  constructor() {
    this._gl = null;
    this._slots = new Map(); // wrap element → slot state
    this._sample = NEUTRAL_SAMPLE;
    this._params = sceneParams(NEUTRAL_SAMPLE);
    this._from = this._params;
    this._to = this._params;
    this._tweenStart = 0;
    this._tweenRaf = 0;
    this._renderRaf = 0;
    this._enabled = true;
    this._intensity = 0.6;
    this._quality = "auto";
    this._style = "realistic";
    this._destroyed = false;
  }

  // ─── Configuration ───

  /** @param {{enabled?:boolean, intensity?:number, quality?:string, style?:string}} config */
  setConfig(config = {}) {
    if ("enabled" in config) this._enabled = config.enabled !== false;
    if ("intensity" in config) this._intensity = clamp01(Number(config.intensity) || 0);
    if ("quality" in config) this._quality = config.quality === "off" ? "off" : "auto";
    // Anything unrecognised is the semi-realistic model, which is also what a
    // world that has never seen this setting gets.
    if ("style" in config) {
      this._style = Object.hasOwn(STYLE_CLASS, config.style) ? config.style : "realistic";
    }
    this._scheduleRender();
  }

  get active() {
    return this._enabled && this._quality !== "off";
  }

  /**
   * What the GM panel reports. `reason` explains a weaker-than-expected result
   * so a GM on a non-CORS asset host isn't left guessing.
   */
  getStatus() {
    let cssFallbacks = 0;
    let corsFallbacks = 0;
    let missingArt = 0;
    for (const state of this._slots.values()) {
      if (state.mode !== "css") continue;
      cssFallbacks++;
      // Only the CORS case has a fix the GM can act on; a missing file is a
      // broken image path and says so on its own.
      if (state.reason === "cors" || state.reason === "tainted") corsFallbacks++;
      else if (state.reason === "missing") missingArt++;
    }
    return {
      active: this.active,
      backgroundDegraded: !!this._sample.degraded,
      backgroundReason: this._sample.reason,
      webglAvailable: this._gl ? this._gl.isSupported() : true,
      cssFallbacks,
      corsFallbacks,
      missingArt,
    };
  }

  // ─── Scene ───

  /** Re-sample the background and tween the grade across. */
  async refreshScene(scene) {
    const sample = await sampleScene(scene);
    if (this._destroyed) return;
    this._sample = sample;

    const next = sceneParams(sample);
    this._from = this._params;
    this._to = next;
    this._tweenStart = performance.now();

    const duration = scaledMs(TWEEN_MS);
    if (duration <= 0) {
      this._params = next;
      this._scheduleRender();
      return;
    }
    if (!this._tweenRaf) this._tweenRaf = requestAnimationFrame(() => this._stepTween(duration));
  }

  _stepTween(duration) {
    this._tweenRaf = 0;
    if (this._destroyed) return;

    const elapsed = performance.now() - this._tweenStart;
    const t = clamp01(elapsed / duration);
    // Smoothstep — matches the decelerate-to-rest feel of --gl-ease.
    const eased = t * t * (3 - 2 * t);
    this._params = lerpParams(this._from, this._to, eased);
    this._renderAll();

    if (t < 1) this._tweenRaf = requestAnimationFrame(() => this._stepTween(duration));
  }

  // ─── Slots ───

  /**
   * Register (or update) a character slot.
   * @param {HTMLElement} wrap  The `.stage-actor-img-wrap` element.
   * @param {object} info       { src, position, highlighted, dimmed, optOut }
   */
  register(wrap, info) {
    if (!wrap) return;
    const src = info.src || "";
    const previous = this._slots.get(wrap);
    // A slot that changed art carries nothing forward. Its canvas holds the
    // *old* character, and the shaded canvas is what the viewer sees — keeping
    // it would leave the previous face on screen until the new render lands.
    // Dropping it shows the plain <img> for that gap instead, which is the right
    // character merely unlit.
    const sameArt = !!previous && previous.src === src;
    if (previous && !sameArt) this._clearSlot(wrap, previous);

    const state = {
      src,
      position: clamp01(info.position ?? 0.5),
      highlighted: !!info.highlighted,
      dimmed: !!info.dimmed,
      optOut: !!info.optOut,
      mode: sameArt ? previous.mode : "off",
      reason: sameArt ? previous.reason : undefined,
      canvas: sameArt ? previous.canvas : null,
      fallback: sameArt ? previous.fallback : null,
      renderedSrc: sameArt ? previous.renderedSrc : null,
    };
    this._slots.set(wrap, state);
    this._scheduleRender();
  }

  unregister(wrap) {
    const state = this._slots.get(wrap);
    if (!state) return;
    state.canvas?.remove();
    state.fallback?.remove();
    this._slots.delete(wrap);
  }

  /** Drop slots whose elements have left the document. */
  prune() {
    for (const [wrap, state] of [...this._slots]) {
      if (!wrap.isConnected) {
        state.canvas?.remove();
        state.fallback?.remove();
        this._slots.delete(wrap);
      }
    }
  }

  // ─── Rendering ───

  _scheduleRender() {
    if (this._destroyed || this._renderRaf) return;
    this._renderRaf = requestAnimationFrame(() => {
      this._renderRaf = 0;
      this._renderAll();
    });
  }

  _renderAll() {
    if (this._destroyed) return;
    for (const [wrap, state] of this._slots) {
      if (!wrap.isConnected || !state) continue;
      this._renderSlot(wrap).catch(() => {
        /* a single slot failing must never take the stage down */
      });
    }
  }

  /** Per-slot lighting derived from where the character stands. */
  _slotLighting(state) {
    const params = this._params;
    const local = columnAt(this._sample, state.position);
    // Ambient is mostly the local column — that's what makes the character in
    // front of the fire read differently from the one by the window.
    const ambient = mixRgb(params.ambient, mixRgb(local, [1, 1, 1], 0.12), 0.6);

    // Key light colour comes from the background where the light appears to be.
    const key = toKeyLight(columnAt(this._sample, params.centroid[0]));

    // A single direction from this slot toward the scene's brightest region.
    // Two characters flanking a central fire get rims from opposite sides. Only
    // the CSS fallback consumes this now — the shader gets a light *position*
    // via `lightPlacement` and works the direction out per fragment, which it
    // can do because it has the figure's measured silhouette and the fallback
    // does not.
    const keyDir = keyDirection(params.centroid, state.position);

    // The shadow side gets the room's colour rather than the lamp's. Only the
    // shader consumes this — the CSS fallback has one gradient per direction and
    // no normal to aim a third one with.
    return { ambient, key, keyDir, bounce: bounceLight(ambient, key) };
  }

  async _renderSlot(wrap) {
    // Read the live state on every pass: `register` replaces the state object,
    // so anything captured before an await can be stale by the time it resumes.
    let state = this._slots.get(wrap);
    if (!state) return;

    const off = !this.active || state.optOut || !state.src || !this._sample.ok;
    if (off) {
      this._clearSlot(wrap, state);
      return;
    }

    if (!this._gl) this._gl = new StageGL();

    const src = state.src;
    const normal = this._gl.isSupported() ? await getNormalMap(src) : null;
    if (this._destroyed || !wrap.isConnected) return;
    // The slot may have been reassigned while the prepass was in flight.
    state = this._slots.get(wrap);
    if (!state || state.src !== src) return;

    if (!normal) {
      // `assetReason` is undefined when WebGL is missing (nothing probed the
      // asset at all), which is exactly the distinction the panel needs.
      this._applyCssFallback(wrap, state, this._slotLighting(state), assetReason(src) ?? "no-webgl");
      return;
    }

    // Uploading the art can suspend; shading and copying out must not. See the
    // note on `StageGL.draw` — the render target is shared by every slot, so
    // anything that yields between the draw and the blit lets another slot's
    // character land in this one.
    const prepared = await this._gl.prepare(src, normal);

    if (this._destroyed || !wrap.isConnected) return;
    // `prepare` awaits the art upload, so re-check the slot once more.
    state = this._slots.get(wrap);
    if (!state || state.src !== src) return;

    const lighting = this._slotLighting(state);

    if (!prepared) {
      this._applyCssFallback(wrap, state, lighting, assetReason(src) ?? "render");
      return;
    }

    const placement = lightPlacement(
      this._params.centroid,
      state.position,
      normal.figure,
      normal.width / Math.max(normal.height, 1),
      this._sample.aspect || 16 / 9
    );

    // ── Nothing below this line may await. ──
    const canvas = this._gl.draw(prepared, {
      ...placement,
      ambient: lighting.ambient,
      bounce: lighting.bounce,
      key: lighting.key,
      shadowColor: this._params.shadowColor,
      intensity: this._intensity,
      // Carries `cel` as well as the six term strengths — the style is one
      // frozen table, so a strength and the banding it was balanced against can
      // never arrive from different places.
      ...shaderStrengths(this._style),
      // The model works in linear light; `exposure` is stored perceptually for
      // the CSS fallback's `brightness()` filter, so convert it here.
      exposure: Math.pow(this._params.exposure, 2.2),
      night: this._params.night,
      shadow: state.dimmed ? 1 : 0,
      lift: state.highlighted ? 1 : 0,
    });

    if (!canvas) {
      this._applyCssFallback(wrap, state, lighting, assetReason(src) ?? "render");
      return;
    }

    this._blit(wrap, state, canvas);
  }

  /** Copy the shared GL canvas into this slot's own canvas. */
  _blit(wrap, state, source) {
    let target = state.canvas;
    if (!target) {
      target = document.createElement("canvas");
      target.className = "glstage-pp-canvas";
      target.setAttribute("aria-hidden", "true");
      wrap.appendChild(target);
      state.canvas = target;
    }
    if (target.width !== source.width || target.height !== source.height) {
      target.width = source.width;
      target.height = source.height;
    }
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0);

    state.fallback?.remove();
    state.fallback = null;
    state.mode = "full";
    state.reason = undefined;
    state.renderedSrc = state.src;
    wrap.classList.add("glstage-pp-on");
    wrap.classList.remove("glstage-pp-css", ...STYLE_CLASSES);
    clearWrapVars(wrap);
  }

  /**
   * CSS path: masked overlays taking the character's exact silhouette. Masks
   * reference the art by URL and never read its pixels, so this works
   * unconditionally on cross-origin assets — including a bucket that will never
   * send a CORS header.
   *
   * Three layers rather than two: an ambient wash, a lit gradient from the key
   * direction, and a shadow gradient from the opposite side. The third costs
   * nothing and is what stops the fallback reading as a flat colour overlay,
   * which matters because for un-CORS-able art this is the *only* look there is.
   */
  _applyCssFallback(wrap, state, lighting, reason) {
    state.reason = reason;
    state.canvas?.remove();
    state.canvas = null;

    let layer = state.fallback;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "glstage-pp-fallback";
      layer.setAttribute("aria-hidden", "true");
      layer.innerHTML =
        '<span class="glstage-pp-tint"></span>' +
        '<span class="glstage-pp-shade"></span>' +
        '<span class="glstage-pp-key"></span>';
      wrap.appendChild(layer);
      state.fallback = layer;
    }

    const css = (rgb, alpha = 1) => {
      const c = `${Math.round(rgb[0] * 255)} ${Math.round(rgb[1] * 255)} ${Math.round(rgb[2] * 255)}`;
      return alpha >= 1 ? `rgb(${c})` : `rgb(${c} / ${alpha.toFixed(3)})`;
    };

    // Feature-prefixed custom properties on the element — never bare --gl-* on
    // :root, which would repaint every feature loaded after Stage.
    const url = `url("${state.src.replace(/["\\]/g, "\\$&")}")`;
    const angle = cssGradientAngle(lighting.keyDir);
    layer.style.setProperty("--glstage-pp-mask", url);
    layer.style.setProperty("--glstage-pp-ambient", css(lighting.ambient));
    layer.style.setProperty("--glstage-pp-key", css(lighting.key));
    layer.style.setProperty("--glstage-pp-angle", `${angle}deg`);
    // The shadow gradient runs the other way, so its lit-side stop is the one
    // that fades out — the dark end lands opposite the key.
    layer.style.setProperty("--glstage-pp-shade-angle", `${(angle + 180) % 360}deg`);
    layer.style.setProperty("--glstage-pp-shadow", css(this._params.shadowColor));
    layer.style.setProperty("--glstage-pp-strength", String(this._intensity));
    // Dimming is carried by the shader on the full path; the fallback has to do
    // it here or a dimmed character would read as brightly lit as a spotlit one.
    layer.style.setProperty("--glstage-pp-dim", state.dimmed ? "1" : "0");

    // These two are read by the <img>, which is the layer's *sibling* — custom
    // properties inherit downward, so they have to be set on the wrap the two
    // share or they never arrive.
    wrap.style.setProperty("--glstage-pp-exposure", String(this._params.exposure));
    // The rim glow's strength lives in its alpha: a filter has no opacity of its
    // own, so this is the only way the dial reaches it. Dimmed and highlighted
    // characters scale the same way the shader's core does.
    const glow = this._intensity * (state.dimmed ? 0.25 : 1) * (state.highlighted ? 1.5 : 1);
    wrap.style.setProperty("--glstage-pp-rim-glow", css(lighting.key, clamp01(glow)));

    state.mode = "css";
    state.renderedSrc = state.src;
    wrap.classList.add("glstage-pp-on", "glstage-pp-css");
    // The fallback follows the style too, as far as masked gradients can. Cel
    // gets hard stops instead of ramps: it cannot band the art's own shading —
    // it never reads a pixel — but a figure whose lit and shadow sides meet at
    // a line is still recognisably the same choice as the shader's. Rim-only
    // drops the directional gradients entirely and glows the silhouette, which
    // for once this path can do exactly: a drop-shadow is a blur of the alpha,
    // which is all the shader's spill term is either.
    wrap.classList.remove(...STYLE_CLASSES);
    const styleClass = STYLE_CLASS[this._style];
    if (styleClass) wrap.classList.add(styleClass);
  }

  _clearSlot(wrap, state) {
    state.canvas?.remove();
    state.canvas = null;
    state.fallback?.remove();
    state.fallback = null;
    state.mode = "off";
    state.reason = undefined;
    state.renderedSrc = null;
    wrap.classList.remove("glstage-pp-on", "glstage-pp-css", ...STYLE_CLASSES);
    clearWrapVars(wrap);
  }

  // ─── Invalidation ───

  /** An actor's art changed — drop every cached derivative of the old asset. */
  invalidateArt(src) {
    if (!src) return;
    invalidateNormalMap(src);
    this._gl?.invalidate(src);
    this._scheduleRender();
  }

  /** A background asset may have changed under the same path. */
  invalidateBackground(src = null) {
    invalidateSceneSamples(src);
  }

  // ─── Teardown ───

  destroy() {
    this._destroyed = true;
    if (this._tweenRaf) cancelAnimationFrame(this._tweenRaf);
    if (this._renderRaf) cancelAnimationFrame(this._renderRaf);
    this._tweenRaf = 0;
    this._renderRaf = 0;
    for (const [wrap, state] of this._slots) {
      state.canvas?.remove();
      state.fallback?.remove();
      wrap.classList?.remove("glstage-pp-on", "glstage-pp-css", ...STYLE_CLASSES);
      clearWrapVars(wrap);
    }
    this._slots.clear();
    this._gl?.destroy();
    this._gl = null;
  }
}
