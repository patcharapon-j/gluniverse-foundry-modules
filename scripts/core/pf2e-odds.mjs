/**
 * PF2e odds — the engine behind every percentage the suite shows.
 *
 * Pure and dependency-free apart from the degree helper, so the check tools and
 * the preview page load it under plain Node. Nothing here reads `game`.
 *
 * ## The unit is the d20 face
 *
 * A check is twenty faces, each of which lands on exactly one degree. Every
 * number the feature prints is derived from those twenty answers, never from a
 * closed-form "chance to hit": that is the only way the three things PF2e does
 * per face come out right at the same time —
 *
 *   • the natural 20 / natural 1 step (`core/pf2e-degree.mjs`);
 *   • degree-of-success adjustments (Evasion, Juggernaut, incapacitation…),
 *     whose predicates may test the natural and the total, so they genuinely
 *     differ face by face;
 *   • fortune and misfortune, which do not change any face's degree but weight
 *     the faces unevenly (keep-higher makes a 20 thirty-nine times likelier
 *     than a 1).
 *
 * ## A DC is a number, a range, or unknown
 *
 * What a player knows about a defence narrows over a fight (docs/PF2E_ODDS.md,
 * "Knowledge"). A range is not averaged: a face is *certain* when it lands on
 * the same degree across the whole range and *uncertain* otherwise, carrying
 * the lowest and highest degree it could be. The headline is then a range too,
 * and it collapses to a single number exactly when every face is certain.
 *
 * ## Mirroring PF2e's DegreeOfSuccess
 *
 * `faceDegree` reproduces PF2e 8.x `DegreeOfSuccess` (pf2e.mjs, the class of
 * that name) and the adjustment reduce inside `Check.roll`: the unadjusted
 * degree includes the natural step; the adjustments whose predicates pass are
 * reduced into one map keyed `all` / degree key, later entries winning; the
 * FIRST of `all, criticalFailure … criticalSuccess` that applies to the
 * unadjusted degree is used, and an "increase" on a critical success or a
 * "lower" on a critical failure does not count as applying. One adjustment per
 * roll, never two. `tools/pf2e-odds-check.mjs` pins all of it.
 */

import { DEGREE_KEYS, adjustDegreeForNatural, baseDegree } from "./pf2e-degree.mjs";

export { DEGREE_KEYS };

export const CRIT_FAIL = 0;
export const FAILURE = 1;
export const SUCCESS = 2;
export const CRIT_SUCCESS = 3;

/** PF2e's named adjustment amounts. A string amount pins the degree outright. */
const AMOUNTS = Object.freeze({
  "one-degree-better": 1,
  "one-degree-worse": -1,
  "two-degrees-better": 2,
  "two-degrees-worse": -2,
});
const PINS = Object.freeze({ criticalFailure: 0, failure: 1, success: 2, criticalSuccess: 3 });

/** Concealed and hidden, the two flat checks that stand in front of a Strike. */
export const FLAT_CHECKS = Object.freeze({ concealed: 5, hidden: 11 });

/** One face's probability of passing a flat check of this DC. */
export function flatChance(dc) {
  if (!Number.isFinite(dc)) return 1;
  return Math.max(0, Math.min(20, 21 - dc)) / 20;
}

/**
 * How often each face is the one kept.
 *
 * keep-higher: P(max = k) = (k² − (k−1)²) / 400 = (2k − 1) / 400.
 * keep-lower is its mirror. PF2e rolls a flat 1d20 when fortune and
 * misfortune both apply, which callers pass as `false`.
 */
export function faceWeights(rollTwice = false) {
  const w = new Array(20);
  for (let k = 1; k <= 20; k++) {
    w[k - 1] = rollTwice === "keep-higher" ? (2 * k - 1) / 400 : rollTwice === "keep-lower" ? (41 - 2 * k) / 400 : 1 / 20;
  }
  return w;
}

