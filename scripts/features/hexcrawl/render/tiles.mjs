/**
 * Hexcrawl renderer — the look of one hex.
 *
 * `drawHex` draws a hex exactly as the static layer shows it at rest, into any
 * Graphics, offset by (ox, oy). The chunked static layer calls it with no
 * offset; an animating hex calls it with its own centre as origin, so it can be
 * scaled about its middle. One function, so a hex never looks one way while it
 * animates and another once it settles.
 *
 * It never decides visibility: it is handed the `view` model.mjs produced.
 * All geometry comes from the shared template (template.mjs) — a draw is a
 * translation, never an inset or a curve evaluation.
 */

import { BLANK_TERRAIN } from "../constants.mjs";
import { effectiveRating } from "../model.mjs";
import { ALPHA, GEO, HATCH } from "./style.mjs";
import { QMARK_DOT, dashSegment, diamond, hatchPoly, landmarkSlots } from "./geom.mjs";
import { FOG_DASH } from "./template.mjs";
import { at, strokeDashes, strokeLines } from "./template.mjs";

const ROUND = "round";
const MITER = "miter"; // hexagon and diamond corners: a round join triangulates many times the geometry

/** World-space polygons of a hex (for overlays that draw one hex at a time). */
export function hexPolys(ctx, key) {
  const c = ctx.adapter.center(key);
  const t = ctx.tpl;
  const w = (poly) => poly.map((p) => ({ x: p.x + c.x, y: p.y + c.y }));
  return { c, edge: w(t.rel), outer: w(t.outer), bevel: w(t.bevel) };
}

function glyphLine(g, width, color, alpha) {
  g.lineStyle({ width, color, alpha, cap: ROUND, join: ROUND });
}

function drawPips(g, n, x, y, R, color, alpha = 1) {
  if (!n) return;
  const s = GEO.pipSize * R, gap = GEO.pipGap * R;
  const x0 = x - ((n - 1) * gap) / 2;
  g.lineStyle(0);
  g.beginFill(color, alpha);
  for (let k = 0; k < n; k++) g.drawPolygon(diamond(x0 + k * gap, y, s));
  g.endFill();
}

function drawQuestion(g, tpl, R, x, y, color, alpha, width, k = 1) {
  glyphLine(g, width, color, alpha);
  for (const l of tpl.qmark) {
    g.moveTo(l[0] * k + x, l[1] * k + y);
    for (let n = 2; n < l.length; n += 2) g.lineTo(l[n] * k + x, l[n + 1] * k + y);
  }
  const s = GEO.qScale * R * k;
  g.lineStyle(0);
  g.beginFill(color, alpha);
  g.drawCircle(x + QMARK_DOT.x * s, y + QMARK_DOT.y * s, QMARK_DOT.r * s * 1.25);
  g.endFill();
}

/** A withheld rating: a small dashed hollow diamond with a "?" in it. */
function drawWithheldRating(g, tpl, x, y, R, color) {
  const s = GEO.pipSize * R * 2.1;
  const d = diamond(x, y, s);
  g.lineStyle({ width: GEO.fogDashWidth * R, color, alpha: 0.7 });
  for (let e = 0; e < 4; e++) {
    const ax = d[2 * e], ay = d[2 * e + 1], bx = d[(2 * e + 2) % 8], by = d[(2 * e + 3) % 8];
    g.moveTo(ax + (bx - ax) * 0.18, ay + (by - ay) * 0.18);
    g.lineTo(ax + (bx - ax) * 0.82, ay + (by - ay) * 0.82);
  }
  drawQuestion(g, tpl, R, x, y - s * 0.05, color, 0.75, GEO.fogDashWidth * R * 0.8, (s * 0.075) / (GEO.qScale * R));
}

function drawBadges(g, n, cx, cy, R, colors) {
  const s = GEO.lmBadge * R * (n >= 3 ? 0.82 : 1);
  for (const slot of landmarkSlots(n)) {
    const x = cx + slot.x * R, y = cy + (GEO.lmBadgeY + slot.y) * R;
    // A soft ink halo so the badge sits above the tile rather than on it.
    g.lineStyle(0);
    g.beginFill(colors.ink0, 0.55);
    g.drawPolygon(diamond(x, y, s * 1.22));
    g.endFill();
    g.lineStyle({ width: GEO.lmBadgeWidth * R, color: colors.warn, alpha: 1, join: MITER });
    g.beginFill(colors.ink1, 0.96);
    g.drawPolygon(diamond(x, y, s));
    g.endFill();
    g.lineStyle({ width: GEO.lmBadgeWidth * R * 0.5, color: colors.warn, alpha: 0.35, join: MITER });
    g.drawPolygon(diamond(x, y, s * 0.72));
  }
}

