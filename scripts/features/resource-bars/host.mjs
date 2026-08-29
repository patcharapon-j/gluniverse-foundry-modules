/**
 * GLUniverse Suite — resource bars: the renderer.
 *
 * ── Where the bars live ──
 *
 * In one container on `canvas.interface`, in world coordinates — *not* as
 * children of each token. Three reasons, in order of how much they matter:
 *
 *   1. The bloom is one filter over that container. A filter on a token
 *      allocates a render texture per token per frame, which in a forty-token
 *      combat is the most expensive thing this feature could possibly do.
 *   2. Tokens rotate. Bars must not. Living in world space means never having
 *      to counter-rotate anything.
 *   3. One container is one place to hide everything when the feature is
 *      switched off mid-session.
 *
 * ── Hot and cold ──
 *
 * A bar that is not changing is not ticked at all: it keeps the frame it last
 * drew. The ticker is only attached while at least one bar is hot, so a quiet
 * scene costs nothing, and a scene where one creature is being hit costs one
 * bar. This is the entire performance story.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { FRAGMENT_SHADER, READOUT_INSET, VERTEX_SHADER } from "./shader.mjs";
import { rampUniform, hexToFloat3, TEMP_COLOR, SHIELD_COLOR, RAIL_COLOR } from "./ramp.mjs";
import { BarAnim, POPUP_LIFT, POPUP_RISE, SHED_ORDER } from "./anim.mjs";
import { DIVIDER, FLAGS, LAYOUT, ROLE, SEGMENTS } from "./constants.mjs";
import { readToken, sameReading } from "./data.mjs";
import { canViewBars, canViewNumbers } from "./visibility.mjs";
import { getAtlas, resetAtlas, runGeometry, TEXT_VERTEX_SHADER, TEXT_FRAGMENT_SHADER } from "./atlas.mjs";
import { createBloomFilter } from "./bloom.mjs";

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/**
 * Where the bar container sorts inside `canvas.interface`.
 *
 * This is not cosmetic. `InterfaceCanvasGroup` sorts its children by zIndex,
 * and Foundry's own layers all declare one — the tokens layer holds every
 * Token object, and a Token's children are its hover/target border, its
 * nameplate and its elevation tooltip. A container left at the default zIndex 0
 * therefore sorts *below all of them*: the bars are above the token artwork
 * (that lives in `canvas.primary`, an entirely different group) but the hover
 * box is drawn straight over them, which is exactly what it looked like.
 *
 * 900 clears the tokens layer and the notes layer (800) and stays under the
 * controls layer (1000), so rulers, door controls and the drag ruler keep the
 * top of the stack — those are things you are aiming at, and a health bar must
 * never be in front of a click target.
 */
const CONTAINER_Z = 900;

/**
 * How far outside the viewport a bar is still drawn, in world pixels.
 *
 * Wide enough to cover the bloom a bar just off the edge would have spilled
 * back inward, so culling is invisible rather than a fringe that pops at the
 * screen edge while panning.
 */
const CULL_PAD = 96;

/** The three rows, in stacking order. */
const ROLES = ["hero", "rail", "shield"];

/** Readout ink: at rest, and the two colours an impact drags it toward. */
const REST_INK = [0.97, 0.99, 1.0];
const HIT_INK = [1.0, 0.52, 0.48];
const HEAL_INK = [0.62, 1.0, 0.78];

/** A unit quad in local space; the mesh is scaled to the bar's pixel size. */
function unitQuad() {
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
}

