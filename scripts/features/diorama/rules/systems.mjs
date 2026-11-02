/**
 * Diorama — per-system readouts, pure.
 *
 * What a move, a distance or a fall means at this table: PF2e counts Strides
 * by Speed, Daggerheart reads range bands, everyone else gets the distance.
 * Every string goes through the `t(key, data)` the caller passes (Foundry's
 * `game.i18n.format` in the view); the default returns the key, so the check
 * tool can see exactly which keys a readout reaches for.
 */

import { DH_BANDS } from "../constants.mjs";
import { pf2eFall, PF2E_FALL } from "./fall.mjs";

export const PF2E = "pf2e";
/** Daggerheart system ids: this suite's own system, and Foundryborne's. */
export const DAGGERHEART = Object.freeze(["gluniverse-daggerheart", "daggerheart"]);

/** Daggerheart: one move inside an action reaches Close. */
const DH_FREE_SQUARES = 6;
/** PF2e: a fall of this many feet or less does no damage. */
const PF2E_SAFE_FALL = PF2E_FALL.safe;

const keyOnly = (key) => key;
const isDH = (id) => DAGGERHEART.includes(id);

/** A distance for display: at most one decimal, no trailing ".0". */
export function fmtDist(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "∞";
  return String(Math.round(v * 10) / 10);
}

/** The Daggerheart band key a distance falls in. */
export function bandFor(distance, gridDistance) {
  const squares = gridDistance > 0 ? Number(distance) / gridDistance : Number(distance);
  for (const b of DH_BANDS) if (squares <= b.max + 1e-9) return b.key;
  return DH_BANDS.at(-1).key;
}

/** PF2e tone for a Stride count. */
function pf2eTone(actions) {
  if (actions <= 1) return "info";
  if (actions === 2) return "warn";
  if (actions === 3) return "hazard";
  return "peril";
}

/**
 * @param {object} o
 * @param {string} o.systemId
 * @param {number|null} o.speed        distance units, or null
 * @param {number} o.distance          distance moved
 * @param {number} o.cost              movement cost (difficult terrain included)
 * @param {string} o.units
 * @param {number} [o.gridDistance=5]  needed for Daggerheart's Close
 * @param {(key:string, data?:object) => string} [o.t]
 * @returns {{text:string, tone:"info"|"warn"|"hazard"|"peril", actions:number|null}}
 */
export function movementReadout({ systemId, speed = null, distance = 0, cost = distance, units = "", gridDistance = 5,
  t = keyOnly } = {}) {
  const c = Number.isFinite(Number(cost)) ? Number(cost) : Infinity;
  const data = { distance: fmtDist(distance), units };
  if (c === Infinity) return { text: t("GLDIO.rules.blocked", data), tone: "peril", actions: null };

  if (systemId === PF2E && Number(speed) > 0) {
    const actions = Math.max(0, Math.ceil(c / Number(speed) - 1e-9));
    const key = actions === 1 ? "GLDIO.rules.pf2eActionsOne" : "GLDIO.rules.pf2eActionsMany";
    return { text: t(key, { ...data, actions }), tone: pf2eTone(actions), actions };
  }

  if (isDH(systemId)) {
    const band = bandFor(distance, gridDistance);
    const within = c <= DH_FREE_SQUARES * (gridDistance || 5) + 1e-9;
    const key = within ? "GLDIO.rules.dhWithin" : "GLDIO.rules.dhBeyond";
    return { text: t(key, { ...data, band: t(`GLDIO.band.${band}`) }), tone: within ? "info" : "warn", actions: null };
  }

  return { text: t("GLDIO.rules.distance", data), tone: "info", actions: null };
}

/**
 * @param {object} o
 * @param {string} o.systemId
 * @param {number} o.distance
 * @param {number} o.gridDistance
 * @param {string} o.units
 * @param {(key:string, data?:object) => string} [o.t]
 * @returns {{text:string, band:string|null}}
 */
export function distanceReadout({ systemId, distance = 0, gridDistance = 5, units = "", t = keyOnly } = {}) {
  const data = { distance: fmtDist(distance), units };
  if (isDH(systemId)) {
    const band = bandFor(distance, gridDistance);
    return { text: t("GLDIO.rules.distanceBand", { ...data, band: t(`GLDIO.band.${band}`) }), band };
  }
  return { text: t("GLDIO.rules.distance", data), band: null };
}

/**
 * A hint for a drop, never applied.
 * PF2e (rules/fall.mjs, Player Core p. 420): half the fall as bludgeoning (and
 * prone) when it is more than 5 ft; into water the fall counts as 20 ft
 * shorter (no deeper than the water; the terrain does not know the depth, so
 * the water is taken as deep enough).
 * @returns {string|null}
 */
export function fallHint({ systemId, dropDist = 0, intoWater = false, depth = Infinity, units = "", t = keyOnly } = {}) {
  const drop = Number(dropDist);
  if (!(drop > 0)) return null;
  const data = { distance: fmtDist(drop), units };
  if (systemId === PF2E) {
    const f = pf2eFall(drop, { soft: intoWater, depth });
    if (f.effective <= PF2E_SAFE_FALL || f.damage <= 0) return t("GLDIO.rules.fallSafe", data);
    return t(intoWater ? "GLDIO.rules.fallPf2eWater" : "GLDIO.rules.fallPf2e", { ...data, damage: f.damage });
  }
  return t("GLDIO.rules.fall", data);
}

/** A climb mark on a path (any system). */
export function climbHint({ riseDist = 0, units = "", t = keyOnly } = {}) {
  const rise = Number(riseDist);
  if (!(rise > 0)) return null;
  return t("GLDIO.rules.climb", { distance: fmtDist(rise), units });
}

/** Label for a cover result from foundry/cover.mjs (or terrain/occlusion.mjs). */
export function coverText(result, t = keyOnly) {
  if (!result) return null;
  if (!result.lineOfSight) return t("GLDIO.rules.noLineOfSight");
  return t(`GLDIO.cover.${result.cover}`);
}

/** Every value of the dynamic families, for the check tool. */
export const COVER_VALUES = Object.freeze(["none", "standard", "greater"]);

/** Every literal key this module can return (the check tool holds the lang file to it). */
export const RULE_KEYS = Object.freeze([
  "GLDIO.rules.climb",
  "GLDIO.rules.noLineOfSight",
  "GLDIO.rules.backendConflict",
  "GLDIO.rules.blocked",
  "GLDIO.rules.pf2eActionsOne",
  "GLDIO.rules.pf2eActionsMany",
  "GLDIO.rules.dhWithin",
  "GLDIO.rules.dhBeyond",
  "GLDIO.rules.distance",
  "GLDIO.rules.distanceBand",
  "GLDIO.rules.fall",
  "GLDIO.rules.fallSafe",
  "GLDIO.rules.fallPf2e",
  "GLDIO.rules.fallPf2eWater",
]);
