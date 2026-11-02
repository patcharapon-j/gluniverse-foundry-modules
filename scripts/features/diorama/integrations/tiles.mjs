/**
 * Diorama — Foundry tiles in 3D: which tiles the view draws, as what, and where.
 * See docs/DIORAMA_BUILDINGS.md.
 *
 *   readTiles({ scene, isGM, asPlayers, grid, walls, ground })  → TileState[]
 *
 * Foundry v14 has no "overhead" switch any more: a tile draws over tokens when
 * its elevation is above theirs, and fades for them when its occlusion modes
 * say so (CONST.OCCLUSION_MODES, mirrored in OCC below). The view sorts a tile
 * into one of two kinds:
 *
 *   ground  a decal lying on the terrain at its elevation (a rug, a table top,
 *           blood on the flagstones). Never fades.
 *   roof    a flat plane over the board. Any occlusion mode makes a tile a roof,
 *           and so does an elevation at or above the viewed Level's top (where
 *           v14 moved the old scene foreground elevation). A roof stands on the
 *           walls under it when there are any, else at its own elevation, and
 *           never below the ground under it plus one square.
 *
 * Who sees what: a hidden tile reaches only the GM's view (ghosted), never a
 * player's and never the GM's "view as players". A tile not in the viewed
 * Level is skipped. The GM can switch a scene's tiles off in 3D, or keep only
 * one kind (scene flag dio.tiles), for maps whose tiles clash with the 3D board.
 *
 * Everything above `readTiles` is pure and takes plain data; the check tool
 * drives it. `readTiles` is the only part that reads the world.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { FLAG_TILES } from "../constants.mjs";
import { levelIdOf } from "../terrain/store.mjs";

/** Scene flag dio.tiles: which tiles the 3D view draws. Stored data: never rename. */
export const TILE_MODES = Object.freeze(["all", "roofs", "ground", "off"]);
export const DEFAULT_TILE_MODE = "all";

/** Foundry's CONST.OCCLUSION_MODES (common/constants.mjs, v14). The check pins the values. */
export const OCC = Object.freeze({ NONE: 0, FADE: 1, SURFACE: 2, RADIAL: 4, VISION: 8 });

/** Fit modes Foundry's PrimarySpriteMesh#resize knows. */
export const FITS = Object.freeze(["fill", "cover", "contain", "width", "height"]);

/** A roof never sits lower than this above the highest ground under it, in q (one square). */
export const ROOF_CLEARANCE_Q = 4;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const HEX_RE = /^#[0-9a-f]{6}$/i;

/** A scene's tile mode, sanitised (anything unknown reads as the default). */
export function normalizeTileMode(v) {
  return TILE_MODES.includes(v) ? v : DEFAULT_TILE_MODE;
}

/** The union of a tile's occlusion modes (a Set, an array, or an old single number). */
export function occlusionMask(modes) {
  if (Number.isFinite(Number(modes)) && !(modes instanceof Set) && !Array.isArray(modes)) return Number(modes) | 0;
  let m = 0;
  for (const x of modes ?? []) m |= Number(x) | 0;
  return m;
}

/**
 * "roof" or "ground".
 * @param {{elevation:number, mask:number, levelTop:number|null}} o  levelTop null = +Infinity
 */
export function tileKind({ elevation, mask, levelTop = null }) {
  if ((mask & (OCC.FADE | OCC.RADIAL | OCC.VISION | OCC.SURFACE)) !== 0) return "roof";
  const top = levelTop === null || levelTop === undefined || !Number.isFinite(Number(levelTop)) ? Infinity : Number(levelTop);
  return num(elevation) >= top ? "roof" : "ground";
}

/** Does a tile of this kind draw under this scene's mode? */
export function modeAllows(mode, kind) {
  const m = normalizeTileMode(mode);
  if (m === "off") return false;
  if (m === "all") return true;
  return m === (kind === "roof" ? "roofs" : "ground");
}

/**
 * The four corners of a tile's box in px, clockwise from the anchor's top left,
 * the way Foundry's RectangleShapeData lays it out: (x, y) is the ANCHOR point,
 * the box runs from −anchor × size to (1 − anchor) × size, turned about the
 * anchor by `rotation` degrees (clockwise on the canvas).
 */
export function tileBox({ x, y, width, height, anchorX = 0.5, anchorY = 0.5, rotation = 0 }) {
  const a = (num(rotation) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const W = num(width), H = num(height), ax = num(anchorX, 0.5), ay = num(anchorY, 0.5);
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const lx = (u - ax) * W, ly = (v - ay) * H;
    return [num(x) + lx * c - ly * s, num(y) + lx * s + ly * c];
  });
}