function makeBarMesh(role, opts) {
  const uniforms = {
    uTime: 0, uTexel: 0, uAspect: 6,
    uFrac: 1, uGhost: 1, uBloom: 0, uFlash: 0, uLow: 0, uSweep: 0,
    uTemp: 0, uCracked: 0, uSeg: opts.segments, uSegW: opts.dividerWidth ?? DIVIDER.default, uRole: role,
    uHit: 0, uHitX: 1, uHeal: 0, uSpark: 0, uChip: 0, uWave: 0, uWaveX: 1,
    uRamp: opts.ramp,
    uTempCol: new Float32Array(hexToFloat3(TEMP_COLOR)),
    uShieldCol: new Float32Array(hexToFloat3(SHIELD_COLOR)),
    uRailCol: new Float32Array(hexToFloat3(RAIL_COLOR)),
  };
  const shader = PIXI.Shader.from(VERTEX_SHADER, FRAGMENT_SHADER, uniforms);
  const mesh = new PIXI.Mesh(unitQuad(), shader);
  mesh.blendMode = PIXI.BLEND_MODES?.NORMAL ?? "normal";
  return mesh;
}

class BarEntry {
  constructor(token, host) {
    this.token = token;
    this.host = host;
    this.group = new PIXI.Container();
    this.group.eventMode = "none";
    this.meshes = { hero: null, rail: null, shield: null };
    this.anims = { hero: null, rail: null, shield: null };
    this.textMesh = null;
    this.popupMesh = null;
    this.reading = null;
    this.lastNumber = "";
    this.popupText = null;
    /** Per-row geometry, in world pixels: { w, h, y }. Fixed by the layout. */
    this.rows = {};
    /** Token origin plus the configured offset, in world pixels. */
    this.baseX = 0;
    /* Reused rather than reallocated: the readout's tint changes every frame of
       an impact, and PIXI compares uniform vectors element-wise, so mutating one
       buffer in place uploads exactly when a fresh array would. */
    this._ink = new Float32Array(REST_INK);
  }

  destroy() {
    this.group.destroy({ children: true });
  }

  /** The animation model for a role, created on first use. */
  animFor(role, frac) {
    if (!this.anims[role]) {
      this.anims[role] = new BarAnim(frac, { motionScale: this.host.motionScale });
    }
    return this.anims[role];
  }

  /** Pull new values in, arming whatever animation the change deserves. */
  read(opts) {
    const next = readToken(this.token, opts);
    if (!next) { this.reading = null; return; }
    const first = !this.reading;
    const changed = !sameReading(this.reading, next);
    this.reading = next;
    if (!changed) return;

    const set = (role, bar, max) => {
      if (!bar) return;
      const a = this.animFor(role, bar.frac);
      a.motionScale = this.host.motionScale;
      if (first) a.set(bar.frac, { silent: true });
      else a.set(bar.frac, { max: this.host.floatingDeltas ? max : 0 });
    };
    set("hero", next.hero, next.hero?.max ?? 0);
    set("rail", next.rail, 0);
    set("shield", next.shield, 0);
  }
}

class BarHost {
  constructor() {
    this.entries = new Map();
    this.container = null;
    this.ticking = false;
    this.frameMs = 16;
    this.shed = 0;
    this.opts = {};
    this._tick = this.tick.bind(this);
    this._lastTime = 0;
  }

  /* ── Settings mirror ─────────────────────────────────────────────────── */

  configure(opts) {
    this.opts = opts;
    this.motionScale = opts.motionScale;
    this.floatingDeltas = opts.floatingDeltas;
    this.ramp = rampUniform(opts.ramp);
    for (const entry of this.entries.values()) {
      for (const role of ROLES) {
        const mesh = entry.meshes[role];
        if (mesh) {
          mesh.shader.uniforms.uRamp = this.ramp;
          mesh.shader.uniforms.uSeg = role === "hero" ? this.segmentsFor(entry.reading?.hero) : 0;
          mesh.shader.uniforms.uSegW = this.dividerWidth();
        }
        if (entry.anims[role]) entry.anims[role].motionScale = opts.motionScale;
      }
    }
    this.applyBloom();
  }

