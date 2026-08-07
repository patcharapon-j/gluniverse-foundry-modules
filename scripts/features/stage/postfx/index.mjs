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

/** Characters stand low in the frame — this is where light is measured from. */
const SLOT_ANCHOR_Y = 0.78;

const LUMA = [0.2126, 0.7152, 0.0722];

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
  return {
    ambient: mixRgb(ambient, [1, 1, 1], 0.25),
    centroid: sample.centroid,
    exposure: 1 - clamp01(sample.darkness) * 0.65,
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
    this._destroyed = false;
  }

  // ─── Configuration ───

  /** @param {{enabled?:boolean, intensity?:number, quality?:string}} config */
  setConfig(config = {}) {
    if ("enabled" in config) this._enabled = config.enabled !== false;
    if ("intensity" in config) this._intensity = clamp01(Number(config.intensity) || 0);
    if ("quality" in config) this._quality = config.quality === "off" ? "off" : "auto";
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
    const previous = this._slots.get(wrap);
    const state = {
      src: info.src || "",
      position: clamp01(info.position ?? 0.5),
      highlighted: !!info.highlighted,
      dimmed: !!info.dimmed,
      optOut: !!info.optOut,
      mode: previous?.mode ?? "off",
      reason: previous?.src === (info.src || "") ? previous?.reason : undefined,
      canvas: previous?.canvas ?? null,
      fallback: previous?.fallback ?? null,
      renderedSrc: previous?.src === (info.src || "") ? previous?.renderedSrc : null,
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
    const ambient = mixRgb(params.ambient, mixRgb(local, [1, 1, 1], 0.2), 0.6);

    // Key light colour comes from the background where the light appears to be.
    const key = toKeyLight(columnAt(this._sample, params.centroid[0]));

    // Direction: from this slot toward the scene's brightest region. Two
    // characters flanking a central fire get rims from opposite sides.
    const keyDir = keyDirection(params.centroid, state.position);
    return { ambient, key, keyDir };
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

    const lighting = this._slotLighting(state);

    if (!normal) {
      // `assetReason` is undefined when WebGL is missing (nothing probed the
      // asset at all), which is exactly the distinction the panel needs.
      this._applyCssFallback(wrap, state, lighting, assetReason(src) ?? "no-webgl");
      return;
    }

    const canvas = await this._gl.render(src, normal, {
      ambient: lighting.ambient,
      key: lighting.key,
      keyDir: lighting.keyDir,
      shadowColor: this._params.shadowColor,
      intensity: this._intensity,
      rim: 0.9,
      exposure: this._params.exposure,
      shadow: state.dimmed ? 1 : 0,
      lift: state.highlighted ? 1 : 0,
    });

    if (this._destroyed || !wrap.isConnected) return;
    // `render` awaits the art upload, so re-check the slot once more.
    state = this._slots.get(wrap);
    if (!state || state.src !== src) return;

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
    wrap.classList.remove("glstage-pp-css");
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

    const css = (rgb) =>
      `rgb(${Math.round(rgb[0] * 255)} ${Math.round(rgb[1] * 255)} ${Math.round(rgb[2] * 255)})`;

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
    layer.style.setProperty("--glstage-pp-exposure", String(this._params.exposure));
    // Dimming is carried by the shader on the full path; the fallback has to do
    // it here or a dimmed character would read as brightly lit as a spotlit one.
    layer.style.setProperty("--glstage-pp-dim", state.dimmed ? "1" : "0");

    state.mode = "css";
    state.renderedSrc = state.src;
    wrap.classList.add("glstage-pp-on", "glstage-pp-css");
  }

  _clearSlot(wrap, state) {
    state.canvas?.remove();
    state.canvas = null;
    state.fallback?.remove();
    state.fallback = null;
    state.mode = "off";
    state.reason = undefined;
    state.renderedSrc = null;
    wrap.classList.remove("glstage-pp-on", "glstage-pp-css");
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
      wrap.classList?.remove("glstage-pp-on", "glstage-pp-css");
    }
    this._slots.clear();
    this._gl?.destroy();
    this._gl = null;
  }
}
