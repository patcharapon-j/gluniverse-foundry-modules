/**
 * Hexcrawl renderer — the overlays: region borders, sight boundary, party
 * marker, staged outlines, trail, blight veins, hover.
 *
 * Hairline overlays take a `width` already converted from device pixels; the
 * renderer redraws them when the zoom settles. Pulsing overlays are drawn once
 * and pulse by container alpha alone.
 */

import { BLANK_TERRAIN } from "../constants.mjs";
import { boundaryEdges, unionRange } from "../hex-math.mjs";
import { GEO } from "./style.mjs";
import { dashPoly, dashSegment, flat, inset, seeded } from "./geom.mjs";
import { hexPolys } from "./tiles.mjs";

const ROUND = "round";

/** Sight boundary: dashed outline of the union of the party's sight ranges. */
export function sightEdges(adapter, party) {
  if (!party?.length) return [];
  return boundaryEdges(adapter, unionRange(adapter, party));
}

export function drawSight(g, ctx, edges, width, phase) {
  g.clear();
  if (!edges.length) return;
  const R = ctx.R;
  // A faint wide underlay so the dashes read over bright tiles.
  g.lineStyle({ width: width * 3.4, color: ctx.colors.ink0, alpha: 0.45 });
  for (const e of edges) { g.moveTo(e.a.x, e.a.y); g.lineTo(e.b.x, e.b.y); }
  g.lineStyle({ width: width * 5, color: ctx.colors.accent, alpha: 0.16 });
  for (const e of edges) dashSegment(g, e.a, e.b, R / 3, 0.55, phase);
  g.lineStyle({ width, color: ctx.colors.accentLift, alpha: 0.95 });
  for (const e of edges) dashSegment(g, e.a, e.b, R / 3, 0.55, phase);
}

export function drawParty(g, ctx, party, width) {
  g.clear();
  const R = ctx.R;
  for (const { key } of party ?? []) {
    const { outer } = hexPolys(ctx, key);
    const ring = inset(outer, ctx.adapter.center(key), -0.02);
    g.lineStyle({ width: GEO.partyGlow * R, color: ctx.colors.accent, alpha: 0.22, join: ROUND });
    g.drawPolygon(flat(ring));
    g.lineStyle({ width, color: ctx.colors.accentLift, alpha: 1, join: ROUND });
    g.drawPolygon(flat(ring));
  }
}

export function drawStaged(g, ctx, keys, width) {
  g.clear();
  g.lineStyle({ width, color: ctx.colors.accentLift, alpha: 1 });
  for (const k of keys ?? []) {
    const c = ctx.adapter.center(k);
    const poly = inset(ctx.adapter.vertices(k), c, 0.1);
    dashPoly(g, poly, ctx.R * 0.24, 0.6);
  }
}

/** Dotted trail through the centres of the ordered keys, oldest faintest. */
export function drawTrail(g, ctx, keys) {
  g.clear();
  const n = keys?.length ?? 0;
  if (!n) return;
  const R = ctx.R;
  const pts = keys.map((k) => ctx.adapter.center(k));
  const alphaAt = (f) => 0.2 + 0.75 * f; // f: 0 oldest → 1 newest
  const ring = GEO.trailDot * R * 0.45;
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 1 : i / (n - 1);
    if (i > 0) {
      const a = pts[i - 1], b = pts[i];
      for (const t of [0.25, 0.5, 0.75]) {
        const ft = n === 1 ? 1 : (i - 1 + t) / (n - 1);
        g.lineStyle({ width: ring, color: ctx.colors.ink0, alpha: 0.7 * alphaAt(ft) });
        g.beginFill(ctx.colors.accentLift, alphaAt(ft) * 0.85);
        g.drawCircle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, GEO.trailDot * R * 0.55);
        g.endFill();
      }
    }
    g.lineStyle({ width: ring, color: ctx.colors.ink0, alpha: 0.75 * alphaAt(f) });
    g.beginFill(ctx.colors.accentLift, alphaAt(f));
    g.drawCircle(pts[i].x, pts[i].y, GEO.trailDot * R * 0.9);
    g.endFill();
  }
}