  applyBloom() {
    if (!this.container) return;
    if (this.opts.bloom) {
      if (!this.bloom) this.bloom = createBloomFilter();
      if (this.bloom) {
        this.syncFilterResolution();
        /* Nothing here has a geometric edge to antialias — every shape in the
           bar is an SDF the fragment shader already resolves against px, and the
           numerals are alpha-blended from an atlas. Multisampling the filter
           target would resolve an extra buffer every frame for no difference. */
        this.bloom.multisample = PIXI.MSAA_QUALITY?.NONE ?? 0;
      }
      this.container.filters = this.bloom ? [this.bloom] : null;
    } else {
      this.container.filters = null;
    }
  }

  /* ── Lifecycle ───────────────────────────────────────────────────────── */

  attach() {
    if (this.container) return;
    const layer = canvas?.interface ?? canvas?.tokens;
    if (!layer) return;
    this.container = new PIXI.Container();
    this.container.eventMode = "none";
    this.container.sortableChildren = false;
    /* Set before the addChild so the parent is only marked dirty once. If the
       parent turns out not to sort its children at all, being added last puts us
       on top anyway — both paths land above the token furniture. */
    this.container.zIndex = CONTAINER_Z;
    layer.addChild(this.container);
    this.applyBloom();
    this.refreshAll();
  }

  detach() {
    this.stopTicker();
    for (const entry of this.entries.values()) entry.destroy();
    this.entries.clear();
    try {
      this.container?.destroy({ children: true });
    } catch {
      /* canvasTearDown may already have destroyed the parent layer out from
         under us; there is nothing left to release and nothing to report. */
    }
    this.container = null;
    this.bloom = null;
    resetAtlas();
  }

  /* ── Entries ─────────────────────────────────────────────────────────── */

