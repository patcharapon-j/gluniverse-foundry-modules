/**
 * Hexcrawl renderer — the hex template.
 *
 * Every hex on a Foundry hex grid is the same hexagon translated, so the
 * polygons, the fog and mask dashes and the flattened glyph polylines are
 * computed ONCE, relative to a hex centre, and every draw is a translation.
 * That is the difference between a 2,400-hex rebuild that fits in a frame
 * budget and one that does not: curve maths and inset maths per hex, per
 * rebuild, was most of the cost.
 */

import { parseGlyph, GLYPHS } from "../glyphs.mjs";
import { GEO } from "./style.mjs";
import { QMARK, inset } from "./geom.mjs";

/** Dash period along an edge, in R (the fog survey line and the mask line). */
export const FOG_DASH = Object.freeze({ period: 0.34, duty: 0.52 });
const CURVE_STEPS = 8;
const SIN60 = Math.sqrt(3) / 2;

/**
 * One point per vertex of a hex whose boundary edges (bit e of `mask` = edge e,
 * rel[e] → rel[e+1]) are pushed `d` inwards. Vertex i sits between edge i-1 and
 * edge i: both boundary → the inset corner; one boundary → the point on the
 * OTHER (interior) edge at distance d from the boundary line, which is exactly
 * where the neighbour in the same region puts its own point, so outlines and
 * rims run on across hexes without a join.
 */
function offsetPoints(rel, mask, d) {
  const t = d / SIN60;
  return rel.map((V, i) => {
    const bPrev = (mask >> ((i + 5) % 6)) & 1, bNext = (mask >> i) & 1;
    if (!bPrev && !bNext) return { x: V.x, y: V.y };
    if (bPrev && bNext) { const L = Math.hypot(V.x, V.y); return { x: V.x - (V.x / L) * t, y: V.y - (V.y / L) * t }; }
    const o = bPrev ? rel[(i + 1) % 6] : rel[(i + 5) % 6];
    const dx = o.x - V.x, dy = o.y - V.y, L = Math.hypot(dx, dy);
    return { x: V.x + (dx / L) * t, y: V.y + (dy / L) * t };
  });
}

/** Glyph-syntax path → polylines [[x0,y0,x1,y1,…], …] at `scale`, centred on 0,0. */
export function flattenPath(d, scale, dx = 0, dy = 0) {
  const out = [];
  let cur = null, sx = 0, sy = 0, px = 0, py = 0;
  for (const { op, pts } of parseGlyph(d)) {
    const p = pts.map((v, n) => v * scale + (n % 2 ? dy : dx));
    if (op === "M") { cur = [p[0], p[1]]; out.push(cur); sx = px = p[0]; sy = py = p[1]; }
    else if (op === "L") { cur.push(p[0], p[1]); px = p[0]; py = p[1]; }
    else if (op === "Q") {
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS, u = 1 - t;
        cur.push(u * u * px + 2 * u * t * p[0] + t * t * p[2], u * u * py + 2 * u * t * p[1] + t * t * p[3]);
      }
      px = p[2]; py = p[3];
    } else if (op === "Z") { cur.push(sx, sy); px = sx; py = sy; }
  }
  return out.filter((l) => l.length >= 4);
}

/** Centred dashes on one segment, as [x0,y0,x1,y1] quads. */
function dashes(a, b, period, duty) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const n = Math.max(1, Math.round(len / period)), p = len / n, off = (1 - duty) / 2;
  const out = [];
  for (let k = 0; k < n; k++) {
    const s = (k + off) * p / len, e = (k + off + duty) * p / len;
    out.push([a.x + dx * s, a.y + dy * s, a.x + dx * e, a.y + dy * e]);
  }
  return out;
}

export function makeTemplate(adapter, R, sampleKey) {
  const c = adapter.center(sampleKey);
  const rel = adapter.vertices(sampleKey).map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  const O = { x: 0, y: 0 };
  const outer = inset(rel, O, GEO.gutter);
  const bevel = inset(rel, O, GEO.bevel);
  const top = bevel.filter((p) => p.y <= 1e-6).sort((a, b) => a.x - b.x);
  const sheen = top.length >= 2 ? [{ x: top[0].x, y: 0 }, ...top, { x: top[top.length - 1].x, y: 0 }] : null;
  const edgeDash = (poly) => poly.map((a, e) => dashes(a, poly[(e + 1) % poly.length], FOG_DASH.period * R, FOG_DASH.duty));
  const glyphCache = new Map();
  const fusedCache = new Map();
  return {
    rel, outer, bevel, sheen,
    /** Offsets from a centre to the neighbour across each edge (edge e ↔ its (e+3)%6). */
    across: rel.map((a, e) => { const b = rel[(e + 1) % 6]; return { x: a.x + b.x, y: a.y + b.y }; }),
    fogDash: edgeDash(rel),
    maskDash: edgeDash(outer),
    qmark: flattenPath(QMARK, GEO.qScale * R),
    /**
     * The fused look of a hex, by boundary mask (bit e set = edge e borders
     * another region, fog or the map's edge):
     *   body   the fill polygon, pulled back from boundary edges by the channel
     *   rims   polylines of the region rim (closed: all six edges are boundary)
     *   seams  [a, b] per interior edge this hex OWNS (e < 3), cut at the rim line
     */
    fused(mask) {
      let f = fusedCache.get(mask);
      if (f) return f;
      const body = offsetPoints(rel, mask, GEO.channel * R);
      const q = offsetPoints(rel, mask, (GEO.channel + GEO.rimInset) * R);
      const rims = [];
      if (mask === 63) rims.push({ pts: q, closed: true });
      else if (mask) {
        for (let e = 0; e < 6; e++) {
          if (!((mask >> e) & 1) || ((mask >> ((e + 5) % 6)) & 1)) continue; // start of a run
          const pts = [q[e]];
          let k = e;
          while ((mask >> k) & 1) { k = (k + 1) % 6; pts.push(q[k]); if (k === e) break; }
          rims.push({ pts, closed: false });
        }
      }
      const seams = [];
      for (let e = 0; e < 3; e++) if (!((mask >> e) & 1)) seams.push([q[e], q[(e + 1) % 6]]);
      f = { body, rims, seams };
      fusedCache.set(mask, f);
      return f;
    },
    glyph(id, scale) {
      const k = `${id}|${scale}`;
      let g = glyphCache.get(k);
      if (!g) { g = GLYPHS[id] ? flattenPath(GLYPHS[id], scale) : []; glyphCache.set(k, g); }
      return g;
    },
  };
}

/** Translate a relative [{x,y}] polygon to a flat point array at (x,y). */
export function at(poly, x, y) {
  const out = new Array(poly.length * 2);
  for (let n = 0; n < poly.length; n++) { out[2 * n] = poly[n].x + x; out[2 * n + 1] = poly[n].y + y; }
  return out;
}

/** Stroke relative polylines at (x,y). */
export function strokeLines(g, lines, x, y) {
  for (const l of lines) {
    g.moveTo(l[0] + x, l[1] + y);
    for (let n = 2; n < l.length; n += 2) g.lineTo(l[n] + x, l[n + 1] + y);
  }
}

/** Stroke relative dash quads at (x,y). */
export function strokeDashes(g, quads, x, y) {
  for (const q of quads) { g.moveTo(q[0] + x, q[1] + y); g.lineTo(q[2] + x, q[3] + y); }
}
