/**
 * WeatherEffect — the live weather (and delving atmosphere) inside a host
 * element: the HUD bar's left edge, its delving edge, the weather window's hero
 * and the editors' previews.
 *
 * What it draws is decided by the pure model (`fx/looks.mjs`) and drawn by
 * procedural WebGL2 programs (`fx/shaders.mjs`) on ONE context shared by every
 * surface (`fx/renderer.mjs`), each frame copied onto the host's own 2D canvas.
 * This file is only the host: sizing, the shared frame loop, the frame budget,
 * the surface lifecycle and the storm's lightning, which is the one transient
 * that lives in JS.
 *
 * The rules it keeps:
 *   • One frame clock. Shedding is `Budget.ladder("clocks-weather", SHED_ORDER)`
 *     — the full rate goes first, then the far layer, the haze, resolution, and
 *     last the motion itself (the field holds its last frame).
 *   • Every host is a registered surface: paused off screen, and its claim on
 *     the shared context released when idle (the context is freed once no
 *     surface holds one). The host's 2D canvas keeps its picture through a
 *     release, so nothing blanks.
 *   • Whole-turn loops. Time reaches the shaders as a phase of LOOP_SECONDS;
 *     every rate there is floored to a whole number of turns.
 *   • Ambient: while the policy says ambient motion holds still, the phase
 *     stops and the field keeps its frame.
 *
 * The canvas covers only the part of the host its CSS mask leaves visible (read
 * from the host's computed `mask-image`); the field is laid out over the whole
 * host, so only invisible pixels go undrawn.
 *
 * If WebGL2 is unavailable, create() returns null and the host keeps its
 * CSS-only tinted look.
 */

import { clamp } from "../../../core/util.mjs";
import { Budget } from "../../../core/budget.mjs";
import { Surfaces } from "../../../core/gl-surfaces.mjs";
import { FxRenderer, NO_BOLT } from "./fx/renderer.mjs";
import {
  BOLT, DPR, FPS, LOOP_SECONDS, SHED_ORDER, hasBolts, makeBolt, resolveLook
} from "./fx/looks.mjs";

export { SHED_ORDER } from "./fx/looks.mjs";

const LADDER_ID = "clocks-weather";

/** Accept a frame a little early so the cadence locks to whole display frames. */
const FRAME_SLACK = 0.85;

/* ------------------------------ visible span ------------------------------ */

/** Split a CSS argument list on top-level commas. */
function splitArgs(s) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  out.push(s.slice(start).trim());
  return out;
}

/** Alpha of a computed CSS colour ("rgba(0, 0, 0, 0)", "rgb(0 0 0 / 0)", "transparent"). */
function colorAlpha(c) {
  if (/^transparent$/i.test(c)) return 0;
  const m = /^rgba?\(([^)]*)\)$/i.exec(c);
  if (!m) return 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 4) return 1;
  const a = parts[3];
  return a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
}

/**
 * The horizontal slice [f0, f1] (fractions of the host width) that the host's
 * own CSS mask leaves visible. Only a horizontal linear-gradient mask that ends
 * transparent is understood; anything else returns the full width.
 */
export function visibleSpan(el) {
  let cs;
  try { cs = getComputedStyle(el); } catch { return [0, 1]; }
  const img = [cs.maskImage, cs.webkitMaskImage].find(v => v && v !== "none") ?? "";
  const m = /^linear-gradient\((.*)\)$/s.exec(img.trim());
  if (!m) return [0, 1];
  const args = splitArgs(m[1]);
  let dir = 180;
  if (/^-?[\d.]+deg$/.test(args[0])) dir = parseFloat(args.shift());
  else if (/^to\s/.test(args[0])) dir = { "to right": 90, "to left": 270, "to top": 0, "to bottom": 180 }[args.shift().replace(/\s+/g, " ")] ?? NaN;
  dir = ((dir % 360) + 360) % 360;
  if (dir !== 90 && dir !== 270) return [0, 1];
  const w = el.clientWidth || 1;
  const stops = args.map(s => {
    const pm = /(-?[\d.]+)(%|px)$/.exec(s);
    const color = pm ? s.slice(0, pm.index).trim().replace(/\s+-?[\d.]+(%|px)$/, "") : s;
    const pos = pm ? (pm[2] === "%" ? parseFloat(pm[1]) / 100 : parseFloat(pm[1]) / w) : null;
    return { a: colorAlpha(color), pos };
  });
  let last = -1;
  for (let i = 0; i < stops.length; i++) if (stops[i].a > 0) last = i;
  if (last < 0) return [0, 1];
  const edge = stops[last + 1]?.pos;
  if (last === stops.length - 1 || edge == null) return [0, 1];
  const reach = clamp(edge, 0, 1);
  return dir === 90 ? [0, reach] : [1 - reach, 1];
}

/* ------------------------------ shared state ------------------------------ */

