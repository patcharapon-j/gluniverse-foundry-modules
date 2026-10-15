/**
 * Per-actor state every client keeps: the MAP count and the armed action.
 *
 * Both are derived on every client from things every client is told (chat
 * cards, combat turns) so no client is the authority — except two deliberate
 * inputs a player makes, which are broadcast so the GM and the stream see the
 * same badge the player does:
 *
 *   • the armed action — what the player last hovered or clicked on their
 *     sheet, the HUD or a chat card;
 *   • a manual MAP step clicked onto the chip.
 *
 * A broadcast is honoured only from a user who OWNS the actor it names, read
 * off the server-attested sender (`meta.attested`, core/socket.mjs) — a claimed
 * sender id is routing metadata, never permission.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { emitSocket, onSocket } from "../../core/socket.mjs";
import { FEATURE_ID, MSG, SETTINGS } from "./constants.mjs";
import { cycle, isAttack, nextIndex, recordAttack } from "./map-model.mjs";

const MAP = new Map();
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

const resetMs = () => {
  try {
    return Math.max(1, Number(game.settings.get(SUITE_ID, SETTINGS.mapReset)) || 12) * 1000;
  } catch {
    return 12000;
  }
};

const runningCombat = () => {
  const c = game.combat;
  return c?.started && (!c.scene || c.scene.id === canvas?.scene?.id) ? c : null;
};

/** The current turn as a key: round and turn, so last round's count never leaks. */
const turnKey = () => {
  const c = runningCombat();
  return c ? `${c.id}:${c.round}:${c.turn}` : null;
};

/* ── MAP ─────────────────────────────────────────────────────────────────── */

/** The attack index the actor's NEXT attack will be: 0, 1 or 2, and whether a player set it. */
export function mapIndex(actor) {
  if (!actor) return { index: 0, manual: false };
  const turn = turnKey();
  return nextIndex(MAP.get(actor.id), { now: Date.now(), turn, resetMs: resetMs(), inCombat: !!turn });
}

/** The chip's click: step the shown penalty, and tell the table. */
export function stepMap(actor) {
  if (!actor?.isOwner) return;
  const shown = mapIndex(actor).index;
  const next = cycle(MAP.get(actor.id), shown, { now: Date.now(), turn: turnKey() });
  MAP.set(actor.id, next);
  emitSocket(FEATURE_ID, { type: MSG.mapOverride, actorId: actor.id, override: next.override, turn: next.turn });
  changed(actor.id);
}

function onAttackCard(message) {
  const ctx = message.flags?.pf2e?.context;
  if (!isAttack(ctx)) return;
  const actor = message.actor;
  if (!actor) return;
  MAP.set(actor.id, recordAttack(MAP.get(actor.id), { at: Date.now(), turn: turnKey(), mapIncreases: ctx.mapIncreases ?? null }));
  changed(actor.id);
}

/* ── the armed action ────────────────────────────────────────────────────── */

/**
 * @typedef {{kind: "strike", slug: string|null}
 *          |{kind: "skill", action: string}
 *          |{kind: "spell", uuid: string, mode: "attack"|"save"}} Armed
 */

const validArmed = (a) =>
  a &&
  ((a.kind === "strike" && (a.slug == null || typeof a.slug === "string")) ||
    (a.kind === "skill" && typeof a.action === "string") ||
    (a.kind === "spell" && typeof a.uuid === "string" && (a.mode === "attack" || a.mode === "save")));

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

function fromSocket(payload, _claimed, meta) {
  const user = game.users?.get(meta?.attested ?? "");
  const actor = game.actors?.get(payload?.actorId);
  if (!user || !actor || !actor.testUserPermission?.(user, "OWNER")) return;
  if (payload.type === MSG.armed && validArmed(payload.armed)) {
    ARMED.set(actor.id, payload.armed);
    changed(actor.id);
  } else if (payload.type === MSG.mapOverride && [0, 1, 2].includes(payload.override)) {
    const s = MAP.get(actor.id);
    MAP.set(actor.id, { ...(s && s.turn === payload.turn ? s : { count: 0, at: 0, turn: payload.turn ?? null }), override: payload.override, at: Date.now() });
    changed(actor.id);
  }
}

/* ── wiring ──────────────────────────────────────────────────────────────── */

export function wireTracker() {
  Hooks.on("createChatMessage", onAttackCard);
  // A new turn clears the combatant whose turn it now is; everything else
  // keys on the turn and goes stale by itself.
  Hooks.on("combatTurnChange", (combat) => {
    const actor = combat?.combatant?.actor;
    if (actor) {
      MAP.delete(actor.id);
      changed(actor.id);
    }
  });
  Hooks.on("deleteCombat", () => {
    MAP.clear();
    changed(null);
  });
  onSocket(FEATURE_ID, fromSocket);
}