/**
 * Blight veins: 2–3 organic curves per hex, deterministic from the key, all
 * inside the hex's incircle. The whole layer pulses by alpha.
 */
export function veinPaths(ctx, key, { rim = false } = {}) {
  const rnd = seeded(`vein:${key}`);
  const R = ctx.R;
  const c = ctx.adapter.center(key);
  const n = 2 + (rnd() < 0.5 ? 1 : 0);
  const out = [];
  const base = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a0 = base + (i * Math.PI * 2) / n + (rnd() - 0.5) * 0.7;
    const r0 = R * (0.68 + rnd() * 0.08);
    const a1 = a0 + Math.PI * (rim ? 0.28 + rnd() * 0.16 : 0.55 + rnd() * 0.5) * (rnd() < 0.5 ? -1 : 1);
    // On a landmark hex the veins hug the rim and leave the badge clear.
    const r1 = R * (rim ? 0.5 + rnd() * 0.1 : 0.12 + rnd() * 0.22);
    const p0 = { x: c.x + Math.cos(a0) * r0, y: c.y + Math.sin(a0) * r0 };
    const p2 = { x: c.x + Math.cos(a1) * r1, y: c.y + Math.sin(a1) * r1 };
    const am = (a0 + a1) / 2, rm = R * (rim ? 0.62 + rnd() * 0.08 : 0.3 + rnd() * 0.3);
    const p1 = { x: c.x + Math.cos(am) * rm, y: c.y + Math.sin(am) * rm };
    // A short branch off the midpoint of the curve.
    const mx = 0.25 * p0.x + 0.5 * p1.x + 0.25 * p2.x, my = 0.25 * p0.y + 0.5 * p1.y + 0.25 * p2.y;
    const ab = Math.atan2(my - c.y, mx - c.x) + (rnd() - 0.5) * 1.6;
    const lb = R * (0.12 + rnd() * 0.12) * (rim ? 0.5 : 1);
    out.push({ p0, p1, p2, branch: { a: { x: mx, y: my }, b: { x: mx + Math.cos(ab) * lb, y: my + Math.sin(ab) * lb } } });
  }
  return out;
}

export function drawVeins(g, ctx, keys) {
  g.clear();
  const R = ctx.R;
  const all = [];
  // keys: offset keys, or { key, rim } for a hex whose centre must stay clear.
  for (const k of keys) all.push(...(typeof k === "string" ? veinPaths(ctx, k) : veinPaths(ctx, k.key, { rim: k.rim })));
  const pass = (width, color, alpha, round) => {
    g.lineStyle(round ? { width, color, alpha, cap: ROUND } : { width, color, alpha });
    for (const v of all) {
      g.moveTo(v.p0.x, v.p0.y);
      g.quadraticCurveTo(v.p1.x, v.p1.y, v.p2.x, v.p2.y);
      g.moveTo(v.branch.a.x, v.branch.a.y);
      g.lineTo(v.branch.b.x, v.branch.b.y);
    }
  };
  pass(GEO.veinGlow * R, ctx.colors.violet, 0.16, false);
  pass(GEO.veinWidth * R, ctx.colors.violet, 0.95, true);
}

/** Hover: a brighter bevel and a faint veil. */
export function drawHover(g, ctx, key, view, fog) {
  g.clear();
  if (!key || !view) return;
  const R = ctx.R;
  const { outer } = hexPolys(ctx, key);
  g.lineStyle(0);
  g.beginFill(ctx.colors.text, 0.05);
  g.drawPolygon(flat(outer));
  g.endFill();
  if (fog) {
    g.lineStyle({ width: GEO.fogDashWidth * R * 1.4, color: ctx.colors.textDim, alpha: 0.8, join: ROUND });
    g.drawPolygon(flat(outer));
    return;
  }
  const region = view.regionId ? ctx.map.regions[view.regionId]?.color ?? null : null;
  const col = ctx.colors.tile(view.terrain?.color ?? BLANK_TERRAIN.color, { blight: !!view.blight, region });
  g.lineStyle({ width: GEO.bevelWidth * R * 1.35, color: col.hover, alpha: 0.95, join: ROUND });
  g.drawPolygon(flat(outer));
}
