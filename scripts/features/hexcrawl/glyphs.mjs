/**
 * Hexcrawl — terrain glyphs.
 *
 * Pure. Each glyph is a tiny stroked path in a ~20-unit box centred on 0,0,
 * written in a subset of SVG path syntax (M, L, Q, Z — absolute only) so the
 * same data draws in PIXI.Graphics, in an SVG <path> (icon pickers, tooltips)
 * and in the check tool. Stroked, never filled: the Etched Glass tile reads its
 * terrain from a lit line, not a painted icon.
 */

import { GLYPH_IDS } from "./constants.mjs";

export const GLYPH_BOX = 20;

export const GLYPHS = Object.freeze({
  grass: "M-6 4 L-7 -2 M-2 4 L-2 -4 M2 4 L3 -2 M6 4 L7 0",
  tree: "M-7 3 L-3 -7 L1 3 Z M-3 3 L-3 6 M0 1 L4 -6 L8 1 M4 1 L4 4",
  palm: "M0 7 Q1 0 -1 -5 M-1 -5 Q-6 -7 -9 -3 M-1 -5 Q4 -8 8 -4 M-1 -5 Q-3 -9 -6 -10 M-1 -5 Q2 -10 5 -10",
  marsh: "M-9 4 L9 4 M-5 4 L-6 -3 M0 4 L0 -5 M5 4 L6 -2",
  wave: "M-9 -2 Q-6 -5 -3 -2 Q0 1 3 -2 Q6 -5 9 -2 M-9 4 Q-6 1 -3 4 Q0 7 3 4 Q6 1 9 4",
  deep: "M-9 -5 Q-4.5 -8.5 0 -5 Q4.5 -1.5 9 -5 M-9 0.5 Q-4.5 -3 0 0.5 Q4.5 4 9 0.5 M-9 6 Q-4.5 2.5 0 6 Q4.5 9.5 9 6",
  dune: "M-10 3 Q-4 -5 2 3 M-2 -1 Q3 -7 10 1",
  hills: "M-10 5 Q-5 -4 0 5 M-3 1 Q3 -8 10 5",
  mount: "M-10 5 L-3 -7 L1 -1 L4 -5 L10 5",
  frozen: "M-10 5 L-3 -7 L4 5 M-5.5 -3 L-3 -1 L-0.5 -3 M6 -7 L6 1 M2.5 -5 L9.5 -1 M2.5 -1 L9.5 -5",
  mesa: "M-10 5 L-7 -2 L2 -2 L5 5 M5 5 L7 1 L10 1 M-5 1 L0 1",
  cave: "M-9 5 Q-9 -7 0 -7 Q9 -7 9 5 M-4 5 Q-4 -2 0 -2 Q4 -2 4 5",
  road: "M-9 5 Q0 0 9 -6 M-9 1 Q-2 -3 7 -8",
  ruins: "M-8 6 L-8 -2 M-4 6 L-4 -5 M0 6 L0 0 M4 6 L4 -4 L7 -4 M-10 6 L10 6",
  crystal: "M0 -8 L4 -2 L0 7 L-4 -2 Z M-4 -2 L4 -2",
  fungus: "M-7 0 Q0 -10 7 0 Z M0 0 L0 6",
  lava: "M-9 4 Q-5 -2 -1 3 Q3 8 9 0 M-3 -5 L-2 -2 M4 -6 L3 -3",
  star: "M0 -8 L2 -2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 -2 Z",
  none: "",
});

/**
 * Parse a glyph into drawing commands:
 * [{ op: "M"|"L"|"Q"|"Z", pts: number[] }]
 */
export function parseGlyph(d) {
  const out = [];
  const tok = String(d ?? "").match(/[MLQZ]|-?\d*\.?\d+/g) ?? [];
  let i = 0;
  while (i < tok.length) {
    const op = tok[i++];
    const n = op === "Q" ? 4 : op === "Z" ? 0 : 2;
    if (!"MLQZ".includes(op) || op.length !== 1) throw new Error(`hexcrawl glyph: bad op "${op}"`);
    const pts = tok.slice(i, i + n).map(Number);
    if (pts.length !== n || pts.some((v) => !Number.isFinite(v))) throw new Error(`hexcrawl glyph: bad args for ${op}`);
    out.push({ op, pts });
    i += n;
  }
  return out;
}

export const glyphCommands = (id) => parseGlyph(GLYPHS[id] ?? "");

/** Draw a glyph into a PIXI.Graphics already given a lineStyle. */
export function drawGlyph(g, id, x, y, scale = 1) {
  let sx = 0, sy = 0; // subpath start, for Z
  for (const { op, pts } of glyphCommands(id)) {
    const p = pts.map((v, n) => (n % 2 === 0 ? x + v * scale : y + v * scale));
    if (op === "M") { g.moveTo(p[0], p[1]); sx = p[0]; sy = p[1]; }
    else if (op === "L") g.lineTo(p[0], p[1]);
    else if (op === "Q") g.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else if (op === "Z") g.lineTo(sx, sy);
  }
}

/** The glyph as an SVG path `d` (for DOM previews/pickers). */
export const glyphSvgPath = (id) => GLYPHS[id] ?? "";

/** Every declared glyph id has path data (the check tool asserts this). */
export const glyphIdsCovered = () => GLYPH_IDS.every((id) => Object.hasOwn(GLYPHS, id));