/** Is a point inside a convex or concave polygon ([[x, y], …])? */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's outline. */
export function distToPoly(x, y, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return best;
}

/**
 * The highest wall top (q) of the walls that stand on a roof's outline or
 * inside it (a wall's midpoint within `margin` px of the box, or inside it),
 * or -Infinity when no wall holds it up. Doors and windows count: they are
 * walls with a hole in them. Invisible walls do not (nothing is drawn).
 * @param {number[][]} box  px
 * @param {{a:number[], b:number[], type:string, topQ:number}[]} walls  WallState[]
 */
export function wallTopUnder(box, walls, margin = 0) {
  let top = -Infinity;
  for (const w of walls ?? []) {
    if (!w || w.type === "invisible" || !Array.isArray(w.a) || !Array.isArray(w.b)) continue;
    const mx = (num(w.a[0]) + num(w.b[0])) / 2, my = (num(w.a[1]) + num(w.b[1])) / 2;
    if (pointInPoly(mx, my, box) || distToPoly(mx, my, box) <= margin) top = Math.max(top, num(w.topQ, -Infinity));
  }
  return top;
}

/**
 * Where a roof is drawn, q: on its walls when there are any (a building's walls
 * hold its roof up, whatever height the tile was given), else at its own
 * elevation, and never below the ground under it plus ROOF_CLEARANCE_Q.
 * @param {{elevationQ:number, wallTopQ:number, groundTopQ:number}} o
 */
export function roofHeightQ({ elevationQ, wallTopQ = -Infinity, groundTopQ = 0 }) {
  const on = Number.isFinite(wallTopQ) ? wallTopQ : num(elevationQ);
  return Math.max(on, num(groundTopQ) + ROOF_CLEARANCE_Q);
}

/**
 * The renderer's TileState for one tile, from plain document data. null when
 * this viewer does not get it (hidden and not the GM's own view, filtered out by
 * the scene's mode, no art, fully transparent).
 *
 * TileState = { id, kind:"ground"|"roof", src, video, x, y, width, height,
 *   anchorX, anchorY, rotation, scaleX, scaleY, fit, alpha, tint:"#rrggbb",
 *   elevQ, roofQ, ghost, mask, occludedAlpha, sort }   px and q, like the
 *   rest of the view's states
 *
 * @param {object} d  { id, x, y, width, height, rotation, elevation, alpha, hidden, sort,
 *   texture:{src, anchorX, anchorY, fit, scaleX, scaleY, tint}, occlusion:{modes, alpha} }
 * @param {object} o
 * @param {boolean} o.gmView      the GM, not viewing as the players
 * @param {number} o.distance     grid distance per square
 * @param {number|null} [o.levelTop]
 * @param {string} [o.mode]       the scene's dio.tiles
 * @param {object[]} [o.walls]    WallState[] (roof height)
 * @param {(box:number[][]) => number} [o.groundTopQ]  highest ground under a box, q
 * @param {HTMLVideoElement|null} [o.video]
 */
export function tileStateOf(d, { gmView, distance, levelTop = null, mode = DEFAULT_TILE_MODE, walls = [], groundTopQ = null, video = null } = {}) {
  if (!d || typeof d !== "object") return null;
  if (d.hidden && !gmView) return null;
  const src = typeof d.texture?.src === "string" ? d.texture.src : "";
  if (!src && !video) return null;
  const alpha = clamp01(num(d.alpha, 1));
  if (alpha <= 0) return null;
  const width = num(d.width), height = num(d.height);
  if (!(width > 0) || !(height > 0)) return null;
  const mask = occlusionMask(d.occlusion?.modes ?? d.occlusion?.mode ?? 0);
  const dist = num(distance, 5) || 5;
  const elevQ = (num(d.elevation) / dist) * 4;
  const kind = tileKind({ elevation: num(d.elevation), mask, levelTop });
  if (!modeAllows(mode, kind)) return null;
  const tex = d.texture ?? {};
  const box = tileBox({ x: d.x, y: d.y, width, height, anchorX: tex.anchorX, anchorY: tex.anchorY, rotation: d.rotation });
  let roofQ = elevQ;
  if (kind === "roof") {
    const gq = typeof groundTopQ === "function" ? num(groundTopQ(box), 0) : 0;
    roofQ = roofHeightQ({ elevationQ: elevQ, wallTopQ: wallTopUnder(box, walls, 0), groundTopQ: gq });
  }
  const tint = typeof tex.tint === "string" && HEX_RE.test(tex.tint) ? tex.tint.toLowerCase() : "#ffffff";
  return {
    id: String(d.id ?? d._id ?? ""),
    kind,
    src,
    video: video ?? null,
    x: num(d.x), y: num(d.y), width, height,
    anchorX: num(tex.anchorX, 0.5), anchorY: num(tex.anchorY, 0.5),
    rotation: num(d.rotation),
    scaleX: num(tex.scaleX, 1) || 1, scaleY: num(tex.scaleY, 1) || 1,
    fit: FITS.includes(tex.fit) ? tex.fit : "fill",
    alpha,
    tint,
    elevQ,
    roofQ,
    box,
    ghost: !!d.hidden,
    mask,
    occludedAlpha: clamp01(num(d.occlusion?.alpha, 0)),
    sort: num(d.sort),
  };
}

