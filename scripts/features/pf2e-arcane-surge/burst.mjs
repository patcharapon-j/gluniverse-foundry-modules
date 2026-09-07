/**
 * GLUniverse Suite — the full-screen beats.
 *
 * Two of them, deliberately opposite motions so they can never read as the same
 * effect played twice:
 *
 *   SURGE throws energy OUTWARD from a vortex — spiral arms, a shock racing
 *   away, filaments whipping off it — with the word struck across the middle.
 *   Scaled by stability level, because severity has not been rolled yet.
 *
 *   VERDICT collapses INWARD in rings that land on the centre, one ring per
 *   tier step, in the tier's own colour.
 *
 * Both run LIVE, at full device resolution, composed supersampled and averaged
 * down. That is a deliberate reversal of this feature's first design, which
 * pre-baked frames: baking buys a flat per-frame cost but freezes the effect
 * into a filmstrip, and a surge that plays the identical 24 frames every time
 * stops landing by the third session.
 *
 * What makes live affordable is not a cheaper shader — it is `warm()`. A GL
 * program is not really compiled when `linkProgram` returns; drivers specialize
 * on first draw, and that first draw was the bulk of the hitch baking was
 * introduced to hide. Paying it once at load, off-screen, is the whole trick.
 * Beyond that the supersampler adapts on measured evidence rather than on
 * assumption, so a capable GPU never loses quality.
 *
 * The word is DOM, not GLSL. Text in a fragment shader is a bitmap-font problem
 * with no upside here, and as an element it gets the suite's display face and
 * its motion tokens for free.
 *
 * Modelled on `stream-pacer/PerilWebGL`: raw WebGL, own canvas on `<body>`, own
 * RAF loop, own resize listener, clean no-op without WebGL. No PIXI — a
 * two-second cosmetic beat has no business being able to disturb the renderer
 * the scene draw depends on.
 */

import { onThemeChange } from "../../core/theme.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { FrameBudget } from "./anim.mjs";
import { SuperSampler, bindFullscreenTriangle, buildProgram, mountCanvas, sizeToViewport, uniformLocations, webglSupported } from "./gl-host.mjs";
import { TIERS } from "./constants.mjs";
import { chaosFor } from "./levels.mjs";
import { rampFloats, tierFloats } from "./palette.mjs";
import {
  BLIT_FRAG,
  BLIT_UNIFORMS,
  BURST_FRAG,
  BURST_SECONDS,
  BURST_UNIFORMS,
  SEVERITY_FRAG,
  SEVERITY_SECONDS,
  SEVERITY_UNIFORMS,
  VERT,
} from "./shader.mjs";

