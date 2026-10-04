/**
 * Keeps Foundry's own camera moves off the stream client.
 *
 * The stream camera is this feature's, but Foundry core pans the canvas by itself in several places, all
 * of which fire on the capture login with nobody touching it:
 *
 *   - `Token#_onUpdate` pans to a token *this client controls* whenever it moves — and a player login
 *     auto-controls its owned tokens (on canvas draw, and when a hidden token it owns is revealed);
 *   - `Token#_onControl({pan})` and `Canvas#draw` pan to a controlled token;
 *   - chat bubbles pan to the speaker when "Pan to speaker" is on;
 *   - the combat tracker, notes and keybindings pan on interaction.
 *
 * In Scene/full-background mode the camera is meant to stay put, so dropping or moving a PC "pulled" the
 * shot to it while the module's own framing said nothing should move — and the next reframe then pulled it
 * back. Our camera never calls either method (it drives `canvas.pan` directly), so both are refused while
 * stream mode is active and the UI is hidden. With the emergency restore up, a person is operating the
 * client and Foundry behaves normally.
 *
 * Wrapped once, chaining to whatever was installed before, so libWrapper or another module's patch on the
 * same method keeps working.
 */

import { MODULE_ID } from "../constants.js";

const WRAPPED = Symbol.for(`${MODULE_ID}.stream.panGuard`);

let streamMode = null;

export function installPanGuard(mode) {
  streamMode = mode;
  const TokenClass = foundry?.canvas?.placeables?.Token;
  const CanvasClass = foundry?.canvas?.Canvas ?? globalThis.canvas?.constructor;
  wrap(TokenClass?.prototype, "panCanvas", async () => undefined);
  // A system's Token subclass that overrides panCanvas is wrapped too; one that inherits is covered above.
  const ConfiguredToken = CONFIG?.Token?.objectClass;
  if (ConfiguredToken && ConfiguredToken !== TokenClass && Object.hasOwn(ConfiguredToken.prototype, "panCanvas")) {
    wrap(ConfiguredToken.prototype, "panCanvas", async () => undefined);
  }
  wrap(CanvasClass?.prototype, "animatePan", async () => false);
}

/** True while the shot belongs to the stream camera. */
export function streamOwnsCamera() {
  return Boolean(streamMode?.active && !streamMode.restoreVisible);
}

function wrap(target, method, refused) {
  const original = target?.[method];
  if (typeof original !== "function" || original[WRAPPED]) return;
  const guarded = function (...args) {
    if (streamOwnsCamera()) return refused();
    return original.apply(this, args);
  };
  guarded[WRAPPED] = true;
  target[method] = guarded;
}
