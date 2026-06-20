/**
 * HEX_LAYOUT — the fixed topology of the 19-hex Hex Flower.
 *
 * One canonical index `0..18` is shared by every flower, Navigation Hex, and
 * the live position, so a season swap can "map by coordinate" (decision #10):
 * the index alone identifies the same cell across all of them.
 *
 * Geometry: five flat-top columns of heights 3-4-5-4-3 = 19 hexes, arranged in
 * the classic Goblin's Henchman flower. Indices run column-by-column (left→right),
 * top→bottom within each column. Index 9 is the dead-centre hex.
 *
 *            ┌── col0  col1  col2  col3  col4
 *   row top  │         3     7
 *            │   0     4     8    12
 *            │         …     9(*) …          (*) centre
 *            │   1     5    10    13    16
 *            │         6    11    15    17
 *   row bot  │   2          …          18
 *
 * The actual cell-by-cell map (col, vertical-unit v) → index is the COORDS table
 * below. Vertical units are half-hex steps: cells in a column are 2 apart, and
 * each neighbouring column is offset by 1 (so diagonals land on real cells).
 *
 * Direction deltas (flat-top hexes), matching WEATHER_DIRECTIONS:
 *   up         (col,   v-2)
 *   down       (col,   v+2)
 *   upperRight (col+1, v-1)
 *   lowerRight (col+1, v+1)
 *   upperLeft  (col-1, v-1)
 *   lowerLeft  (col-1, v+1)
 *
 * Edge handling: a direction that leaves the flower has `neighbors[dir] === null`,
 * which triggers the Navigation Hex's edge rule. The precomputed `wrap[dir]` is
 * the PDF "wild-card jump" target — wrap around to the opposite edge along the
 * same row/column — found by walking the OPPOSITE direction to the far edge.
 */

import { WEATHER_DIRECTIONS } from "../const.js";

/** Index → axial-ish cell coordinate {col, v}. (col 0..4 left→right; v = half-hex.) */
const COORDS = [
  { col: 0, v: -2 }, { col: 0, v: 0 }, { col: 0, v: 2 },                       // 0,1,2
  { col: 1, v: -3 }, { col: 1, v: -1 }, { col: 1, v: 1 }, { col: 1, v: 3 },     // 3,4,5,6
  { col: 2, v: -4 }, { col: 2, v: -2 }, { col: 2, v: 0 }, { col: 2, v: 2 }, { col: 2, v: 4 }, // 7,8,9,10,11
  { col: 3, v: -3 }, { col: 3, v: -1 }, { col: 3, v: 1 }, { col: 3, v: 3 },     // 12,13,14,15
  { col: 4, v: -2 }, { col: 4, v: 0 }, { col: 4, v: 2 }                         // 16,17,18
];

/** Per-direction (col, v) step. */
const DELTA = {
  up: [0, -2], down: [0, 2],
  upperRight: [1, -1], lowerRight: [1, 1],
  upperLeft: [-1, -1], lowerLeft: [-1, 1]
};

const OPPOSITE = {
  up: "down", down: "up",
  upperRight: "lowerLeft", lowerLeft: "upperRight",
  lowerRight: "upperLeft", upperLeft: "lowerRight"
};

/** "col,v" → index lookup. */
const KEY = (col, v) => `${col},${v}`;
const BY_COORD = new Map(COORDS.map((c, i) => [KEY(c.col, c.v), i]));

const indexAt = (col, v) => BY_COORD.get(KEY(col, v)) ?? null;

/** The neighbour index in `dir` from `index`, or null if it leaves the flower. */
function neighbor(index, dir) {
  const c = COORDS[index];
  const [dc, dv] = DELTA[dir];
  return indexAt(c.col + dc, c.v + dv);
}

/** Wild-card-jump target: walk OPPOSITE(dir) to the far edge; return that cell. */
function wrapTarget(index, dir) {
  const opp = OPPOSITE[dir];
  let cur = index;
  for (let guard = 0; guard < 8; guard++) {
    const nxt = neighbor(cur, opp);
    if (nxt === null) break;
    cur = nxt;
  }
  return cur;
}

/**
 * Pixel (unit) centres for rendering. Flat-top hexes of unit radius R=1:
 *   x = col * 1.5            (column pitch = 1.5·R)
 *   y = v   * (√3 / 2)       (each v-unit is half a row; row pitch = √3·R)
 * Centred so the flower's bounding box is symmetric about (0,0).
 */
const SQRT3_2 = Math.sqrt(3) / 2;
function unitCenter(c) {
  // cols span 0..4 → centre by subtracting 2; v already centred about 0.
  return { x: (c.col - 2) * 1.5, y: c.v * SQRT3_2 };
}

/**
 * HEX_LAYOUT[i] = {
 *   index, col, v,
 *   center: {x, y},                       // unit centre (R=1), renderer scales
 *   neighbors: {up, upperRight, ... },    // index | null per direction
 *   wrap:      {up, upperRight, ... }      // wild-card-jump target index per direction
 * }
 */
export const HEX_LAYOUT = COORDS.map((c, index) => {
  const neighbors = {}, wrap = {};
  for (const dir of WEATHER_DIRECTIONS) {
    neighbors[dir] = neighbor(index, dir);
    wrap[dir] = wrapTarget(index, dir);
  }
  return { index, col: c.col, v: c.v, center: unitCenter(c), neighbors, wrap };
});

