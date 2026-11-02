/**
 * Diorama view — which roofs open, for whom. See docs/DIORAMA_BUILDINGS.md.
 *
 *   readRoofs({ tiles, props, isGM, asPlayers, cutaway, vision, grid, bakeScale })
 *     → { roofs: RoofState[], focus: Focus[] }   for renderer.setRoofs
 *
 * A roof is either a Foundry tile the view draws as a roof (integrations/
 * tiles.mjs) or a prop flagged `roof` (render/props.mjs draws it, and takes
 * its fade through PropsLayer#setRoofFade). Each one gets a target here; the
 * renderer tweens to it (render/roofs.mjs) and adds the one rule that needs the
 * camera: a roof between the camera and one of the viewer's own figures fades
 * too, whoever's roof it is.
 *
 * The decision table (roofTarget, pure):
 *   GM cutaway on (the GM's own view only)   every roof → ROOF_CUTAWAY_ALPHA
 *   tile, FADE, a viewer's figure inside     the whole roof → its occluded alpha
 *   tile, RADIAL                             a hole round each viewer figure under it
 *   tile, VISION with a vision bake          open where the viewer sees right now
 *   tile, VISION without one (the GM)        as FADE
 *   tile, no mode                            never opens for figures
 *   prop roof, a viewer's figure inside      the whole roof → 0
 *
 * "A viewer's figure" (viewerTokens): a player's own tokens that are not
 * hidden, and any they control; the GM's controlled tokens; under the GM's
 * "view as players", every player-owned token on the board. That is narrower
 * than Foundry's 2D rule, which also opens a roof for any visible token: the 3D
 * board has walls in it, and a roof that opened for a goblin inside would show a
 * player the room the goblin is in.
 *
 * Who may see a roof at all: GM-hidden tiles never get here for a player
 * (readTiles). A roof shows once the ground on or just around its outline has
 * been seen (roofSeen), the way a prop shows once its centre has: a player who
 * walked past a house has seen its roof. Under it, the interior is still the
 * ground's own business: what nobody has seen is never drawn.
 *
 * Pure above `viewerTokens`; the adapters below it read the canvas.
 */

import { pointInPoly } from "../integrations/tiles.mjs";

/** The GM's "cut away roofs": every roof shows this much of itself. */
export const ROOF_CUTAWAY_ALPHA = 0.12;
/** Most radial holes one roof draws (the shader's uRoofHoles). */
export const MAX_HOLES = 4;
/** A prop roof opens to this over a figure inside (it has no occluded alpha of its own). */
export const PROP_ROOF_OPEN = 0;
/** A figure counts as under a roof while its feet are this far below the roof's top, cells. */
export const UNDER_MARGIN = 0.25;

const OCC = Object.freeze({ FADE: 1, RADIAL: 4, VISION: 8 });
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/**
 * One roof's target.
 * @param {{source:"tile"|"prop", mask?:number, occludedAlpha?:number}} roof
 * @param {object} c
 * @param {boolean} c.gmView      the GM, not viewing as the players
 * @param {boolean} c.cutaway     the GM's cut-away toggle
 * @param {boolean} c.inside      a viewer's figure is under it, inside its outline
 * @param {boolean} c.below       a viewer's figure is anywhere below it (VISION)
 * @param {{x:number, z:number, r:number}[]} c.holes   viewer figures under it, cells
 * @param {boolean} c.visionMap   the view bakes this viewer's sight (a player, or view-as-players)
 * @returns {{alpha:number, holes:{x:number,z:number,r:number}[], vision:boolean}}
 */
export function roofTarget(roof, { gmView = false, cutaway = false, inside = false, below = false, holes = [], visionMap = false } = {}) {
  if (cutaway && gmView) return { alpha: ROOF_CUTAWAY_ALPHA, holes: [], vision: false };
  if (roof?.source === "prop") return { alpha: inside ? PROP_ROOF_OPEN : 1, holes: [], vision: false };
  const mask = Number(roof?.mask) | 0;
  const open = clamp01(roof?.occludedAlpha ?? 0);
  let alpha = 1, vision = false, out = [];
  if (mask & OCC.VISION) {
    // Foundry: with a vision mask the roof opens where sight reaches; without one it fades like FADE
    if (visionMap && below) vision = true;
    else if (inside) alpha = open;
  }
  if ((mask & OCC.FADE) && inside) alpha = open;
  if (mask & OCC.RADIAL) out = (holes ?? []).slice(0, MAX_HOLES).map((h) => ({ x: Number(h.x), z: Number(h.z), r: Math.max(0, Number(h.r)) }));
  return { alpha, holes: out, vision };
}

