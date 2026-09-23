/**
 * WeatherEffect — a self-contained Canvas2D mini-diorama for the weather display
 * (decision #7). It owns one 2D canvas inside a host element and never touches
 * the scene canvas. Particles are tinted sprites drawn from procedural textures
 * (no asset files), so any weather is just an archetype + two tints (decision
 * #8): acid rain = streaks + green, crimson lightning = flashes + crimson, etc.
 *
 * Fidelity: particles carry a depth `z` that drives parallax (near particles are
 * larger, faster and brighter than far ones), streaks use a head→tail gradient
 * texture, and particle counts scale with canvas area so the same effect reads
 * well in a tiny chip OR across the full HUD bar.
 *
 * Why not Pixi: every effect used to be its own PIXI.Application — its own WebGL
 * context, its own uncapped ticker (120/144 Hz on a fast monitor) and a canvas
 * the size of the whole HUD bar, of which the CSS mask shows under half. The
 * effects are nothing but alpha/tint/rotation/scale sprites with NORMAL or ADD
 * blending plus one stroked bolt, which Canvas2D draws identically
 * (`globalAlpha`, `setTransform`, `"lighter"` for ADD, a pre-tinted copy of the
 * white texture for `tint`). So now:
 *   - no WebGL context at all (the browser caps those, and Foundry needs its own);
 *   - ONE shared requestAnimationFrame loop for every live effect, capped at
 *     FPS — the motion is integrated with real dt, and the one frame-coupled
 *     term (motes' random walk + damping) is normalised to its 60 Hz look;
 *   - the canvas covers only the part of the host its CSS mask leaves visible
 *     (read from the host's computed `mask-image`); the simulation still runs
 *     over the whole host, so density, wrap-around and bolt placement are
 *     unchanged — only invisible pixels are no longer drawn;
 *   - backing store at devicePixelRatio capped to MAX_DPR;
 *   - sampling matches what the GPU did: power-of-two textures are drawn from a
 *     trilinear-style mip chain chosen per sprite exactly as WebGL picks its LOD
 *     (that softness is part of the gusts/rain look), the rest bilinear only.
 *
 * Lifecycle (decision D4): an effect only draws while its owner wants it running
 * (resume/pause), the tab is visible and the host is on screen and displayed
 * (IntersectionObserver). destroy() releases everything.
 *
 * If a 2D context is unavailable, create() returns null and the host falls back
 * to its CSS-only tinted look.
 */

import { clamp, randRange as rand } from "../../../core/util.mjs";

const ADDITIVE = new Set(["motes", "embers", "spores", "runes", "void"]);

/**
 * Motion map: every archetype resolves to ONE of the nine implemented motion
 * behaviours. The original nine map to themselves; the expanded batch reuses a
 * base motion and distinguishes itself by texture / blend / tint / tuning. This
 * is what makes the library "virtually unlimited looks" without bespoke physics
 * per effect — a new archetype is just an entry here plus a TUNING row.
 */
const MOTION = {
  clear: "clear", streaks: "streaks", flakes: "flakes", volume: "volume",
  flashes: "flashes", motes: "motes", embers: "embers", gusts: "gusts", shards: "shards",
  // ---- expanded batch ----
  shadow: "volume",    // dark soft masses creeping / pulsing at the edges
  creep: "embers",     // spreading rot rising from below
  spores: "motes",     // glowing spores hanging in the air
  miasma: "volume",    // heavy sickly low haze
  static: "motes",     // signal loss — fast flickering speckle
  swarm: "motes",      // erratic drifting swarm
  drips: "streaks",    // slow oozing drips
  bubbles: "embers",   // rising depth bubbles
  runes: "motes",      // glowing glyph-motes pulsing in place
  void: "motes",       // distant twinkling void / stars
  dust: "flakes",      // fine grains drifting sideways
  ripples: "gusts"     // rising water lines
};

/** Per-archetype tuning: base count @intensity 1 & unit area, hard cap, texture. */
const TUNING = {
  clear:   { max: 14, cap: 60,  tex: "dot"    },
  streaks: { max: 80, cap: 420, tex: "streak" },
  flakes:  { max: 60, cap: 340, tex: "flake"  },
  volume:  { max: 8,  cap: 46,  tex: "blob"   },
  flashes: { max: 70, cap: 380, tex: "streak" },   // storm = rain + strobe overlay
  motes:   { max: 50, cap: 280, tex: "glow"   },
  embers:  { max: 46, cap: 260, tex: "glow"   },
  gusts:   { max: 60, cap: 300, tex: "streak" },
  shards:  { max: 50, cap: 300, tex: "shard"  },
  // ---- expanded batch ----
  shadow:  { max: 7,  cap: 40,  tex: "blob"   },
  creep:   { max: 40, cap: 220, tex: "glow"   },
  spores:  { max: 46, cap: 260, tex: "glow"   },
  miasma:  { max: 8,  cap: 46,  tex: "blob"   },
  static:  { max: 70, cap: 380, tex: "dot"    },
  swarm:   { max: 60, cap: 320, tex: "dot"    },
  drips:   { max: 50, cap: 260, tex: "streak" },
  bubbles: { max: 44, cap: 240, tex: "glow"   },
  runes:   { max: 40, cap: 220, tex: "glow"   },
  void:    { max: 60, cap: 320, tex: "glow"   },
  dust:    { max: 60, cap: 340, tex: "flake"  },
  ripples: { max: 46, cap: 240, tex: "streak" }
};