const shared = { renderer: null, claims: 0, ladder: null, supported: null };

function ladder() {
  if (!shared.ladder) {
    shared.ladder = Budget.ladder(LADDER_ID, SHED_ORDER);
    // A shed or recovered `resolution` changes every host's backing store.
    Budget.onChange(() => { for (const fx of ALL) if (fx._fit()) fx._draw(); });
  }
  return shared.ladder;
}

function renderer() {
  shared.renderer ??= new FxRenderer();
  return shared.renderer;
}

function supported() {
  shared.supported ??= FxRenderer.supported();
  return shared.supported;
}

const LIVE = new Set();
const ALL = new Set();          // every effect not yet destroyed
let rafId = 0;
let lastTick = -Infinity;
let lastNow = null;
let clockT = 0;            // seconds of weather time; held while motion may not run
let seedN = 0;
let held = false;          // preview seam: the clock is pinned by seek()

const allows = (name) => ladder().allows(name);
const motionOn = () => Budget.ambientAllowed && allows("motion");
const phase = () => (clockT % LOOP_SECONDS) / LOOP_SECONDS;

function kick() {
  if (rafId || !LIVE.size || typeof requestAnimationFrame !== "function") return;
  rafId = requestAnimationFrame(loop);
}

/** One frame of every live effect. `Budget.measure` RETURNS a timed wrapper;
 *  it does not run anything, so this is built once and called each frame. */
const stepAll = Budget.measure(LADDER_ID, (dt, moving) => { for (const fx of LIVE) fx._frame(dt, moving); });

function loop(now) {
  rafId = 0;
  if (!LIVE.size) { lastNow = null; return; }
  const frameMs = 1000 / (allows("fullRate") ? FPS.full : FPS.shed);
  if (now - lastTick >= frameMs * FRAME_SLACK) {
    lastTick = now;
    // A gap (hidden tab, paused host) is not motion: never jump the field.
    const dt = lastNow == null ? 0 : Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    const moving = motionOn() && !held;
    if (moving) clockT = (clockT + dt) % (LOOP_SECONDS * 1024);
    stepAll(moving ? dt : 0, moving);
  }
  rafId = requestAnimationFrame(loop);
}

/* ------------------------------ the host ------------------------------ */

export class WeatherEffect {
  /** Preview seam: hold the shared clock at `t` seconds and redraw everything. */
  static seek(t) {
    held = true;
    clockT = Math.max(0, Number(t) || 0);
    for (const fx of ALL) fx._draw();
  }

  /** Build an effect for `host`, or null when WebGL2 is unavailable. */
  static create(host, spec) {
    if (!host || !supported()) return null;
    try { return new WeatherEffect(host, spec); }
    catch (err) { console.warn("gluniverse-foundry-modules | clocks-tracker | Weather effect init failed", err); return null; }
  }

  constructor(host, spec) {
    this.host = host;
    this.spec = null;
    this.model = null;
    this._wanted = false;       // owner's resume()/pause()
    this._paused = false;       // the surface registry's pause (off screen / hidden)
    this._claim = false;        // holding a claim on the shared context
    this._seed = (++seedN * 17.31) % 97;
    this._flash = 0;
    this._boltA = 0;
    this._bolt = NO_BOLT;
    this._strikes = 0;
    this._quiet = BOLT.minGap;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.canvas = canvas; this.ctx = ctx;
    canvas.classList.add("glct-wx-canvas");
    // left/width follow the visible span (_fit); right:auto beats the
    // stylesheets' inset:0 so the canvas can cover only part of the host.
    Object.assign(canvas.style, { position: "absolute", top: "0", bottom: "auto", right: "auto", height: "100%" });
    host.appendChild(canvas);

    this.surface = Surfaces.register({
      id: `${LADDER_ID}:${seedN}`,
      element: () => this.host,
      pause: () => { this._paused = true; this._syncLive(); },
      resume: () => { this._paused = false; this._syncLive(); this._draw(); },
      release: () => this._unclaim(),
      restore: () => this._reclaim()
    });

    if (typeof ResizeObserver === "function") {
      this._ro = new ResizeObserver(() => { if (this._fit()) this._draw(); });
      this._ro.observe(host);
    }
    ALL.add(this);
    this._fit();
    this.setSpec(spec);
  }

  /* ------------------------------ geometry ------------------------------ */

