/**
 * GLUniverse Suite — token conditions: lifecycle and takeover.
 *
 * Foundry's own effect icons are not deleted, they are made non-renderable.
 * Deleting them would put us in a fight with every module that expects
 * `token.effects` to exist — PF2e's own `StatusEffects` among them — and leaving
 * them visible would draw two sets of icons on every token. Suppressing the
 * render leaves Foundry's own bookkeeping running underneath, which is what lets
 * this feature be turned off and hand the icons straight back.
 */

import { SUITE_ID, log, warn } from "../../core/const.mjs";
import { MOTION_SCALE, MOTION_TIER_DEFAULT } from "../../core/theme.mjs";
import { registerWrapper, WRAPPER } from "../../core/wrapper.mjs";
import { LIMITS, SETTINGS } from "./constants.mjs";
import { host } from "./host.mjs";

const get = (key, fallback) => {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
};

/**
 * Clamped here rather than trusted from the setting: a range is advisory in
 * Foundry's UI, and a world edited by hand or migrated from an older key can
 * hold anything. A 0 would collapse every plate to nothing with no error.
 */
const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** Everything the renderer reads, resolved from settings in one place. */
function currentOptions() {
  const tier = get(SETTINGS.motionTier, MOTION_TIER_DEFAULT);
  return {
    showEffects: !!get(SETTINGS.showEffects, true),
    maxPlates: clampNum(get(SETTINGS.maxPlates, 6), LIMITS.platesMin, LIMITS.platesMax, 6),
    side: get(SETTINGS.side, "left") === "right" ? "right" : "left",
    bloom: !!get(SETTINGS.bloom, true),
    offsetX: Number(get(SETTINGS.offsetX, 0)) || 0,
    offsetY: Number(get(SETTINGS.offsetY, 0)) || 0,
    expiryWarn: clampNum(get(SETTINGS.expiryWarn, 1), 0, LIMITS.expiryWarnMax, 1),
    motionScale: MOTION_SCALE[tier] ?? MOTION_SCALE[MOTION_TIER_DEFAULT],
    labels: get(SETTINGS.labels, "hover"),
    scale: clampNum(get(SETTINGS.scale, 1), LIMITS.scaleMin, LIMITS.scaleMax, 1),
  };
}

/** Push settings into the live renderer. Safe to call before the canvas exists. */
export function reconfigure() {
  host.configure(currentOptions());
  host.refreshAll();
}

/**
 * Stop Foundry drawing its own icon grid for a token.
 *
 * `renderable` rather than `visible`: `visible` is a permission answer other
 * code reads, and clearing it would make the token's state invisible to
 * everything that asks — this feature's own reader included.
 */
function suppressNative(token) {
  if (token?.effects) token.effects.renderable = false;
}

let installed = false;

function installTakeover() {
  if (installed) return;
  if (!get(SETTINGS.suppressCore, true)) { installed = true; return; }

  /* Check and wrap the *same* path: resolving one and registering another means
     a Foundry that moved the class passes the check and then throws. */
  const TARGET = "CONFIG.Token.objectClass.prototype.drawEffects";
  if (typeof CONFIG.Token?.objectClass?.prototype?.drawEffects !== "function") {
    /* Not fatal — the hooks below suppress them anyway. Worth a warning, because
       it means a Foundry version moved the method and the suppression is now
       running one frame later than it should, which is one frame of Foundry's
       icons appearing and then vanishing. */
    warn("token-conditions | Token#drawEffects not found; falling back to hook-time suppression");
    installed = true;
    return;
  }
  try {
    const backend = registerWrapper(TARGET, function (wrapped, ...args) {
      const out = wrapped(...args);
      /* drawEffects is async in v13+: suppress on the promise as well as
         synchronously, or the icons are drawn back in after we cleared them. */
      Promise.resolve(out).then(() => suppressNative(this)).catch(() => {});
      suppressNative(this);
      return out;
    }, WRAPPER);
    log(`token-conditions | native effect icons suppressed (${backend})`);
  } catch (err) {
    warn("token-conditions | could not wrap Token#drawEffects", err);
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

  on("canvasReady", () => host.attach());
  on("canvasTearDown", () => host.detach());

  /* Pan and zoom change which rails are on screen, and the filtered container is
     measured from the ones that are. */
  on("canvasPan", () => host.cull());

  on("drawToken", (token) => { suppressNative(token); host.refreshToken(token); });
  on("destroyToken", (token) => host.remove(token?.id));
  on("deleteToken", (doc) => host.remove(doc?.id));

  /* Position only — this fires every frame of a drag, and a full refresh walks
     the actor's items and resolves an origin UUID per effect. */
  on("refreshToken", (token) => { suppressNative(token); host.reposition(token); });

  const full = (token) => host.refreshToken(token);
  const forActor = (actor) => { for (const t of actor?.getActiveTokens?.() ?? []) full(t); };

  on("updateToken", (doc) => doc.object && full(doc.object));
  on("updateActor", (actor) => forActor(actor));
  /* Conditions and effects are *items*, so these three are the feature's main
     input rather than an edge case. */
  on("createItem", (item) => forActor(item.actor));
  on("updateItem", (item) => forActor(item.actor));
  on("deleteItem", (item) => forActor(item.actor));

  /**
   * Durations are measured against the world clock, so a rail that only
   * refreshed on item changes would show a gauge frozen at whatever it read when
   * the effect was applied — and would keep showing an effect for the whole
   * session after it expired. Both hooks matter: the clock moves on its own, and
   * advancing a combat turn is the commonest way it moves.
   */
  on("updateWorldTime", () => host.refreshAll());
  on("updateCombat", () => host.refreshAll());
  on("deleteCombat", () => host.refreshAll());

  /* Hover and control gate the labels, which are permission-shaped, so they go
     through the full path rather than through reposition. */
  on("hoverToken", (token) => full(token));
  on("controlToken", (token) => full(token));

  if (canvas?.ready) host.attach();
}

export function onDisable() {
  for (const [event, id] of H.splice(0)) Hooks.off(event, id);
  host.detach();
  /* Give Foundry its icons back. */
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token.effects) {
      token.effects.renderable = true;
      token.drawEffects?.();
    }
  }
}

export const api = {
  reconfigure,
  teardown: onDisable,
  get host() { return host; },
};
