/**
 * Diorama — Spellsprite (feature `pf2e-fx`) effects mirrored into 3D.
 *
 * Spellsprite's Director steps every running effect (a Sim, pf2e-fx/core/sim.mjs)
 * whether or not this view is open. This mirror only PAINTS them, once per
 * drawn frame, from the camera the renderer hands it (render/renderer.mjs
 * setPixelSource), so the same simulation reads the same in 2D and 3D and is
 * never stepped twice.
 *
 * Per running sim:
 *   - one top-down paint (flat layer + light layer) laid on the ground as a
 *     `pixel-flat` decal and an additive `pixel-light` pool; its lights also join
 *     the effect point lights, which light the standees standing in them;
 *   - per site (`sim.sites`: the caster, each target, the area), one side paint
 *     of the standing particles filed under that site, projected exactly as the
 *     orthographic camera would (across × right, depth × sin pitch, height ×
 *     cos pitch), stood on the site as a `pixel-standing` billboard.
 * A loop that follows its creature carries `sim.offset` (squares): the sites
 * move by it, and `paintFrame` (core/frame.mjs viewFor) moves the particles.
 *
 * Art scale: one art pixel is k whole device pixels, k = round(device px per
 * cell / ART_PER_SQUARE), so a standing billboard is pixel-crisp at any zoom.
 *
 * Creatures react through `react(id, x, z)` (render/standees.mjs
 * setReactions): the flash, squash and knockback of `sim.hits`, and the tint
 * of `sim.lightAt`. The shake is the camera's (render/camera.mjs setShake).
 *
 * Sim units are grid squares from the scene's origin, as Diorama's cells are
 * (x = px / grid size). The api is optional: with the feature off, missing, or
 * throwing, nothing is drawn and nothing costs a frame.
 *
 * Everything but `fxApi` / `onFxChange` is pure (no `game`), so the preview
 * page drives this file with its own stand-in Director.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { Pix, Light } from "../../pf2e-fx/core/pix.mjs";
import { paintFrame } from "../../pf2e-fx/core/frame.mjs";
import { LayerCanvas } from "../../pf2e-fx/core/blit.mjs";
import { lightK } from "../../pf2e-fx/core/sim.mjs";
import { S as shadeOf } from "../../pf2e-fx/core/palette.mjs";
import { ART_PER_SQUARE } from "../../pf2e-fx/constants.mjs";

export const FX_FEATURE = "pf2e-fx";
export const FX_HOOK = "gluniverse.fx.changed";

/** The side scratch: wide enough for a bolt crossing a dozen squares; the anchor sits low (most of an effect stands above it). */
export const SIDE = Object.freeze({ w: 1024, h: 768, ax: 512, ay: 560 });
/** The top scratch, centred on the sim's sites. */
export const TOP = 1024;
/** How long a struck creature reacts (s, sim time), its flash frames per second, and how strongly the light tints it. */
export const REACT = Object.freeze({ span: 0.7, fps: 12, flashFrames: 4, tint: 0.14, tintMax: 0.22, light: 0.7 });

const IDLE = Object.freeze({ live: false, effects: [], react: null, shake: null });

/**
 * The pf2e-fx api, or null (feature off, not loaded, or no `sims`). Fails closed.
 * @returns {{sims:(sceneId?:string) => object[], onChange?:Function}|null}
 */
export function fxApi() {
  try {
    const api = globalThis.game?.modules?.get?.(SUITE_ID)?.api?.features?.[FX_FEATURE];
    return api && typeof api.sims === "function" ? api : null;
  } catch {
    return null;
  }
}

/** Call `fn` when the running set changes (the hook, and the api's own listener if it has one). @returns unsubscribe */
export function onFxChange(fn) {
  const offs = [];
  try {
    if (typeof Hooks !== "undefined") { const id = Hooks.on(FX_HOOK, () => fn()); offs.push(() => Hooks.off(FX_HOOK, id)); }
  } catch { /* no hooks */ }
  try {
    const off = fxApi()?.onChange?.(() => fn());
    if (typeof off === "function") offs.push(off);
  } catch { /* no listener */ }
  return () => { for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } } };
}

/** Art pixels per cell for a camera at `pxWorld` cells per device px: one art pixel = k device px. */
export function artScale(pxWorld, art = ART_PER_SQUARE) {
  const ppc = 1 / Math.max(1e-6, Number(pxWorld) || 0.01);
  const k = Math.max(1, Math.round(ppc / art));
  return { k, aps: ppc / k, ppc };
}

/**
 * The view that stands a billboard on world (cx, cy) (squares): the
 * orthographic camera's own projection, relative to that point.
 */
export function cameraSideView({ cx, cy, rx, ry, fx, fy, pitch, aps, lod = false, key = "dio" }) {
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  return {
    kind: "side", key, aps, sq: sp, lod, lift: 1,
    ap: (x, y, z) => {
      const dx = x - cx, dy = y - cy;
      return [SIDE.ax + (dx * rx + dy * ry) * aps, SIDE.ay - ((dx * fx + dy * fy) * sp + z * cp) * aps];
    },
  };
}