  refreshAll() {
    if (!this.container || !canvas?.tokens) return;
    const seen = new Set();
    for (const token of canvas.tokens.placeables) {
      seen.add(token.id);
      this.refreshToken(token);
    }
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) { entry.destroy(); this.entries.delete(id); }
    }
    this.cull();
    this.syncTicker();
  }

  /**
   * Position only — no data read.
   *
   * `refreshToken` fires on every frame of a drag, so the full refresh (which
   * calls `getBarAttribute` three times and rebuilds the numeral geometry)
   * cannot be hung off it. Moving a token is not a value change.
   */
  reposition(token) {
    const entry = this.entries.get(token?.id);
    if (!entry || !entry.reading) return;
    entry.token = token;
    this.layout(entry);
    this.cullEntry(entry);
    this.writeUniforms(entry, canvas.app?.ticker?.lastTime / 1000 || 0);
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.destroy();
    this.entries.delete(id);
  }

  refreshToken(token) {
    if (!this.container || !token?.id) return;

    if (!canViewBars(token)) { this.remove(token.id); this.syncTicker(); return; }

    let entry = this.entries.get(token.id);
    if (!entry) {
      entry = new BarEntry(token, this);
      this.entries.set(token.id, entry);
      this.container.addChild(entry.group);
    }
    entry.token = token;                       // survives a redraw of the placeable
    entry.read({ bothBars: this.opts.bothBars, pf2eLayers: this.opts.pf2eLayers });
    if (!entry.reading) { this.remove(token.id); return; }

    this.layout(entry);
    this.writeUniforms(entry, (canvas.app?.ticker?.lastTime ?? 0) / 1000);
    this.syncTicker();
  }

  /**
   * Place the stack under the token, in world pixels.
   *
   * Heights are a fraction of the *grid*, not of the token: a bar sized off a
   * gargantuan creature would be a slab the size of a doorway, and one sized
   * off a tiny creature would be unreadable — while the thing the reader is
   * actually judging (can I see this at this zoom?) depends on the grid.
   */
  /**
   * The nudge for one token, in grid squares.
   *
   * A per-token flag *replaces* the world default rather than adding to it. The
   * additive reading looks friendlier and is worse in practice: a GM who moves
   * the world default afterwards silently drags every hand-placed token with
   * it, and the token whose placement was the whole reason for the override is
   * the one that moves furthest.
   *
   * An unset flag is `null` (the Token Config form submits an empty number
   * field as null), which is exactly the distinction we need and the reason
   * this tests for finiteness rather than for truthiness — 0 is a legitimate
   * override meaning "hold still while the world default moves".
   */
  offsetFor(token) {
    const pick = (flag, fallback) => {
      let v;
      try { v = token?.document?.getFlag(SUITE_ID, flag); } catch { v = undefined; }
      return Number.isFinite(v) ? v : fallback;
    };
    return {
      x: pick(FLAGS.offsetX, this.opts.offsetX ?? 0),
      y: pick(FLAGS.offsetY, this.opts.offsetY ?? 0),
    };
  }

  /**
   * How many divisions the primary bar carries.
   *
   * Two ways to ask for them, and they answer different questions. A fixed
   * **count** keeps every bar on the table looking alike, so position along the
   * bar means the same fraction on every creature — which is the thing that
   * makes divisions useful to a colour-blind player in the first place. A block
   * **per N HP** instead makes one division mean one quantity of damage
   * everywhere, so a 12 HP goblin gets two plates and a 200 HP dragon gets
   * forty, and "took about three blocks" is the same hit on both.
   *
   * Rounded *up*, so the last plate is the short one. Rounding down would put
   * the remainder in the first plate, which is the one at the full-health end
   * that a GM is looking at when nothing has happened yet.
   *
   * A creature with no maximum — some actor types genuinely have none — falls
   * back to a continuous fill rather than to a division count derived from
   * zero.
   */
  segmentsFor(bar) {
    /* The switch belongs here rather than beside each write, for the same
       reason the per-HP count does: three call sites resolving "are there
       divisions" independently is three chances for one of them to keep
       dividing a bar the GM turned the dividers off on. */
    if (this.opts.dividers === false) return 0;
    if (this.opts.segmentMode !== "perHp") return this.opts.segments;
    const per = Number(this.opts.segmentSize);
    const max = Number(bar?.max);
    if (!(per > 0) || !Number.isFinite(max) || max <= 0) return 0;
    return clamp(Math.ceil(max / per), 0, SEGMENTS.max);
  }

  /**
   * The gap between two plates, in device pixels.
   *
   * Clamped here as well as ranged in the settings UI, because the shader
   * multiplies the floor by it: a negative value out of a hand-edited world
   * would invert the clamp and take the *whole* fill out.
   */
  dividerWidth() {
    const w = Number(this.opts.dividerWidth);
    return Number.isFinite(w) ? clamp(w, DIVIDER.min, DIVIDER.max) : DIVIDER.default;
  }

  layout(entry) {
    const token = entry.token;
    const grid = canvas.dimensions?.size ?? 100;
    const w = token.w;

    const heroH = clamp(grid * LAYOUT.heroH, LAYOUT.minHeroPx, LAYOUT.maxHeroPx);
    const railH = clamp(grid * LAYOUT.railH, LAYOUT.minRailPx, LAYOUT.maxRailPx);
    const gap = grid * LAYOUT.gap;
    const off = this.offsetFor(token);

    const rows = [];
    if (entry.reading.hero) rows.push(["hero", ROLE.hero, heroH]);
    if (entry.reading.rail) rows.push(["rail", ROLE.rail, railH]);
    if (entry.reading.shield) rows.push(["shield", ROLE.shield, railH]);

    entry.baseX = token.x + off.x * grid;
    // The hero straddles the token's edge; the offset moves the whole stack.
    let y = token.y + token.h - heroH * 0.42 + off.y * grid;
    entry.rows = {};
    for (const [role, roleId, h] of rows) {
      let mesh = entry.meshes[role];
      if (!mesh) {
        mesh = makeBarMesh(roleId, {
          segments: role === "hero" ? this.segmentsFor(entry.reading.hero) : 0,
          dividerWidth: this.dividerWidth(),
          ramp: this.ramp,
        });
        entry.meshes[role] = mesh;
        entry.group.addChild(mesh);
      }
      mesh.visible = true;
      mesh.position.set(entry.baseX, y);
      mesh.scale.set(w, h);
      mesh.shader.uniforms.uAspect = w / h;
      entry.rows[role] = { w, h, y };
      y += h + gap;
    }
    for (const role of ROLES) {
      if (!entry.rows[role] && entry.meshes[role]) entry.meshes[role].visible = false;
    }
    entry.heroH = heroH;
    entry.heroW = w;
    /* The stack's world-space extent, for culling. Grown upward by a hero
       height because the floating deltas rise out of the top of the bar. */
    entry.box = { x0: entry.baseX, y0: token.y + token.h - heroH * 1.5 + off.y * grid,
                  x1: entry.baseX + w, y1: y };
  }

  /* ── Per-frame ───────────────────────────────────────────────────────── */

  /**
   * Keep the bloom's render target at the renderer's own resolution.
   *
   * This is the blur. `PIXI.Filter` defaults its resolution to 1, *not* to the
   * renderer's, and the filter system sizes the intermediate textures from the
   * filter rather than from the target it is drawing into. On any HiDPI display
   * — which is every retina Mac and most modern laptops — the renderer runs at
   * resolution 2 and the entire bar container is therefore rendered at half the
   * device pixels and scaled back up on composite. Nothing errors. The bars
   * simply arrive soft, and worse the harder you zoom in, because the thing
   * being upscaled is a fixed fraction of the real pixel count.
   *
   * It has to be re-read rather than set once: dragging the window to a display
   * with a different pixel ratio changes `renderer.resolution` underneath us.
   */
  syncFilterResolution() {
    const r = canvas?.app?.renderer;
    if (!this.bloom || !r) return;
    const res = r.resolution || 1;
    if (this.bloom.resolution !== res) this.bloom.resolution = res;
  }

  /**
   * Stop drawing the bars that are not on screen.
   *
   * Two costs, and the second is the one that hurts. Off-screen bars are draw
   * calls that render nothing — annoying but linear. They are also *bounds*:
   * a filtered container measures itself every frame by walking each child, and
   * the filter's texture is allocated from that measurement, so one token
   * parked in the far corner of a large scene sizes the bloom's intermediate
   * buffers to the whole distance between them. In a forty-token combat spread
   * across a battlemap that is the single largest thing this feature does, and
   * it costs the same whether or not anything is animating.
   *
   * PIXI skips a non-renderable child in `calculateBounds` as well as in the
   * render, so clearing the flag fixes both at once.
   *
   * Nothing visible changes: the margin is wide enough that a bar just outside
   * the viewport still contributes the bloom it would have spilled inward.
   */
  cull() {
    if (!this.container) return;
    this.syncFilterResolution();
    const screen = canvas?.app?.renderer?.screen;
    if (!screen) return;

    const a = this.container.toLocal({ x: screen.x, y: screen.y });
    const b = this.container.toLocal({ x: screen.x + screen.width, y: screen.y + screen.height });
    this._view = {
      x0: Math.min(a.x, b.x) - CULL_PAD, x1: Math.max(a.x, b.x) + CULL_PAD,
      y0: Math.min(a.y, b.y) - CULL_PAD, y1: Math.max(a.y, b.y) + CULL_PAD,
    };
    for (const entry of this.entries.values()) this.cullEntry(entry);
  }

  /**
   * Apply the last computed view to one entry.
   *
   * Split out because a dragged token needs re-testing on every frame of the
   * drag while the *view* has not moved at all, and recomputing the rectangle
   * there would put two matrix inversions inside the drag loop.
   */
  cullEntry(entry) {
    const v = this._view;
    const box = entry.box;
    /* No view or no box yet means nothing has been measured; leave the bar
       visible rather than hiding one this pass has no information about. */
    entry.group.renderable =
      !v || !box || !(box.x1 < v.x0 || box.x0 > v.x1 || box.y1 < v.y0 || box.y0 > v.y1);
  }

  syncTicker() {
    const wanted = [...this.entries.values()].some((e) =>
      Object.values(e.anims).some((a) => a?.hot));
    if (wanted && !this.ticking) {
      canvas.app.ticker.add(this._tick);
      this.ticking = true;
      this._lastTime = performance.now();
    } else if (!wanted && this.ticking) {
      this.stopTicker();
    }
  }

  stopTicker() {
    if (!this.ticking) return;
    canvas.app?.ticker?.remove(this._tick);
    this.ticking = false;
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(50, now - this._lastTime);
    this._lastTime = now;

    /* A rolling frame time drives the shed. Effects are given up in
       SHED_ORDER, cheapest first, until we are back inside budget — a bar that
       degrades is better than a canvas that stutters. */
    this.frameMs = this.frameMs * 0.9 + dt * 0.1;
    const over = this.frameMs > 22;
    this.shed = clamp(this.shed + (over ? 1 : -1), 0, SHED_ORDER.length);

    let anyHot = false;
    for (const entry of this.entries.values()) {
      let hot = false;
      for (const role of ROLES) {
        const a = entry.anims[role];
        if (!a) continue;
        if (a.step(dt)) hot = true;
      }
      if (hot) { this.writeUniforms(entry, now / 1000); anyHot = true; }
    }
    if (!anyHot) this.stopTicker();
  }

  /** True while an effect is still inside the shed budget. */
  allows(effect) {
    const i = SHED_ORDER.indexOf(effect);
    return i < 0 || i >= this.shed;
  }

  writeUniforms(entry, time) {
    const r = entry.reading;
    if (!r) return;

    const rows = [["hero", r.hero], ["rail", r.rail], ["shield", r.shield]];
    for (const [role, bar] of rows) {
      const mesh = entry.meshes[role];
      const base = entry.rows[role];
      if (!mesh || !bar || !mesh.visible || !base) continue;
      const a = entry.anims[role];
      const u = mesh.shader.uniforms;

      u.uSeg = role === "hero" ? this.segmentsFor(r.hero) : 0;
      u.uSegW = this.dividerWidth();
      u.uTime = time;
      u.uFrac = a ? a.frac : bar.frac;
      u.uGhost = a && this.allows("ghost") ? a.ghost : u.uFrac;
      u.uBloom = a && this.allows("bloom") ? a.bloom : 0;
      u.uFlash = a ? a.flash : 0;
      u.uLow = role === "hero" ? (a ? a.low : Math.max(0, (this.opts.lowAt - bar.frac) / this.opts.lowAt)) : 0;
      u.uSweep = this.allows("sweep") && (entry.token.hover || entry.token.controlled) ? (a?.sweep ?? 0) : 0;
      u.uHit = a && this.allows("ring") ? a.hit : 0;
      u.uHitX = a ? a.hitX : bar.frac;
      u.uHeal = a ? a.heal : 0;
      u.uSpark = a && this.allows("sparks") ? a.hit : 0;
      u.uChip = a && this.allows("ghost") ? a.chip : 0;
      u.uWave = a && this.allows("wave") ? a.wave : 0;
      u.uWaveX = a ? a.waveX : u.uFrac;
      u.uTemp = role === "hero" ? r.temp : 0;
      u.uCracked = role === "shield" ? (r.shield?.broken ? 1 : 0) : 0;

      /* Nothing about the geometry is animated — not the mesh transform, not
         the fill's height. Every part of a change is light moving across a
         rigid instrument: the sweep crosses it, the ring expands, the trail
         drains. A bar that shakes, scales or wobbles is a bar you stop reading
         as a measurement. */
      u.uTexel = this.texelFor(mesh);
    }

    this.writeNumbers(entry, r);
  }

  /**
   * One device pixel in the quad's UV units — the contract `core/glsl.mjs`'s
   * prelude is written against. Left at 0 every clamp in the shader is inert
   * and it degrades to the unfiltered look, which is why this is allowed to
   * fail quietly.
   */
  texelFor(mesh) {
    const scale = mesh.worldTransform?.a ?? 1;
    const res = canvas.app?.renderer?.resolution ?? 1;
    const widthPx = Math.abs(scale) * res;
    return widthPx > 1 ? 1 / widthPx : 0;
  }

  /**
   * The readout and, when armed, the floating delta.
   *
   * Geometry is rebuilt only when the *text* changes. The punch and the
   * delta's rise are transform and uniform changes on a stable mesh — building
   * a fresh PIXI.Geometry every frame of a 300ms animation is eighteen buffer
   * allocations and uploads per token per hit, which is precisely the
   * per-change GPU cost the glyph atlas exists to avoid. Getting this wrong
   * costs nothing visible and everything in frame time.
   */
  writeNumbers(entry, r) {
    const show = r.hero && this.allows("numbers") && canViewNumbers(entry.token, this.opts.numbers);
    if (!show) {
      if (entry.textMesh) entry.textMesh.visible = false;
      if (entry.popupMesh) entry.popupMesh.visible = false;
      return;
    }

    const a = entry.anims.hero;
    const hm = entry.meshes.hero;
    const base = entry.rows.hero;
    if (!hm || !base) return;

    /* The readout is anchored to the row's resting geometry, which never moves.
       Only its own scale and colour animate — the punch is the number
       reacting, not the bar being thrown around. */
    const w = base.w, h = base.h;
    const numScale = this.opts.numberScale > 0 ? this.opts.numberScale : 1;
    /* Measured in bar heights from the quad's right edge, and shared with the
       shader, because what it has to clear is the corner the shader cuts. */
    const right = w - READOUT_INSET * h;
    const mid = h * 0.5;
    const anchorX = hm.position.x + right;
    const anchorY = hm.position.y + mid;

    /* `num` and not `frac`: the fill snaps to the new value on impact, but a
       readout that snaps is a number nobody saw move. It counts instead, which
       also means a burst of small hits reads as one continuous fall rather than
       as a digit flickering. */
    const value = Math.round((a ? a.num : r.hero.frac) * r.hero.max);
    const label = value + "/" + r.hero.max;

    /* Cached against everything that shapes the run, not only its text. Size
       comes from the bar's height and the viewer's setting, and neither of
       those changes the label — so a key of the label alone leaves a resized
       token, or a just-moved size slider, drawing the old geometry until the
       creature next takes damage. It looks like the setting does nothing. */
    const stamp = label + "@" + (h * numScale).toFixed(2) + ":" + w.toFixed(1);
    if (stamp !== entry.lastNumber || !entry.textMesh) {
      entry.lastNumber = stamp;
      /* The current value is the reading; the maximum is the scale it is read
         against, so it steps back — but only by one step. It was 0.22/0.30
         once, which is furniture: a denominator you have to go looking for is
         not serving the reading it belongs to. At full strength it competes
         instead, because a small numeral at full ink is still high-contrast
         against the plate. A slight step down carries the hierarchy while
         leaving both halves legible at a glance.

         The separator takes one step further than the maximum does, because it
         is punctuation rather than information.

         They also sit on a shared baseline rather than each on the mid-line,
         because a run where every part is separately centred reads as three
         sizes of number instead of as one reading. */
      const geo = runGeometry([
        { text: String(value), size: h * 0.46 * numScale },
        { text: "/", size: h * 0.23 * numScale, dim: 0.62, bottom: true },
        { text: String(r.hero.max), size: h * 0.24 * numScale, dim: 0.80, bottom: true },
      ], { right, mid });
      entry.textMesh = this.swapTextMesh(entry, entry.textMesh, geo, entry._ink, 1);
      /* Pivot on the run's own anchor so the punch scales about the number
         rather than throwing it across the bar. */
      entry.textMesh?.pivot.set(right, mid);
    }
    if (entry.textMesh) {
      const punch = 1 + (a && this.allows("punch") ? a.punch : 0);
      entry.textMesh.visible = true;
      entry.textMesh.scale.set(punch);
      entry.textMesh.position.set(anchorX, anchorY);

      /* The readout takes the colour of what just happened, and drops back to
         white as the impact decays. Colour on the number is what makes a heal
         and a hit distinguishable at a glance on a bar that is briefly the same
         length either way. */
      const heat = a && this.allows("punch") ? a.hit * 0.70 : 0;
      const to = a?.heal ? HEAL_INK : HIT_INK;
      for (let i = 0; i < 3; i++) entry._ink[i] = REST_INK[i] + (to[i] - REST_INK[i]) * heat;
    }

    /* Floating deltas. "The bar got shorter" is a magnitude you estimate;
       "-42" is one you read. */
    const pop = this.allows("popups") ? a?.popups?.[a.popups.length - 1] : null;
    if (!pop) {
      if (entry.popupMesh) entry.popupMesh.visible = false;
      entry.popupText = null;
      return;
    }

    const popStamp = pop.text + "@" + (h * numScale).toFixed(2);
    if (popStamp !== entry.popupText || !entry.popupMesh) {
      entry.popupText = popStamp;
      const geo = runGeometry([{ text: pop.text, size: h * 0.44 * numScale }], { right, mid });
      entry.popupMesh = this.swapTextMesh(entry, entry.popupMesh, geo,
        pop.heal ? HEAL_INK : HIT_INK, 1);
      entry.popupMesh?.pivot.set(right, mid);
    }
    if (entry.popupMesh) {
      const e = 1 - Math.pow(1 - pop.t, 2.2);
      const alpha = pop.t < 0.15 ? pop.t / 0.15 : 1 - Math.pow((pop.t - 0.15) / 0.85, 2);
      /* Punched in, not faded in. The delta is the one element on screen that
         exists purely to be read once and discarded, so it arrives at 1.35×,
         settles, and then drifts. A number that fades up from nothing is a
         number the eye finds after it has already started leaving. */
      const inT = Math.min(1, pop.t / 0.14);
      const popScale = (0.55 + 0.45 * inT) * (1 + 0.35 * Math.sin(inT * Math.PI)) * (1 - 0.14 * e);
      entry.popupMesh.visible = true;
      entry.popupMesh.shader.uniforms.uOpacity = Math.max(0, alpha);
      entry.popupMesh.scale.set(popScale);
      /* It rises and drifts back along the bar, so consecutive deltas fan out
         instead of stacking on one another. */
      entry.popupMesh.position.set(anchorX - w * (0.02 + 0.06 * e),
                                   anchorY - h * (POPUP_LIFT + POPUP_RISE * e));
    }
  }

  /**
   * Replace a run's geometry.
   *
   * The geometry is destroyed and rebuilt rather than mutated because a
   * PIXI.Geometry's buffers are uploaded once; writing new vertex counts into
   * an existing one leaves the index buffer describing the old glyph count and
   * draws garbage.
   */
  swapTextMesh(entry, mesh, geometry, ink, opacity) {
    if (!geometry) { if (mesh) mesh.visible = false; return mesh; }
    /* A Float32Array is adopted by reference so the caller can keep writing to
       it — PIXI compares vector uniforms element-wise against its own cache, so
       an in-place edit uploads exactly as a fresh array would, without an
       allocation per frame of every impact on every token. */
    const buf = ink instanceof Float32Array ? ink : new Float32Array(ink);
    if (!mesh) {
      const shader = PIXI.Shader.from(TEXT_VERTEX_SHADER, TEXT_FRAGMENT_SHADER, {
        uAtlas: getAtlas().texture,
        uInk: buf,
        uEdge: new Float32Array([0.02, 0.03, 0.05]),
        uOpacity: opacity,
      });
      mesh = new PIXI.Mesh(geometry, shader);
      mesh.blendMode = PIXI.BLEND_MODES?.NORMAL ?? "normal";
      entry.group.addChild(mesh);
      return mesh;
    }
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old?.destroy();
    mesh.shader.uniforms.uInk = buf;
    mesh.shader.uniforms.uOpacity = opacity;
    return mesh;
  }
}

export const host = new BarHost();
