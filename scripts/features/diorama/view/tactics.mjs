/**
 * Diorama view — tactical readouts: what one of your creatures has on another
 * (line of sight, cover, 3D distance), and what a move off a ledge costs.
 * Display only: nothing here writes a document or applies a number.
 *
 *   sightReadouts({ from, hovered, targets, grid, systemId, t }) → { lines, labels }
 *     lines   overlay `los` entries (render/tactics.mjs): the centre line of
 *             sight, broken where ground or a wall stops it
 *     labels  [{ id, tokenId, lines, tone }] for the HUD, distance first, then
 *             the cover badge
 *   fallReadouts({ terrain, cells, falls, grid, systemId, t }) → { lines, labels }
 *             a drop line down each ledge on the path, and its PF2e damage
 *
 * Who may see what is decided before anything is measured: a token the viewer
 * cannot see (Foundry's `token.isVisible`) is never measured to, a GM viewing
 * as the players gets nothing, and the attacker is a token this user controls.
 */

import { PALETTE } from "../../../core/theme.mjs";
import { distToQ } from "../terrain/model.mjs";
import { lineStyles, COVER_AC } from "../rules/los.mjs";
import { pf2eFall } from "../rules/fall.mjs";
import { fmtDist } from "../rules/systems.mjs";
import { seams } from "./seams.mjs";

/** Most targets that get their own line besides the hovered token. */
export const MAX_TARGET_LINES = 4;

/** Badge tone and line colour per sight result. */
export function sightTone(r) {
  if (!r) return "info";
  if (!r.lineOfSight) return "peril";
  return { none: "info", standard: "warn", greater: "hazard" }[r.cover] ?? "info";
}
const TONE_COLOR = () => ({ info: PALETTE.info, warn: PALETTE.warn, hazard: PALETTE.hazard, peril: PALETTE.peril });

/**
 * May this viewer measure from `from` to `to`? Both on the scene, both shown
 * to this viewer by Foundry, and the attacker theirs to control.
 * Pure on what it is handed, so the check tool drives it.
 */
export function mayMeasure(from, to, { asPlayers = false } = {}) {
  if (asPlayers || !from || !to || from === to) return false;
  if (from.document?.parent && to.document?.parent && from.document.parent !== to.document.parent) return false;
  if (from.isVisible === false || to.isVisible === false) return false;
  if (from.controlled === false) return false;
  return true;
}

/** The label lines for one sight readout. */
export function sightLines(r, { systemId = "", units = "", gridDistance = 5, t }) {
  const out = [];
  const d = Number(r?.distance);
  const dist = Number.isFinite(d)
    ? (seams.systems?.distanceReadout?.({ systemId, distance: d, gridDistance, units, t })?.text ?? `${fmtDist(d)} ${units}`.trim())
    : null;
  if (dist) out.push(dist);
  const rise = Number(r?.rise) || 0;
  if (Math.abs(rise) >= 0.5) out.push(t(rise > 0 ? "GLDIO.tactics.above" : "GLDIO.tactics.below", { distance: fmtDist(Math.abs(rise)), units }));
  if (!r) return out;
  const tone = sightTone(r);
  if (!r.lineOfSight) out.push({ text: t("GLDIO.cover.noSight"), chip: tone });
  else {
    const name = t(`GLDIO.cover.${r.cover}`);
    const ac = COVER_AC[r.cover] ?? 0;
    out.push({ text: systemId === "pf2e" && ac ? t("GLDIO.tactics.coverAc", { cover: name, ac }) : name, chip: tone });
  }
  return out;
}

/**
 * @param {object} o
 * @param {Token|null} o.from         the controlled token
 * @param {Token|null} o.hovered
 * @param {Token[]} [o.targets]       this user's targets
 * @param {{distance:number, units?:string}} o.grid
 * @param {boolean} [o.asPlayers]
 * @param {boolean} [o.draw=true]     the line itself (dio.tactics); labels come regardless
 * @param {string} [o.systemId]
 * @param {(k:string, d?:object) => string} o.t
 */
