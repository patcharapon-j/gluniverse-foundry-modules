/**
 * Multiple attack penalty tracking — the pure half.
 *
 * PF2e does not track MAP: a Strike shows three buttons and the player picks.
 * The odds badge has to show ONE number, so it counts. State per actor:
 *
 *   { count, at, override, turn }
 *
 *   count     attack-trait checks so far this turn, capped at 2 (the third
 *             attack and every one after it take the same penalty)
 *   at        when the last one landed (ms), for the out-of-combat reset
 *   override  a manual 0/1/2 the player clicked onto the chip, or null; it
 *             holds until the next reset
 *   turn      the combat turn key the count belongs to, so a stale count from
 *             last round never leaks into this one
 *
 * Which variant a check was is PF2e's own `context.mapIncreases` when it is
 * there — a player who clicked the third button has made their third attack,
 * whatever we had counted.
 */

export const blank = () => ({ count: 0, at: 0, override: null, turn: null });

/** Whether a PF2e check context is an attack for MAP purposes. */
export function isAttack(context) {
  if (!context) return false;
  if (context.type === "damage-roll" || context.type === "damage-taken") return false;
  if (context.type === "attack-roll" || context.type === "spell-attack-roll") return true;
  const traits = (context.traits ?? []).map((t) => (typeof t === "string" ? t : t?.name));
  if (traits.includes("attack")) return true;
  return (context.options ?? []).includes?.("trait:attack") ?? false;
}

/**
 * Fold one attack in.
 * @param {object} state
 * @param {{at: number, turn: string|null, mapIncreases?: number|null}} hit
 */
export function recordAttack(state, { at, turn, mapIncreases = null, resetMs = Infinity }) {
  // Out of combat both turn keys are null, so expiry has to be asked for here
  // too: a stale count carried into a fresh attack makes it the third.
  const live = state && state.turn === turn && (turn != null || at - state.at <= resetMs);
  const s = live ? { ...state } : { ...blank(), turn };
  const prior = Number.isInteger(mapIncreases) ? Math.max(s.count, mapIncreases) : s.count;
  s.count = Math.min(2, prior + 1);
  // A manual step is a correction to the count, not a freeze: the attack after
  // it still moves the penalty on.
  if (s.override != null) s.override = Math.min(2, Math.max(s.override, prior) + 1);
  s.at = at;
  return s;
}

/**
 * The attack index (0, 1, 2) the NEXT attack will be.
 * @param {object} state
 * @param {{now: number, turn: string|null, resetMs: number, inCombat: boolean}} ctx
 */
export function nextIndex(state, { now, turn, resetMs, inCombat }) {
  if (!state) return { index: 0, manual: false };
  if (inCombat ? state.turn !== turn : now - state.at > resetMs) return { index: 0, manual: false };
  if (state.override != null) return { index: state.override, manual: true };
  return { index: Math.min(2, state.count), manual: false };
}

/** The chip's click: 0 → 1 → 2 → 0, starting from what it shows now. */
export function cycle(state, shown, { now = 0, turn = null } = {}) {
  const s = state && state.turn === turn ? { ...state } : { ...blank(), turn };
  s.override = (shown + 1) % 3;
  s.at = now;
  return s;
}
