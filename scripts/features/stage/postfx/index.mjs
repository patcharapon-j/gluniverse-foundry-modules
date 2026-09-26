/**
 * Stage character grade — orchestration.
 *
 * Owns the slots, the current grade and the tween between grades, and decides
 * per slot which of two presentations it gets:
 *
 *   full  — the art is graded on the GPU (gl.mjs) and copied into the slot
 *   css   — the art's pixels can't be read (cross-origin without CORS) or there
 *           is no WebGL; the dials are approximated with CSS filters on the
 *           <img> itself
 *   off   — disabled, opted out, or no art; the <img> renders untouched
 *
 * The grade itself is data (grade-model.mjs): the GM sets it, it is stored on
 * the scene, and this file only ever applies it. Nothing here moves a value on
 * its own.
 */

import { clamp01 } from "../../../core/util.mjs";
import { scaledMs } from "../../../core/theme.mjs";
import { assetReason } from "./asset.mjs";
import { StageGL } from "./gl.mjs";
import {
  DEFAULT_GRADE,
  DEFAULT_TRIM,
  BASIC_KEYS,
  normalizeGrade,
  normalizeTrim,
  basicParams,
} from "./grade-model.mjs";

/** Matches the `--gl-d-reveal` rung; routed through the motion scale. */
const TWEEN_MS = 620;

/** Every class this file ever puts on a wrap, so teardown can take them all. */
const WRAP_CLASSES = ["glstage-pp-on", "glstage-pp-css"];

/** Interpolate the dials of two normalized grades. */
function lerpGrade(a, b, t) {
  const basic = {};
  for (const key of BASIC_KEYS) basic[key] = a.basic[key] + (b.basic[key] - a.basic[key]) * t;
  return { ...b, basic };
}

/**
 * The CSS filter chain that approximates a set of basic-correction dials.
 *
 * Approximate by necessity: CSS filters run per channel in encoded light and
 * have no lift or midtone control, so brightness and gamma are carried by
 * `brightness()` alone, and the master intensity scales every dial toward its
 * neutral value rather than crossfading pixels. Exported for the check tool,
 * which pins that all-neutral dials produce no filter at all.
 */
export function cssFilterFor(basic, trim, intensity) {
  const p = basicParams(basic, trim);
  const k = clamp01(intensity);
  // Each filter is scaled toward its neutral value and left out entirely once
  // it gets there, so neutral dials — or intensity 0 — write no filter at all.
  const toward = (value) => 1 + (value - 1) * k;
  const parts = [];
  // Exposure is a linear gain; brightness() works on encoded values. Lift and
  // gamma have no CSS equivalent, so their effect on mid-grey rides here too.
  const gain = toward(Math.pow(p.gain, 1 / 2.2) * (1 + p.lift) * Math.pow(0.5, 1 / p.gamma - 1));
  if (Math.abs(gain - 1) > 1e-4) parts.push(`brightness(${gain.toFixed(4)})`);
  const contrast = toward(p.contrast);
  if (Math.abs(contrast - 1) > 1e-4) parts.push(`contrast(${contrast.toFixed(4)})`);
  const sat = toward(p.sat);
  if (Math.abs(sat - 1) > 1e-4) parts.push(`saturate(${sat.toFixed(4)})`);
  const deg = ((Math.atan2(p.hueSin, p.hueCos) * 180) / Math.PI) * k;
  if (Math.abs(deg) > 1e-3) parts.push(`hue-rotate(${deg.toFixed(2)}deg)`);
  return parts.join(" ");
}

export class StagePostFX {
  constructor() {
    this._gl = null;
    this._slots = new Map(); // wrap element → slot state
    this._enabled = true;
    this._intensity = 0.6;
    this._quality = "auto";
    this._grade = normalizeGrade(DEFAULT_GRADE);
    this._from = this._grade;
    this._to = this._grade;
    this._tweenStart = 0;
    this._tweenRaf = 0;
    this._renderRaf = 0;
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

  /** The grade currently being applied (mid-tween, the interpolated one). */
  get grade() {
    return this._grade;
  }

  /**
   * Adopt a new grade.
   *
   * @param {object} grade   A stored grade; normalized here.
   * @param {object} [opts]
   * @param {boolean} [opts.immediate]  Skip the tween — used while the GM drags a
   *                                    slider, where the preview must follow the
   *                                    hand rather than chase it.
   */
  setGrade(grade, { immediate = false } = {}) {
    const next = normalizeGrade(grade);
    const duration = immediate ? 0 : scaledMs(TWEEN_MS);
    if (duration <= 0) {
      if (this._tweenRaf) cancelAnimationFrame(this._tweenRaf);
      this._tweenRaf = 0;
      this._grade = next;
      this._from = this._to = next;
      this._scheduleRender();
      return;
    }
    this._from = this._grade;
    this._to = next;
    this._tweenStart = performance.now();
    if (!this._tweenRaf) this._tweenRaf = requestAnimationFrame(() => this._stepTween(duration));
  }

  _stepTween(duration) {
    this._tweenRaf = 0;
    if (this._destroyed) return;
    const t = clamp01((performance.now() - this._tweenStart) / duration);
    // Smoothstep — matches the decelerate-to-rest feel of --gl-ease.
    this._grade = t >= 1 ? this._to : lerpGrade(this._from, this._to, t * t * (3 - 2 * t));
    this._renderAll();
    if (t < 1) this._tweenRaf = requestAnimationFrame(() => this._stepTween(duration));
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
      if (state.reason === "cors" || state.reason === "tainted") corsFallbacks++;
      else if (state.reason === "missing") missingArt++;
    }
    return {
      active: this.active,
      webglAvailable: this._gl ? this._gl.isSupported() : true,
      cssFallbacks,
      corsFallbacks,
      missingArt,
    };
  }