export function sightReadouts({ from, hovered, targets = [], grid, asPlayers = false, draw = true, systemId = "", t }) {
  const lines = [], labels = [];
  const between = seams.cover?.tacticsBetween;
  const list = [];
  if (hovered && mayMeasure(from, hovered, { asPlayers })) list.push({ tok: hovered, id: "hover", hover: true });
  for (const tg of targets ?? []) {
    if (list.length > MAX_TARGET_LINES) break;
    if (tg === hovered || !mayMeasure(from, tg, { asPlayers })) continue;
    list.push({ tok: tg, id: `target-${tg.id}`, hover: false });
  }
  const colors = TONE_COLOR();
  for (const { tok, id, hover } of list) {
    let r = null;
    try { r = typeof between === "function" ? between(from, tok) : null; } catch { r = null; }
    if (!r) {
      // No seam: the old readout, distance and terrain cover only.
      const cv = seams.cover?.coverBetween?.(from, tok) ?? null;
      r = cv ? { ...cv, distance: null, rise: 0 } : null;
    }
    if (!r) continue;
    const tone = sightTone(r);
    labels.push({ id, tokenId: tok.id, lines: sightLines(r, { systemId, units: grid.units ?? "", gridDistance: grid.distance, t }), tone });
    if (draw && r.line) {
      lines.push({
        id, a: r.line.a, b: r.line.b, pieces: lineStyles(r.line.spans),
        color: colors[tone] ?? PALETTE.info, strength: hover ? 1 : 0.7,
      });
    }
  }
  return { lines, labels };
}

/**
 * Drops along a path: a line down each ledge it falls off, and what the
 * landing costs (PF2e: half the fall in bludgeoning, prone; into water 20 ft
 * shorter if it is that deep, which the terrain does not know).
 * @param {object} o
 * @param {import("../terrain/model.mjs").Terrain|null} o.terrain
 * @param {Array<{i:number,j:number}>} o.cells       the path, start first
 * @param {Array<{i:number,j:number,dropDist:number,intoWater:boolean}>} o.falls  rules/path.mjs analyzePath().falls
 * @param {{size:number, distance:number, units?:string}} o.grid
 * @param {number} [o.w=1]  token width, squares
 * @param {number} [o.h=1]
 * @returns {{lines:object[], labels:Array<{id:string, world:{x:number,y:number,zQ:number}, lines:Array<string|object>, tone:string}>}}
 */
export function fallReadouts({ terrain, cells = [], falls = [], grid, w = 1, h = 1, systemId = "", t }) {
  const lines = [], labels = [];
  if (!terrain || !falls?.length) return { lines, labels };
  const size = grid.size, units = grid.units ?? "";
  const at = new Map(cells.map((c, k) => [`${c.i},${c.j}`, k]));
  falls.forEach((f, n) => {
    const k = at.get(`${f.i},${f.j}`);
    const prev = k > 0 ? cells[k - 1] : null;
    if (!prev) return;
    const topQ = terrain.footprintTop(prev.i, prev.j, w, h);
    const landQ = terrain.footprintTop(f.i, f.j, w, h);
    // the lip: the middle of the edge between the two footprints, on the side it drops from
    const cx = (prev.j + w / 2 + (f.j + w / 2)) / 2 * size, cy = (prev.i + h / 2 + (f.i + h / 2)) / 2 * size;
    const color = PALETTE.hazard;
    lines.push({ id: `fall-${n}`, a: { x: cx, y: cy, zQ: topQ }, b: { x: cx, y: cy, zQ: landQ }, pieces: [{ t0: 0, t1: 1, style: "drop" }], color, strength: 1, cap: true });
    const out = [t("GLDIO.tactics.drop", { distance: fmtDist(f.dropDist), units })];
    let tone = "hazard";
    if (systemId === "pf2e") {
      const dry = pf2eFall(f.dropDist);
      const fall = f.intoWater ? pf2eFall(f.dropDist, { soft: true }) : dry;
      if (fall.damage > 0) out.push({ text: t("GLDIO.tactics.fallDamage", { damage: fall.damage }), chip: "hazard" });
      else { out.push({ text: t("GLDIO.tactics.fallSafe"), chip: "good" }); tone = "warn"; }
      if (f.intoWater && fall.reduction > 0) out.push(t("GLDIO.tactics.fallWater", { reduction: fmtDist(fall.reduction), units, dry: dry.damage }));
    }
    labels.push({ id: `fall-${n}`, world: { x: cx, y: cy, zQ: topQ + 1 }, lines: out, tone });
  });
  return { lines, labels };
}

/** True when a creature moving this way does not fall: it flies (altitude above its ground) or moves by flying. */
export function isFlying(altitude, action) {
  return (Number(altitude) || 0) > 0 || action === "fly";
}

/** A signature of overlay lines, so an unchanged readout costs no rebuild. */
export function linesKey(lines) {
  const r = (n) => Math.round(Number(n) * 10) / 10;
  return (lines ?? []).map((l) => [l.id, r(l.a.x), r(l.a.y), r(l.a.zQ), r(l.b.x), r(l.b.y), r(l.b.zQ), l.color, l.strength,
    (l.pieces ?? []).map((p) => `${p.style}${r(p.t0 * 100)}-${r(p.t1 * 100)}`).join("/")].join(",")).join(";");
}

export { distToQ };
