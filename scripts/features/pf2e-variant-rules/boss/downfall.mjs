/**
 * Boss Creatures — Downfalls, and the defence penalty they impose.
 *
 * A Downfall is the party's lever on a boss, so the state behind it has to be
 * exactly right or the lever stops working in a way nobody at the table can see.
 * Three things are load-bearing here.
 *
 * The two locks are different locks. A boss suffers at most one Downfall per
 * boss *turn*, and is immune to a specific trigger until the beginning of its
 * next *initial* turn. A Supreme boss takes three turns between initial turns,
 * so collapsing the two into one would let the same critical hit disrupt it
 * twice in a round.
 *
 * The penalty counts *separate* Downfalls, not triggerings. Two hits on the same
 * Downfall is still −1; two different Downfalls is −2. Counting triggerings
 * reaches −3 roughly twice as fast and nothing about the boss looks wrong.
 *
 * And the penalty is deliberately not something the boss can shed: "Unlike other
 * conditions and negative effects, a boss cannot use Boss Denial to remove these
 * penalties." It is cleared by the clock — the boss's next initial turn — and by
 * nothing else, which is why it lives in combatant state rather than in an
 * effect item a GM could delete off the token.
 */

import { SUITE_ID, warn } from "../../../core/const.mjs";
import { BOSS_FLAGS, DEFENCE_SELECTORS, DOWNFALL_SLUG } from "./constants.mjs";
import { downfallAvailable, downfallPenalty } from "./rules.mjs";
import { bossProfile } from "./profile.mjs";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/**
 * The blank state a combatant starts a fight in.
 *
 * `fired` is an array of Downfall ids rather than a map of id → round, and that
 * is not a style choice: `setFlag` merges, so writing `{}` over an object does
 * nothing at all. Clearing the per-trigger immunities at the boss's initial turn
 * silently failed, leaving every Downfall single-use for the whole encounter
 * instead of once per round. An array is replaced wholesale, so `[]` clears.
 * The round is already carried by `roundSerial`; the map was storing it twice.
 */
const EMPTY = Object.freeze({
  turnSerial: 0,
  roundSerial: 0,
  fired: [],
  lastTurn: null,
  triggered: [],
  telegraph: null,
});

export function readState(combatant) {
  const raw = combatant?.getFlag?.(SUITE_ID, BOSS_FLAGS.state);
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  return {
    turnSerial: Math.max(0, Math.trunc(Number(raw.turnSerial) || 0)),
    roundSerial: Math.max(0, Math.trunc(Number(raw.roundSerial) || 0)),
    fired: Array.isArray(raw.fired) ? raw.fired.filter((id) => typeof id === "string") : [],
    // `Number(null)` is 0 and `Number.isFinite(0)` is true, so coercing here
    // turned "this boss has never suffered a Downfall" into "it suffered one on
    // turn 0" — and with `turnSerial` also starting at 0 the very first Downfall
    // of an encounter was refused as already spent, with nothing to see but a
    // greyed-out button.
    lastTurn: typeof raw.lastTurn === "number" && Number.isFinite(raw.lastTurn) ? raw.lastTurn : null,
    triggered: Array.isArray(raw.triggered) ? raw.triggered.filter((id) => typeof id === "string") : [],
    telegraph: raw.telegraph && typeof raw.telegraph === "object" ? { ...raw.telegraph } : null,
  };
}

async function writeState(combatant, state) {
  try {
    await combatant.setFlag(SUITE_ID, BOSS_FLAGS.state, state);
  } catch (error) {
    warn("pf2e-variant-rules | could not write boss state", error);
  }
}

/** The penalty this boss is currently under, as a negative number or 0. */
export function currentPenalty(combatant) {
  return downfallPenalty(readState(combatant).triggered.length);
}

/** Can this specific Downfall be triggered right now? */
export function canTrigger(combatant, downfallId) {
  const state = readState(combatant);
  return downfallAvailable({
    turnSerial: state.turnSerial,
    roundSerial: state.roundSerial,
    lastTurn: state.lastTurn,
    lastRound: state.fired.includes(downfallId) ? state.roundSerial : null,
  });
}

/**
 * Fire one Downfall.
 *
 * Returns what happened rather than a boolean, because the caller has to say so
 * in chat: which lock refused it, what the penalty climbed to, and whether a
 * telegraphed ability was disrupted along the way.
 */