/** Archetypes whose particles mix in the secondary glow tint on a fraction of sprites. */
const GLOW_MIX = new Set(["embers", "motes", "spores", "runes", "void", "creep"]);

const REF_AREA = 1700;          // ~ the original 54×30 chip; counts scale off this

/** Frame cap for the shared loop. Every archetype integrates with real dt, and
    the streak/flake/glow textures already read as motion-blurred, so 30 fps is
    indistinguishable from 60 on a ~50px strip while halving the draw cost. */
const FPS = 30;
const FRAME_MS = 1000 / FPS;
/** Accept a frame a little early so the cadence locks to whole display frames
    (60 Hz → every 2nd, 120 Hz → every 4th, 144 Hz → every 5th) instead of
    alternating between two intervals, which reads as judder. */
const FRAME_SLACK = 0.85;
const MAX_DPR = 1.5;
/** The motes random walk was tuned per 60 Hz frame; see _advance. */
const REF_HZ = 60;

const hexInt = (s, fallback = 0xffffff) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s ?? ""));
  return m ? parseInt(m[1], 16) : fallback;
};
const cssHex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);

/* ------------------------------ shared textures ------------------------------ */

/** The base textures are pure white with an alpha shape, identical for every
    effect, so they are built once per page and shared. */
let TEXTURES = null;

function canvasTex(w, h, draw) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d"), w, h);
  return cv;
}

function buildTextures() {
  if (TEXTURES) return TEXTURES;
  // a soft radial blob with a configurable alpha falloff. Textures are
  // super-sampled (drawn larger than they'll ever display) and down-sampled at
  // draw time — crisp, clean anti-aliasing at every particle size.
  const soft = (s, stops) => canvasTex(s, s, (ctx) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
  const dot  = soft(96,  [[0, 1], [0.30, 0.96], [0.58, 0.46], [1, 0]]);         // general round particle
  const glow = soft(128, [[0, 0.95], [0.22, 0.62], [0.55, 0.18], [1, 0]]);      // motes / embers halo
  const blob = soft(192, [[0, 0.46], [0.4, 0.2], [0.72, 0.06], [1, 0]]);        // fog volume

  // snow: a soft six-spoke ice crystal — faint radial spokes over a soft core,
  // so flakes read as crystalline without hard edges (also reads fine, tinted,
  // for drifting ash). Super-sampled for clean spokes at small sizes.
  const flake = canvasTex(96, 96, (ctx, w, h) => {
    const c = w / 2;
    const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.62);
    core.addColorStop(0, "rgba(255,255,255,0.98)");
    core.addColorStop(0.4, "rgba(255,255,255,0.5)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.34)";
    ctx.lineWidth = w * 0.045; ctx.lineCap = "round";
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k, ex = Math.cos(a) * c * 0.82, ey = Math.sin(a) * c * 0.82;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + ex, c + ey); ctx.stroke();
      // small side-barbs for a hint of crystal structure
      const bx = c + ex * 0.6, by = c + ey * 0.6, bl = c * 0.2;
      for (const s2 of [-1, 1]) {
        const ba = a + s2 * (Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl); ctx.stroke();
      }
    }
  });

  // rain: a smooth vertical motion-blur streak, bright head (bottom) → clear
  // tail, with a soft feathered edge. Super-sampled and narrow for a crisp,
  // glassy filament rather than a fat bar.
  const streak = canvasTex(16, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,0.7)");
    g.addColorStop(0.55, "rgba(255,255,255,0.28)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    const cw = w * 0.34;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(w / 2 - cw / 2, 3, cw, h - 6, cw / 2);
    else ctx.rect(w / 2 - cw / 2, 3, cw, h - 6);
    ctx.fill();
  });

  // hail / sleet: a small, crisp ice crystal — a faceted diamond with a lit
  // upper-left face, a darker lower body and a bright rim, wrapped in a faint
  // icy halo so it stays legible even when tiny. Super-sampled for clean edges.
  const shard = canvasTex(64, 80, (ctx, w, h) => {
    const cx = w / 2, top = h * 0.14, bot = h * 0.86, midY = h * 0.5, lx = w * 0.24, rx = w * 0.76;
    // faint halo (lets a small crystal still catch the eye as a bright glint)
    const halo = ctx.createRadialGradient(cx, midY, 0, cx, midY, w * 0.5);
    halo.addColorStop(0, "rgba(255,255,255,0.42)");
    halo.addColorStop(0.5, "rgba(255,255,255,0.1)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
    // crystal body, diagonally graded (bright top-left → dim bottom-right)
    const body = ctx.createLinearGradient(lx, top, rx, bot);
    body.addColorStop(0, "rgba(255,255,255,1)");
    body.addColorStop(0.5, "rgba(255,255,255,0.84)");
    body.addColorStop(1, "rgba(255,255,255,0.58)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(cx, top); ctx.lineTo(rx, midY); ctx.lineTo(cx, bot); ctx.lineTo(lx, midY); ctx.closePath();
    ctx.fill();
    // lit upper-left facet
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.moveTo(cx, top); ctx.lineTo(lx, midY); ctx.lineTo(cx, midY); ctx.closePath();
    ctx.fill();
    // bright rim for crisp definition
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = w * 0.045;
    ctx.beginPath();
    ctx.moveTo(cx, top); ctx.lineTo(rx, midY); ctx.lineTo(cx, bot); ctx.lineTo(lx, midY); ctx.closePath();
    ctx.stroke();
  });

  // storm bloom: a vertical wash, bright at the top fading down (sky lighting)
  const flash = canvasTex(32, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,0.38)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });

  TEXTURES = { dot, glow, blob, flake, streak, shard, flash };
  return TEXTURES;
}

