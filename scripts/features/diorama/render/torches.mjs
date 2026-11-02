/**
 * Diorama — living light: Foundry's lights flicker, fires burn, figures take
 * the light's direction and throw its shadow. Pure (no game/canvas/foundry): it
 * draws the light sources the bake hands the renderer (view/bake.mjs `sources`).
 *
 * The light bake (setLighting `light`) already holds every light, occluded by
 * walls and height. Nothing here adds light; it shapes the bake:
 *
 *   • Tracked lights. The MAX_TORCHES lights nearest the camera's target go to
 *     every lit material (LIT uTorch*): each one's flicker scales the bake where
 *     the bake is that light's, and its direction shades faces toward it
 *     brighter and faces away darker, flat ground kept exact. A light joining or
 *     leaving the set fades over TIMING.torchFade, so panning never pops.
 *   • Flicker. By the light's own Foundry animation: torch and flame lights
 *     flicker (their speed and intensity), pulse lights breathe, a warm light
 *     with no animation wavers gently, everything else burns steady. The
 *     flicker is smooth value noise on the clock: continuous, never periodic,
 *     so it never snaps (the check holds both).
 *   • Fire. A fire-like light (a torch or flame animation, or a warm light on a
 *     prop named like a brazier, a torch or a hearth) gets a flame and rising
 *     embers at its foot. A light a token carries flickers but draws no flame:
 *     the figure holds it.
 *   • Figure shadows. Each visible standee throws a soft shadow on the ground
 *     away from the one or two tracked lights that light it most, as strong as
 *     that light's share of the light at its foot.
 *
 * Contract with renderer.mjs:
 *   new TorchesLayer(shared)
 *   .group
 *   .setGridSize(px)
 *   .setGround((xCells, zCells) => yCells)   the rules ground (props stamped in)
 *   .setSources(sources, { size, distance }) the bake's light sources (px, distance units)
 *   .setProps(PropState[])                   fire-like props (braziers)
 *   .relayout()                              the ground moved: re-seat the flames
 *   .frame(t, dt, fx, view, standees, pxWorld) → bool   true while anything here moves
 *   .dispose()
 *
 * Cost: three instanced draws (flames, embers, figure shadows), each instance a
 * handful of floats written only when something changed; embers are placed in
 * the vertex shader from a seed and the clock. With lightFx off, or no lights,
 * the uniforms say "the bake alone" and nothing draws.
 */

import * as THREE from "./three.mjs";
import { MATERIALS, MAX_TORCHES } from "./materials.mjs";
import { TIMING } from "../constants.mjs";
import { VIEW_CELLS } from "./camera.mjs";

export { MAX_TORCHES };
/** Most flames drawn (a hall of braziers is a dozen). */
export const MAX_FLAMES = 24;
export const EMBERS_PER_FLAME = 8;
/** Most figure shadows (two lights per figure, a crowded room). */
export const MAX_TORCH_SHADOWS = 48;
/** The darkest a figure's torch shadow gets (its alpha with the torch the only light). */
export const SHADOW_MAX = 0.78;
/** The most a flicker moves a light from steady, either way. */
export const FLICKER_MAX = 0.22;

/** Foundry light animation types that are fire. */
export const FIRE_ANIMATIONS = Object.freeze(["torch", "flame", "fire", "candle", "campfire", "fireplace"]);
/** Foundry light animation types that breathe. */
export const PULSE_ANIMATIONS = Object.freeze(["pulse"]);
/** A prop whose label names a fire makes a warm light on it a fire. */
export const FIRE_PROP = /\b(brazier|braziers|torch|torches|sconce|campfire|bonfire|firepit|fire ?pit|hearth|fireplace|lantern|candles?|candelabra|fire|pyre)\b/i;