export async function triggerDownfall(combatant, downfallId) {
  const actor = combatant?.actor;
  if (!actor || !bossProfile(actor)) return { applied: false, reason: "notBoss" };

  const state = readState(combatant);
  if (state.lastTurn === state.turnSerial) return { applied: false, reason: "spent" };
  if (state.fired.includes(downfallId)) return { applied: false, reason: "immune" };

  // Separate Downfalls stack; the same one twice does not.
  const triggered = state.triggered.includes(downfallId)
    ? state.triggered
    : [...state.triggered, downfallId];

  const disrupted = state.telegraph;
  const next = {
    ...state,
    triggered,
    lastTurn: state.turnSerial,
    fired: state.fired.includes(downfallId) ? state.fired : [...state.fired, downfallId],
    // "any Telegraphs currently active are disrupted" — and a disrupted
    // Telegraph means the ability cannot be used at all, not merely delayed.
    telegraph: null,
  };
  await writeState(combatant, next);
  await syncPenalty(combatant, downfallPenalty(triggered.length));

  return { applied: true, penalty: downfallPenalty(triggered.length), disrupted };
}

/**
 * Push the defence penalty onto the actor as a custom modifier.
 *
 * `system.customModifiers` is the seam PF2e leaves open for exactly this:
 * `prepareSynthetics` pushes every key of it into `synthetics.modifiers` with no
 * allow-list, so a penalty lands on AC and the three saves without an effect
 * item or a rule element. `addCustomModifier` refuses a duplicate *label*, so a
 * penalty climbing from −1 to −2 has to be removed and re-added rather than
 * updated in place.
 *
 * The removal has to find what is actually there. `addCustomModifier` slugs the
 * *label* it was given and stores that, so removing by a slug of this feature's
 * own choosing matches nothing — and `removeCustomModifier` does not complain
 * about a slug it cannot find, it simply returns. The old modifier would stay,
 * the new one would be refused as a duplicate label, and the penalty would sit
 * at −1 however many Downfalls landed. So the entries are found by label and
 * removed by whatever slug they carry.
 */
export async function syncPenalty(combatant, penalty) {
  const actor = combatant?.actor;
  if (!actor?.addCustomModifier) return;

  const label = L("GLVR.boss.downfalls.modifier");
  for (const selector of DEFENCE_SELECTORS) {
    const slugs = new Set([DOWNFALL_SLUG]);
    for (const entry of actor.system?.customModifiers?.[selector] ?? []) {
      if (entry?.label === label && entry?.slug) slugs.add(entry.slug);
    }
    for (const slug of slugs) {
      try {
        await actor.removeCustomModifier(selector, slug);
      } catch {
        /* nothing to remove is the normal case */
      }
    }
  }
  if (penalty >= 0) return;

  for (const selector of DEFENCE_SELECTORS) {
    try {
      await actor.addCustomModifier(selector, label, penalty, "untyped");
    } catch (error) {
      warn(`pf2e-variant-rules | could not apply the downfall penalty to ${selector}`, error);
    }
  }
}

/** Clear every Downfall and its penalty. Called at the boss's initial turn. */
export async function clearDownfalls(combatant) {
  const state = readState(combatant);
  await writeState(combatant, { ...state, triggered: [], fired: [] });
  await syncPenalty(combatant, 0);
}

/* ── The clock ───────────────────────────────────────────────────────────── */

/**
 * Advance the boss's own turn counters.
 *
 * `initial` marks the boss's first turn of a round, which is the beat that
 * clears the Downfall penalties and the per-trigger immunities. Every other boss
 * turn only advances `turnSerial`, which is what re-arms the once-per-turn lock.
 */
export async function advanceTurn(combatant, { initial = false } = {}) {
  const state = readState(combatant);
  const next = {
    ...state,
    turnSerial: state.turnSerial + 1,
    roundSerial: initial ? state.roundSerial + 1 : state.roundSerial,
  };

  if (initial) {
    next.triggered = [];
    next.fired = [];
  }
  await writeState(combatant, next);
  if (initial) await syncPenalty(combatant, 0);
  return next;
}

/* ── Telegraph ───────────────────────────────────────────────────────────── */

/** Record what the boss has signalled, so a Downfall knows what to disrupt. */
export async function setTelegraph(combatant, ability, target = null) {
  const state = readState(combatant);
  await writeState(combatant, { ...state, telegraph: ability ? { ability, target } : null });
}

export function readTelegraph(combatant) {
  return readState(combatant).telegraph;
}

/** Wipe every trace of boss state, for when a boss leaves the encounter. */
export async function resetState(combatant) {
  await syncPenalty(combatant, 0);
  try {
    await combatant.unsetFlag(SUITE_ID, BOSS_FLAGS.state);
  } catch {
    /* a combatant already gone needs no cleanup */
  }
}
