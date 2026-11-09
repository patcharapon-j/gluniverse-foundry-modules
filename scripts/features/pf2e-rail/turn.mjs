/**
 * PF2e HUD — the turn: the actions you have left, the reaction and the MAP
 * step, counted on THIS screen and nowhere else.
 *
 * The count is deliberately local. It is drained by the rail's own presses,
 * filled when your turn comes round, and never stored, synced or written to
 * the actor: a roll made from the sheet or a macro does not drain it, and
 * the player may correct it by pressing a diamond. It is a tally, not a rule
 * PF2e enforces, so nothing else may read it as one.
 *
 * Pure: the host owns one `Turn` per actor and feeds it the combat.
 */

/** The actions a turn starts with: three, one more Quickened, fewer Slowed
 *  or Stunned (each takes its value, as PF2e words it). `conds` is the
 *  actor's condition items. */
export function economyOf(conds = []) {
  const v = (slug) => {
    const c = conds.find((x) => x?.slug === slug);
    if (!c) return 0;
    const n = Number(c.system?.value?.value ?? c.value ?? 1);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  /* The note is PF2e's own (localised) condition names, as the chips print them. */
  const said = (slug) => { const c = conds.find((x) => x?.slug === slug); return c ? `${c.name ?? slug}${v(slug) > 1 || c.system?.value?.value ? ` ${v(slug)}` : ""}` : ""; };
  const quick = conds.some((x) => x?.slug === "quickened");
  const slowed = v("slowed"), stunned = v("stunned");
  /* The actions lost to Stunned count toward those lost to Slowed (PF2e): the
     loss is the larger of the two, never their sum. */
  const max = Math.max(0, Math.min(4, 3 + (quick ? 1 : 0) - Math.max(slowed, stunned)));
  const note = slowed || stunned ? [said("stunned"), said("slowed")].filter(Boolean).join(", ") : quick ? said("quickened") : null;
  return { max, ...(note ? { note, tone: quick && !slowed && !stunned ? "good" : "danger" } : {}) };
}

/** One actor's tally. `key` names the turn it belongs to (combat, round,
 *  turn), so a refresh in the same turn keeps what was spent. */
export class Turn {
  constructor() { this.key = null; this.spent = 0; this.reaction = true; this.map = 0; }

  /** Called on every read: a new turn of this actor's refills everything. */
  sync(key, mine) {
    if (mine && key !== this.key) { this.key = key; this.spent = 0; this.reaction = true; this.map = 0; return true; }
    if (!mine && this.key != null && key !== this.key) this.map = 0;
    return false;
  }

  /** A costed press: "1".."3" drains that many, "r" the reaction; an attack
   *  advances the MAP step. Off your turn only a reaction is spent. */
  spend(cost, attack, { mine, max }) {
    const c = String(cost ?? "");
    if (c === "r") { this.reaction = false; return true; }
    if (!mine) return false;
    if (/^[123]$/.test(c)) this.spent = Math.min(max, this.spent + +c);
    if (attack) this.map = Math.min(2, this.map + 1);
    return true;
  }

  /** A press on a diamond corrects the tally by hand. */
  pip(which, max) {
    if (which === "r") { this.reaction = !this.reaction; return; }
    const i = +which, left = max - this.spent;
    this.spent = Math.max(0, Math.min(max, max - (i < left ? i : i + 1)));
  }

  economy(base) { return { ...base, spent: Math.min(base.max, this.spent), reaction: this.reaction }; }
}

/** The key of the turn being taken now. */
export const turnKey = (combat) => (combat ? `${combat.id}:${combat.round}:${combat.turn}` : null);

/** Is the turn after the current one this actor's? The tracker's order is
 *  `turns`, the current turn `index`; a defeated combatant is passed over
 *  where the tracker skips them (core's `skipDefeated`), as the next press of
 *  Next Turn would. The current combatant itself is never "next". */
export function upNext(turns, index, isMine, { skipDefeated = false } = {}) {
  const n = turns?.length ?? 0;
  if (n < 2 || !Number.isInteger(index) || index < 0 || index >= n) return false;
  for (let k = 1; k < n; k++) {
    const c = turns[(index + k) % n];
    if (skipDefeated && c?.isDefeated) continue;
    return !!isMine(c);
  }
  return false;
}