/** Lights are held this high above their ground (cells) when they shade: a torch is held, a brazier burns above its bowl. */
const LIGHT_LIFT = 0.6;
/** A token's own light is at about its chest (cells above its elevation). */
const TOKEN_LIGHT_Y = 0.75;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Integer hash → [0, 1). */
function hash1(i, seed) {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1D value noise, -1..1: C1-continuous, never repeats. */
export function valueNoise(x, seed) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i, seed), b = hash1(i + 1, seed);
  return (a + (b - a) * u) * 2 - 1;
}

/** A string → a stable unsigned seed. */
export function seedOf(id) {
  let h = 0x811c9dc5;
  const s = String(id ?? "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** rgb 0..1 → hue in degrees and saturation (HSV). */
function hueSat(rgb) {
  const [r, g, b] = rgb;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (mx <= 0 || d <= 1e-6) return { hue: 0, sat: 0 };
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { hue: ((h * 60) + 360) % 360, sat: d / mx };
}

/** A light colour that reads as firelight: orange to amber, clearly coloured. */
export function isWarm(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return false;
  const { hue, sat } = hueSat(rgb);
  return sat >= 0.25 && hue >= 8 && hue <= 58;
}

/** How much a fire's own colour should recolour its flame: 0 for firelight, most of the way for a coloured one. */
export function flameRecolor(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return 0;
  const { hue, sat } = hueSat(rgb);
  if (sat < 0.3) return 0;
  return hue >= 0 && hue <= 62 ? 0 : 0.85;
}

/**
 * What a light does: "fire" (flickers, burns), "pulse" (breathes), "warm"
 * (wavers gently), or "steady". A Foundry animation other than these keeps
 * Foundry's own look on the 2D canvas and burns steady here.
 * @param {{anim?:{type?:string|null}, color?:number[]|null, x:number, z:number}} src  cells
 * @param {Array<{x:number,y:number,w?:number,d?:number,label?:string,ghost?:boolean}>} [props]
 */
export function lightKind(src, props = []) {
  const type = String(src?.anim?.type ?? "").toLowerCase();
  if (FIRE_ANIMATIONS.includes(type)) return "fire";
  if (PULSE_ANIMATIONS.includes(type)) return "pulse";
  if (type) return "steady";
  if (!isWarm(src?.color)) return "steady";
  return fireProp(src, props) ? "fire" : "warm";
}

/** The fire-named prop a light stands on or in, if any. */
export function fireProp(src, props = []) {
  for (const p of props ?? []) {
    if (!p || p.ghost || !FIRE_PROP.test(String(p.label ?? ""))) continue;
    const reach = Math.max(0.5, Math.max(Number(p.w) || 1, Number(p.d) || 1) * 0.6);
    if (Math.hypot(src.x - p.x, src.z - p.y) <= reach) return p;
  }
  return null;
}

/**
 * The light's flicker multiplier at clock time t (ms): 1 = steady. Fire's
 * noise steps follow Foundry's speed (1..10, 5 the default) and its depth the
 * intensity (1..10); always within 1 ± FLICKER_MAX.
 */
export function flicker(kind, t, seed = 0, speed = 5, intensity = 5) {
  const sp = Math.min(10, Math.max(1, Number(speed) || 5)) / 5;
  const it = Math.min(10, Math.max(1, Number(intensity) || 5));
  if (kind === "fire") {
    const step = TIMING.flickerStep / Math.pow(sp, 0.6);
    const amp = Math.min(FLICKER_MAX, 0.06 + 0.016 * it);
    return 1 + amp * (0.68 * valueNoise(t / step, seed) + 0.32 * valueNoise(t / (step * 0.41) + 7.3, seed ^ 0x9e37));
  }
  if (kind === "warm") {
    const step = TIMING.flickerGentle;
    return 1 + 0.045 * (0.8 * valueNoise(t / step, seed) + 0.2 * valueNoise(t / (step * 0.37) + 3.1, seed ^ 0x51ed));
  }
  if (kind === "pulse") {
    const period = TIMING.lightPulse / sp;
    const amp = Math.min(FLICKER_MAX, 0.04 + 0.012 * it);
    return 1 + amp * Math.sin((t / period + (seed % 1000) / 1000) * Math.PI * 2);
  }
  return 1;
}

/**
 * A bake source (view/bake.mjs) → cells. Total: anything without a position
 * or a radius is dropped (null).
 * @param {object} raw  { id, x, y (px), elevation (distance units), dim, bright (px),
 *                       tint:[r,g,b] 0..1, color:[r,g,b]|null, anim:{type,speed,intensity}, token }
 * @param {{size:number, distance:number}} grid
 */
export function normalizeSource(raw, grid) {
  const S = Number(grid?.size) > 0 ? Number(grid.size) : 100;
  const D = Number(grid?.distance) > 0 ? Number(grid.distance) : 5;
  const x = Number(raw?.x) / S, z = Number(raw?.y) / S;
  const dim = Math.max(Number(raw?.dim) || 0, Number(raw?.bright) || 0) / S;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(dim > 0)) return null;
  const bright = Math.max(0, Math.min(dim, (Number(raw?.bright) || 0) / S));
  const tint = Array.isArray(raw?.tint) && raw.tint.length >= 3 ? raw.tint.slice(0, 3).map((v) => clamp01(Number(v) || 0)) : [1, 1, 1];
  const color = Array.isArray(raw?.color) && raw.color.length >= 3 ? raw.color.slice(0, 3).map((v) => clamp01(Number(v) || 0)) : null;
  const id = String(raw?.id ?? `${x.toFixed(2)},${z.toFixed(2)}`);
  return {
    id, x, z, dim, brightFrac: dim > 0 ? Math.min(0.999, bright / dim) : 0,
    elev: (Number(raw?.elevation) || 0) / D,
    tint, color, token: !!raw?.token, seed: seedOf(id),
    anim: { type: raw?.anim?.type ?? null, speed: Number(raw?.anim?.speed ?? 5), intensity: Number(raw?.anim?.intensity ?? 5) },
  };
}

/**
 * The lights that shade now: the nearest to the camera's target, by distance
 * over reach (a big light far off still counts), at most `max`.
 */
export function pickTorches(lights, focus, max = MAX_TORCHES) {
  const fx = Number(focus?.x) || 0, fz = Number(focus?.z) || 0;
  return [...(lights ?? [])]
    .map((l) => ({ l, s: Math.hypot(l.x - fx, l.z - fz) / (l.dim + 2) - 0.05 * luma(l.tint) }))
    .sort((a, b) => a.s - b.s || (a.l.id < b.l.id ? -1 : 1))
    .slice(0, max)
    .map((e) => e.l);
}

function instanced(count, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(attrs.quad), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const out = {};
  for (const [name, size] of Object.entries(attrs.per)) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    out[name] = a;
  }
  g.instanceCount = 0;
  return { g, a: out };
}

