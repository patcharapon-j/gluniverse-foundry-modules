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
const RESERVED_KEYS = new Set(["__feature", "__claimedSender"]);

/** Register a feature's socket handler: fn(payload, senderUserId). */
export function onSocket(featureId, fn, { validate = null } = {}) {
  _handlers.set(featureId, { fn, validate });
}

/** Emit a payload to all clients on behalf of a feature. */
export function emitSocket(featureId, payload = {}) {
  const safePayload = Object.fromEntries(
    Object.entries(payload ?? {}).filter(([key]) => !RESERVED_KEYS.has(key))
  );
  game.socket.emit(SOCKET, {
    ...safePayload,
    __feature: featureId,
    // Raw Foundry module sockets do not provide server-attested identity. This
    // field is routing/dedup metadata only and must never grant permissions.
    __claimedSender: game.user?.id ?? null,
  });
}

/** Wire the single channel. Called once at ready. */
export function initSocketDispatcher() {
  game.socket.on(SOCKET, (msg) => {
    if (!msg || typeof msg !== "object") return;
    const entry = _handlers.get(msg.__feature);
    if (!entry) return;
    const senderId = typeof msg.__claimedSender === "string" ? msg.__claimedSender : null;
    const payload = Object.fromEntries(
      Object.entries(msg).filter(([key]) => !RESERVED_KEYS.has(key))
    );
    try {
      if (entry.validate && entry.validate(payload) !== true) return;
      Promise.resolve(entry.fn(payload, senderId)).catch((e) => {
        err(`Async socket handler for "${msg.__feature}" rejected:`, e);
      });
    } catch (e) {
      err(`Socket handler for "${msg.__feature}" threw:`, e);
    }
  });
}