/** The top-down view a ground decal is painted through, centred on (cx, cy). */
export function groundView({ cx, cy, aps, lod = false, key = "dio-top" }) {
  return { kind: "top", key, aps, sq: 1, lod, lift: 0, ap: (x, y) => [TOP / 2 + (x - cx) * aps, TOP / 2 + (y - cy) * aps] };
}

const validSim = (s) => s && Array.isArray(s.parts) && Array.isArray(s.lights) && s.shed instanceof Set;

/** A struck creature's reaction to one hit at `d` s after it, or null (preview drawTokens' rule). */
export function hitReaction(hit, d, x, z) {
  if (!hit || !(d >= 0) || d >= REACT.span) return null;
  const k = Number(hit.k) || 1;
  const hx = Number(hit.from?.x), hz = Number(hit.from?.y);
  const fx = Number.isFinite(hx) ? x - hx : 0, fz = Number.isFinite(hz) ? z - hz : 0, fl = Math.hypot(fx, fz);
  const kb = 0.12 * Math.min(1.5, k) * Math.exp(-d * 9);
  const squash = 0.2 * Math.min(1.4, k) * Math.exp(-d * 10) * Math.cos(d * 32);
  const fr = Math.floor(d * REACT.fps);
  let flash = null;
  if (fr === 0) flash = [1, 1, 1, 0.85];
  else if (fr < REACT.flashFrames && Array.isArray(hit.R)) {
    const c = shadeOf(hit.R, 0.9);
    flash = [c[0] / 255, c[1] / 255, c[2] / 255, 0.6 * (1 - fr / REACT.flashFrames)];
  }
  return { dx: fl > 1e-6 ? (fx / fl) * kb : 0, dz: fl > 1e-6 ? (fz / fl) * kb : 0, squash, flash };
}

export class SpellspriteMirror {
  /**
   * @param {object} o
   * @param {() => object[]} o.sims  the running sims, [{ key, sim }] (fxApi().sims(sceneId))
   * @param {(x:number, y:number) => number} o.groundQ  the ground at a scene point (px) in q
   * @param {() => boolean} [o.bright]  a bright floor: every shape outlined
   * @param {((siteId:string) => boolean)|null} [o.siteSeen]  whether a site's creature is on this
   *   viewer's board; an unseen one's billboard is not drawn (a GM's "view as players")
   */
  constructor({ sims, groundQ, bright = () => false, siteSeen = null } = {}) {
    this.sims = typeof sims === "function" ? sims : () => [];
    this.groundQ = typeof groundQ === "function" ? groundQ : () => 0;
    this.bright = bright;
    this.siteSeen = typeof siteSeen === "function" ? siteSeen : null;
    /** key → { flat, light, stands: Map(siteId → LayerCanvas), seen } */
    this.entries = new Map();
    this.side = null;
    this.top = null;
    this._stamp = 0;
  }

  /** The running sims, validated. Fails closed to none. */
  list() {
    let raw;
    try { raw = this.sims(); } catch { raw = null; }
    return Array.isArray(raw) ? raw.filter((r) => r && r.key != null && validSim(r.sim)) : [];
  }

  scratch() {
    // A painted layer that is never shown is a 1×1 buffer: everything it is handed is clipped.
    this.side ??= { flat: new Pix(1, 1), stand: new Pix(SIDE.w, SIDE.h), light: new Light(1, 1) };
    this.top ??= { flat: new Pix(TOP, TOP), stand: new Pix(1, 1), light: new Light(TOP, TOP) };
  }

  entry(key) {
    let e = this.entries.get(key);
    if (!e) { e = { flat: new LayerCanvas(), light: new LayerCanvas(), stands: new Map(), seen: 0 }; this.entries.set(key, e); }
    return e;
  }