/* ------------------------------ sampling ------------------------------ */

/** Pixi uploaded power-of-two textures with trilinear mipmaps and everything
    else bilinear only, and for the streak textures that is visible: a gust is a
    16×128 streak squashed 3–6× along its length, so the GPU samples a level
    where the filament is already smeared across its width. Canvas2D picks its
    own (sharper) level, so we choose it the GPU's way instead: build the chain,
    and the half-steps between levels (a 50/50 blend of level d and d+1, i.e.
    trilinear at its midpoint), then draw the nearest one with plain bilinear. */
const MIPS = new WeakMap();
const isPot = (n) => n > 0 && (n & (n - 1)) === 0;

function mipLevels(tex) {
  let out = MIPS.get(tex);
  if (out) return out;
  if (!isPot(tex.width) || !isPot(tex.height)) { MIPS.set(tex, out = [tex]); return out; }
  const levels = [tex];
  for (let cur = tex; cur.width > 1 || cur.height > 1;) {
    const w = Math.max(1, cur.width >> 1), h = Math.max(1, cur.height >> 1), src = cur;
    cur = canvasTex(w, h, (ctx) => { ctx.imageSmoothingQuality = "low"; ctx.drawImage(src, 0, 0, w, h); });  // exact 2×2 box
    levels.push(cur);
  }
  out = [];
  for (let d = 0; d < levels.length; d++) {
    out.push(levels[d]);
    const lo = levels[d], hi = levels[d + 1];
    if (!hi) break;
    out.push(canvasTex(lo.width, lo.height, (ctx, w, h) => {
      ctx.imageSmoothingQuality = "low";
      ctx.globalCompositeOperation = "lighter";          // premultiplied sum → a true linear mix
      ctx.globalAlpha = 0.5;
      ctx.drawImage(lo, 0, 0);
      ctx.drawImage(hi, 0, 0, w, h);
    }));
  }
  MIPS.set(tex, out);
  return out;
}

/** WebGL's LOD for a texture drawn through the 2×2 matrix [a c; b d] (texels →
    device px): log2 of the longer texel footprint of one screen pixel. Returns
    the index into mipLevels() (half-level steps). */
function lodIndex(a, b, c, d, n) {
  const det = Math.abs(a * d - b * c);
  if (!(det > 0)) return 0;
  const rho = Math.max(Math.hypot(d, b), Math.hypot(c, a)) / det;
  if (!(rho > 1)) return 0;                              // magnified: level 0
  return Math.min(n - 1, Math.round(Math.log2(rho) * 2));
}

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
 * transparent is understood — anything else (no mask, radial, vertical, an
 * image) returns the full width, which is always safe.
 */
function visibleSpan(el) {
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
  if (last < 0) return [0, 1];                       // fully transparent: nothing to save, stay safe
  const edge = stops[last + 1]?.pos;
  if (last === stops.length - 1 || edge == null) return [0, 1];
  const reach = clamp(edge, 0, 1);
  return dir === 90 ? [0, reach] : [1 - reach, 1];
}