/** Boundary edges of a drawn hex (bit e = edge e): the renderer's answer, or all six. */
export const boundaryMask = (ctx, key) => (ctx.boundary ? ctx.boundary(key) : 63);

/** The region rim: the region's colour; a neutral line when the terrain is withheld
 *  (a silhouette shows the shape, not the colour); the terrain's own lit colour
 *  when the region has none. */
function rimColor(ctx, view, col, masked) {
  if (masked && !view.terrain) return ctx.colors.silRim;
  const region = view.regionId ? ctx.map.regions[view.regionId]?.color ?? null : null;
  return region ? ctx.colors.regionBorder(region) : col.bevel;
}

/** look: "tile" (full), "masked" (player view of a masked hex), "fog" (hidden). */
export function lookFor(view, asGMFull) {
  if (asGMFull) return "tile";
  if (view.state === "revealed") return "tile";
  if (view.state === "masked") return "masked";
  return "fog";
}

/**
 * Draw one hex.
 * ctx: { adapter, tpl, R, colors, mode, map, showPips(view)→bool, labelKeys:Set,
 *        fogEdge(key, e)→bool (optional; which fog edges this hex owns) }
 */
export function drawHex(g, ctx, key, view, look, ox = 0, oy = 0) {
  const { R, colors, mode, tpl } = ctx;
  const c = ctx.adapter.center(key);
  const cx = c.x - ox, cy = c.y - oy;
  const lmN = view.landmarks?.length ?? 0;
  const isLabel = ctx.labelKeys?.has(key) && !lmN;

  if (look === "fog") {
    g.lineStyle(0);
    g.beginFill(colors.ink2, 1);
    g.drawPolygon(at(tpl.outer, cx, cy));
    g.endFill();
    // On the true edge, so neighbouring fog hexes share one survey line —
    // and each shared edge is drawn by exactly one of the two (fogEdge).
    g.lineStyle({ width: GEO.fogDashWidth * R, color: colors.textDim, alpha: ALPHA.fogDash });
    for (let e = 0; e < 6; e++) if (!ctx.fogEdge || ctx.fogEdge(key, e)) strokeDashes(g, tpl.fogDash[e], cx, cy);
    // The "?" is text in the region-label face, drawn by the renderer's qmark layer.
    if (lmN) drawBadges(g, lmN, cx, cy, R, colors);
    return;
  }

  const masked = look === "masked";
  const terrain = view.terrain ?? { ...BLANK_TERRAIN, id: null };
  const region = view.regionId ? ctx.map.regions[view.regionId]?.color ?? null : null;
  const col = colors.tile(terrain.color, { blight: !!view.blight, region, masked });
  // A region texture shows through the glass: the fill thins by the scene's strength.
  const art = ctx.art ? ctx.art(key) : null;
  const texShown = art?.tex ? Math.max(0, Math.min(1, ctx.map.config?.texStrength ?? 0)) : 0;
  const fillAlpha = (mode === "outlines" ? 0 : mode === "tint" ? ALPHA.tintFill : 1) * (1 - texShown);
  // Fused: hexes of one region are one shape. Only boundary edges (another
  // region, fog, the map edge) get the dark channel and the region's rim; an
  // interior edge is a faint seam — solid when revealed, dashed when masked.
  const F = tpl.fused(boundaryMask(ctx, key));

  // Body.
  g.lineStyle(0);
  if (fillAlpha > 0) {
    g.beginFill(col.fill, fillAlpha);
    g.drawPolygon(at(F.body, cx, cy));
    g.endFill();
  }
  if (F.seams.length) {
    g.lineStyle({ width: GEO.seamWidth * R, color: col.rim, alpha: masked ? ALPHA.maskSeam : ALPHA.seam });
    for (const [a, b] of F.seams) {
      if (masked) dashSegment(g, a, b, FOG_DASH.period * R, FOG_DASH.duty, 0, -cx, -cy);
      else { g.moveTo(a.x + cx, a.y + cy); g.lineTo(b.x + cx, b.y + cy); }
    }
  }
  if (F.rims.length) {
    g.lineStyle({ width: GEO.regionRim * R, color: rimColor(ctx, view, col, masked), alpha: masked ? ALPHA.maskRim : ALPHA.rim, join: MITER });
    for (const r of F.rims) {
      if (r.closed) { g.drawPolygon(at(r.pts, cx, cy)); continue; }
      g.moveTo(r.pts[0].x + cx, r.pts[0].y + cy);
      for (let n = 1; n < r.pts.length; n++) g.lineTo(r.pts[n].x + cx, r.pts[n].y + cy);
    }
  }

  // Glyph (suppressed on the region's label hex — the label names the terrain).
  // An image icon replaces it; the renderer's icon layer draws that as a Sprite.
  const glyph = terrain.glyph ?? "none";
  if (!isLabel && glyph !== "none" && !art?.icon) {
    const gy = cy + (lmN ? GEO.lmGlyphY : GEO.glyphY) * R;
    const gs = GEO.glyphScale * R * (lmN ? GEO.lmGlyphScale : 1);
    glyphLine(g, GEO.glyphWidth * R * (lmN ? 0.8 : 1), col.glyph, masked ? 0.75 : 1);
    strokeLines(g, tpl.glyph(glyph, gs), cx, gy);
  }

  // Rating.
  const py = cy + (lmN ? GEO.lmPipY : GEO.pipY) * R;
  if (!isLabel) {
    if (view.rating != null) {
      if (ctx.showPips(view)) drawPips(g, view.rating, cx, py, lmN ? R * 0.8 : R, col.pip, masked ? 0.7 : 1);
    } else if (masked && effectiveRating(ctx.map, key) != null) {
      drawWithheldRating(g, tpl, cx, py, lmN ? R * 0.8 : R, colors.textDim);
    }
  }

  if (lmN) drawBadges(g, lmN, cx, cy, R, colors);
}

