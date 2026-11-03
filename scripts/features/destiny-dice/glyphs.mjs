/**
 * The glyphs a fate face carries, as geometry.
 *
 * ONE statement for two renderers: the chat strip draws these shapes as SVG and
 * the die bakes them into its face maps (raster.mjs). Written twice, the die and
 * the card would drift — a star with four points on the table and five in chat —
 * and each file would look right on its own.
 *
 * Coordinates are face units: a square from -1 to 1 on both axes, y down, the
 * origin at the centre of the face. A d6 face is the whole texture tile, so the
 * centre of the tile is the centre of the face; everything stays inside SAFE,
 * clear of the bevel Dice So Nice rounds the cube's edges with.
 *
 * Pure: numbers in, numbers and strings out.
 */

/* Half-extent the marks stay inside. The bevel eats the outer ~15% of a d6 face. */
export const SAFE = 0.66;
/* The engraved frame on the die (not drawn in chat, where the tile has its own). */
export const FRAME = Object.freeze({ half: 0.76, cut: 0.2, width: 0.026 });
/* Stroke half-width for numerals and the bolt, in face units. */
export const STROKE = 0.06;

/*
 * Numerals, squared like the suite's display face so they read at a glance on a
 * tumbling die: a box 0.6 wide and 1 tall, y down, as polylines.
 */
const DIGITS = Object.freeze({
  0: [[[0, 0], [0.6, 0], [0.6, 1], [0, 1], [0, 0]]],
  1: [[[0.12, 0.16], [0.34, 0], [0.34, 1]]],
  2: [[[0, 0], [0.6, 0], [0.6, 0.5], [0, 0.5], [0, 1], [0.6, 1]]],
  3: [[[0, 0], [0.6, 0], [0.6, 1], [0, 1]], [[0.14, 0.5], [0.6, 0.5]]],
  // Closed and slanted: the open seven-segment 4 reads as a letter at a glance.
  4: [[[0.46, 1], [0.46, 0], [0, 0.66], [0.6, 0.66]]],
  5: [[[0.6, 0], [0, 0], [0, 0.5], [0.6, 0.5], [0.6, 1], [0, 1]]],
  6: [[[0.6, 0], [0, 0], [0, 1], [0.6, 1], [0.6, 0.5], [0, 0.5]]],
  7: [[[0, 0], [0.6, 0], [0.6, 1]]],
  8: [[[0, 0], [0.6, 0], [0.6, 1], [0, 1], [0, 0]], [[0, 0.5], [0.6, 0.5]]],
  9: [[[0.6, 0.5], [0, 0.5], [0, 0], [0.6, 0], [0.6, 1], [0, 1]]],
  "+": [[[0.3, 0.24], [0.3, 0.76]], [[0.04, 0.5], [0.56, 0.5]]],
  "−": [[[0.04, 0.5], [0.56, 0.5]]],
  "-": [[[0.04, 0.5], [0.56, 0.5]]],
});
const CHAR_W = 0.6;
const CHAR_GAP = 0.24;

/** Polylines for a numeral string, laid out centred inside SAFE. */
function numeralStrokes(text) {
  const chars = [...String(text)].filter((c) => DIGITS[c]);
  if (!chars.length) return [];
  const advance = CHAR_W + CHAR_GAP;
  const width = chars.length * advance - CHAR_GAP;
  // Height 1 in glyph units; scale so the run fits the safe square either way.
  const scale = Math.min((SAFE * 1.7) / 1, (SAFE * 1.9) / width);
  const ox = -(width * scale) / 2;
  const oy = -scale / 2;
  const strokes = [];
  chars.forEach((c, i) => {
    for (const line of DIGITS[c]) {
      strokes.push(line.map(([x, y]) => [ox + (i * advance + x) * scale, oy + y * scale]));
    }
  });
  return strokes;
}

/** A four-point star with concave sides, and a small one off its shoulder. */
function starPolygons() {
  const star = (cx, cy, r, waist) => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * waist;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
  };
  return [star(-0.06, 0.06, SAFE * 0.92, 0.2), star(0.4, -0.4, SAFE * 0.3, 0.24)];
}

/** A complication that adds nothing: a break, not a number. */
function boltStrokes() {
  const s = SAFE * 0.9;
  return [[[-0.1 * s, -s], [0.32 * s, -0.12 * s], [-0.3 * s, 0.14 * s], [0.12 * s, s]]];
}

/**
 * The shapes for one glyph spec (faces.mjs `glyphSpec`).
 * @returns {{ strokes: number[][][], polygons: number[][][] }}
 */
export function glyphShapes(spec) {
  switch (spec?.mark) {
    case "star": return { strokes: [], polygons: starPolygons() };
    case "number": return { strokes: numeralStrokes(spec.text), polygons: [] };
    case "bolt": return { strokes: boltStrokes(), polygons: [] };
    default: return { strokes: [], polygons: [] };
  }
}

/** The engraved chamfered frame, as one closed polyline. */
export function frameStroke() {
  const h = FRAME.half;
  const c = FRAME.cut;
  return [[-h + c, -h], [h, -h], [h, h - c], [h - c, h], [-h, h], [-h, -h + c], [-h + c, -h]];
}

/* ── Rasterising ──────────────────────────────────────────────────────── */

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function polylineDistance(px, py, line) {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) {
    d = Math.min(d, segmentDistance(px, py, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
  }
  return d;
}

/** Signed distance to a closed polygon: negative inside. */
export function polygonDistance(px, py, poly) {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    d = Math.min(d, segmentDistance(px, py, xi, yi, xj, yj));
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? -d : d;
}

const coverFrom = (d, aa) => Math.max(0, Math.min(1, 0.5 - d / aa));

/**
 * How much of the glyph covers a point, 0..1, antialiased over `aa` face units
 * (one texel is 2 / tile size).
 */
export function glyphCoverage(shapes, x, y, aa) {
  let c = 0;
  for (const poly of shapes.polygons) c = Math.max(c, coverFrom(polygonDistance(x, y, poly), aa));
  for (const line of shapes.strokes) c = Math.max(c, coverFrom(polylineDistance(x, y, line) - STROKE, aa));
  return c;
}

export function frameCoverage(x, y, aa) {
  return coverFrom(polylineDistance(x, y, frameStroke()) - FRAME.width, aa);
}

/* ── SVG ──────────────────────────────────────────────────────────────── */

const fmt = (n) => Number(n.toFixed(3));
const pathOf = (pts, close) => `M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}${close ? "Z" : ""}`;

/**
 * The glyph as an SVG string, drawn in `currentColor`. Strokes are the same
 * width as on the die, so the two read as the same mark.
 */
export function glyphSvg(spec, { className = "glddf-glyph" } = {}) {
  const shapes = glyphShapes(spec);
  const fill = shapes.polygons.map((p) => `<path d="${pathOf(p, true)}"/>`).join("");
  const lines = shapes.strokes.map((l) => `<path d="${pathOf(l, false)}"/>`).join("");
  return `<svg class="${className}" viewBox="-1 -1 2 2" aria-hidden="true" focusable="false">`
    + (fill ? `<g fill="currentColor">${fill}</g>` : "")
    + (lines ? `<g fill="none" stroke="currentColor" stroke-width="${fmt(STROKE * 2)}" stroke-linecap="round" stroke-linejoin="round">${lines}</g>` : "")
    + `</svg>`;
}