/* ═══════════════════════════ the world ═══════════════════════════ */

/** A Color (or a number, or a string) as "#rrggbb". */
function cssOf(c) {
  if (typeof c === "string") return c;
  if (c && typeof c.css === "string") return c.css;
  if (Number.isFinite(Number(c))) return `#${(Number(c) & 0xffffff).toString(16).padStart(6, "0")}`;
  return "#ffffff";
}

/** The scene's tile mode (scene flag dio.tiles). */
export function sceneTileMode(scene) {
  let v = null;
  try { v = scene?.getFlag?.(SUITE_ID, FLAG_TILES); } catch { v = null; }
  return normalizeTileMode(v);
}

/**
 * Every tile this viewer's 3D view draws, in Foundry's sort order.
 * @param {object} o
 * @param {Scene} o.scene
 * @param {boolean} o.isGM
 * @param {boolean} o.asPlayers
 * @param {{size:number, distance:number}} o.grid
 * @param {object[]} o.walls     WallState[] (view/snapshot.mjs readWalls)
 * @param {object|null} o.ground the drawn ground (terrain/model.mjs Terrain)
 */
export function readTiles({ scene, isGM, asPlayers, grid, walls = [], ground = null }) {
  const mode = sceneTileMode(scene);
  if (mode === "off" || !scene || !grid) return [];
  const gmView = !!isGM && !asPlayers;
  let levelId = null, levelTop = null;
  try {
    levelId = levelIdOf(scene);
    const lvl = scene.levels?.get?.(levelId) ?? null;
    const top = lvl?.elevation?.top;
    levelTop = top === null || top === undefined ? null : Number(top);
  } catch { levelId = null; }
  const size = grid.size || 100;
  const groundTopQ = (box) => {
    if (!ground) return 0;
    const xs = box.map((p) => p[0]), ys = box.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const n = Math.max(2, Math.min(8, Math.ceil(Math.max(x1 - x0, y1 - y0) / size) + 1));
    let top = 0;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * j) / n;
      if (pointInPoly(x, y, box) || i === 0 || j === 0 || i === n || j === n) top = Math.max(top, ground.groundAt(x, y, size));
    }
    return top;
  };
  const out = [];
  for (const doc of scene.tiles ?? []) {
    try {
      if (levelId && typeof doc.includedInLevel === "function" && !doc.includedInLevel(levelId)) continue;
      const obj = doc.object ?? null;
      const video = obj?.isVideo ? obj.sourceElement ?? null : null;
      const tex = doc.texture ?? {};
      const s = tileStateOf({
        id: doc.id, x: doc.x, y: doc.y, width: doc.width, height: doc.height, rotation: doc.rotation,
        elevation: doc.elevation, alpha: doc.alpha, hidden: doc.hidden, sort: doc.sort,
        texture: { src: tex.src, anchorX: tex.anchorX, anchorY: tex.anchorY, fit: tex.fit, scaleX: tex.scaleX, scaleY: tex.scaleY, tint: cssOf(tex.tint) },
        occlusion: { modes: doc.occlusion?.modes, alpha: doc.occlusion?.alpha },
      }, { gmView, distance: grid.distance, levelTop, mode, walls, groundTopQ, video });
      if (s) out.push(s);
    } catch (e) {
      console.warn("GLUniverse Suite | diorama: a tile could not be read", e);
    }
  }
  // Foundry draws tiles by elevation, then sort
  out.sort((a, b) => a.elevQ - b.elevQ || a.sort - b.sort);
  return out;
}