/** The roll options PF2e adds after the dice land, which adjustment predicates may test. */
export function landedOptions(face, total, dc) {
  const out = [`check:total:${total}`, `check:total:natural:${face}`, `check:roll:total:natural:${face}`];
  if (Number.isFinite(dc)) out.push(`check:total:delta:${total - dc}`);
  return out;
}

function amountOf(amount) {
  if (typeof amount === "number") return amount;
  if (amount in AMOUNTS) return AMOUNTS[amount];
  return amount;
}

function applyAmount(amount, degree) {
  const a = amountOf(amount);
  if (typeof a === "string") return a in PINS ? PINS[a] : degree;
  return Math.max(0, Math.min(3, degree + a));
}

/**
 * Reduce adjustment entries into PF2e's map, keeping only those whose
 * predicate passes on these options.
 *
 * @param {Array<{adjustments: object, test?: (opts: Set<string>) => boolean}>} dos
 */
export function reduceAdjustments(dos, options) {
  const map = {};
  for (const entry of dos ?? []) {
    if (entry?.test && !entry.test(options)) continue;
    for (const key of ["all", ...DEGREE_KEYS]) {
      const adj = entry?.adjustments?.[key];
      if (adj) map[key] = { label: adj.label ?? "", amount: adj.amount };
    }
  }
  return map;
}

/** PF2e's #getDegreeAdjustment: the first entry that applies to this degree, or null. */
export function pickAdjustment(unadjusted, map) {
  for (const key of ["all", ...DEGREE_KEYS]) {
    const adj = map?.[key];
    if (!adj?.amount || !adj.label) continue;
    const a = amountOf(adj.amount);
    if (unadjusted === CRIT_SUCCESS && a === 1) continue;
    if (unadjusted === CRIT_FAIL && a === -1) continue;
    if (key === "all" || DEGREE_KEYS.indexOf(key) === unadjusted) return adj;
  }
  return null;
}

/**
 * The degree one face lands on against one DC.
 * @returns {{degree: number, unadjusted: number, adjustment: string|null}}
 */
export function faceDegree(face, mod, dc, { dos = null, baseOptions = null } = {}) {
  const total = face + mod;
  const unadjusted = adjustDegreeForNatural(baseDegree(total, dc), face);
  if (!dos?.length) return { degree: unadjusted, unadjusted, adjustment: null };
  const options = new Set([...(baseOptions ?? []), ...landedOptions(face, total, dc)]);
  const adj = pickAdjustment(unadjusted, reduceAdjustments(dos, options));
  if (!adj) return { degree: unadjusted, unadjusted, adjustment: null };
  return { degree: applyAmount(adj.amount, unadjusted), unadjusted, adjustment: adj.label };
}

/* ── DCs as knowledge ────────────────────────────────────────────────────── */

/**
 * Normalise what is known about a DC into `{lo, hi}` or null (nothing known).
 * A number is an exact DC; `{lo, hi}` with either end open is clamped to a
 * window wide enough that every face is already decided past it.
 */
export function dcRange(dc, mod = 0) {
  if (dc == null) return null;
  if (Number.isFinite(dc)) return { lo: dc, hi: dc };
  const lo = Number.isFinite(dc.lo) ? dc.lo : mod + 1 - 10;
  const hi = Number.isFinite(dc.hi) ? dc.hi : mod + 20 + 11;
  if (lo > hi) return null;
  return { lo, hi };
}

export const isExact = (range) => !!range && range.lo === range.hi;

/**
 * Every face of a check against a known, partly known or unknown DC.
 *
 * @param {{mod: number, dc: number|{lo:number,hi:number}|null, dos?: Array, baseOptions?: Iterable<string>}} spec
 * @returns {Array<{face: number, lo: number, hi: number, certain: boolean, adjustments: string[]}>}
 */