  // ─── Slots ───

  /**
   * Register (or update) a character slot.
   * @param {HTMLElement} wrap  The `.stage-actor-img-wrap` element.
   * @param {object} info       { src, position, optOut, trim }
   */
  register(wrap, info) {
    if (!wrap) return;
    const src = info.src || "";
    const previous = this._slots.get(wrap);
    // A slot that changed art carries nothing forward. Its canvas holds the
    // *old* character, and the graded canvas is what the viewer sees — keeping
    // it would leave the previous face on screen until the new render lands.
    const sameArt = !!previous && previous.src === src;
    if (previous && !sameArt) this._clearSlot(wrap, previous);

    const state = {
      src,
      position: clamp01(info.position ?? 0.5),
      optOut: !!info.optOut,
      trim: info.trim ? normalizeTrim(info.trim) : DEFAULT_TRIM,
      mode: sameArt ? previous.mode : "off",
      reason: sameArt ? previous.reason : undefined,
      canvas: sameArt ? previous.canvas : null,
    };
    this._slots.set(wrap, state);
    this._scheduleRender();
  }

  unregister(wrap) {
    const state = this._slots.get(wrap);
    if (!state) return;
    this._clearSlot(wrap, state);
    this._slots.delete(wrap);
  }

  /** Drop slots whose elements have left the document. */
  prune() {
    for (const [wrap, state] of [...this._slots]) {
      if (!wrap.isConnected) {
        state.canvas?.remove();
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

  async _renderSlot(wrap) {
    // Read the live state on every pass: `register` replaces the state object,
    // so anything captured before an await can be stale by the time it resumes.
    let state = this._slots.get(wrap);
    if (!state) return;

    if (!this.active || state.optOut || !state.src) {
      this._clearSlot(wrap, state);
      return;
    }

    if (!this._gl) this._gl = new StageGL({ onLost: () => this._scheduleRender() });
    const src = state.src;

    // Uploading the art can suspend; grading and copying out must not. See the
    // note on `StageGL.draw`.
    const prepared = this._gl.isSupported() ? await this._gl.prepare(src) : null;

    if (this._destroyed || !wrap.isConnected) return;
    state = this._slots.get(wrap);
    if (!state || state.src !== src) return;

    if (!prepared) {
      // `assetReason` is undefined when WebGL is missing (nothing probed the
      // asset at all), which is exactly the distinction the panel needs.
      this._applyCssFallback(wrap, state, assetReason(src) ?? "no-webgl");
      return;
    }

    // ── Nothing below this line may await. ──
    const canvas = this._gl.draw(prepared, {
      intensity: this._intensity,
      ...basicParams(this._grade.basic, state.trim),
    });

    if (!canvas) {
      this._applyCssFallback(wrap, state, assetReason(src) ?? "render");
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

    state.mode = "full";
    state.reason = undefined;
    wrap.classList.add("glstage-pp-on");
    wrap.classList.remove("glstage-pp-css");
    wrap.style.removeProperty("--glstage-pp-filter");
  }

  /**
   * CSS path: the dials as a filter chain on the <img>. Filters never read the
   * art's pixels, so this works on cross-origin art the shader cannot touch.
   */
  _applyCssFallback(wrap, state, reason) {
    state.reason = reason;
    state.canvas?.remove();
    state.canvas = null;
    const filter = cssFilterFor(this._grade.basic, state.trim, this._intensity);
    if (filter) wrap.style.setProperty("--glstage-pp-filter", filter);
    else wrap.style.removeProperty("--glstage-pp-filter");
    state.mode = "css";
    wrap.classList.add("glstage-pp-on", "glstage-pp-css");
  }

  _clearSlot(wrap, state) {
    state.canvas?.remove();
    state.canvas = null;
    state.mode = "off";
    state.reason = undefined;
    wrap.classList.remove(...WRAP_CLASSES);
    wrap.style?.removeProperty?.("--glstage-pp-filter");
  }

  // ─── Invalidation ───

  /** An actor's art changed — drop the GPU copy of the old asset. */
  invalidateArt(src) {
    if (!src) return;
    this._gl?.invalidate(src);
    this._scheduleRender();
  }

  // ─── Teardown ───

  destroy() {
    this._destroyed = true;
    if (this._tweenRaf) cancelAnimationFrame(this._tweenRaf);
    if (this._renderRaf) cancelAnimationFrame(this._renderRaf);
    this._tweenRaf = 0;
    this._renderRaf = 0;
    for (const [wrap, state] of this._slots) this._clearSlot(wrap, state);
    this._slots.clear();
    this._gl?.destroy();
    this._gl = null;
  }
}
