/**
 * GLUniverse Suite — Etched-Glass Chat Theme: settings + lifecycle wiring.
 *
 * Registers the chat hooks ONLY in onInit (inert when disabled, Principle III).
 * `renderChatMessageHTML` (+ legacy `renderChatMessage`) is the sole classifier;
 * `createChatMessage` does one thing — add the id to `freshIds` on EVERY client
 * (no author gate) so the renderer animates a live crit once and shows the static
 * still on scrollback / late-join.
 */

import { applyStyle } from "./style.mjs";
import { fxRenderer } from "./fx-card.mjs";
import { addFrameHeaderButton, addFrameHeaderControl, injectFrameTitlebarButton } from "./frame.mjs";

/** In-memory ids of messages created live this session (animate-once marker). */
export const freshIds = new Set();

// Registered hook handles, for a clean teardown if the feature is torn down.
const _hooks = [];

function on(hook, fn) {
  const id = Hooks.on(hook, fn);
  _hooks.push([hook, id]);
}

/** No persisted settings in v1 beyond the suite enable toggle; stub for parity. */
export function featureRegisterSettings() {
  /* intentionally empty — the world-level enable toggle is the only setting */
}

export function onInit() {
  // Sole classifier/styler: fires on every render of every message element.
  on("renderChatMessageHTML", (message, html) => applyStyle(message, html));
  // Legacy (pre-v13) signature passes jQuery; rootOf() normalizes it.
  on("renderChatMessage", (message, html) => applyStyle(message, html));
  // Live-vs-historical marker, every client, NO author gate.
  on("createChatMessage", (message) => freshIds.add(message.id));

  // Per-actor portrait framing lives on the ACTOR SHEET header (a crop button),
  // not on chat cards. Contribute to every header array generation AND fall back
  // to direct DOM injection — PF2e mixes ApplicationV2 and legacy sheets.
  on("getApplicationHeaderButtons", (app, buttons) => addFrameHeaderButton(app, buttons));
  on("getApplicationV1HeaderButtons", (app, buttons) => addFrameHeaderButton(app, buttons));
  on("getActorSheetHeaderButtons", (app, buttons) => addFrameHeaderButton(app, buttons));
  on("getHeaderControlsApplicationV2", (app, controls) => addFrameHeaderControl(app, controls));
  on("renderApplicationV1", (app, html) => injectFrameTitlebarButton(app, html));
  on("renderApplicationV2", (app, html) => injectFrameTitlebarButton(app, html));
}

export function onReady() {
  // FX renderer is created lazily on first fracture (fxRenderer.ensureRenderer).
  // Nothing to eagerly initialize here in v1.
}

/** Full teardown so a disabled feature leaves no hooks / state / renderer. */
export function teardown() {
  for (const [hook, id] of _hooks) Hooks.off(hook, id);
  _hooks.length = 0;
  freshIds.clear();
  try {
    fxRenderer.destroy();
  } catch {
    /* ignore */
  }
}
