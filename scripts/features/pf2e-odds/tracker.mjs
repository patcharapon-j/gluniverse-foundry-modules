/**
 * Per-actor state every client keeps: the armed action.
 *
 * The armed action is what the player last hovered or clicked on their sheet —
 * the Strike, the spell or the skill action, and for anything with an attack
 * trait WHICH of its three multiple-attack-penalty buttons. The badge on the
 * targeting line prices exactly that: PF2e does not track MAP (a Strike shows
 * three buttons and the player picks), so neither do we. Counting attacks from
 * chat cards guessed, and a guess the player then had to correct on a chip.
 *
 * It is broadcast so the GM and the stream see the same badge the player
 * does, and honoured only from a user who OWNS the actor it names, read off
 * the server-attested sender (`meta.attested`, core/socket.mjs) — a claimed
 * sender id is routing metadata, never permission.
 */

import { emitSocket, onSocket } from "../../core/socket.mjs";
import { FEATURE_ID, MSG } from "./constants.mjs";
import { validArmed } from "./armed.mjs";

const ARMED = new Map();
const listeners = new Set();

/** Subscribe to "something a badge depends on changed". Returns an unsubscribe. */
export function onTrackerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = (actorId) => {
  for (const fn of listeners) {
    try {
      fn(actorId);
    } catch {
      /* a listener's failure is its own */
    }
  }
};

/**
 * @typedef {{kind: "strike", slug: string|null, map?: 0|1|2}
 *          |{kind: "skill", action: string, map?: 0|1|2}
 *          |{kind: "spell", uuid: string, mode: "attack"|"save", map?: 0|1|2}} Armed
 */

export const armedOf = (actor) => (actor ? ARMED.get(actor.id) ?? null : null);

/** Arm an action for an actor the user owns, and tell the table. */
export function arm(actor, armed) {
  if (!actor?.isOwner || !validArmed(armed)) return;
  const prev = ARMED.get(actor.id);
  if (prev && JSON.stringify(prev) === JSON.stringify(armed)) return;
  ARMED.set(actor.id, armed);
  emitSocket(FEATURE_ID, { type: MSG.armed, actorId: actor.id, armed });
  changed(actor.id);
}

let forgetHandler = null;
/** observe.mjs owns the ledger; this socket only carries a GM's reset to it. */
export const setForgetHandler = (fn) => {
  forgetHandler = fn;
};

function fromSocket(payload, _claimed, meta) {
  const user = game.users?.get(meta?.attested ?? "");
  if (payload?.type === MSG.forget) {
    if (user) forgetHandler?.(payload, user);
    return;
  }
  const actor = game.actors?.get(payload?.actorId);
  if (!user || !actor || !actor.testUserPermission?.(user, "OWNER")) return;
  if (payload.type === MSG.armed && validArmed(payload.armed)) {
    ARMED.set(actor.id, payload.armed);
    changed(actor.id);
  }
}

/* ── wiring ──────────────────────────────────────────────────────────────── */

export function wireTracker() {
  onSocket(FEATURE_ID, fromSocket);
}
