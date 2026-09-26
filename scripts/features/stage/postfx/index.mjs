/**
 * Stage character grade — orchestration.
 *
 * Owns the slots, the current grade, the scene's darkness and the tween between
 * them, and decides per slot which of two presentations it gets:
 *
 *   full  — the art is graded on the GPU (gl.mjs) and copied into the slot
 *   css   — the art's pixels can't be read (cross-origin without CORS) or there
 *           is no WebGL; the layers are approximated with CSS filters on the
 *           <img> and blended overlays masked to its silhouette
 *   off   — disabled, opted out, or no art; the <img> renders untouched
 *
 * The grade itself is data (grade-model.mjs): the GM sets it, it is stored on
 * the scene, and this file only ever applies it. Nothing here moves a value on
 * its own. Scene darkness is the one live input, and it only ever reaches the
 * picture through the wash layer's own `darkness` dial.
 */

import { clamp01 } from "../../../core/util.mjs";
import { scaledMs } from "../../../core/theme.mjs";
import { assetReason } from "./asset.mjs";
import { StageGL } from "./gl.mjs";
import {
  DEFAULT_GRADE,
  DEFAULT_TRIM,
  normalizeGrade,
  normalizeTrim,
  lerpGrade,
  stackParams,
  linearToHex,
} from "./grade-model.mjs";

/** Matches the `--gl-d-reveal` rung; routed through the motion scale. */
const TWEEN_MS = 620;

/** Every class this file ever puts on a wrap, so teardown can take them all. */
const WRAP_CLASSES = ["glstage-pp-on", "glstage-pp-css"];

/** Custom properties written on the wrap (read by the <img>, its child). */
const WRAP_VARS = ["--glstage-pp-filter"];

/**
 * The CSS gradient angle that puts the lit colour on the lit side, for a light
 * at `deg` (0 right, 90 up). CSS angles run clockwise from "to top", and the
 * first stop sits at the end *opposite* the angle, so the gradient has to point
 * away from the light.
 */
export function cssGradientAngle(deg) {
  return (((-90 - deg) % 360) + 360) % 360;
}

/**
 * The CSS approximation of a whole grade, for art the shader cannot read.
 *
 * Approximate by necessity. CSS filters run per channel in encoded light and
 * have no lift or midtone control, so brightness, gamma and the scene's
 * darkness are carried by `brightness()` alone; the gradient and the wash are
 * overlays masked to the art. Master intensity scales every value toward its
 * neutral rather than crossfading pixels. Neutral values — or intensity 0 —
 * produce no filter and fully transparent overlays.
 *
 * Exported for the check tool.
 */
export function cssFallbackFor(grade, trim, intensity, darkness = 0) {
  const g = normalizeGrade(grade);
  const p = stackParams(g, trim, { darkness });
  const k = clamp01(intensity);
  const toward = (value) => 1 + (value - 1) * k;
  const parts = [];
  // Exposure is a linear gain; brightness() works on encoded values.
  const level = Math.pow(p.gain * p.darkGain, 1 / 2.2) * (1 + p.lift) * Math.pow(0.5, 1 / p.gamma - 1);
  const gain = toward(level);
  if (Math.abs(gain - 1) > 1e-4) parts.push(`brightness(${gain.toFixed(4)})`);
  const contrast = toward(p.contrast);
  if (Math.abs(contrast - 1) > 1e-4) parts.push(`contrast(${contrast.toFixed(4)})`);
  const sat = toward(p.sat);
  if (Math.abs(sat - 1) > 1e-4) parts.push(`saturate(${sat.toFixed(4)})`);
  const deg = ((Math.atan2(p.hueSin, p.hueCos) * 180) / Math.PI) * k;
  if (Math.abs(deg) > 1e-3) parts.push(`hue-rotate(${deg.toFixed(2)}deg)`);

  // The wash as a multiply overlay: the cast, scaled so its brightest channel
  // is 1, so it tints without also darkening.
  const peak = Math.max(...p.washCast, 1e-4);
  const washTint = linearToHex(p.washCast.map((x) => x / peak));

  return {
    filter: parts.join(" "),
    gradient: {
      color: g.gradient.color,
      angle: cssGradientAngle(g.light.angle),
      opacity: p.gradAmount * k,
    },
    wash: { color: washTint, opacity: p.washAmount * k },
    // The back shadow is the same ramp from the other side. The rim and the
    // glow have no honest CSS equivalent — both need the art's pixels — so the
    // fallback leaves them out rather than faking them with an outer shadow.
    shade: { angle: cssGradientAngle(g.light.angle + 180), opacity: p.backAmount * k },
  };
}

export class StagePostFX {
  /**
   * @param {object} [opts]
   * @param {import("./look-library.mjs").LookLibrary} [opts.looks]  Resolves
   *        look ids to LUTs. Without one, every look is drawn at opacity 0.
   */
  constructor({ looks = null } = {}) {
    this._looks = looks;
    this._gl = null;
    this._slots = new Map(); // wrap element → slot state
    this._enabled = true;
    this._intensity = 1;
    this._quality = "auto";
    // What is being drawn right now, and the tween between two of them. The
    // grade and the darkness move on one clock so a scene change that alters
    // both arrives as one movement.
    this._grade = normalizeGrade(DEFAULT_GRADE);
    this._darkness = 0;
    this._from = { grade: this._grade, darkness: 0 };
    this._to = { grade: this._grade, darkness: 0 };
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
    this._retarget({ grade: normalizeGrade(grade), darkness: this._to.darkness }, immediate);
  }