/* ------------------------------ shared loop ------------------------------ */

const LIVE = new Set();        // effects that should be drawing right now
let rafId = 0;
let lastTick = -Infinity;
let visWired = false;
let io = null;

function kick() {
  if (rafId || !LIVE.size || document.hidden) return;
  rafId = requestAnimationFrame(loop);
}

function loop(now) {
  rafId = 0;
  if (!LIVE.size || document.hidden) return;
  if (now - lastTick >= FRAME_MS * FRAME_SLACK) {
    lastTick = now;
    for (const fx of LIVE) fx._frame(now);
  }
  rafId = requestAnimationFrame(loop);
}

function wireVisibility() {
  if (visWired) return;
  visWired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
    else { for (const fx of LIVE) fx._last = null; kick(); }
  });
}

function observer() {
  if (io || typeof IntersectionObserver !== "function") return io;
  io = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.__glctFx?._setInView(e.isIntersecting);
  });
  return io;
}

/** A plain sprite record: the same fields the motion code used on PIXI.Sprite. */
class Sprite {
  constructor(tex) {
    this.tex = tex; this.x = 0; this.y = 0; this.rotation = 0; this.alpha = 1; this.tint = 0xffffff;
    this.scale = { x: 1, y: 1, set(x, y = x) { this.x = x; this.y = y; } };
  }
}

export class WeatherEffect {
  /** Build an effect for `host`, or null if a 2D canvas is unavailable. */
  static create(host, spec) {
    if (!host) return null;
    try { return new WeatherEffect(host, spec); }
    catch (err) { console.warn("gluniverse-foundry-modules | clocks-tracker | Weather effect init failed", err); return null; }
  }

  constructor(host, spec) {
    this.host = host;
    this.spec = null;
    this.particles = [];
    this._flashT = 0;
    this._strike = 0;
    this._wanted = false;       // owner's resume()/pause()
    this._inView = true;        // corrected by the IntersectionObserver
    this._last = null;          // timestamp of this effect's previous frame
    this._tintCache = new Map();

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.canvas = canvas; this.ctx = ctx;
    canvas.classList.add("glct-wx-canvas");
    // left/width are set per visible span in _fit(); right:auto beats the
    // stylesheets' inset:0 so the canvas can cover only part of the host.
    Object.assign(canvas.style, { position: "absolute", top: "0", bottom: "auto", right: "auto", height: "100%" });
    host.appendChild(canvas);

    this.tex = buildTextures();
    this.flash = { alpha: 0, visible: false };
    // Lightning bolt: a jagged, branching path regenerated on each strike and
    // drawn additively over the flash bloom (storm archetype only).
    this.bolt = { alpha: 0, visible: false };
    this._boltMain = null; this._boltBranches = [];

    this._measure();
    this.areaScale = clamp((this._w * this._h) / REF_AREA, 0.7, 6);
    this._fit();

    host.__glctFx = this;
    observer()?.observe(host);
    if (typeof ResizeObserver === "function") {
      this._ro = new ResizeObserver(() => { if (this._fit()) this._draw(); });
      this._ro.observe(host);
    }
    wireVisibility();

    this.setSpec(spec);
  }

  /* ------------------------------ geometry ------------------------------ */

  /** Simulation size, in CSS px. Like the Pixi renderer it replaces, it only
      changes on an explicit resize(); between resizes the canvas stretches. */
  _measure() {
    this._w = Math.max(8, this.host.clientWidth || 54);
    this._h = Math.max(8, this.host.clientHeight || 30);
  }

