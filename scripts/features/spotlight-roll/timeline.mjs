/**
 * When everything in a spotlit roll happens, in milliseconds after the throw.
 *
 * The one statement of the sequence. The die's tumble, the overlay's beats
 * and the backdrop's light all read it, so they cannot drift apart; a preview
 * that kept its own timings would flatter a reveal nobody ships.
 *
 *   throw → land → settle → [fortune drop] → [natural] → [DC unveil]
 *         → modifier tally (one step per modifier) → degree → hold → out
 *
 * The DC unveils BEFORE the tally on purpose: watching the running total climb
 * past the line, or stop one short of it, is the most dramatic thing a check
 * can do, and it only works if the line is already drawn.
 */
import { TUMBLE } from "./tumble.mjs";

export const BEAT_MS = Object.freeze({
  lead: 0,            // throw is t = 0
  fortune: 520,       // the losing die breaks away
  natural: 1050,      // the NATURAL 20 / NATURAL 1 beat
  dcReveal: 820,      // a hidden DC uncovers
  tallyIn: 260,       // gap before the first modifier flies in
  tallyStep: 420,     // per modifier
  tallyOut: 340,      // last modifier → degree
  degree: 900,        // the degree's own entrance
  hold: 3800,
  holdCrit: 5600,
  out: 700,
});

/** PF2e degree index and the printed rule live in core, shared with Destiny Dice. */
export { DEGREE_KEYS as DEGREES, degreeOf } from "../../core/pf2e-degree.mjs";

/**
 * Schedule a roll.
 *   mods      number of modifier steps to tally (0 skips the tally)
 *   natural   20 / 1 / anything else
 *   dcHidden  the DC is hidden until now (and a DC exists)
 *   fortune   two dice landed, one is dropped
 *   crit      the degree is a critical (longer hold)
 *   scale     motion tier
 */
export function scheduleBeats({ mods = 0, natural = null, dcHidden = false, fortune = false, crit = false, scale = 1 } = {}) {
  const s = (ms) => Math.round(ms * scale);
  const beats = {};
  let t = 0;
  beats.throw = 0;
  beats.land = s(TUMBLE.duration * 1000);
  beats.settle = beats.land + s(TUMBLE.settle * 1000);
  t = beats.settle;
  if (fortune) { beats.fortune = t; t += s(BEAT_MS.fortune); }
  if (natural === 20 || natural === 1) { beats.natural = t; t += s(BEAT_MS.natural); }
  if (dcHidden) { beats.dcReveal = t; t += s(BEAT_MS.dcReveal); }
  beats.tally = [];
  if (mods > 0) {
    t += s(BEAT_MS.tallyIn);
    for (let i = 0; i < mods; i++) { beats.tally.push(t); t += s(BEAT_MS.tallyStep); }
    t = beats.tally.at(-1) + s(BEAT_MS.tallyOut);
  }
  beats.degree = Math.round(t);
  t += s(BEAT_MS.degree);
  beats.hold = Math.round(t);
  t += s(crit ? BEAT_MS.holdCrit : BEAT_MS.hold);
  beats.out = Math.round(t);
  beats.end = Math.round(t + s(BEAT_MS.out));
  return beats;
}