/**
 * Everything drawHex reads, except the hex's position — two hexes with the
 * same key draw identical triangles, so one tessellation serves both (see
 * MeshPen#stamp). KEEP IN STEP WITH drawHex: an input read there and missing
 * here draws a stale look on every hex that shares the stamp.
 */
export function stampKey(ctx, key, view, look) {
  const lmN = view.landmarks?.length ?? 0;
  const label = ctx.labelKeys?.has(key) && !lmN ? 1 : 0;
  if (look === "fog") {
    let mask = 0;
    for (let e = 0; e < 6; e++) if (!ctx.fogEdge || ctx.fogEdge(key, e)) mask |= 1 << e;
    return `f|${mask}|${lmN}`;
  }
  const t = view.terrain;
  const region = view.regionId ? ctx.map.regions[view.regionId]?.color ?? "" : "";
  const pips = view.rating != null ? (ctx.showPips(view) ? view.rating : 0) : 0;
  const withheld = look === "masked" && view.rating == null && effectiveRating(ctx.map, key) != null ? 1 : 0;
  const art = ctx.art ? ctx.art(key) : null;
  const tex = art?.tex ? ctx.map.config?.texStrength ?? 0 : "";
  return `${look}|${ctx.mode}|${t?.color ?? ""}|${t?.glyph ?? ""}|${view.blight ? 1 : 0}|${region}|${lmN}|${label}|${pips}|${withheld}|${boundaryMask(ctx, key)}|${tex}|${art?.icon ? 1 : 0}`;
}

/** The GM hatch over a hex players cannot fully see. kind: "hidden" | "masked". */
export function drawHatch(g, ctx, key, kind, width, ox = 0, oy = 0) {
  const { R, colors, tpl } = ctx;
  const c = ctx.adapter.center(key);
  const cx = c.x - ox, cy = c.y - oy;
  const hidden = kind === "hidden";
  g.lineStyle(0);
  g.beginFill(colors.ink0, hidden ? ALPHA.hatchVeilHidden : ALPHA.hatchVeilMasked);
  g.drawPolygon(at(tpl.outer, cx, cy));
  g.endFill();
  g.lineStyle({ width, color: colors.hatch, alpha: hidden ? ALPHA.hatchHidden : ALPHA.hatchMasked });
  // Clipped in world space; the static layer draws this once and stamps it per hex.
  hatchPoly(g, tpl.outer.map((p) => ({ x: p.x + c.x, y: p.y + c.y })), (hidden ? HATCH.hidden : HATCH.masked) * R, ox, oy);
}