  /**
   * One frame, for the renderer (render/renderer.mjs setPixelSource).
   * @param {{rx:number, ry:number, fx:number, fy:number, pitch:number, pxWorld:number, size:number, now:number}} view
   */
  frame(view) {
    const list = this.list();
    if (!list.length) {
      if (this.entries.size) this.entries.clear();
      return IDLE;
    }
    this.scratch();
    const stamp = ++this._stamp;
    const size = Number(view.size) || 100;
    const { aps, ppc } = artScale(view.pxWorld);
    const lod = ppc < ART_PER_SQUARE * 1.5;
    const bright = !!this.bright?.();
    const states = [];
    let shake = 0;
    for (const { key, sim } of list) {
      const e = this.entry(key);
      e.seen = stamp;
      const ox = Number(sim.offset?.x) || 0, oy = Number(sim.offset?.y) || 0;
      const sites = sim.sites?.length ? sim.sites : [{ id: null, x: 0, y: 0 }];
      let cx = 0, cy = 0;
      for (const s of sites) { cx += s.x; cy += s.y; }
      cx = cx / sites.length + ox; cy = cy / sites.length + oy;

      // the ground: decals and the light pool, top-down (stand-layer shapes skipped, glows kept)
      const T = this.top;
      paintFrame([sim], groundView({ cx, cy, aps, lod }), T, { bright, light: true, filter: (p) => p.layer !== "stand" || !!p.glow });
      e.flat.update(T.flat, (out, stride, box) => T.flat.toRGBA(out, stride, box));
      e.light.update(T.light, (out, stride, box) => T.light.toRGBA(out, stride, box, false));
      const gq = this.groundQ(cx * size, cy * size);
      const anchor = { ax: TOP / 2, ay: TOP / 2 };
      const at = { x: cx * size, y: cy * size, zQ: gq };
      if (!e.flat.empty) states.push({ id: `${key}:flat`, kind: "pixel-flat", source: e.flat.canvas, version: e.flat.version, box: boxOf(e.flat), aps, anchor, ...at });
      const lights = sim.shed.has("tokenLight") ? [] : sim.lights.map((l) => ({
        x: (l.x + ox) * size, y: (l.y + oy) * size, zQ: gq, z: Number(l.z) || 0, r: l.r * size,
        color: [l.c[0] / 255, l.c[1] / 255, l.c[2] / 255], k: lightK(l) * REACT.light,
      }));
      if (!e.light.empty || lights.length) {
        states.push({ id: `${key}:light`, kind: "pixel-light", source: e.light.canvas, version: e.light.version, box: e.light.empty ? { x: 0, y: 0, w: 0, h: 0 } : boxOf(e.light), aps, anchor, ...at, lights });
      }

      // standing: one billboard per site, its own particles only
      const live = new Set();
      for (const site of sites) {
        const sx = site.x + ox, sy = site.y + oy, id = site.id ?? "_";
        if (site.id != null && this.siteSeen && !this.siteSeen(site.id)) continue;
        live.add(id);
        const v = cameraSideView({ cx: sx, cy: sy, rx: view.rx, ry: view.ry, fx: view.fx, fy: view.fy, pitch: view.pitch, aps, lod, key: `dio:${id}` });
        const filter = site.id == null ? (p) => p.layer !== "flat" : (p) => p.layer !== "flat" && p.site === site.id;
        paintFrame([sim], v, this.side, { bright, light: false, filter });
        let lc = e.stands.get(id);
        if (!lc) { lc = new LayerCanvas(); e.stands.set(id, lc); }
        lc.update(this.side.stand, (out, stride, box) => this.side.stand.toRGBA(out, stride, box));
        if (lc.empty) continue;
        states.push({ id: `${key}:stand:${id}`, kind: "pixel-standing", source: lc.canvas, version: lc.version, box: boxOf(lc), aps,
          anchor: { ax: SIDE.ax, ay: SIDE.ay }, x: sx * size, y: sy * size, zQ: this.groundQ(sx * size, sy * size) });
      }
      for (const id of [...e.stands.keys()]) if (!live.has(id)) e.stands.delete(id);
      if (!sim.shed.has("shake") && sim.shake > 0.3) shake = Math.max(shake, sim.shake);
    }
    for (const [key, e] of this.entries) if (e.seen !== stamp) this.entries.delete(key);

    const now = Number(view.now) || 0;
    // whole art pixels, as the 2D canvas shakes
    const sh = shake ? { x: Math.round(Math.sin(now * 0.09) * shake) / aps, y: Math.round(Math.cos(now * 0.071) * shake * 0.6) / aps } : null;
    return { live: true, effects: states, react: reactor(list), shake: sh };
  }

  dispose() {
    this.entries.clear();
    this.side = null;
    this.top = null;
  }
}

const boxOf = (lc) => ({ x: lc.x, y: lc.y, w: lc.w, h: lc.h });

/** The per-figure reaction for this frame's sims: hits (flash, squash, knockback) and the light on it. */
function reactor(list) {
  return (id, x, z) => {
    let out = null, tr = 0, tg = 0, tb = 0, ta = 0;
    for (const { sim } of list) {
      const h = sim.hits?.[id];
      const r = h ? hitReaction(h, sim.t - h.at, x, z) : null;
      if (r) {
        out ??= { dx: 0, dz: 0, squash: 0, flash: null, tint: null };
        out.dx += r.dx; out.dz += r.dz;
        if (Math.abs(r.squash) > Math.abs(out.squash)) out.squash = r.squash;
        if (r.flash && (!out.flash || r.flash[3] > out.flash[3])) out.flash = r.flash;
      }
      if (sim.shed.has("tokenLight")) continue;
      let L = null;
      try { L = sim.lightAt(x, z); } catch { L = null; }
      if (!L) continue;
      const a = L.k * REACT.tint;
      tr += (L.c[0] / 255) * a; tg += (L.c[1] / 255) * a; tb += (L.c[2] / 255) * a; ta += a;
    }
    if (ta > 0.01) {
      out ??= { dx: 0, dz: 0, squash: 0, flash: null, tint: null };
      // colour normalised, strength carried in a
      out.tint = [tr / ta, tg / ta, tb / ta, Math.min(REACT.tintMax, ta)];
    }
    return out;
  };
}