  /** Size the canvas to the host's visible span at the current density.
      Returns true if the backing store changed (which clears it). */
  _fit() {
    if (!this.canvas) return false;
    this._w = Math.max(8, this.host.clientWidth || 54);
    this._h = Math.max(8, this.host.clientHeight || 30);
    const [f0, f1] = visibleSpan(this.host);
    const cap = allows("resolution") ? DPR.max : DPR.shed;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, cap);
    this._x0 = f0 * this._w;
    const vw = Math.max(1, (f1 - f0) * this._w);
    const cw = Math.max(1, Math.round(vw * dpr));
    const ch = Math.max(1, Math.round(this._h * dpr));
    this._px = ch / this._h;
    const left = `${(f0 * 100).toFixed(3)}%`, width = `${((f1 - f0) * 100).toFixed(3)}%`;
    if (this.canvas.style.left !== left) this.canvas.style.left = left;
    if (this.canvas.style.width !== width) this.canvas.style.width = width;
    if (this.canvas.width === cw && this.canvas.height === ch) return false;
    this.canvas.width = cw; this.canvas.height = ch;
    return true;
  }

  /* ------------------------------ spec ------------------------------ */

  setSpec(spec) {
    const s = spec ?? { archetype: "clear", intensity: 0.3, tintParticle: "#cfe8ff", tintGlow: "#7fb4e6", drift: "still" };
    this.spec = { ...s };
    this.model = resolveLook(this.spec);
    if (!hasBolts(this.model.look)) { this._flash = 0; this._boltA = 0; this._strikes = 0; this._bolt = NO_BOLT; }
    this._draw();
  }

  /* ------------------------------ frame ------------------------------ */

  _frame(dt, moving) {
    // A held field is the frame already on screen (setSpec, resize and every
    // budget change redraw it themselves), so a still tick draws nothing.
    if (!moving) return;
    if (hasBolts(this.model?.look)) this._tickStorm(dt);
    this._draw();
  }

  /** Lightning: a quiet gap, a strike (sometimes a double), a decaying flash. */
  _tickStorm(dt) {
    const I = this.model.I;
    this._flash = Math.max(0, this._flash - dt * BOLT.flashDecay);
    this._boltA = Math.max(0, this._boltA - dt * BOLT.boltDecay);
    if (this._strikes > 0) {
      if (this._boltA <= 0.02) {
        this._strikes--;
        if (this._strikes > 0) this._strike(0.35 + 0.25 * Math.random());
      }
      return;
    }
    this._quiet -= dt;
    if (this._quiet <= 0 && Math.random() < dt * (BOLT.rate + I * BOLT.rateI)) {
      this._strikes = Math.random() < 0.45 ? 2 : 1;
      this._strike(0.6 + 0.35 * Math.random());
      this._quiet = BOLT.minGap;
    }
  }

  _strike(flash) {
    const pts = makeBolt(this._w, this._h);
    const out = new Float32Array(BOLT.points * 2);
    pts.forEach(([x, y], i) => { out[i * 2] = x; out[i * 2 + 1] = y; });
    this._bolt = out;
    this._boltA = 1;
    this._flash = Math.max(this._flash, flash);
  }

  _uniforms() {
    const m = this.model;
    return {
      uHost: [this._w, this._h],
      uSpan0: this._x0,
      uPx: this._px,
      uPhase: phase(),
      uI: m.I,
      uTint: m.tint,
      uGlow: m.glow,
      uDir: m.dir,
      uSeed: this._seed,
      uShed: [allows("depth") ? 1 : 0, allows("haze") ? 1 : 0, 1, 0],
      uP: m.p,
      uFlash: this._flash,
      uBolt: this._bolt,
      uBoltA: this._boltA
    };
  }

  /** Draw the current frame onto the host canvas. */
  _draw() {
    if (!this.canvas || !this.model || this._paused) return;
    if (!this.surface.use()) return;
    if (!this._claim) this._reclaim();
    const r = renderer();
    const cw = this.canvas.width, ch = this.canvas.height;
    const src = r.draw(this.model.look, this._uniforms(), cw, ch);
    this.ctx.clearRect(0, 0, cw, ch);
    if (src) this.ctx.drawImage(src.canvas, src.sx, src.sy, src.w, src.h, 0, 0, cw, ch);
  }

  /* ------------------------------ lifecycle ------------------------------ */

  _reclaim() {
    if (this._claim) return;
    this._claim = true;
    shared.claims++;
  }

  _unclaim() {
    if (!this._claim) return;
    this._claim = false;
    shared.claims = Math.max(0, shared.claims - 1);
    if (shared.claims === 0) shared.renderer?.release();
  }

  _syncLive() {
    if (this._wanted && !this._paused && this.canvas) { LIVE.add(this); kick(); }
    else LIVE.delete(this);
  }

  pause() { this._wanted = false; this._syncLive(); }

  resume() { this._wanted = true; this._syncLive(); }

  resize() {
    try { this._fit(); this._draw(); } catch { /* ignore */ }
  }

  destroy() {
    LIVE.delete(this);
    ALL.delete(this);
    try { this._ro?.disconnect(); } catch { /* ignore */ }
    this.surface?.dispose();
    this._unclaim();
    this.canvas?.remove();
    this.canvas = null; this.ctx = null; this._ro = null; this.surface = null;
  }
}

/** Neutral alias: the delving HUD renders its atmospheres through it too. */
export { WeatherEffect as EffectField };