class BeatHost {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.surge = null;
    this.verdict = null;
    this.blit = null;
    this.surgeUniforms = {};
    this.verdictUniforms = {};
    this.blitUniforms = {};
    this.sampler = null;
    this.word = null;
    this.warmed = false;
    this.budget = new FrameBudget();
    this._raf = null;
    this._onResize = () => this._resize();
  }

  _ensureContext() {
    if (this.gl) return true;

    const mounted = mountCanvas("glas-burst");
    if (!mounted) return false;
    this.canvas = mounted.canvas;
    this.gl = mounted.gl;

    this.surge = buildProgram(this.gl, VERT, BURST_FRAG, "surge");
    this.verdict = buildProgram(this.gl, VERT, SEVERITY_FRAG, "verdict");
    this.blit = buildProgram(this.gl, VERT, BLIT_FRAG, "blit");
    if (!this.surge || !this.verdict || !this.blit) {
      this.destroy();
      return false;
    }

    bindFullscreenTriangle(this.gl, this.surge, this.verdict, this.blit);
    this.surgeUniforms = uniformLocations(this.gl, this.surge, BURST_UNIFORMS);
    this.verdictUniforms = uniformLocations(this.gl, this.verdict, SEVERITY_UNIFORMS);
    this.blitUniforms = uniformLocations(this.gl, this.blit, BLIT_UNIFORMS);
    this.sampler = new SuperSampler(this.gl, this.blit, this.blitUniforms);

    this._resize();
    window.addEventListener("resize", this._onResize);
    return true;
  }

  /** The canvas itself is full device resolution; the supersampler decides how
   *  much larger the field is composed before being averaged onto it. */
  _resize() {
    sizeToViewport(this.canvas, this.gl, 1);
    this.sampler?.ensure();
  }

  /**
   * Pay the driver's deferred compile cost once, at load, off-screen.
   *
   * `linkProgram` returning does not mean a program is compiled — drivers
   * specialize on first draw. Without this the first surge of a session pays for
   * three programs mid-animation, at exactly the moment a stutter is most
   * visible. One real draw of each, at the size they will actually run at, makes
   * the first frame cost the same as every later one.
   *
   * The canvas is not visible during this: it carries no `glas-visible` class,
   * so the compositor never shows the warm frames.
   */
  warm() {
    if (this.warmed) return false;
    if (!webglSupported() || !this._ensureContext()) return false;
    this.warmed = true;

    const gl = this.gl;
    const ramp = rampFloats();

    if (this.sampler.bind()) {
      gl.useProgram(this.surge);
      gl.uniform1f(this.surgeUniforms.uTime, 0);
      gl.uniform1f(this.surgeUniforms.uProgress, 0);
      gl.uniform2f(this.surgeUniforms.uRes, this.sampler.size[0], this.sampler.size[1]);
      gl.uniform1f(this.surgeUniforms.uSeed, 0);
      gl.uniform1f(this.surgeUniforms.uChaos, 1);
      gl.uniform3fv(this.surgeUniforms.uDeep, ramp.deep);
      gl.uniform3fv(this.surgeUniforms.uMid, ramp.mid);
      gl.uniform3fv(this.surgeUniforms.uHot, ramp.hot);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.sampler.blit(this.canvas, 0);
    }

    if (this.sampler.bind()) {
      gl.useProgram(this.verdict);
      gl.uniform1f(this.verdictUniforms.uTime, 0);
      gl.uniform1f(this.verdictUniforms.uProgress, 0);
      gl.uniform2f(this.verdictUniforms.uRes, this.sampler.size[0], this.sampler.size[1]);
      gl.uniform1f(this.verdictUniforms.uTier, TIERS.length - 1);
      gl.uniform3fv(this.verdictUniforms.uDeep, ramp.deep);
      gl.uniform3fv(this.verdictUniforms.uMid, ramp.mid);
      gl.uniform3fv(this.verdictUniforms.uHot, ramp.hot);
      gl.uniform3fv(this.verdictUniforms.uVerdict, tierFloats(TIERS[TIERS.length - 1]));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.sampler.blit(this.canvas, 0);
    }

    // Force execution rather than leaving the work queued behind the first
    // real frame, which would defeat the point.
    gl.finish();
    return true;
  }

  /* ── The word ────────────────────────────────────────────────────── */

  /**
   * Struck across the middle, in the suite's display face.
   *
   * Mounted per playback and removed with the beat, so nothing of it survives
   * into a session where the feature is disabled.
   */
  _strike(text, tier = null) {
    this.word?.remove();
    const el = document.createElement("div");
    el.className = `glas-word gl-type${tier ? ` glas-tier-${tier}` : ""}`;
    el.innerHTML = `<span class="glas-word-text">${escapeHTML(text)}</span>`;
    document.body.appendChild(el);
    this.word = el;
    // Force a reflow so the entrance animation runs from its start state even
    // when a second beat lands immediately after the first.
    void el.offsetWidth;
    el.classList.add("glas-word-in");
  }

  _clearWord() {
    this.word?.remove();
    this.word = null;
  }

  /* ── Playback ────────────────────────────────────────────────────── */

  _run(program, uniforms, seconds, write) {
    this._stopLoop();
    this._resize();
    this.canvas.classList.add("glas-visible");

    const gl = this.gl;
    const start = performance.now();
    let last = start;

    const step = () => {
      const now = performance.now();
      const frameMs = now - last;
      this.budget.sample(frameMs);
      this.sampler.sample(frameMs);
      last = now;

      const elapsed = (now - start) / 1000;
      const progress = Math.min(1, elapsed / seconds);

      // Compose supersampled, then average down onto the canvas. Both fields are
      // thin high-contrast detail, which crawls badly when rendered direct.
      if (this.sampler.bind()) {
        gl.useProgram(program);
        gl.uniform1f(uniforms.uTime, elapsed);
        gl.uniform1f(uniforms.uProgress, progress);
        gl.uniform2f(uniforms.uRes, this.sampler.size[0], this.sampler.size[1]);
        write(uniforms);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.sampler.blit(this.canvas, 1);
      }

      if (progress >= 1) {
        this.canvas.classList.remove("glas-visible");
        this._clearWord();
        this._raf = null;
        return;
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  playSurge(level, { label = null } = {}) {
    if (!webglSupported() || !this._ensureContext()) return;
    const gl = this.gl;
    const ramp = rampFloats();
    const chaos = chaosFor(level);
    const seed = seedFor(level);

    this._strike(label ?? game.i18n.localize("GLAS.burst.word"));
    this._run(this.surge, this.surgeUniforms, BURST_SECONDS, (u) => {
      gl.uniform1f(u.uSeed, seed);
      gl.uniform1f(u.uChaos, chaos);
      gl.uniform3fv(u.uDeep, ramp.deep);
      gl.uniform3fv(u.uMid, ramp.mid);
      gl.uniform3fv(u.uHot, ramp.hot);
    });
  }

  playVerdict(tier) {
    if (!webglSupported() || !this._ensureContext()) return;
    const index = TIERS.indexOf(tier);
    if (index < 0) return;

    const gl = this.gl;
    const ramp = rampFloats();
    const verdictColour = tierFloats(tier);

    this._strike(game.i18n.localize(`GLAS.tier.${tier}`), tier);
    this._run(this.verdict, this.verdictUniforms, SEVERITY_SECONDS, (u) => {
      gl.uniform1f(u.uTier, index);
      gl.uniform3fv(u.uDeep, ramp.deep);
      gl.uniform3fv(u.uMid, ramp.mid);
      gl.uniform3fv(u.uHot, ramp.hot);
      gl.uniform3fv(u.uVerdict, verdictColour);
    });
  }

  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  /** Nothing is cached across a retheme any more — both passes read the ramp
   *  fresh every frame — so this only has to drop a beat already in flight. */
  retheme() {}

  destroy() {
    this._stopLoop();
    this._clearWord();
    window.removeEventListener("resize", this._onResize);
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.sampler?.destroy();
    this.sampler = null;
    this.gl = null;
    this.surge = null;
    this.verdict = null;
    this.blit = null;
    this.warmed = false;
  }
}

/** A level's vortex is stable across a session rather than random per surge, so
 *  the same danger looks like itself twice. */
function seedFor(level) {
  let hash = 0;
  for (let i = 0; i < level.length; i++) hash = (hash * 31 + level.charCodeAt(i)) % 9973;
  return hash / 9973;
}

let host = null;
let untheme = null;

function ensureHost() {
  host ??= new BeatHost();
  untheme ??= onThemeChange(() => host?.retheme());
  return host;
}

/** The surge itself, scaled by the world's state. */
export function playBurst(level) {
  ensureHost().playSurge(level);
}

/**
 * The verdict, when the severity card resolves.
 *
 * First thing shed when the frame budget is under pressure: the tier is already
 * legible on the card, and a struggling machine should spend its frames on the
 * game rather than on a second cinematic in four seconds.
 */
export function playFlourish(tier) {
  const current = ensureHost();
  if (!current.budget.allows("flourish")) return;
  current.playVerdict(tier);
}

export function warmBurst() {
  ensureHost().warm();
}

export function destroyBurst() {
  untheme?.();
  untheme = null;
  host?.destroy();
  host = null;
}
