/**
 * Diorama — creature height, pure.
 *
 * How tall a creature stands, and where its eye is. The sight backend, cover
 * and the 3D view all ask here, so one creature has one height everywhere.
 *
 *   1. The actor flag `dio.heightCm` (centimetres), set in the Standee window,
 *      converted to the scene's distance units.
 *   2. The legacy actor flag `dio.height` (distance units), when a GM set one.
 *   3. A size key on the actor (`system.traits.size.value`: PF2e, and any
 *      system that shares its keys).
 *   4. The token's footprint (Daggerheart and every other system).
 *   5. Medium (6 ft).
 *
 * Size heights are feet (the book table), so a metre scene gets them in metres.
 * The scene's units come from the token document handed in
 * (`tokenDoc.parent.grid.units`) or an explicit argument; unknown units read as
 * feet, which keeps a feet scene's numbers exactly what they always were.
 *
 * Also here: the standee art marks (`dio.artMarks`), the head and feet lines a
 * card is sized by (render/art.mjs composeCard).
 *
 * Pure: takes the documents it is handed and reads no globals.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { SIZE_HEIGHT, EYE_FRACTION, FLAG_CREATURE_HEIGHT, FLAG_HEIGHT_CM, FLAG_ART_MARKS } from "../constants.mjs";
import { distToQ } from "../terrain/model.mjs";

const MEDIUM = SIZE_HEIGHT.med;

/** Centimetres in a foot and an inch. */
export const CM_PER_FT = 30.48;
export const CM_PER_IN = 2.54;

/** Centimetres per scene distance unit, by the units string a scene's grid carries. */
const UNIT_CM = Object.freeze({
  ft: CM_PER_FT, feet: CM_PER_FT, foot: CM_PER_FT, "'": CM_PER_FT,
  m: 100, meter: 100, meters: 100, metre: 100, metres: 100,
  cm: 1, centimeter: 1, centimeters: 1, centimetre: 1, centimetres: 1,
  in: CM_PER_IN, inch: CM_PER_IN, inches: CM_PER_IN, '"': CM_PER_IN,
  yd: 91.44, yard: 91.44, yards: 91.44,
  km: 100000, mi: 160934.4, mile: 160934.4, miles: 160934.4,
});

/** Centimetres in one scene distance unit; unknown units read as feet. */
export function cmPerUnit(units) {
  const k = String(units ?? "").trim().toLowerCase().replace(/\.$/, "");
  return Object.prototype.hasOwnProperty.call(UNIT_CM, k) ? UNIT_CM[k] : CM_PER_FT;
}

/** True when the units are metric (the Standee window then starts in cm). */
export const isMetric = (units) => [100, 1, 100000].includes(cmPerUnit(units)) && String(units ?? "").trim() !== "";

/** Feet → scene units. Exactly the same number in a feet scene (the factor is 1). */
export const feetToDist = (ft, units) => ft * (CM_PER_FT / cmPerUnit(units));

/** Centimetres → feet and inches, inches to one decimal, never 12. */
export function cmToFtIn(cm) {
  const total = Math.max(0, Number(cm) || 0) / CM_PER_IN;
  let ft = Math.floor(total / 12);
  let inch = Math.round((total - ft * 12) * 10) / 10;
  if (inch >= 12) { ft += 1; inch = 0; }
  return { ft, in: inch };
}

export const ftInToCm = (ft, inch) => (Number(ft) || 0) * CM_PER_FT + (Number(inch) || 0) * CM_PER_IN;

const positive = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Canonical size key: tiny | sm | med | lg | huge | grg. */
export const SIZE_KEYS = Object.freeze(["tiny", "sm", "med", "lg", "huge", "grg"]);
const SIZE_ALIAS = Object.freeze({ small: "sm", medium: "med", large: "lg", gargantuan: "grg" });
const canonSize = (k) => {
  const s = String(k ?? "").toLowerCase();
  const c = SIZE_ALIAS[s] ?? s;
  return SIZE_KEYS.includes(c) ? c : null;
};

