/**
 * PF2e HUD — the roll echo: which chat message a press answers, and what of
 * it the pressing screen may show.
 *
 * The echo prints a total (and the degree, where PF2e would show it) on the
 * press that rolled. That is a second place a result appears, so it obeys the
 * first place's rules and adds none of its own:
 *
 *   - never on the stream login: the capture is watched by the players;
 *   - never for a blind roll (PF2e's secret trait rolls blind): the roller
 *     is not supposed to know the number, and the GM's screen has the card;
 *   - never for a whisper this viewer is not in, or content Foundry says
 *     this viewer cannot see;
 *   - the degree only where the viewer sees the truth, or PF2e's own
 *     metagame setting shows results to players.
 *
 * Pure. The host passes the message and the viewer; the answer is
 * `{ total, degree, word }` or null.
 */
import { DEGREE_KEYS } from "../../core/pf2e-degree.mjs";

/** May `viewer` be shown this message's result at all? */
export function echoVisible(message, { userId, stream = false } = {}) {
  if (!message || stream) return false;
  if (message.blind) return false;
  if (message.isContentVisible === false) return false;
  const whisper = Array.from(message.whisper ?? []);
  if (whisper.length && !whisper.includes(userId) && (message.author?.id ?? message.user?.id) !== userId) return false;
  return Array.isArray(message.rolls) && message.rolls.length > 0;
}

/** The echo for a visible roll. `degreeShown` is the host's answer to
 *  "would PF2e show this viewer the outcome" (truth, or metagame results). */
export function echoOf(message, { userId, stream = false, degreeShown = false, words = [] } = {}) {
  if (!echoVisible(message, { userId, stream })) return null;
  const roll = message.rolls[0];
  const total = Number(roll?.total);
  if (!Number.isFinite(total)) return null;
  const outcome = message.flags?.pf2e?.context?.outcome ?? null;
  const d = outcome ? DEGREE_KEYS.indexOf(outcome) : -1;
  const degree = degreeShown && d >= 0 ? d : null;
  return { total, degree, word: degree == null ? "" : words[degree] ?? "" };
}

/** Does this message answer a press made a moment ago on this screen? The
 *  press is `{ actorId, at }`; only this user's own roll for that actor,
 *  within `within` ms, is its answer. */
export function answers(message, press, { userId, now, within = 12000 } = {}) {
  if (!message || !press) return false;
  if ((message.author?.id ?? message.user?.id) !== userId) return false;
  if (now - press.at > within) return false;
  return (message.speaker?.actor ?? null) === press.actorId;
}