  /** Adopt the scene's darkness, 0..1. Eased like a grade change. */
  setDarkness(darkness, { immediate = false } = {}) {
    this._retarget({ grade: this._to.grade, darkness: clamp01(Number(darkness) || 0) }, immediate);
  }

  _retarget(next, immediate) {
    const duration = immediate ? 0 : scaledMs(TWEEN_MS);
    if (duration <= 0) {
      if (this._tweenRaf) cancelAnimationFrame(this._tweenRaf);
      this._tweenRaf = 0;
      this._grade = next.grade;
      this._darkness = next.darkness;
      this._from = this._to = next;
      this._scheduleRender();
      return;
    }
    this._from = { grade: this._grade, darkness: this._darkness };
    this._to = next;
    this._tweenStart = performance.now();
    if (!this._tweenRaf) this._tweenRaf = requestAnimationFrame(() => this._stepTween(duration));
  }

  _stepTween(duration) {
    this._tweenRaf = 0;
    if (this._destroyed) return;
    const t = clamp01((performance.now() - this._tweenStart) / duration);
    if (t >= 1) {
      this._grade = this._to.grade;
      this._darkness = this._to.darkness;
    } else {
      // Smoothstep — matches the decelerate-to-rest feel of --gl-ease.
      const e = t * t * (3 - 2 * t);
      this._grade = lerpGrade(this._from.grade, this._to.grade, e);
      this._darkness = this._from.darkness + (this._to.darkness - this._from.darkness) * e;
    }
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
      overlay: sameArt ? previous.overlay : null,
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
        state.overlay?.remove();
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
    const { art } = prepared;
    const params = stackParams(this._grade, state.trim, {
      aspect: art.width / Math.max(art.height, 1),
      darkness: this._darkness,
    });
    const canvas = this._gl.draw(prepared, {
      intensity: this._intensity,
      ...params,
      looks: this._resolveLooks(params.lookIds),
    });

    if (!canvas) {
      this._applyCssFallback(wrap, state, assetReason(src) ?? "render");
      return;
    }
    this._blit(wrap, state, canvas);
  }

  /**
   * The LUTs for a look stack, from what is already loaded. Anything not yet
   * loaded is requested and drawn at opacity 0 for now; its arrival schedules
   * another render. So a look never makes the render wait, and a look that
   * fails to load simply is not there.
   */
  _resolveLooks(ids) {
    if (!this._looks || !ids?.length) return [];
    return ids.map((id) => {
      const ready = this._looks.peek(id);
      if (ready) return ready;
      this._looks.get(id).then((loaded) => {
        if (loaded) this._scheduleRender();
      });
      return null;
    });
  }

  /** A look's source changed (a custom file was replaced or removed). */
  invalidateLooks(id = null) {
    this._looks?.invalidate(id);
    this._scheduleRender();
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

    state.overlay?.remove();
    state.overlay = null;
    state.mode = "full";
    state.reason = undefined;
    wrap.classList.add("glstage-pp-on");
    wrap.classList.remove("glstage-pp-css");
    for (const v of WRAP_VARS) wrap.style.removeProperty(v);
  }

  /**
   * CSS path: a filter chain on the <img>, and the directional layers as
   * overlays masked to its silhouette. Neither reads the art's pixels, so this
   * works on cross-origin art the shader cannot touch.
   */
  _applyCssFallback(wrap, state, reason) {
    state.reason = reason;
    state.canvas?.remove();
    state.canvas = null;

    const css = cssFallbackFor(this._grade, state.trim, this._intensity, this._darkness);
    if (css.filter) wrap.style.setProperty("--glstage-pp-filter", css.filter);
    else wrap.style.removeProperty("--glstage-pp-filter");

    let layer = state.overlay;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "glstage-pp-fallback";
      layer.setAttribute("aria-hidden", "true");
      layer.innerHTML =
        '<span class="glstage-pp-wash"></span>' +
        '<span class="glstage-pp-gradient"></span>' +
        '<span class="glstage-pp-shade"></span>';
      wrap.appendChild(layer);
      state.overlay = layer;
    }
    // Feature-prefixed custom properties on the element — never bare --gl-* on
    // :root, which would repaint every feature loaded after Stage.
    const set = (k, v) => layer.style.setProperty(k, v);
    set("--glstage-pp-mask", `url("${state.src.replace(/["\\]/g, "\\$&")}")`);
    set("--glstage-pp-grad-color", css.gradient.color);
    set("--glstage-pp-grad-angle", `${css.gradient.angle}deg`);
    set("--glstage-pp-grad-opacity", css.gradient.opacity.toFixed(4));
    set("--glstage-pp-wash-color", css.wash.color);
    set("--glstage-pp-wash-opacity", css.wash.opacity.toFixed(4));
    set("--glstage-pp-shade-angle", `${css.shade.angle}deg`);
    set("--glstage-pp-shade-opacity", css.shade.opacity.toFixed(4));

    state.mode = "css";
    wrap.classList.add("glstage-pp-on", "glstage-pp-css");
  }

  _clearSlot(wrap, state) {
    state.canvas?.remove();
    state.canvas = null;
    state.overlay?.remove();
    state.overlay = null;
    state.mode = "off";
    state.reason = undefined;
    wrap.classList.remove(...WRAP_CLASSES);
    for (const v of WRAP_VARS) wrap.style?.removeProperty?.(v);
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
