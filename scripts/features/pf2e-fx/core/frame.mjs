/**
 * Spellsprite — paint simulations into pixel layers through a view.
 *
 * A view maps world squares to art pixels of one buffer. Two kinds:
 *
 *   top   the 2D canvas, seen from above. Height lifts a little (`lift`), so a
 *         fireball's arc still reads as an arc.
 *   side  a Diorama billboard: horizontal is the camera's right vector across
 *         the ground, vertical is height; the ground is squashed by `sq`.
 *
 * `paintFrame` fills a `Layers` (core/pix.mjs) and returns nothing; a host
 * uploads the dirty boxes.
 */

import { DRAW } from "./shapes.mjs";
import { lightK } from "./sim.mjs";
import { S } from "./palette.mjs";

/**
 * @param {{ox:number, oy:number, aps:number, lift?:number, lod?:boolean, key?:string}} o
 *   ox, oy: the art pixel of world (0, 0); aps: art pixels per square
 */
export function topView({ ox, oy, aps, lift = 0.2, lod = false, key = "top" }) {
  return {
    kind: "top", key, aps, sq: 1, lod, lift,
    ap: (x, y, z) => [ox + x * aps, oy + y * aps - z * aps * lift],
  };
}

/**
 * A billboard standing at world (cx, cy), facing a camera whose right vector
 * across the ground is (rx, ry) (unit). Art pixel (ax, ay) of the buffer is
 * where (cx, cy, 0) lands.
 */
export function sideView({ cx, cy, rx, ry, ax, ay, aps, sq = 0.35, lod = false, key = "side" }) {
  // forward (away from the camera) is the right vector turned a quarter
  // counter-clockwise on Foundry's y-down floor: right (1,0) looks north (0,-1)
  const fx = ry, fy = -rx;
  return {
    kind: "side", key, aps, sq, lod, lift: 1,
    ap: (x, y, z) => {
      const dx = x - cx, dy = y - cy;
      const across = dx * rx + dy * ry, depth = dx * fx + dy * fy;
      return [ax + across * aps, ay - depth * aps * sq - z * aps];
    },
  };
}

/**
 * Draw every particle of `sims` into `L`.
 * @param {import("./sim.mjs").Sim[]} sims
 * @param {object} v  a view
 * @param {import("./pix.mjs").Layers} L
 * @param {{bright?:boolean, filter?:(p:object)=>boolean, light?:boolean}} [o]
 */
export function paintFrame(sims, v, L, { bright = false, filter = null, light = true } = {}) {
  L.flat.begin(); L.stand.begin(); L.light.begin();
  for (const s of sims) {
    const sv = viewFor(v, s);
    for (const p of s.parts) {
      if (p.wait > 0 || (v.lod && p.minor) || (filter && !filter(p))) continue;
      DRAW[p.k](sv, p.layer === "flat" ? L.flat : L.stand, p, s);
    }
  }
  L.flat.outline(bright ? 1 : 2);
  L.stand.outline(bright ? 1 : 2);
  if (light) for (const s of sims) paintLights(s, viewFor(v, s), L.light, filter);
}

/**
 * A sim can be carried by its creature: a condition loop compiled where the
 * token stood follows it when it moves. The host sets `sim.offset` (squares)
 * and the sim is drawn shifted; its own world never moves.
 */
export function viewFor(v, s) {
  const o = s.offset;
  if (!o || (!o.x && !o.y)) return v;
  const dx = o.x, dy = o.y;
  return { ...v, ap: (x, y, z) => v.ap(x + dx, y + dy, z) };
}

/** Shapes that light the floor around themselves without asking: radius in art px, strength. */
const SHAPE_GLOW = Object.freeze({ spark: { r: 7, k: 0.32 }, streak: { r: 6, k: 0.26 }, ember: { r: 4, k: 0.2 }, glint: { r: 6, k: 0.3 } });
/** Self-lit parts per sim that light at full strength before the shared budget dims them. */
const GLOW_FREE = 10;

export function paintLights(s, v, lit, filter = null) {
  if (s.shed.has("lightBands")) return;
  for (const l of s.lights) {
    if (filter && !filter(l)) continue;
    const k = lightK(l), [fx, fy] = v.ap(l.x, l.y, 0), [lx, ly] = v.ap(l.x, l.y, l.z), rx = l.r * v.aps;
    lit.add(fx, fy, rx, rx * v.sq, l.c, k * 0.9);
    lit.add(lx, ly, rx * 0.42, rx * 0.42, l.c, k * 0.6);
  }
  // every spark and ember carries its own small light (spellsprite-craft: light on everything),
  // but a spray shares one budget: thirty sparks born on one point would otherwise stack into a
  // clipped band-3 blot that hides the hit. Up to GLOW_FREE parts light at full strength; past
  // that each is dimmed by sqrt(free / n), so a crowd reads brighter than one spark, never solid.
  const shedMinor = s.shed.has("minor");
  let n = 0;
  for (const p of s.parts) if (!(p.wait > 0) && !p.glow && SHAPE_GLOW[p.k] && p.R && !(p.minor && shedMinor) && !(filter && !filter(p))) n++;
  const share = n > GLOW_FREE ? Math.sqrt(GLOW_FREE / n) : 1;
  for (const p of s.parts) {
    if (p.wait > 0 || (filter && !filter(p))) continue;
    const pos = p.b ?? [p.x, p.y, p.z], [x, y] = v.ap(...pos), u = p.age / p.life;
    if (p.glow) { const r = (p.r || 3) * 2.6 + 4; lit.add(x, y, r, r, S(p.R, 0.8), 0.5 * (1 - u)); continue; }
    const g = SHAPE_GLOW[p.k];
    if (g && p.R && !(p.minor && shedMinor)) lit.add(x, y, g.r, g.r, S(p.R, 0.85), g.k * share * (1 - u));
  }
}