export function faces({ mod, dc, dos = null, baseOptions = null }) {
  const range = dcRange(dc, mod);
  const out = [];
  for (let face = 1; face <= 20; face++) {
    if (!range) {
      out.push({ face, lo: CRIT_FAIL, hi: CRIT_SUCCESS, certain: false, adjustments: [] });
      continue;
    }
    let lo = 3;
    let hi = 0;
    const labels = new Set();
    for (let d = range.lo; d <= range.hi; d++) {
      const r = faceDegree(face, mod, d, { dos, baseOptions });
      lo = Math.min(lo, r.degree);
      hi = Math.max(hi, r.degree);
      if (r.adjustment) labels.add(r.adjustment);
    }
    out.push({ face, lo, hi, certain: lo === hi, adjustments: [...labels] });
  }
  return out;
}

/**
 * The chance of landing on `degree` or better, as a range.
 * A face counts toward the floor only when its worst case qualifies, and
 * toward the ceiling when its best case does.
 */
export function chanceAtLeast(faceList, degree, weights = faceWeights()) {
  let lo = 0;
  let hi = 0;
  faceList.forEach((f, i) => {
    if (f.lo >= degree) lo += weights[i];
    if (f.hi >= degree) hi += weights[i];
  });
  return { lo: round4(lo), hi: round4(hi) };
}

/** The chance of landing on exactly `degree`, as a range. */
export function chanceExactly(faceList, degree, weights = faceWeights()) {
  let lo = 0;
  let hi = 0;
  faceList.forEach((f, i) => {
    if (f.lo === degree && f.hi === degree) lo += weights[i];
    if (f.lo <= degree && f.hi >= degree) hi += weights[i];
  });
  return { lo: round4(lo), hi: round4(hi) };
}

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * Everything a surface draws for one check.
 *
 * @param {{
 *   mod: number,
 *   dc: number|{lo:number,hi:number}|null,
 *   dos?: Array, baseOptions?: Iterable<string>,
 *   rollTwice?: false|"keep-higher"|"keep-lower",
 *   flatDc?: number|null,
 *   goal?: number,        // the degree the roller wants: SUCCESS for a Strike
 *   invert?: boolean,     // the roller is the TARGET (a save against your spell):
 *                         // the headline is the chance they do worse than `goal`
 * }} spec
 */
export function oddsOf(spec) {
  const { mod, dc, dos = null, baseOptions = null, rollTwice = false, flatDc = null, goal = SUCCESS, invert = false } = spec;
  const list = faces({ mod, dc, dos, baseOptions });
  const weights = faceWeights(rollTwice);
  const range = dcRange(dc, mod);
  const flat = flatChance(flatDc);
  const atLeast = chanceAtLeast(list, goal, weights);
  const crit = chanceAtLeast(list, CRIT_SUCCESS, weights);
  const critFail = chanceExactly(list, CRIT_FAIL, weights);
  const known = !!range;

  // Inverted: a save against the caster's DC. The caster's "it works" is the
  // target landing BELOW `goal`, so the floor and ceiling swap.
  const raw = invert ? { lo: round4(1 - atLeast.hi), hi: round4(1 - atLeast.lo) } : atLeast;
  const headline = known ? { lo: round4(raw.lo * flat), hi: round4(raw.hi * flat) } : null;
  const adjustments = [...new Set(list.flatMap((f) => f.adjustments))];

  return {
    faces: list,
    weights,
    dc: range,
    exact: isExact(range),
    known,
    headline,
    success: atLeast,
    crit: invert ? critFail : crit,
    critFail: invert ? crit : critFail,
    flat: flatDc == null ? null : { dc: flatDc, chance: flat },
    adjustments,
    rollTwice: rollTwice || false,
  };
}

/** Percent, whole numbers: a d20 never resolves finer than 5% without fortune. */
export const pct = (p) => Math.round(p * 100);

/** `55–70%`, `60%`, or null for unknown. */
export function formatRange(range) {
  if (!range) return null;
  const lo = pct(range.lo);
  const hi = pct(range.hi);
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}