/** Is a figure (cells, feet at y) under a roof whose outline is `poly` (cells) and top `topY`? */
export function underRoof(fig, poly, topY) {
  return Number(fig.footY) < Number(topY) - UNDER_MARGIN && pointInPoly(Number(fig.x), Number(fig.z), poly);
}

/** Could a circle (cells) reach a roof's outline box? (radial holes) */
export function circleNearPoly(fig, r, poly) {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return fig.x + r >= Math.min(...xs) && fig.x - r <= Math.max(...xs) && fig.z + r >= Math.min(...zs) && fig.z - r <= Math.max(...zs);
}

/**
 * How much of a roof the viewer has seen, from the vision bake (R visible now,
 * G explored): 1, 0.5 or 0, the most of any texel on its outline or within
 * `margin` bake px of it (the ground just outside its walls included).
 * @param {{data:Uint8ClampedArray|number[], width:number, height:number, x0:number, y0:number}} img  a region of the bake
 * @param {number[][]} poly  the outline in bake px
 * @param {number} margin    bake px
 */
export function roofSeen(img, poly, margin) {
  if (!img || !img.data) return 0;
  let best = 0;
  const near = (x, y) => pointInPoly(x, y, poly) || distToPolyPx(x, y, poly) <= margin;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const k = (y * img.width + x) * 4;
      const r = img.data[k], g = img.data[k + 1];
      if (r <= 127 && g <= 127) continue;
      const v = r > 127 ? 1 : 0.5;
      if (v <= best) continue;
      if (!near(img.x0 + x + 0.5, img.y0 + y + 0.5)) continue;
      best = v;
      if (best === 1) return 1;
    }
  }
  return best;
}

function distToPolyPx(x, y, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return best;
}

/** A prop's outline in cells (a turned w × d rectangle about its centre). */
export function propOutline(p) {
  const a = ((Number(p.rot) || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([u, v]) => {
    const lx = u * Number(p.w), ly = v * Number(p.d);
    return [Number(p.x) + lx * c - ly * s, Number(p.y) + lx * s + ly * c];
  });
}

/* ═══════════════════════════ the world ═══════════════════════════ */

/**
 * The figures a roof opens for, and that the camera keeps in view.
 *   GM:               controlled
 *   GM as players:    player-owned and not hidden
 *   player:           owned and not hidden, plus controlled
 * Each as { token, x, z, footY, headY, r } (cells; r = Foundry's occlusion radius).
 */
export function viewerTokens({ isGM, asPlayers, grid, heightQ = () => 6 }) {
  const layer = globalThis.canvas?.tokens;
  if (!layer || !grid) return [];
  const size = grid.size || 100, dist = grid.distance || 5;
  const pick = new Set();
  for (const t of layer.placeables ?? []) {
    const doc = t.document;
    if (!doc) continue;
    if (isGM && !asPlayers) { if (t.controlled) pick.add(t); continue; }
    if (asPlayers) { if (!doc.hidden && t.actor?.hasPlayerOwner) pick.add(t); continue; }
    if (t.controlled || (doc.isOwner && !doc.hidden)) pick.add(t);
  }
  const out = [];
  for (const t of pick) {
    const c = t.center ?? { x: t.document.x, y: t.document.y };
    const footY = (Number(t.document.elevation) || 0) / dist;
    let r = 0;
    try { r = Math.max(Number(t.externalRadius) || 0, Number(t.getLightRadius?.(t.document.occludable?.radius ?? 0)) || 0); } catch { r = 0; }
    out.push({ token: t, x: c.x / size, z: c.y / size, footY, headY: footY + Math.max(0.5, Number(heightQ(t)) / 4), r: r / size });
  }
  return out;
}

/** The vision bake region under a roof's outline (px of the scene) as roofSeen wants it. */
function bakeRegion(vision, polyPx, scale, margin) {
  if (!vision) return null;
  const xs = polyPx.map((p) => p[0] * scale), ys = polyPx.map((p) => p[1] * scale);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - margin)), y0 = Math.max(0, Math.floor(Math.min(...ys) - margin));
  const x1 = Math.min(vision.width, Math.ceil(Math.max(...xs) + margin)), y1 = Math.min(vision.height, Math.ceil(Math.max(...ys) + margin));
  if (x1 <= x0 || y1 <= y0) return null;
  try {
    const d = vision.getContext("2d", { willReadFrequently: true }).getImageData(x0, y0, x1 - x0, y1 - y0);
    return { data: d.data, width: d.width, height: d.height, x0, y0 };
  } catch {
    return null;
  }
}