/** Height in FEET for a size key; unknown keys read as Medium. */
export function heightForSize(sizeKey) {
  const k = String(sizeKey ?? "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(SIZE_HEIGHT, k) ? SIZE_HEIGHT[k] : MEDIUM;
}

/** Size key a token footprint (in grid squares) stands for. */
export function sizeForFootprint(widthCells, heightCells = widthCells) {
  const w = Math.max(Number(widthCells) || 1, Number(heightCells) || 1);
  if (w < 1) return "tiny";
  if (w <= 1) return "med";
  if (w <= 2) return "lg";
  if (w <= 3) return "huge";
  return "grg";
}

/**
 * A suite flag off an actor: through getFlag on a document, or the plain
 * object's flags (fixtures, snapshots), where the dotted key is a nested path.
 */
function flagOf(actor, key) {
  if (!actor) return undefined;
  let v;
  try { v = actor.getFlag?.(SUITE_ID, key); } catch { v = undefined; }
  if (v !== undefined) return v;
  const scope = actor.flags?.[SUITE_ID];
  if (!scope) return undefined;
  if (scope[key] !== undefined) return scope[key];
  return key.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), scope);
}

/** The actor's height in cm from the Standee window's flag, or null. */
export const heightCmOf = (actor) => positive(flagOf(actor, FLAG_HEIGHT_CM));

/** The legacy height flag, distance units, or null. */
export const legacyHeightOf = (actor) => positive(flagOf(actor, FLAG_CREATURE_HEIGHT));

/** The scene units a token document stands in, or "" when it carries none. */
const unitsOf = (tokenDoc) => tokenDoc?.parent?.grid?.units ?? "";

/**
 * The height the creature gets with no flag: from its size key, else its
 * footprint, else Medium. In FEET, with the size key it came from.
 * @returns {{ft:number, size:string}}
 */
export function autoHeight(actor, tokenDoc = null) {
  const a = actor ?? tokenDoc?.actor ?? null;
  const key = canonSize(a?.system?.traits?.size?.value);
  if (key) return { ft: heightForSize(key), size: key };
  if (tokenDoc && (tokenDoc.width !== undefined || tokenDoc.height !== undefined)) {
    const s = sizeForFootprint(tokenDoc.width, tokenDoc.height);
    return { ft: heightForSize(s), size: s };
  }
  return { ft: MEDIUM, size: "med" };
}

/**
 * A creature's height in distance units.
 * @param {object|null} actor
 * @param {object|null} [tokenDoc]  its parent scene's grid units are used
 * @param {string} [units]          overrides the token's scene units
 */
export function creatureHeightDist(actor, tokenDoc = null, units = undefined) {
  const a = actor ?? tokenDoc?.actor ?? null;
  const u = units ?? unitsOf(tokenDoc);
  const cm = heightCmOf(a);
  if (cm !== null) return cm / cmPerUnit(u);
  const legacy = legacyHeightOf(a);
  if (legacy !== null) return legacy;
  return feetToDist(autoHeight(a, tokenDoc).ft, u);
}

/**
 * The eye of a token, in q: its elevation (its feet) plus EYE_FRACTION of its
 * height. Uses the prepared elevation, which follows a token's animation.
 * @param {object} tokenDoc
 * @param {{distance:number, units?:string}} grid
 */
export function eyeQ(tokenDoc, grid) {
  const feet = Number(tokenDoc?.elevation) || 0;
  const h = creatureHeightDist(tokenDoc?.actor ?? null, tokenDoc, grid?.units || undefined);
  return distToQ(feet + EYE_FRACTION * h, grid?.distance || 5);
}

/* ─────────────────────────── standee art marks ─────────────────────────── */

/** The thinnest figure the marks may describe (fraction of the art's height). */
export const MIN_MARK_SPAN = 0.05;

const frac = (v) => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};

/**
 * Normalise stored marks: `{top, bottom}` fractions of the art's height, top
 * above bottom by at least MIN_MARK_SPAN, or null. With `src`, marks made on
 * other art are null (a GM who changed the portrait, a disguised token).
 * @param {{top?:number, bottom?:number, src?:string}|null} raw
 * @param {string|null} [src]  the art the standee will draw
 */
export function standeeMarks(raw, src = null) {
  if (!raw || typeof raw !== "object") return null;
  const top = frac(raw.top), bottom = frac(raw.bottom);
  if (top === null || bottom === null || bottom - top < MIN_MARK_SPAN - 1e-9) return null;
  if (src != null && raw.src && String(raw.src) !== String(src)) return null;
  return { top, bottom };
}

/** The raw marks flag off an actor (unnormalised). */
export const artMarksOf = (actor) => flagOf(actor, FLAG_ART_MARKS) ?? null;