/* ── Observation: what one roll proves about a DC ───────────────────────── */

/**
 * The DC interval one observed roll proves.
 *
 * `degree` is PF2e's UNADJUSTED outcome (`context.unadjustedOutcome`), which
 * includes the natural step and nothing else. The natural step is unwound
 * first; a natural 20 that came out a critical success could have been a plain
 * success or a critical one, so both bands are allowed and the result is their
 * hull (adjacent bands are contiguous, so the hull adds nothing false).
 *
 * @returns {{lo: number, hi: number}|null}  ends may be ±Infinity
 */
export function boundsFromRoll({ total, natural = null, degree }) {
  if (!Number.isFinite(total) || !Number.isInteger(degree) || degree < 0 || degree > 3) return null;
  const bases = new Set();
  if (natural === 20) {
    bases.add(degree - 1);
    if (degree === CRIT_SUCCESS) bases.add(CRIT_SUCCESS);
  } else if (natural === 1) {
    bases.add(degree + 1);
    if (degree === CRIT_FAIL) bases.add(CRIT_FAIL);
  } else {
    bases.add(degree);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bases) {
    if (b < 0 || b > 3) continue;
    const band = bandFor(b, total);
    lo = Math.min(lo, band.lo);
    hi = Math.max(hi, band.hi);
  }
  return lo > hi ? null : { lo, hi };
}

/** The DCs for which `total` lands in base band `b`. */
function bandFor(b, total) {
  switch (b) {
    case CRIT_SUCCESS: return { lo: -Infinity, hi: total - 10 };
    case SUCCESS: return { lo: total - 9, hi: total };
    case FAILURE: return { lo: total + 1, hi: total + 9 };
    default: return { lo: total + 10, hi: Infinity };
  }
}

/** Two intervals' overlap, or null when they do not meet. */
export function intersect(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  return lo > hi ? null : { lo, hi };
}

/**
 * Fold one observation into what was known.
 *
 * A contradiction (the new proof and the old range do not meet) means
 * something the players could not see moved the number — a hidden buff, a
 * GM's edit. The ledger never sticks at "impossible": it resets to the newest
 * observation and says so, and the GM's view flags it.
 *
 * @returns {{range: {lo,hi}|null, contradiction: boolean, changed: boolean}}
 */
export function narrow(prev, proof) {
  if (!proof) return { range: prev ? { ...prev } : null, contradiction: false, changed: false };
  const next = intersect(prev, proof);
  if (!next) return { range: { ...proof }, contradiction: true, changed: true };
  const changed = !prev || next.lo !== prev.lo || next.hi !== prev.hi;
  return { range: next, contradiction: false, changed };
}

/** Shift an interval by `delta` (normalising a DC to its base stat or back). */
export function shift(range, delta) {
  if (!range || !Number.isFinite(delta)) return range ? { ...range } : null;
  return { lo: range.lo + delta, hi: range.hi + delta };
}

/**
 * An interval made safe to store: JSON has no Infinity, so open ends are
 * written as null and read back as open.
 */
export const storeRange = (r) => (r ? { lo: Number.isFinite(r.lo) ? r.lo : null, hi: Number.isFinite(r.hi) ? r.hi : null } : null);
export const loadRange = (r) =>
  r && typeof r === "object" ? { lo: Number.isFinite(r.lo) ? r.lo : -Infinity, hi: Number.isFinite(r.hi) ? r.hi : Infinity } : null;

/* ── Multiple attack penalty ─────────────────────────────────────────────── */

/** The MAP for the `index`th attack this turn (0-based), agile or not. */
export function mapPenalty(index, agile = false) {
  const i = Math.max(0, Math.min(2, index | 0));
  if (i === 0) return 0;
  return i === 1 ? (agile ? -4 : -5) : agile ? -8 : -10;
}
