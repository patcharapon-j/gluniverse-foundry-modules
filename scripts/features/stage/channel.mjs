/**
 * Stage — the gesture channel.
 *
 * A reaction (nod, shake, hop, tremble, lean) is a moment, not state: it is
 * never stored, only sent. The GM's client plays it at once and broadcasts it;
 * every other client plays it on arrival. Only a GM may send one — the socket
 * carries the server-attested sender (`meta.attested`), and a payload from
 * anyone who is not a GM, or from nobody the server vouched for, is dropped.
 */

import { emitSocket, onSocket } from "../../core/socket.mjs";
import { FEATURE_ID, REACTIONS } from "./model.mjs";

const listeners = new Set();
let wired = false;

const valid = (p) => p && p.op === "react" && typeof p.id === "string" && p.id.length <= 40 && REACTIONS.includes(p.kind);

/** Wire the socket once (onReady). */
export function wireChannel() {
  if (wired) return;
  wired = true;
  onSocket(FEATURE_ID, (payload, _claimed, meta) => {
    const sender = meta?.attested ? game.users?.get(meta.attested) : null;
    if (!sender?.isGM) return;
    for (const fn of listeners) fn(payload.id, payload.kind);
  }, { validate: valid });
}

/** Listen for reactions: fn(castId, kind). Returns an unsubscribe. */
export function onReaction(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Fire a reaction on every client (GM only). */
export function sendReaction(id, kind) {
  if (!game.user?.isGM || !valid({ op: "react", id, kind })) return false;
  for (const fn of listeners) fn(id, kind);
  emitSocket(FEATURE_ID, { op: "react", id, kind });
  return true;
}
