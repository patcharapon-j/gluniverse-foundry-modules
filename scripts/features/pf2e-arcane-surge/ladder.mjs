/**
 * GLUniverse Suite — Arcane Surge's one shed ladder.
 *
 * Shedding rides `core/budget.mjs` now. This feature used to keep its own
 * `FrameBudget` — a 0.9/0.1 rolling average with a 22/15 ms hysteresis, one
 * instance per host — and every host sampled its own frames to feed it. That
 * was a second clock of the same frame, and it could not hear a Performance
 * tier saying "this machine starts one rung down". The shared ladder hears both,
 * and applies the same 22/15 ms pair whenever the `perf` feature is off, so a
 * world that never turns Performance on sheds exactly as it did.
 *
 * ONE LADDER FOR THE FEATURE, not one per host, and that is not an economy. A
 * ladder holds no measurement of its own any more: its level is the policy floor
 * and the shared reflex, both global, so a ladder per host would be two (or, on
 * the preview page, eight) copies of the same number — and each would be its own
 * row in the perf overlay, which would then read as the feature degrading twice.
 * `SHED_ORDER` is one statement of what this feature gives up and in what order;
 * the ladder that answers for it should be one too.
 *
 * Reference-counted, because the two hosts come and go independently: the weave
 * exists only while the party is somewhere unstable, the beat host only once a
 * surge or a warm-up has asked for it. The last host out disposes the ladder so
 * a world that switches the feature off does not leave a dead row in the overlay.
 *
 * `anim.mjs` still owns `SHED_ORDER` and must stay dependency-free (the preview
 * inlines it verbatim), which is why the binding to the budget lives here rather
 * than there. Importable under plain Node: nothing starts until `acquireLadder()`.
 */

import { Budget } from "../../core/budget.mjs";
import { SHED_ORDER } from "./anim.mjs";

export const LADDER_ID = "pf2e-arcane-surge";

let ladder = null;
let holders = 0;

/** Take a reference to the feature's ladder, creating it on first use. */
export function acquireLadder() {
  ladder ??= Budget.ladder(LADDER_ID, SHED_ORDER);
  holders++;
  return ladder;
}

/** Give a reference back; the last one disposes the ladder. Safe to over-call. */
export function releaseLadder() {
  if (holders <= 0) return;
  if (--holders > 0) return;
  ladder?.dispose();
  ladder = null;
}
