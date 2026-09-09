/**
 * Creaturedexing — the rules, as arithmetic.
 *
 * Pure and Foundry-free so `tools/creaturedex-check.mjs` can exercise every one
 * of them under plain Node. Nothing here reads a setting, a flag or a document;
 * callers pass the world in and get a decision back.
 *
 * Note what is **not** here: nothing reads a Recall Knowledge roll. A reveal is
 * the GM's click, so there is no outcome to convert into a section count, no
 * offer to spend down and no repeat-attempt ledger. The book's roll is still
 * the fiction; it is simply not the trigger.
 */

import { OUTCOME } from "./constants.mjs";

/**
 * Is this subject's creaturedex complete?
 *
 *   "If a subject does not have three sections in its stat block, such as a
 *    simple hazard, you need only reveal the number of sections it has
 *    available."
 *
 * So completion is measured against the sections this subject actually has, not
 * against the number three. A simple hazard with one section completes on one
 * reveal, and a subject with no sections at all is not completable — returning
 * true there would hand out Discerning Aid for knowing nothing.
 */
export function isComplete(known, available) {
  const have = new Set(known ?? []);
  const need = (available ?? []).filter(Boolean);
  if (!need.length) return false;
  return need.every((key) => have.has(key));
}

/** Sections still unknown, in the subject's own printed order. */
export const missingSections = (known, available) => {
  const have = new Set(known ?? []);
  return (available ?? []).filter((key) => !have.has(key));
};

/**
 * The circumstance bonus Discerning Aid hands the ally.
 *
 *   "Your result provides a circumstance bonus of the same value as the Aid
 *    reaction, including imposing a penalty on a critical failure and
 *    increasing the circumstance bonus if you are a master or legendary in the
 *    skill you used to Recall Knowledge."
 *
 * Aid's own table, keyed on the degree of success of the Aid check and on the
 * proficiency rank of the skill the knowledge was gained with.
 */
export function aidBonus(outcome, rank = "trained") {
  if (outcome === OUTCOME.critSuccess) {
    if (rank === "legendary") return 4;
    if (rank === "master") return 3;
    return 2;
  }
  if (outcome === OUTCOME.success) return 1;
  if (outcome === OUTCOME.critFailure) return -1;
  return 0;
}

/* ── doctoring a section into a lie ──────────────────────────────────────── */

/**
 * The die ladder a damage step moves along. One step, never two — a d4 that
 * became a d12 is not a lie, it is a typo.
 */
const DICE = [4, 6, 8, 10, 12];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * A signed drift of at most `spread`, never zero.
 *
 * Never zero matters: a doctoring pass that rolls 0 on the one row a player
 * checks has produced a "lie" that is the truth, and the GM has no way to see
 * that from the dialog. Every row this touches actually moves.
 */
function drift(rng, spread) {
  const size = 1 + Math.floor(rng() * spread);
  return rng() < 0.5 ? -size : size;
}

/** Shift every integer in a string by `fn`, leaving the prose around it alone. */
const shiftNumbers = (text, fn) => String(text ?? "").replace(/-?\d+/g, (m) => String(fn(Number(m))));

/** `+14, +9, +4` and `Fort +12, Ref +8, Will +10` keep their signs. */
const shiftSigned = (text, fn) =>
  String(text ?? "").replace(/([+-])(\d+)/g, (_m, sign, digits) => {
    const value = fn(Number(`${sign}${digits}`));
    return `${value >= 0 ? "+" : "-"}${Math.abs(value)}`;
  });

/**
 * Perturb one real section into a plausible false one.
 *
 * The constraint the book's critical failure puts on us is sharp: a lie has to
 * be *plausible enough to act on* and must not silently delete a player's whole
 * kit on one bad roll. So the drift is bounded per row type, and two categories
 * are refused outright.
 *
 * **Immunities are never touched, in either direction.** Removing one is the
 * case the design brief named: the poison-focused rogue empties their kit into
 * a creature that was never going to care, and a random pass chose that, not
 * the GM. Adding a false immunity costs exactly the same thing from the other
 * side — the rogue reads "immune to poison" and never tries at all — so the row
 * is passed through untouched and the GM writes that lie by hand if they want
 * it. Weaknesses and resistances *are* fair game, but only behind `iwr`,
 * because burning your best spell for nothing costs a turn rather than a build.
 *
 * `rng` is injected so this is deterministic under test and so a GM pressing
 * "reroll" in the dialog gets a genuinely different lie rather than the same
 * one from a cached seed.
 */
export function doctorSection(section, { rng = Math.random, iwr = false } = {}) {
  if (!section || typeof section !== "object") return section;
  const out = JSON.parse(JSON.stringify(section));

  out.rows = (out.rows ?? []).map((r) => {
    const row = { ...r };
    switch (row.key) {
      case "ac":
      case "perception":
      case "stealth":
      case "hardness":
        row.value = shiftNumbers(row.value, (n) => Math.max(0, n + drift(rng, 2)));
        break;
      case "saves":
        row.value = shiftSigned(row.value, (n) => n + drift(rng, 2));
        break;
      case "hp":
        row.value = shiftNumbers(row.value, (n) => Math.max(1, Math.round(n * (1 + drift(rng, 2) * 0.1))));
        break;
      case "speed":
        row.value = shiftNumbers(row.value, (n) => Math.max(5, n + drift(rng, 1) * 5));
        break;
      case "weaknesses":
      case "resistances":
        if (iwr) row.value = shiftNumbers(row.value, (n) => Math.max(1, n + drift(rng, 1) * 5));
        break;
      // `immunities` and everything descriptive fall through untouched.
      default:
        break;
    }
    return row;
  });

  for (const kind of ["melee", "ranged"]) {
    for (const strike of out.strikes?.[kind] ?? []) {
      strike.bonus = shiftSigned(strike.bonus, (n) => n + drift(rng, 2));
      strike.damage = String(strike.damage ?? "").replace(/(\d+)d(\d+)/g, (m, count, faces) => {
        const at = DICE.indexOf(Number(faces));
        if (at < 0) return m;
        return `${count}d${DICE[clamp(at + (rng() < 0.5 ? -1 : 1), 0, DICE.length - 1)]}`;
      });
    }
  }

  return out;
}
