/**
 * GLUniverse Suite — unified socket dispatcher.
 *
 * Formerly each module emitted on its own `module.<id>` channel. Only the
 * installed package id routes, so the whole suite shares ONE channel and every
 * payload is tagged with `__feature`. Features register a handler and emit
 * through these helpers instead of touching `game.socket` directly.
 */

import { SOCKET, err } from "./const.mjs";

const _handlers = new Map();

/** Register a feature's socket handler: fn(payload, senderUserId). */
export function onSocket(featureId, fn) {
  _handlers.set(featureId, fn);
}

/** Emit a payload to all clients on behalf of a feature. */
export function emitSocket(featureId, payload = {}) {
  game.socket.emit(SOCKET, { __feature: featureId, ...payload });
}

/** Wire the single channel. Called once at ready. */
export function initSocketDispatcher() {
  game.socket.on(SOCKET, (msg) => {
    if (!msg || typeof msg !== "object") return;
    const fn = _handlers.get(msg.__feature);
    if (!fn) return;
    try {
      fn(msg, msg.userId ?? msg.user ?? null);
    } catch (e) {
      err(`Socket handler for "${msg.__feature}" threw:`, e);
    }
  });
}
