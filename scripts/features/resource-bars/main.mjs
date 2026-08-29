/**
 * GLUniverse Suite — resource bars: lifecycle and takeover.
 *
 * Foundry's own bars are not deleted, they are made non-renderable. Deleting
 * them would put us in a fight with every other module that expects
 * `token.bars` to exist, and leaving them visible would draw two bars on every
 * token. Suppressing the render keeps Foundry's own visibility computation
 * running — which `visibility.mjs` then reads rather than reimplements.
 */

import { SUITE_ID, log, warn } from "../../core/const.mjs";
import { MOTION_SCALE, MOTION_TIER_DEFAULT } from "../../core/theme.mjs";
import { registerWrapper, WRAPPER } from "../../core/wrapper.mjs";
import { SETTINGS } from "./constants.mjs";
import { host } from "./host.mjs";
import { LOW_HEALTH_AT } from "./ramp.mjs";

const get = (key, fallback) => {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
};

/** Everything the renderer reads, resolved from settings in one place. */
function currentOptions() {
  const tier = get(SETTINGS.motionTier, MOTION_TIER_DEFAULT);
  return {
    bothBars: get(SETTINGS.enabledBars, "both") === "both",
    segments: Number(get(SETTINGS.segments, 10)) || 0,
    lowAt: (Number(get(SETTINGS.lowThreshold, LOW_HEALTH_AT * 100)) || 25) / 100,
    floatingDeltas: !!get(SETTINGS.floatingDeltas, false),
    pf2eLayers: !!get(SETTINGS.pf2eLayers, true),
    bloom: !!get(SETTINGS.bloom, true),
    motionScale: MOTION_SCALE[tier] ?? MOTION_SCALE[MOTION_TIER_DEFAULT],
    ramp: get(SETTINGS.ramp, "default"),
    numbers: get(SETTINGS.numbers, "hover"),
  };
}

/** Push settings into the live renderer. Safe to call before the canvas exists. */
export function reconfigure() {
  host.configure(currentOptions());
  host.refreshAll();
}

/**
 * Stop Foundry drawing its own bars for a token.
 *
 * `renderable` rather than `visible`: other code reads `bars.visible` to mean
 * "this client is allowed to see these values", and `visibility.mjs` is one of
 * its readers. Clearing it would make us invisible to ourselves.
 */
function suppressNative(token) {
  if (token?.bars) token.bars.renderable = false;
}

let installed = false;

function installTakeover() {
  if (installed) return;
  /* Check and wrap the *same* path: resolving one and registering another
     means a Foundry that moved the class passes the check and then throws. */
  const TARGET = "CONFIG.Token.objectClass.prototype.drawBars";
  if (typeof CONFIG.Token?.objectClass?.prototype?.drawBars !== "function") {
    /* Not fatal: the refreshToken hook below suppresses them anyway. Worth a
       warning, because it means a Foundry version moved the method and the
       suppression is now running one frame later than it should. */
    warn("resource-bars | Token#drawBars not found; falling back to hook-time suppression");
    installed = true;
    return;
  }
  try {
    const backend = registerWrapper(TARGET, function (wrapped, ...args) {
      const out = wrapped(...args);
      suppressNative(this);
      return out;
    }, WRAPPER);
    log(`resource-bars | native bars suppressed (${backend})`);
  } catch (err) {
    warn("resource-bars | could not wrap Token#drawBars", err);
  }
  installed = true;
}

/* ── Hooks ──────────────────────────────────────────────────────────────── */

const H = [];
const on = (event, fn) => { H.push([event, Hooks.on(event, fn)]); };

export function onInit() {
  /* Nothing may touch the canvas here; settings are registered by the adapter
     before this runs. */
}

export function onReady() {
  installTakeover();
  host.configure(currentOptions());

  on("canvasReady", () => { host.attach(); });
  on("canvasTearDown", () => host.detach());

  on("drawToken", (token) => { suppressNative(token); host.refreshToken(token); });
  on("destroyToken", (token) => host.remove(token?.id));
  on("deleteToken", (doc) => host.remove(doc?.id));

  /* Position only — this fires every frame of a drag. */
  on("refreshToken", (token) => { suppressNative(token); host.reposition(token); });

  /* Value changes. `updateItem` is here for PF2e shields, whose HP lives on an
     item rather than on the actor. */
  const full = (token) => host.refreshToken(token);
  on("updateToken", (doc) => doc.object && full(doc.object));
  on("updateActor", (actor) => { for (const t of actor.getActiveTokens()) full(t); });
  on("updateItem", (item) => { for (const t of item.actor?.getActiveTokens?.() ?? []) full(t); });
  on("createItem", (item) => { for (const t of item.actor?.getActiveTokens?.() ?? []) full(t); });
  on("deleteItem", (item) => { for (const t of item.actor?.getActiveTokens?.() ?? []) full(t); });

  /* Hover and control gate the sweep and the numeric readout, both of which are
     permission-shaped, so they go through the full path rather than reposition. */
  on("hoverToken", (token) => full(token));
  on("controlToken", (token) => full(token));

  if (canvas?.ready) host.attach();
}

export function onDisable() {
  for (const [event, id] of H.splice(0)) Hooks.off(event, id);
  host.detach();
  /* Give Foundry its bars back. */
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token.bars) token.bars.renderable = true;
  }
}

export const api = {
  reconfigure,
  teardown: onDisable,
  get host() { return host; },
};