  /** Size the canvas to the host's visible span. Returns true if the backing
      store changed (which clears it). */
  _fit() {
    const [f0, f1] = visibleSpan(this.host);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, MAX_DPR);
    this._x0 = f0 * this._w;
    this._vw = Math.max(1, (f1 - f0) * this._w);
    const cw = Math.max(1, Math.ceil(this._vw * dpr));
    const ch = Math.max(1, Math.ceil(this._h * dpr));
    const left = `${(f0 * 100).toFixed(3)}%`, width = `${((f1 - f0) * 100).toFixed(3)}%`;
    if (this.canvas.style.left !== left) this.canvas.style.left = left;
    if (this.canvas.style.width !== width) this.canvas.style.width = width;
    this._kx = cw / this._vw; this._ky = ch / this._h;
    if (this.canvas.width === cw && this.canvas.height === ch) return false;
    this.canvas.width = cw; this.canvas.height = ch;   // resets context state
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "low";   // plain bilinear: LOD selection is ours (see mipLevels)
    return true;
  }

  /* ------------------------------ textures ------------------------------ */

  _texFor(name) {
    const t = this.tex;
    switch (name) {
      case "blob": return t.blob;
      case "streak": return t.streak;
      case "glow": return t.glow;
      case "shard": return t.shard;
      case "flake": return t.flake;
      default: return t.dot;
    }
  }

  /** The mip levels of a white texture multiplied by `color` — exactly Pixi's
      tint (a multiply, so tinting each level equals mipmapping the tinted art). */
  _tinted(tex, color) {
    let byColor = this._tintCache.get(tex);
    if (!byColor) this._tintCache.set(tex, byColor = new Map());
    let levels = byColor.get(color);
    if (!levels) {
      const css = cssHex(color);
      levels = mipLevels(tex).map(src => canvasTex(src.width, src.height, (ctx, w, h) => {
        ctx.drawImage(src, 0, 0);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, w, h);
      }));
      byColor.set(color, levels);
    }
    return levels;
  }

  /* ------------------------------ spec / particles ------------------------------ */

  setSpec(spec) {
    const s = spec ?? { archetype: "clear", intensity: 0.3, tintParticle: "#cfe8ff", tintGlow: "#7fb4e6", drift: "still" };
    const archChanged = !this.spec || this.spec.archetype !== s.archetype || this.spec.intensity !== s.intensity || this.spec.drift !== s.drift;
    this.spec = { ...s };
    this.pColor = hexInt(s.tintParticle, 0xffffff);
    this.gColor = hexInt(s.tintGlow, 0xffffff);
    if (archChanged) this._rebuild();
    else this._retint();
    this._draw();
  }

  _rebuild() {
    this.particles = [];
    const arch = this.spec.archetype;
    const motion = MOTION[arch] ?? "clear";
    const tune = TUNING[arch] ?? TUNING.clear;
    this._additive = ADDITIVE.has(arch);
    const I = this.spec.intensity ?? 0.5;
    const count = clamp(Math.round(tune.max * (0.3 + 0.7 * I) * this.areaScale), 3, tune.cap);
    this.flash.visible = motion === "flashes";
    this.bolt.visible = motion === "flashes";
    if (motion !== "flashes") { this._boltMain = null; this._boltBranches = []; this.bolt.alpha = 0; }

    const tex = this._texFor(tune.tex);
    for (let i = 0; i < count; i++) {
      const sp = new Sprite(tex);
      const p = { sp, z: Math.random() };       // z = depth (0 far … 1 near)
      this._spawn(p, true);
      this.particles.push(p);
    }
    // draw nearer (bigger/brighter) particles last so they sit on top
    this.particles.sort((a, b) => a.z - b.z);
    this._retint();
  }

  _retint() {
    const arch = this.spec.archetype;
    const mix = GLOW_MIX.has(arch);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      // glow-mix archetypes blend in the secondary tint on a fraction of particles
      const useGlow = mix && (i % 3 === 0);
      p.sp.tint = useGlow ? this.gColor : this.pColor;
    }
    // drop tinted copies no longer in use (an editor colour drag mints many)
    for (const byColor of this._tintCache.values()) {
      for (const c of byColor.keys()) if (c !== this.pColor && c !== this.gColor) byColor.delete(c);
    }
  }

  /** Initial / recycled spawn for a particle, per archetype. */
  _spawn(p, initial = false) {
    const w = this._w, h = this._h, arch = MOTION[this.spec.archetype] ?? "clear", drift = this.spec.drift, I = this.spec.intensity ?? 0.5;
    const sp = p.sp;
    const z = (p.z ??= Math.random());           // depth: near=1, far=0
    const near = 0.35 + 0.65 * z;                // parallax multiplier
    sp.rotation = 0;
    sp.alpha = 1;
    const driftX = drift === "left" ? -1 : drift === "right" ? 1 : 0;
    const driftY = drift === "rise" ? -1 : drift === "fall" ? 1 : 0;

    switch (arch) {
      case "flashes":      // storm: heavier, faster rain under the bloom
      case "streaks": {
        sp.x = rand(-6, w + 6); sp.y = initial ? rand(0, h) : rand(-h * 0.5, -6);
        // rain is near-vertical; wind only nudges the angle
        const wind = driftX * rand(0.06, 0.16);
        const speed = (arch === "flashes" ? 340 : 250) * (0.55 + I) * near;
        p.vx = wind * speed; p.vy = speed;
        sp.scale.set((0.4 + 0.28 * near) * rand(0.8, 1.15), (0.28 + 0.4 * near) * rand(0.85, 1.25));
        sp.rotation = Math.atan2(p.vy, p.vx) - Math.PI / 2;
        p.base = (0.13 + 0.32 * z) * rand(0.85, 1.1);
        break;
      }
      case "shards": {
        sp.x = rand(-4, w + 4); sp.y = initial ? rand(0, h) : rand(-12, -2);
        p.vx = driftX * rand(10, 30) * near; p.vy = rand(220, 320) * (0.55 + I) * near;
        // small, crisp ice pellets — a fraction of the old footprint so they
        // never crowd the readout; a slight vertical stretch reads as fast fall
        const sc = (0.085 + 0.09 * near) * rand(0.82, 1.14);
        sp.scale.set(sc, sc * 1.16);
        sp.rotation = rand(-0.5, 0.5);    // mostly upright, gentle tilt
        p.spin = rand(-2.4, 2.4);         // slow tumble (was a frantic spin)
        p.base = 0.6 + 0.4 * z;
        break;
      }
      case "flakes": {
        sp.x = rand(0, w); sp.y = initial ? rand(0, h) : (driftY < 0 ? h + 6 : -6);
        // snow falls slowly and drifts; small, soft, varied
        p.vx = rand(-5, 5) + driftX * 12; p.vy = (driftY < 0 ? -1 : 1) * rand(9, 24) * near;
        p.sway = rand(0.4, 1.3); p.phase = rand(0, Math.PI * 2); p.swayAmp = rand(3, 8) * near;
        // scaled for the 96px crystal texture so on-screen flakes stay small
        sp.scale.set((0.038 + 0.085 * near) * rand(0.85, 1.25));
        sp.rotation = rand(0, Math.PI);    // vary the crystal's orientation
        p.base = (0.4 + 0.5 * z);
        break;
      }
      case "volume": {
        // fog: big, very soft, very faint clouds drifting slowly sideways
        sp.x = initial ? rand(0, w) : (driftX < 0 ? w + 70 : -70);
        sp.y = rand(-h * 0.1, h * 1.1);
        p.vx = (driftX || 1) * rand(2, 7) * (0.5 + z); p.vy = rand(-1.5, 1.5);
        sp.scale.set((0.55 + 0.85 * near) * rand(0.8, 1.4));
        p.base = (0.05 + 0.12 * z) + I * 0.07;
        p.phase = rand(0, Math.PI * 2); p.twk = rand(0.25, 0.7);
        break;
      }
      case "motes": {
        sp.x = rand(0, w); sp.y = rand(0, h);
        p.vx = rand(-10, 10) * near; p.vy = (rand(-10, 10) + driftY * 10) * near;
        sp.scale.set((0.18 + 0.4 * near) * rand(0.85, 1.2));
        p.phase = rand(0, Math.PI * 2); p.twk = rand(1.5, 4);
        p.base = (0.35 + 0.6 * z);
        break;
      }
      case "embers": {
        sp.x = rand(0, w); sp.y = initial ? rand(0, h) : h + 4;
        p.vx = rand(-12, 12) + driftX * 10; p.vy = -rand(20, 52) * (0.55 + I) * near;
        sp.scale.set((0.16 + 0.36 * near) * rand(0.85, 1.2));
        p.phase = rand(0, Math.PI * 2); p.twk = rand(3, 7);
        p.base = (0.45 + 0.5 * z);
        break;
      }
      case "gusts": {
        sp.x = initial ? rand(0, w) : (driftX < 0 ? w + 12 : -12);
        sp.y = rand(0, h);
        p.vx = (driftX || 1) * rand(150, 300) * (0.55 + I) * near; p.vy = rand(-6, 6);
        sp.scale.set((0.5 + 0.7 * near) * rand(0.8, 1.2), (0.16 + 0.26 * near));
        sp.rotation = Math.PI / 2;   // lay the streak horizontal
        p.base = (0.22 + 0.5 * z);
        break;
      }
      default: { // clear — faint slow shimmer
        sp.x = rand(0, w); sp.y = rand(0, h);
        p.vx = rand(-4, 4); p.vy = rand(-4, 4);
        sp.scale.set((0.14 + 0.24 * near) * rand(0.85, 1.2));
        p.phase = rand(0, Math.PI * 2); p.twk = rand(1, 2.5);
        p.base = (0.1 + 0.22 * z);
        break;
      }
    }
    sp.alpha = p.base;
  }

  /* ------------------------------ frame ------------------------------ */

  /** One shared-loop frame: advance by real elapsed time, then draw. */
  _frame(now) {
    const dt = this._last == null ? FRAME_MS / 1000 : Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this._advance(dt);
    this._draw();
  }

  _advance(dt) {
    const w = this._w, h = this._h, arch = MOTION[this.spec.archetype] ?? "clear", t = (this._flashT += dt);
    // The motes walk was written per display frame (kick then damp) and tuned at
    // 60 Hz; scale both so the drift looks the same at any frame rate: the kick
    // by √(dt/f₆₀) keeps the walk's variance per second, the damping by dt·60.
    const kick = Math.sqrt(dt / REF_HZ), damp = Math.pow(0.96, dt * REF_HZ);

    for (const p of this.particles) {
      const sp = p.sp;
      sp.x += p.vx * dt; sp.y += p.vy * dt;
      switch (arch) {
        case "flakes":
          sp.x += Math.sin(t * p.sway + p.phase) * p.swayAmp * dt;
          sp.rotation += dt * 0.3;
          if (sp.y > h + 8 || sp.y < -8) this._spawn(p);
          else if (sp.x < -10) sp.x = w + 8; else if (sp.x > w + 10) sp.x = -8;
          break;
        case "motes":
        case "clear":
          p.vx += rand(-12, 12) * kick; p.vy += rand(-12, 12) * kick;
          p.vx *= damp; p.vy *= damp;
          sp.alpha = p.base * (0.5 + 0.5 * Math.sin(t * p.twk + p.phase));
          if (sp.x < -6) sp.x = w + 6; else if (sp.x > w + 6) sp.x = -6;
          if (sp.y < -6) sp.y = h + 6; else if (sp.y > h + 6) sp.y = -6;
          break;
        case "embers":
          p.vx += Math.sin(t * 2 + p.phase) * 14 * dt;
          sp.alpha = p.base * (0.45 + 0.55 * Math.sin(t * p.twk + p.phase));
          if (sp.y < -6 || sp.x < -10 || sp.x > w + 10) this._spawn(p);
          break;
        case "volume":
          sp.alpha = p.base * (0.7 + 0.3 * Math.sin(t * p.twk + p.phase));
          if (sp.x < -76 || sp.x > w + 76) this._spawn(p);
          break;
        case "gusts":
          if (sp.x < -16 || sp.x > w + 16) this._spawn(p);
          break;
        case "shards":
          sp.rotation += (p.spin ?? 0) * dt;
          if (sp.y > h + 8) this._spawn(p);
          break;
        default: // streaks / flashes (rain)
          if (sp.y > h + 8 || sp.x < -12 || sp.x > w + 12) this._spawn(p);
          break;
      }
    }

    if (arch === "flashes") this._tickFlash(dt);
  }

  /** Storm: a forked bolt + ambient flash bloom, with an occasional re-flicker. */
  _tickFlash(dt) {
    const I = this.spec.intensity ?? 0.7;
    if (this._strike > 0) {
      this.flash.alpha = Math.max(0, this.flash.alpha - dt * 6);   // bloom lingers
      this.bolt.alpha = Math.max(0, this.bolt.alpha - dt * 11);    // bolt snaps off
      if (this.flash.alpha <= 0.02 && this.bolt.alpha <= 0.02) {
        this._strike--;
        if (this._strike > 0) { this._spawnBolt(); this.flash.alpha = rand(0.3, 0.6); }  // flicker
      }
    } else if (Math.random() < dt * (0.18 + I * 0.7)) {
      this._strike = Math.random() < 0.5 ? 2 : 1;        // sometimes a double-strike
      this._spawnBolt();
      this.flash.alpha = rand(0.5, 0.85);
    }
  }

  /** Generate a fresh jagged main channel + 1–2 branches. */
  _spawnBolt() {
    const w = this._w, h = this._h;
    const jit = Math.min(w * 0.16, 11);
    const segs = Math.max(4, Math.round(h / 7));
    const stepY = h / segs;
    const main = [];
    // The full HUD bar is very wide and masks the weather to its left third, so
    // strikes must land there to be visible; the popup chip is ~square with no
    // mask, so centre the strike there instead.
    const wide = w / h > 3;
    let x = wide ? rand(w * 0.05, w * 0.24) : rand(w * 0.34, w * 0.66), y = 0;
    for (let i = 0; i <= segs; i++) {
      main.push({ x: clamp(x, 2, w - 2), y });
      x += rand(-1, 1) * jit;
      y += stepY * rand(0.7, 1.3);
    }
    this._boltMain = main;
    this._boltBranches = [];
    const branches = Math.random() < 0.65 ? 1 : 2;
    for (let b = 0; b < branches; b++) {
      const from = main[Math.floor(rand(1, Math.max(2, segs - 1)))];
      const dir = Math.random() < 0.5 ? -1 : 1;
      const br = [{ x: from.x, y: from.y }];
      let bx = from.x, by = from.y;
      const blen = Math.round(rand(2, 4));
      for (let i = 0; i < blen; i++) {
        bx += dir * rand(3, 9) + rand(-2, 2);
        by += stepY * rand(0.5, 1);
        br.push({ x: clamp(bx, 1, w - 1), y: by });
      }
      this._boltBranches.push(br);
    }
    this.bolt.alpha = 1;
  }

  /** Paint the current state: particles (depth-sorted), then the storm bloom,
      then the bolt — the same order and blending as the old Pixi stage. Only the
      visible span is rasterised; particles wholly outside it are skipped. */
  _draw() {
    const ctx = this.ctx, cv = this.canvas;
    if (!ctx || !this.spec) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, cv.width, cv.height);

    const kx = this._kx, ky = this._ky, x0 = this._x0, x1 = this._x0 + this._vw, h = this._h;
    ctx.globalCompositeOperation = this._additive ? "lighter" : "source-over";
    for (const p of this.particles) {
      const sp = p.sp;
      const a = sp.alpha;
      if (!(a > 0)) continue;                          // Pixi skips alpha ≤ 0 too
      const tw = sp.tex.width, th = sp.tex.height;
      const sx = sp.scale.x, sy = sp.scale.y;
      const r = 0.5 * Math.hypot(tw * sx, th * sy);
      if (sp.x + r < x0 || sp.x - r > x1 || sp.y + r < 0 || sp.y - r > h) continue;
      const c = Math.cos(sp.rotation), s = Math.sin(sp.rotation);
      const ma = kx * c * sx, mb = ky * s * sx, mc = -kx * s * sy, md = ky * c * sy;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.setTransform(ma, mb, mc, md, kx * (sp.x - x0), ky * sp.y);
      const levels = this._tinted(sp.tex, sp.tint);
      ctx.drawImage(levels.length > 1 ? levels[lodIndex(ma, mb, mc, md, levels.length)] : levels[0], -tw / 2, -th / 2, tw, th);
    }

    if (this.flash.visible && this.flash.alpha > 0) {
      const tex = this.tex.flash;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(1, this.flash.alpha);
      ctx.setTransform(kx * this._w / tex.width, 0, 0, ky * h / tex.height, -kx * x0, 0);
      ctx.drawImage(this._tinted(tex, this.gColor)[0], 0, 0);
    }

    if (this.bolt.visible && this.bolt.alpha > 0 && this._boltMain) {
      ctx.globalCompositeOperation = "lighter";
      ctx.setTransform(kx, 0, 0, ky, -kx * x0, 0);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const paths = [this._boltMain, ...this._boltBranches];
      const trace = (pts, width, color, alpha) => {
        ctx.lineWidth = width;
        ctx.strokeStyle = cssHex(color);
        ctx.globalAlpha = Math.min(1, alpha * this.bolt.alpha);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      };
      // wide soft glow in the storm's glow tint, then a bright white core
      for (const p of paths) trace(p, 4.2, this.gColor, 0.4);
      for (const p of paths) trace(p, 2.0, this.gColor, 0.7);
      for (const p of paths) trace(p, 0.9, 0xffffff, 1);
    }
  }

  /* ------------------------------ lifecycle ------------------------------ */

  /** Join or leave the shared loop: drawing needs the owner's go-ahead AND the
      host on screen. The tab's visibility is handled by the loop itself. */
  _syncLive() {
    if (this._wanted && this._inView && this.canvas) {
      if (!LIVE.has(this)) { this._last = null; LIVE.add(this); }
      kick();
    } else {
      LIVE.delete(this);
    }
  }

  _setInView(v) { this._inView = !!v; this._syncLive(); }

  pause() { this._wanted = false; this._syncLive(); }

  resume() { this._wanted = true; this._syncLive(); }

  resize() {
    try {
      this._measure();
      this._fit();
      // a large area change (chip ↔ full bar) warrants re-seeding the field density
      const next = clamp((this._w * this._h) / REF_AREA, 0.7, 6);
      if (this.spec && Math.abs(next - this.areaScale) / this.areaScale > 0.25) {
        this.areaScale = next; this._rebuild();
      }
      this._draw();
    } catch { /* ignore */ }
  }

  destroy() {
    LIVE.delete(this);
    try { io?.unobserve(this.host); } catch { /* ignore */ }
    try { this._ro?.disconnect(); } catch { /* ignore */ }
    if (this.host?.__glctFx === this) delete this.host.__glctFx;
    this.canvas?.remove();
    this.canvas = null; this.ctx = null; this._ro = null;
    this.particles = []; this._tintCache.clear();
  }
}

/**
 * Shared alias. The class is no longer weather-specific — it renders any effect
 * archetype × tints for the delving HUD too — so new code should import it under
 * this neutral name. (Kept as an alias rather than a rename to avoid churning the
 * many existing `WeatherEffect` imports.)
 */
export { WeatherEffect as EffectField };