/** Total hexes (always 19). */
export const HEX_COUNT = HEX_LAYOUT.length;

/** Unit bounding box of all centres (for fitting a viewBox around the flower). */
export const HEX_BOUNDS = (() => {
  const xs = HEX_LAYOUT.map(h => h.center.x), ys = HEX_LAYOUT.map(h => h.center.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
})();

/**
 * Resolve a single move from `index` in `dir` under an edge rule.
 * Returns { to, edge } where `edge` flags that a wild-card/edge rule fired.
 *   edgeRule: "wrap" | "stay" | { divert: index }
 */
export function resolveMove(index, dir, edgeRule = "wrap") {
  const direct = HEX_LAYOUT[index]?.neighbors?.[dir];
  if (direct !== null && direct !== undefined) return { to: direct, edge: false };

  // The move left the flower → apply the Navigation Hex's edge rule for this face.
  if (edgeRule === "stay") return { to: index, edge: true };
  if (edgeRule && typeof edgeRule === "object" && Number.isInteger(edgeRule.divert)) {
    const d = edgeRule.divert;
    return { to: (d >= 0 && d < HEX_COUNT) ? d : index, edge: true };
  }
  // default "wrap"
  return { to: HEX_LAYOUT[index]?.wrap?.[dir] ?? index, edge: true };
}

/** Apply an optional ±N direction modifier by rotating the face clockwise. */
export function rotateDirection(dir, steps = 0) {
  const i = WEATHER_DIRECTIONS.indexOf(dir);
  if (i < 0 || !steps) return dir;
  const n = WEATHER_DIRECTIONS.length;
  return WEATHER_DIRECTIONS[(((i + steps) % n) + n) % n];
}

/**
 * A compact inline SVG of the whole 19-hex flower showing one move: every cell is
 * a faint hexagon, the origin (`from`) and destination (`to`) are highlighted, and
 * an arrow is drawn from one to the other so the chat card can show, at a glance,
 * how the weather walked this turn. Returns "" when there is nothing to draw.
 *
 * Styling is left to CSS — the polygons/arrow carry classes (`hx`, `hx from`,
 * `hx to`, `arr-line`, `arr-head`) and the card's --wglow/--wtint cascade in.
 */
export function moveFlowerSvg(fromIndex, toIndex) {
  const from = Number.isInteger(fromIndex) ? fromIndex : null;
  const to = Number.isInteger(toIndex) ? toIndex : null;
  if (to === null || to < 0 || to >= HEX_COUNT) return "";

  const R = 7, PAD = 5, H = R * SQRT3_2;            // hex radius / viewBox pad / flat-side half-height
  const px = i => ({ x: HEX_LAYOUT[i].center.x * R, y: HEX_LAYOUT[i].center.y * R });
  const n = v => v.toFixed(2);
  const hexPoints = (cx, cy) =>
    `${n(cx - R)},${n(cy)} ${n(cx - R / 2)},${n(cy - H)} ${n(cx + R / 2)},${n(cy - H)} ` +
    `${n(cx + R)},${n(cy)} ${n(cx + R / 2)},${n(cy + H)} ${n(cx - R / 2)},${n(cy + H)}`;

  const vbX = HEX_BOUNDS.minX * R - R - PAD;
  const vbY = HEX_BOUNDS.minY * R - H - PAD;
  const vbW = (HEX_BOUNDS.maxX - HEX_BOUNDS.minX) * R + 2 * R + 2 * PAD;
  const vbH = (HEX_BOUNDS.maxY - HEX_BOUNDS.minY) * R + 2 * H + 2 * PAD;

  const cells = HEX_LAYOUT.map((_, i) => {
    const { x, y } = px(i);
    const cls = i === to ? "hx to" : i === from ? "hx from" : "hx";
    return `<polygon class="${cls}" points="${hexPoints(x, y)}"/>`;
  }).join("");

  let arrow = "";
  if (from !== null && from !== to && from >= 0 && from < HEX_COUNT) {
    const a = px(from), b = px(to);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;                // unit move vector
    const tail = { x: a.x + ux * R * 0.5, y: a.y + uy * R * 0.5 };  // start just outside the origin
    const tip = { x: b.x - ux * R * 0.45, y: b.y - uy * R * 0.45 }; // stop just inside the destination
    const ah = 3.6, aw = 2.7;                          // arrowhead length / half-width
    const base = { x: tip.x - ux * ah, y: tip.y - uy * ah };
    const pxp = -uy, pyp = ux;                         // perpendicular
    arrow =
      `<line class="arr-line" x1="${n(tail.x)}" y1="${n(tail.y)}" x2="${n(base.x)}" y2="${n(base.y)}"/>` +
      `<polygon class="arr-head" points="${n(tip.x)},${n(tip.y)} ` +
        `${n(base.x + pxp * aw)},${n(base.y + pyp * aw)} ${n(base.x - pxp * aw)},${n(base.y - pyp * aw)}"/>`;
  }

  return `<svg class="wc-flower" viewBox="${n(vbX)} ${n(vbY)} ${n(vbW)} ${n(vbH)}" ` +
    `width="${Math.round(vbW)}" height="${Math.round(vbH)}" aria-hidden="true">${cells}${arrow}</svg>`;
}
