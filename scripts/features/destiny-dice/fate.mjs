/**
 * A fate, as data: what is stored on the message and what it did to the check.
 *
 * Pure. Every read of `flags[SUITE_ID]["dd.fate"]` goes through `normalizeFate`,
 * so the strip never prints `undefined` for a fate the standalone module wrote.
 */

import { DEGREE_KEYS, adjustDegreeForNatural, baseDegree } from "../../core/pf2e-degree.mjs";
import { pickAdjustment } from "../../core/pf2e-odds.mjs";
import { FACE_NUMBERS } from "./constants.mjs";
import { normalizeBonus, normalizeKind } from "./faces.mjs";

const degreeIndex = (key) => (typeof key === "string" ? DEGREE_KEYS.indexOf(key) : -1);
const degreeKey = (value) => (Number.isInteger(value) && value >= 0 && value <= 3 ? DEGREE_KEYS[value] : null);

/**
 * A stored fate → a fate every renderer can trust, or null.
 *
 * Old flags carry `accepted: null | false` from the standalone module's accept
 * step; `false` still renders as refused. `before`/`after` are new and absent on
 * every message written before this version, which simply shows no shift.
 */
export function normalizeFate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const face = Number(raw.face);
  if (!FACE_NUMBERS.includes(face)) return null;
  const kind = normalizeKind(raw.kind);
  const before = degreeKey(degreeIndex(raw.before));
  const after = degreeKey(degreeIndex(raw.after));
  return {
    face,
    kind,
    bonus: normalizeBonus(raw.bonus),
    source: typeof raw.source === "string" ? raw.source : "manual",
    user: typeof raw.user === "string" ? raw.user : null,
    appliedAt: Number.isFinite(raw.appliedAt) ? raw.appliedAt : null,
    accepted: raw.accepted === false ? false : null,
    bonusApplied: raw.bonusApplied === true,
    before,
    after,
  };
}

/**
 * The degree a check lands on with `bonus` added, by PF2e's own rule.
 *
 * PF2e's DegreeOfSuccess: ±10 bands against the DC, then one step for a natural
 * 20 or 1 (that result is what PF2e calls *unadjusted*), then the first of the
 * actor's degree adjustments that applies (Juggernaut and the like), which PF2e
 * stores reduced on `flags.pf2e.context.dosAdjustments`. The old version of this
 * feature stopped after the natural step, so a fate on a Juggernaut fighter's
 * Fortitude save threw the adjustment away, and it stored the pre-natural band
 * as `unadjustedOutcome`, which is not what PF2e means by it.
 *
 * @param {{ total: number, bonus: number, dc: number, natural: number|null, dosAdjustments?: object }} check
 * @returns {null | { before: string, after: string, unadjusted: string }}
 */
export function shiftDegree({ total, bonus, dc, natural = null, dosAdjustments = null }) {
  if (!Number.isFinite(total) || !Number.isFinite(dc)) return null;
  const land = (t) => {
    const unadjusted = adjustDegreeForNatural(baseDegree(t, dc), natural);
    const adj = pickAdjustment(unadjusted, dosAdjustments);
    return { unadjusted, value: adj ? applyAdjustment(adj.amount, unadjusted) : unadjusted };
  };
  const was = land(total);
  const now = land(total + (Number(bonus) || 0));
  return { before: DEGREE_KEYS[was.value], after: DEGREE_KEYS[now.value], unadjusted: DEGREE_KEYS[now.unadjusted] };
}

/* PF2e's #adjustDegreeOfSuccess: a named degree pins, a number steps (clamped). */
export function applyAdjustment(amount, degree) {
  const pinned = degreeIndex(amount);
  if (pinned >= 0) return pinned;
  const step = Number(amount);
  if (!Number.isFinite(step)) return degree;
  return Math.max(0, Math.min(3, degree + step));
}

/**
 * The natural d20 of a check roll's JSON, PF2e's way: the first d20 term's total
 * (so keep-higher reads the kept die). Null when there is no single d20.
 */
export function naturalOf(rollData) {
  const terms = rollData?.terms ?? [];
  const d20 = terms.find((t) => (t?.class === "Die" || t?.faces === 20) && Number(t?.faces) === 20);
  if (!d20) return null;
  const active = (d20.results ?? []).filter((r) => r?.active !== false && !r?.discarded);
  if (!active.length) return null;
  const value = active.length === 1 ? active[0].result : Math.max(...active.map((r) => r.result));
  return Number.isInteger(value) ? value : null;
}