const quad = (x0, x1, y0, y1) => [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0];

export class TorchesLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.torches";
    this.gridSize = 100;
    this.grid = { size: 100, distance: 5 };
    this.ground = () => 0;
    this.lights = [];
    this.props = [];
    /** id → presence 0..1 among the tracked lights */
    this.presence = new Map();
    this.slots = [];
    this.flameClock = { value: 0 };
    this.px = { value: 0.01 };
    this._layoutDirty = true;
    this._focus = { x: 0, z: 0 };
    this._picked = [];
    this._pickedAt = null;

    const f = instanced(MAX_FLAMES, { quad: quad(-1, 1, -0.25, 1), per: { aFlame: 4, aFire: 4, aSeed: 2 } });
    this.flameGeo = f.g; this.flameAttr = f.a;
    this.flames = new THREE.Mesh(this.flameGeo, MATERIALS.flame(shared, { clock: this.flameClock }));
    this.flames.name = "dio.flames";
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 26;

    const nE = MAX_FLAMES * EMBERS_PER_FLAME;
    const e = instanced(nE, { quad: quad(0, 1, 0, 1), per: { aBase: 4, aSeed: 4 } });
    this.emberGeo = e.g; this.emberAttr = e.a;
    // a fixed seed per spark slot, so a fire's sparks never reshuffle
    let s = 0x2f1e;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const seeds = this.emberAttr.aSeed.array;
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    this.emberAttr.aSeed.needsUpdate = true;
    this.embers = new THREE.Mesh(this.emberGeo, MATERIALS.ember(shared, { px: this.px }));
    this.embers.name = "dio.embers";
    this.embers.frustumCulled = false;
    this.embers.renderOrder = 27;

    const sh = instanced(MAX_TORCH_SHADOWS, { quad: quad(-1, 1, -0.3, 1), per: { aFoot: 4, aDir: 4 } });
    this.shadowGeo = sh.g; this.shadowAttr = sh.a;
    this.shadows = new THREE.Mesh(this.shadowGeo, MATERIALS.torchShadow(shared));
    this.shadows.name = "dio.torchShadows";
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 4;

    // Always in the scene so every program compiles with the first frame.
    this.group.add(this.shadows, this.flames, this.embers);
    this.fires = [];
  }

  setGridSize(px) { this.gridSize = px || 100; }

  /** @param {(x:number, z:number) => number} fn  ground height (cells) under a point (cells) */
  setGround(fn) { this.ground = typeof fn === "function" ? fn : () => 0; this._layoutDirty = true; }

  /** The ground or the props moved: seat the flames again on the next frame. */
  relayout() { this._layoutDirty = true; }

  /** @param {object[]} props PropState[] (terrain/props.mjs propStates) */
  setProps(props) {
    this.props = Array.isArray(props) ? props : [];
    this.lights.forEach((l) => { l.kind = lightKind(l, this.props); });
    this._layoutDirty = true;
  }

  /**
   * @param {object[]|null} sources  view/bake.mjs light sources
   * @param {{size:number, distance:number}} grid
   */
  setSources(sources, grid) {
    if (grid) this.grid = { size: Number(grid.size) || 100, distance: Number(grid.distance) || 5 };
    const list = [];
    for (const raw of Array.isArray(sources) ? sources : []) {
      const l = normalizeSource(raw, this.grid);
      if (l) { l.kind = lightKind(l, this.props); list.push(l); }
    }
    this.lights = list;
    this._pickedAt = null;
    this._layoutDirty = true;
  }

  /** Where a light shades from, and where its flame stands (cells). */
  seat(l) {
    const g = Number(this.ground(l.x, l.z)) || 0;
    if (l.token) return { y: l.elev + TOKEN_LIGHT_Y, foot: null };
    const prop = l.kind === "fire" ? fireProp(l, this.props) : null;
    // a brazier that is not solid is not in the rules ground: stand on its top
    const top = prop ? Math.max(g, (Number(prop.base) || 0) + (Number(prop.h) || 0)) : g;
    // Foundry's elevation is absolute, like a token's: a light at 0 on a plateau burns on the plateau
    const foot = Math.max(top, l.elev);
    const size = prop ? Math.min(0.9, Math.max(0.26, Math.max(Number(prop.w) || 0.5, Number(prop.d) || 0.5) * 0.5))
      : Math.min(0.6, Math.max(0.26, 0.2 * Math.sqrt(l.dim)));
    return { y: Math.max(foot + 0.25, Math.max(g, l.elev) + LIGHT_LIFT), foot, size };
  }

  layout() {
    this._layoutDirty = false;
    this.fires = [];
    for (const l of this.lights) {
      const s = this.seat(l);
      l.y = s.y;
      if (l.kind === "fire" && s.foot !== null && this.fires.length < MAX_FLAMES) this.fires.push({ l, foot: s.foot, size: s.size });
    }
    const F = this.flameAttr, E = this.emberAttr;
    this.fires.forEach((f, i) => {
      F.aFlame.array.set([f.l.x, f.foot, f.l.z, f.size], i * 4);
      F.aSeed.array.set([(f.l.seed % 997) / 997, flameRecolor(f.l.color)], i * 2);
      for (let k = 0; k < EMBERS_PER_FLAME; k++) E.aBase.array.set([f.l.x, f.foot, f.l.z, f.size], (i * EMBERS_PER_FLAME + k) * 4);
    });
    F.aFlame.needsUpdate = F.aSeed.needsUpdate = E.aBase.needsUpdate = true;
  }

  /** Any light that moves on its own (flicker), and any fire. */
  get lively() {
    return this.lights.some((l) => l.kind !== "steady");
  }

  /**
   * Per frame: pick and fade the tracked lights, write their uniforms, flicker,
   * flames, embers and figure shadows.
   * @param {number} t   clock ms
   * @param {number} dt  seconds since the last frame
   * @param {object} fx  the renderer's effectiveFx(): lightFx, flicker, embers, torchShadows
   * @param {{tx:number, tz:number, zoom:number}|null} view
   * @param {{entries?:Map<string, any>}|null} standees
   * @param {number} [pxWorld]  one device pixel in cells
   * @returns {boolean} true while something here moves
   */
  frame(t, dt, fx, view, standees, pxWorld) {
    const u = this.shared;
    if (pxWorld > 0) this.px.value = pxWorld;
    const on = !!fx?.lightFx && this.lights.length > 0;
    if (!on) {
      u.uTorchCount.value = 0;
      u.uTorchDir.value = 0;
      this.flameGeo.instanceCount = this.emberGeo.instanceCount = this.shadowGeo.instanceCount = 0;
      this.presence.clear();
      this.slots = [];
      return false;
    }
    if (this._layoutDirty) this.layout();
    let active = false;

    // ---- which lights shade: picked when the focus has moved a cell or the lights changed
    const fz = { x: view?.tx ?? 0, z: view?.tz ?? 0 };
    if (!this._pickedAt || Math.hypot(fz.x - this._pickedAt.x, fz.z - this._pickedAt.z) > 1) {
      this._picked = pickTorches(this.lights, fz, MAX_TORCHES);
      this._pickedAt = fz;
    }
    const want = new Set(this._picked.map((l) => l.id));
    const step = TIMING.torchFade > 0 ? (dt * 1000) / TIMING.torchFade : 1;
    const byId = new Map(this.lights.map((l) => [l.id, l]));
    for (const l of this._picked) if (!this.presence.has(l.id)) this.presence.set(l.id, this._drawnOnce ? 0 : 1);
    for (const [id, p] of this.presence) {
      if (!byId.has(id)) { this.presence.delete(id); continue; }
      const goal = want.has(id) ? 1 : 0;
      const np = goal > p ? Math.min(1, p + step) : goal < p ? Math.max(0, p - step) : p;
      if (np !== goal) active = true;
      if (np <= 0 && goal === 0) this.presence.delete(id); else this.presence.set(id, np);
    }
    this._drawnOnce = true;
    // the wanted ones first, then those still fading out, as room allows
    const slots = [...this._picked, ...[...this.presence.keys()].filter((id) => !want.has(id)).map((id) => byId.get(id))]
      .filter(Boolean).slice(0, MAX_TORCHES);
    this.slots = slots;

    // ---- uniforms
    const flick = fx.flicker !== false;
    const near = (l) => {
      const R = VIEW_CELLS / Math.max(0.05, view?.zoom ?? 1);
      return Math.hypot(l.x - fz.x, l.z - fz.z) < R + l.dim;
    };
    slots.forEach((l, i) => {
      const p = this.presence.get(l.id) ?? 0;
      const f = flick ? flicker(l.kind, t, l.seed, l.anim.speed, l.anim.intensity) : 1;
      l.f = f;
      u.uTorchPos.value[i].set(l.x, l.y ?? LIGHT_LIFT, l.z, l.dim);
      u.uTorchCol.value[i].set(l.tint[0], l.tint[1], l.tint[2], 1 + p * (f - 1));
      u.uTorchInfo.value[i].set(l.brightFrac, p);
      if (flick && l.kind !== "steady" && near(l)) active = true;
    });
    u.uTorchCount.value = slots.length;
    u.uTorchDir.value = fx.torchShadows !== false ? 1 : 0;

    // ---- flames and embers
    const F = this.flameAttr;
    this.fires.forEach((fire, i) => {
      const f = flick ? flicker("fire", t, fire.l.seed, fire.l.anim.speed, fire.l.anim.intensity) : 1;
      F.aFire.array.set([fire.l.tint[0], fire.l.tint[1], fire.l.tint[2], f], i * 4);
      if (flick && near(fire.l)) active = true;
    });
    F.aFire.needsUpdate = true;
    this.flameGeo.instanceCount = this.fires.length;
    if (flick) this.flameClock.value += (dt * 1000) / TIMING.flameLick;
    const embers = fx.embers !== false && this.fires.length > 0;
    this.emberGeo.instanceCount = embers ? this.fires.length * EMBERS_PER_FLAME : 0;
    if (embers) {
      this.embers.material.uniforms.uEmberT.value += (dt * 1000) / TIMING.emberRise;
      if (this.fires.some(near)) active = true;
    }

    // ---- figure shadows
    this.shadowGeo.instanceCount = fx.torchShadows !== false ? this.writeShadows(slots, standees) : 0;
    return active;
  }

  /** Each visible standee's shadow from its one or two strongest tracked lights. @returns {number} instances */
  writeShadows(slots, standees) {
    const entries = standees?.entries;
    if (!entries || !slots.length) return 0;
    const A = this.shadowAttr;
    const amb = Number(this.shared.uAmbient?.value ?? 1);
    let n = 0;
    const best = [];
    for (const e of entries.values()) {
      if (n >= MAX_TORCH_SHADOWS) break;
      const st = e?.state;
      const root = e?.root;
      if (!root?.visible || !st || st.ghost || st.visible === false) continue;
      const foot = root.position;
      const groundY = Number.isFinite(Number(st.groundQ)) ? Number(st.groundQ) / 4 : foot.y;
      if (foot.y - groundY > 0.2) continue;   // a flyer: its stand and contact shadow say where it is
      const h = Number(e.cardH) > 0 ? Number(e.cardH) : 1.2;
      const w = Math.max(0.12, (Number(st.widthCells) || 1) * 0.3);
      best.length = 0;
      for (const l of slots) {
        const dx = foot.x - l.x, dz = foot.z - l.z;
        const dist = Math.hypot(dx, dz);
        const x = dist / Math.max(l.dim, 0.05);
        if (x >= 1 || dist < 0.08) continue;
        const k = x <= l.brightFrac ? 1 : 1 - smooth01((x - l.brightFrac) / Math.max(1e-3, 1 - l.brightFrac));
        const c = luma(l.tint) * k * (this.presence.get(l.id) ?? 0) * (l.f ?? 1);
        if (c > 0.01) best.push({ l, c, dx, dz, dist });
      }
      best.sort((a, b) => b.c - a.c);
      for (const b of best.slice(0, 2)) {
        if (n >= MAX_TORCH_SHADOWS) break;
        const share = b.c / (b.c + 0.45 * amb + 0.04);
        const rise = Math.max(0.25, (b.l.y ?? LIGHT_LIFT) - foot.y);
        const len = Math.min(2.6, Math.max(0.6, (h * b.dist) / rise * 0.7));
        const alpha = SHADOW_MAX * share * Math.min(1, b.dist / 0.4);
        A.aFoot.array.set([foot.x, foot.y, foot.z, len], n * 4);
        A.aDir.array.set([b.dx / b.dist, b.dz / b.dist, w, alpha], n * 4);
        n++;
      }
    }
    A.aFoot.needsUpdate = A.aDir.needsUpdate = true;
    return n;
  }

  dispose() {
    this.group.remove(this.flames, this.embers, this.shadows);
    for (const m of [this.flames, this.embers, this.shadows]) { m.geometry.dispose(); m.material.dispose(); }
  }
}

function smooth01(x) {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}
