/**
 * GLUniverse Suite — Minimap socket helpers.
 *
 * Thin wrappers over the suite's shared dispatcher. Every payload is already
 * tagged with `__feature: "minimap"` by `emitSocket`; we add a `type` (see MSG)
 * and the dispatcher supplies the originating user id separately.
 */

import { onSocket, emitSocket } from "../../core/socket.mjs";
import { FEATURE_ID, MSG } from "./const.mjs";

const me = () => game.user?.id ?? null;

export function emitPing(x, y, color) {
  emitSocket(FEATURE_ID, { type: MSG.ping, x, y, color, userId: me() });
}

export function emitAttention(x, y, color) {
  emitSocket(FEATURE_ID, { type: MSG.attention, x, y, color, userId: me() });
}

export function emitPublished(mode, rev, style) {
  emitSocket(FEATURE_ID, { type: MSG.published, mode, rev, style, userId: me() });
}

export function emitViewport(pan, zoom, rev) {
  emitSocket(FEATURE_ID, { type: MSG.viewport, pan, zoom, rev, userId: me() });
}

export function emitActivate(open) {
  emitSocket(FEATURE_ID, { type: MSG.activate, open, userId: me() });
}

export function emitRequestSync() {
  emitSocket(FEATURE_ID, { type: MSG.requestSync, userId: me() });
}

export function installDispatcher(handler) {
  onSocket(FEATURE_ID, handler);
}
