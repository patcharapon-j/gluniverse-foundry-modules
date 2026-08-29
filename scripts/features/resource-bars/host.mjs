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

import { FRAGMENT_SHADER, VERTEX_SHADER, SKEW } from "./shader.mjs";
import { rampUniform, hexToFloat3, TEMP_COLOR, SHIELD_COLOR, RAIL_COLOR } from "./ramp.mjs";
import { BarAnim, SHED_ORDER } from "./anim.mjs";
import { LAYOUT, ROLE } from "./constants.mjs";
import { readToken, sameReading } from "./data.mjs";
import { canViewBars, canViewNumbers } from "./visibility.mjs";
import { getAtlas, resetAtlas, runGeometry, TEXT_VERTEX_SHADER, TEXT_FRAGMENT_SHADER } from "./atlas.mjs";
import { createBloomFilter } from "./bloom.mjs";

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

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
    uTemp: 0, uCracked: 0, uSeg: opts.segments, uRole: role,
    uHit: 0, uHitX: 1, uHeal: 0,
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
      for (const role of ["hero", "rail", "shield"]) {
        const mesh = entry.meshes[role];
        if (mesh) {
          mesh.shader.uniforms.uRamp = this.ramp;
          mesh.shader.uniforms.uSeg = role === "hero" ? opts.segments : 0;
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
  layout(entry) {
    const token = entry.token;
    const grid = canvas.dimensions?.size ?? 100;
    const w = token.w;

    const heroH = clamp(grid * LAYOUT.heroH, LAYOUT.minHeroPx, LAYOUT.maxHeroPx);
    const railH = clamp(grid * LAYOUT.railH, LAYOUT.minRailPx, LAYOUT.maxRailPx);
    const gap = grid * LAYOUT.gap;

    const rows = [];
    if (entry.reading.hero) rows.push(["hero", ROLE.hero, heroH]);
    if (entry.reading.rail) rows.push(["rail", ROLE.rail, railH]);
    if (entry.reading.shield) rows.push(["shield", ROLE.shield, railH]);

    let y = token.y + token.h - heroH * 0.42;   // the hero straddles the token's edge
    for (const [role, roleId, h] of rows) {
      let mesh = entry.meshes[role];
      if (!mesh) {
        mesh = makeBarMesh(roleId, { segments: role === "hero" ? this.opts.segments : 0, ramp: this.ramp });
        entry.meshes[role] = mesh;
        entry.group.addChild(mesh);
      }
      mesh.visible = true;
      mesh.position.set(token.x, y);
      mesh.scale.set(w, h);
      mesh.shader.uniforms.uAspect = w / h;
      y += h + gap;
    }
    for (const role of ["hero", "rail", "shield"]) {
      if (!rows.some((r) => r[0] === role) && entry.meshes[role]) entry.meshes[role].visible = false;
    }
    entry.heroH = heroH;
    entry.heroW = w;
  }

  /* ── Per-frame ───────────────────────────────────────────────────────── */

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
      for (const role of ["hero", "rail", "shield"]) {
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
      if (!mesh || !bar || !mesh.visible) continue;
      const a = entry.anims[role];
      const u = mesh.shader.uniforms;

      u.uTime = time;
      u.uTexel = this.texelFor(mesh);
      u.uFrac = a ? a.frac : bar.frac;
      u.uGhost = a && this.allows("ghost") ? a.ghost : u.uFrac;
      u.uBloom = a && this.allows("bloom") ? a.bloom : 0;
      u.uFlash = a ? a.flash : 0;
      u.uLow = role === "hero" ? (a ? a.low : Math.max(0, (this.opts.lowAt - bar.frac) / this.opts.lowAt)) : 0;
      u.uSweep = this.allows("sweep") && (entry.token.hover || entry.token.controlled) ? (a?.sweep ?? 0) : 0;
      u.uHit = a && this.allows("ring") ? a.hit : 0;
      u.uHitX = a ? a.hitX : bar.frac;
      u.uHeal = a ? a.heal : 0;
      u.uTemp = role === "hero" ? r.temp : 0;
      u.uCracked = role === "shield" ? (r.shield?.broken ? 1 : 0) : 0;

      /* The kick displaces the whole quad. A bar whose contents shake inside a
         static frame reads as a texture animating; a bar that moves reads as
         something that was struck. */
      const kick = a && this.allows("kick") ? a.kick : 0;
      mesh.position.x = entry.token.x + kick;
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
    const h = entry.heroH, w = entry.heroW;
    const right = w * (((w / h) - 0.40) / (w / h));
    const mid = h * 0.5;
    const kick = a && this.allows("kick") ? a.kick : 0;
    const heroY = entry.meshes.hero.position.y;

    const value = Math.round((a ? a.frac : r.hero.frac) * r.hero.max);
    const label = value + "/" + r.hero.max;

    if (label !== entry.lastNumber || !entry.textMesh) {
      entry.lastNumber = label;
      const geo = runGeometry([
        { text: String(value), size: h * 0.44 },
        { text: "/", size: h * 0.30 },
        { text: String(r.hero.max), size: h * 0.30 },
      ], { right, mid, skew: SKEW });
      entry.textMesh = this.swapTextMesh(entry, entry.textMesh, geo, [0.97, 0.99, 1.0], 1);
      /* Pivot on the run's own anchor so the punch scales about the number
         rather than throwing it across the bar. */
      entry.textMesh?.pivot.set(right, mid);
    }
    if (entry.textMesh) {
      const punch = 1 + (a && this.allows("punch") ? a.punch : 0);
      entry.textMesh.visible = true;
      entry.textMesh.scale.set(punch);
      entry.textMesh.position.set(entry.token.x + right + kick, heroY + mid);
    }

    /* Floating deltas. "The bar got shorter" is a magnitude you estimate;
       "-42" is one you read. */
    const pop = this.allows("popups") ? a?.popups?.[a.popups.length - 1] : null;
    if (!pop) {
      if (entry.popupMesh) entry.popupMesh.visible = false;
      entry.popupText = null;
      return;
    }

    if (pop.text !== entry.popupText || !entry.popupMesh) {
      entry.popupText = pop.text;
      const geo = runGeometry([{ text: pop.text, size: h * 0.40 }], { right, mid, skew: SKEW });
      entry.popupMesh = this.swapTextMesh(entry, entry.popupMesh, geo,
        pop.heal ? [0.62, 1.0, 0.78] : [1.0, 0.52, 0.48], 1);
      entry.popupMesh?.pivot.set(right, mid);
    }
    if (entry.popupMesh) {
      const e = 1 - Math.pow(1 - pop.t, 2.2);
      const alpha = pop.t < 0.15 ? pop.t / 0.15 : 1 - Math.pow((pop.t - 0.15) / 0.85, 2);
      entry.popupMesh.visible = true;
      entry.popupMesh.shader.uniforms.uOpacity = Math.max(0, alpha);
      entry.popupMesh.position.set(entry.token.x + right - w * 0.02 + kick, heroY + mid - h * 1.15 * e);
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
    if (!mesh) {
      const shader = PIXI.Shader.from(TEXT_VERTEX_SHADER, TEXT_FRAGMENT_SHADER, {
        uAtlas: getAtlas().texture,
        uInk: new Float32Array(ink),
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
    mesh.shader.uniforms.uInk = new Float32Array(ink);
    mesh.shader.uniforms.uOpacity = opacity;
    return mesh;
  }
}

export const host = new BarHost();