/**
 * Every roof's state for the renderer, and the figures the camera keeps in view.
 *
 * RoofState = { id, source:"tile"|"prop", poly:[[x,z]…] cells, baseY, topY (cells),
 *   alpha, holes:[{x,z,r}] cells, vision, open (the occluded alpha), seen }
 * Focus     = { x, z, footY, headY } cells
 *
 * @param {object} o
 * @param {object[]} o.tiles      TileState[] (integrations/tiles.mjs)
 * @param {object[]} o.props      PropState[]; the ones with `roof` set are roofs
 * @param {boolean} o.isGM
 * @param {boolean} o.asPlayers
 * @param {boolean} o.cutaway     the GM's cut-away toggle
 * @param {HTMLCanvasElement|null} o.vision  the vision bake (null: everything is seen)
 * @param {number} o.bakeScale    bake px per scene px
 * @param {{size:number, distance:number}} o.grid
 * @param {(token:object) => number} [o.heightQ]  a figure's height, q
 */
export function readRoofs({ tiles = [], props = [], isGM, asPlayers, cutaway, vision = null, bakeScale = 0.16, grid, heightQ }) {
  if (!grid) return { roofs: [], focus: [] };
  const size = grid.size || 100;
  const gmView = !!isGM && !asPlayers;
  const viewers = viewerTokens({ isGM, asPlayers, grid, heightQ });
  const visionMap = !!vision;
  const margin = Math.max(2, 0.5 * size * bakeScale);
  const seenOf = (polyPx) => {
    if (!vision) return 1;
    const img = bakeRegion(vision, polyPx, bakeScale, margin);
    return roofSeen(img, polyPx.map(([x, y]) => [x * bakeScale, y * bakeScale]), margin);
  };
  const roofs = [];
  for (const t of tiles) {
    if (t.kind !== "roof" || !Array.isArray(t.box)) continue;
    const poly = t.box.map(([x, y]) => [x / size, y / size]);
    const y = t.roofQ / 4;
    const mesh = globalThis.canvas?.tiles?.get?.(t.id)?.mesh ?? null;
    // Foundry's own test where it has one: the tile's opaque pixels under the token's test points
    const inside = viewers.some((v) => {
      if (v.footY >= y - UNDER_MARGIN) return false;
      try { if (typeof mesh?.testOcclusion === "function") return !!mesh.testOcclusion(v.token); } catch { /* fall through */ }
      return pointInPoly(v.x, v.z, poly);
    });
    const below = viewers.some((v) => v.footY < y - UNDER_MARGIN);
    const holes = viewers.filter((v) => v.footY < y - UNDER_MARGIN && circleNearPoly(v, v.r, poly)).map((v) => ({ x: v.x, z: v.z, r: v.r }));
    const tgt = roofTarget({ source: "tile", mask: t.mask, occludedAlpha: t.occludedAlpha }, { gmView, cutaway, inside, below, holes, visionMap });
    roofs.push({ id: t.id, source: "tile", poly, baseY: y, topY: y, ...tgt, open: t.occludedAlpha, seen: t.ghost ? 1 : seenOf(t.box) });
  }
  for (const p of props ?? []) {
    if (!p?.roof) continue;
    const poly = propOutline(p);
    const baseY = Number(p.base) || 0, topY = baseY + (Number(p.h) || 0);
    const inside = viewers.some((v) => underRoof(v, poly, topY));
    const tgt = roofTarget({ source: "prop" }, { gmView, cutaway, inside, visionMap });
    roofs.push({ id: p.id, source: "prop", poly, baseY, topY, ...tgt, open: PROP_ROOF_OPEN, seen: 1 });
  }
  return { roofs, focus: focusOf(viewers) };
}

/** The figures the camera keeps clear of roofs: the controlled ones, else every viewer figure (at most 8). */
export function focusOf(viewers) {
  const held = viewers.filter((v) => v.token?.controlled);
  return (held.length ? held : viewers).slice(0, 8).map(({ x, z, footY, headY }) => ({ x, z, footY, headY }));
}
