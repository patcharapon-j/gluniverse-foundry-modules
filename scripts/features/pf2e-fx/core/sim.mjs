/**
 * Spellsprite — the simulation. Pure, seeded, stepped at a fixed 120 Hz by the
 * host; one `Sim` is one effect (a cast, a Strike, a condition loop).
 *
 * World units are grid squares: x right, y down (Foundry's axes), z up. A
 * particle is a plain object `{k, x, y, z, vx, vy, vz, g, drag, life, R, ...}`
 * drawn by `DRAW[k]` (core/shapes.mjs). Its layer is the shape's: ground shapes
 * lie in the flat layer, everything else stands.
 *
 * Besides particles a sim holds lights (they light the floor and the creatures
 * near them), hits (the flash, squash and knockback on a creature), hitstop and
 * shake. A host reads those; nothing here touches a token.
 *
 * `sites` are the anchors a 3D host stands its billboards on: every particle is
 * filed under the nearest site when it spawns.
 */

import { rng, hash } from "./rand.mjs";
import { DRAW, FLAT_SHAPES } from "./shapes.mjs";

export const STEP = 1 / 120;

export function lightK(l) {
  const u = l.age / l.life;
  let k = l.swell ? l.k * u : l.k * (1 - u) ** 2;
  if (l.flicker) k *= 0.5 + 0.5 * hash(Math.floor(l.age * 20), 5);
  return k;
}

export function physics(p, dt, s) {
  const k = Math.exp(-p.drag * dt);
  p.vx *= k; p.vy *= k; p.vz *= k; p.vz -= p.g * dt;
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  if (p.z < 0) {
    if (p.onGround) p.onGround(p, s);
    else if (p.bounce && Math.abs(p.vz) > 0.7) { p.z = 0; p.vz = -p.vz * p.bounce; p.vx *= 0.55; p.vy *= 0.55; }
    else { p.z = 0; p.vz = 0; p.vx *= 0.7; p.vy *= 0.7; }
  }
}

export class Sim {
  /**
   * @param {object} spec  the compiled FxSpec (see compile.mjs)
   * @param {number} seed
   */
  constructor(spec, seed) {
    this.spec = spec;
    this.seed = seed >>> 0;
    this.R = rng(this.seed);
    this.t = 0;
    this.parts = [];
    this.lights = [];
    this.cues = [];
    this.emitters = [];
    this.sites = [];
    this.hits = Object.create(null);
    this.freeze = 0;
    this.impact = 0;
    this.shake = 0;
    this.period = 4;
    this.stopped = false;
    this.phases = [];
    /** Names the host has shed (Budget ladder). */
    this.shed = new Set();
    this.take = this.seed % 3;
    this.m = 1;
    /** Where the host draws this sim relative to where it was compiled, in squares (a loop following its creature). */
    this.offset = null;
  }

  rand(a = 0, b = 1) { return a + (b - a) * this.R(); }
  /** Spawn count for a rate over `dt`, with stochastic rounding. */
  count(rate, dt) { return Math.floor(rate * dt + this.R()); }
  seedInt() { return Math.floor(this.R() * 1e6); }

  at(t, fn) { this.cues.push({ at: t, fn }); this.cues.sort((a, b) => a.at - b.at); }
  emit(from, to, fn) { this.emitters.push({ from, to, fn }); }

  site(id, x, y) { if (!this.sites.some((s) => s.id === String(id))) this.sites.push({ id: String(id), x, y }); return this; }
  siteOf(x, y) {
    let best = null, bd = Infinity;
    for (const s of this.sites) { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = s; } }
    return best?.id ?? null;
  }

  add(p) {
    if (this.minorScope) p.minor = true;
    if (p.minor && this.shed.has("minor")) return p;
    p.age = 0; p.vx ??= 0; p.vy ??= 0; p.vz ??= 0; p.z ??= 0; p.g ??= 0; p.drag ??= 0;
    p.layer ??= FLAT_SHAPES.has(p.k) ? "flat" : "stand";
    if (p.debris && this.shed.has("debris")) p.life = Math.min(p.life, 1);
    p.site ??= this.siteOf(p.x, p.y);
    if (!DRAW[p.k]) throw new Error(`Spellsprite: unknown shape "${p.k}"`);
    this.parts.push(p);
    return p;
  }

  light(x, y, z, r, c, k, life, opts = {}) { this.lights.push({ x, y, z, r, c, k, life, age: 0, ...opts }); }

  /** A creature was hit: the host flashes, squashes and knocks it back. */
  hit(id, k, from, R) { if (id) this.hits[id] = { at: this.t, k, from, R }; }
  crit() { this.freeze = 2 / 12; this.impact = 2 / 12; this.shake = Math.max(this.shake, 2 + this.m); }

  /** End a loop: no new particles, no new cues; the effect is done when the last one dies. */
  stop() { this.stopped = true; this.period = this.t; this.emitters = []; this.cues = []; }

  get done() { return this.t >= this.period && !this.parts.some((p) => p.life < 1e8) && !this.lights.some((l) => l.life < 1e8); }

  step(dt = STEP) {
    if (this.freeze > 0) { this.freeze -= dt; this.impact = Math.max(0, this.impact - dt); return; }
    this.shake *= Math.exp(-dt * 10);
    this.t += dt;
    while (this.cues.length && this.cues[0].at <= this.t) this.cues.shift().fn(this);
    if (!this.stopped) for (const e of this.emitters) if (this.t >= e.from && this.t < e.to) e.fn(this, (this.t - e.from) / (e.to - e.from), dt);
    for (const p of this.parts) {
      if (p.wait > 0) { p.wait -= dt; continue; }
      p.age += dt;
      if (p.update) p.update(p, this, dt); else physics(p, dt, this);
    }
    if (this.stopped) for (const p of this.parts) if (p.life >= 1e8) p.life = p.age + 0.6;
    if (this.stopped) for (const l of this.lights) if (l.life >= 1e8) l.life = l.age + 0.4;
    this.parts = this.parts.filter((p) => p.age < p.life);
    for (const l of this.lights) l.age += dt;
    this.lights = this.lights.filter((l) => l.age < l.life);
  }

  /** The light reaching a point on the floor: colour, strength and where it comes from. */
  lightAt(x, y) {
    if (this.offset) { x -= this.offset.x || 0; y -= this.offset.y || 0; }
    let r = 0, g = 0, b = 0, dx = 0, dy = 0, sum = 0;
    for (const l of this.lights) {
      const d = Math.hypot(l.x - x, l.y - y); if (d >= l.r) continue;
      const w = lightK(l) * (1 - d / l.r) ** 2;
      r += l.c[0] * w; g += l.c[1] * w; b += l.c[2] * w; dx += (l.x - x) * w; dy += (l.y - y) * w; sum += w;
    }
    if (sum < 0.05) return null;
    const m = Math.max(r, g, b) || 1;
    return { c: [(r / m) * 255, (g / m) * 255, (b / m) * 255], k: Math.min(1, sum), dx, dy };
  }
}
