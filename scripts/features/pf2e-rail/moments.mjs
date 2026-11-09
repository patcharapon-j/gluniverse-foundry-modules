/**
 * PF2e HUD — the rail's moments: what a change of state plays, decided once.
 *
 * A moment is never a state. Each one is read off the difference between the
 * rail that was drawn and the rail about to be drawn, plays once, and leaves
 * the rail as the model says it is:
 *
 *   - the turn comes round: the ignition and the light ("in");
 *   - the turn ends: the light goes home, dimmer and quicker ("home");
 *   - you go down: the lights go out ("out"); you get up: they come back;
 *   - you are up next: the turn bar knocks once (the on-deck tag and its
 *     breathing edge are the model's, `turnbar.next`, and stay while true);
 *   - a Hero Point is spent: the gem cracks, and where a roll was just echoed
 *     its light streaks to that press, the one a reroll answers;
 *   - a dying bead moves: one put out exhales, one lit burns red and the
 *     rail's edges flicker;
 *   - on the GM's screen, a creature's turn: the light in its disposition's
 *     colour, and its card rises.
 *
 * `momentsOf` is pure (the check drives its table); `playMoments` is DOM and
 * core, no `game`, so the preview plays exactly what the host plays.
 */
import * as D from "./drive.mjs";

/** "dying" / "dead" while a player's own rail is down, else "". */
export const downOf = (m) => (m && m.role !== "gm" && (m.plinth?.dead || m.plinth?.dying) ? (m.plinth.dead ? "dead" : "dying") : "");

/** What a change of down plays: going down puts the lights out, coming back
 *  lights them again; dying to dead is still down and plays nothing. */
export const relight = (was, now) => (!was && now ? "out" : was && !now ? "in" : null);

const NONE = Object.freeze({ light: null, tone: null, ignite: false, card: null, call: false, hero: null, dying: null });

/**
 * What plays between rail `was` and rail `now` of the same subject. `fresh`
 * is the host's answer to "did a new turn start for this subject just now"
 * (a player's own turn; on the GM's screen, anyone's).
 */
export function momentsOf(was, now, { fresh = false } = {}) {
  if (!was || !now || was.role !== now.role) return NONE;
  const out = { ...NONE };
  if (now.role === "gm") {
    if (fresh) {
      const f = (now.foes?.foes ?? []).find((x) => x.turn);
      if (f) { out.light = "in"; out.tone = f.disp ?? "neutral"; out.card = f.id; }
    }
    return out;
  }
  const tbWas = was.turnbar?.mode === "encounter" ? was.turnbar : null;
  const tbNow = now.turnbar?.mode === "encounter" ? now.turnbar : null;
  const pass = relight(downOf(was), downOf(now));
  if (pass) out.light = pass;
  else if (fresh) out.light = "in";
  else if (tbWas?.mine && !tbNow?.mine && !downOf(now)) out.light = "home";
  out.ignite = !!fresh;
  out.call = !!tbNow?.next && !tbWas?.next && !tbNow.mine;
  const h0 = was.plinth?.hero?.[0], h1 = now.plinth?.hero?.[0];
  if (Number.isFinite(h0) && Number.isFinite(h1) && h1 < h0) out.hero = { from: h0, to: h1 };
  const d0 = was.plinth?.dying?.value, d1 = now.plinth?.dying?.value;
  if (Number.isFinite(d0) && Number.isFinite(d1) && d0 !== d1 && !now.plinth?.dead) out.dying = { from: d0, to: d1 };
  return out;
}

/**
 * Play what `momentsOf` returned over the drawn rail. `light` is the rail's
 * `RailLight`; `heroAt` the press a Hero Point's light streaks to (the last
 * echoed roll), or null.
 */
export function playMoments(root, mo, { light = null, heroAt = null } = {}) {
  if (!root || !mo) return;
  if (mo.ignite) D.ignite(root);
  if (mo.light) light?.play(root, mo.light, { tone: mo.tone });
  if (mo.card) D.callCard(root, mo.card);
  if (mo.call) D.callUp(root);
  if (mo.hero) D.spendHero(root, mo.hero, heroAt);
  if (mo.dying) D.dyingBeat(root, mo.dying);
}
