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
import { DIVIDER, READOUT, SETTINGS } from "./constants.mjs";
import { host } from "./host.mjs";
import { injectTokenConfig } from "./token-config.mjs";
import { LOW_HEALTH_AT } from "./ramp.mjs";
import { breakSourceActive, tokensForCombatant } from "./break.mjs";
import { LABEL_SETTING_KEYS } from "./mystify.mjs";   // names
import { DEFAULT_LIQUID, LIQUIDS } from "./shader.mjs";

const get = (key, fallback) => {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
};

/* Clamped here rather than trusted from the setting: the range is advisory in
   Foundry's UI, and a world edited by hand or migrated from an older key can
   hold anything. A 0 would collapse the readout to nothing with no error. */
const clampScale = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(READOUT.max, Math.max(READOUT.min, n));
};

/* Same reasoning as clampScale, and the stake is higher: the shader scales the
   gap's floor by this, so a 0 out of a hand-edited world removes the divisions
   entirely while the count still says there are ten of them, and a negative one
   inverts the min() and takes the whole fill out. */
const clampDivider = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return DIVIDER.default;
  return Math.min(DIVIDER.max, Math.max(DIVIDER.min, n));
};

/**
 * When the numeric readout is drawn on *this* client.
 *
 * The world setting overrides the player's own, and the GM keeps theirs: the
 * GM is the one who set the override, and running a table means reading many
 * tokens at once, which is a different job from playing one character.
 *
 * Whatever comes back is a ceiling on *when*, never on *what* — the mode is
 * consulted by canViewNumbers only after the token's Display Bars have already
 * allowed this client to see the bar at all. A forced "always" therefore cannot
 * reveal a hostile's hit points; it can only stop a player having to hover.
 */
function numbersMode() {
  const own = get(SETTINGS.numbers, "hover");
  if (game.user?.isGM) return own;
  const forced = get(SETTINGS.numbersForce, "player");
  return forced === "player" ? own : forced;
}

/** Everything the renderer reads, resolved from settings in one place. */
function currentOptions() {
  const tier = get(SETTINGS.motionTier, MOTION_TIER_DEFAULT);
  return {
    bothBars: get(SETTINGS.enabledBars, "both") === "both",
    /* Resolved against the shader's own list: a hand-edited world holding a
       liquid that does not exist gets ink, not a bar with no program. */
    liquid: LIQUIDS.includes(get(SETTINGS.liquid, DEFAULT_LIQUID)) ? get(SETTINGS.liquid, DEFAULT_LIQUID) : DEFAULT_LIQUID,
    segmentMode: get(SETTINGS.segmentMode, "count") === "perHp" ? "perHp" : "count",
    segments: Number(get(SETTINGS.segments, 10)) || 0,
    segmentSize: Number(get(SETTINGS.segmentSize, 5)) || 0,
    dividers: !!get(SETTINGS.dividers, true),
    dividerWidth: clampDivider(get(SETTINGS.dividerWidth, DIVIDER.default)),
    lowAt: (Number(get(SETTINGS.lowThreshold, LOW_HEALTH_AT * 100)) || 25) / 100,
    floatingDeltas: !!get(SETTINGS.floatingDeltas, false),
    pf2eLayers: !!get(SETTINGS.pf2eLayers, true),
    /* Resolved to false whenever the tracker that owns the state is not
       running, so the renderer never has to ask twice and a world without it
       does not pay for a flag read per token per refresh. */
    breakFx: !!get(SETTINGS.breakFx, true) && breakSourceActive(),
    bloom: !!get(SETTINGS.bloom, true),
    offsetX: Number(get(SETTINGS.offsetX, 0)) || 0,
    offsetY: Number(get(SETTINGS.offsetY, 0)) || 0,
    motionScale: MOTION_SCALE[tier] ?? MOTION_SCALE[MOTION_TIER_DEFAULT],
    ramp: get(SETTINGS.ramp, "default"),
    numbers: numbersMode(),
    numberScale: clampScale(get(SETTINGS.numberScale, 1)),
    /* Names. The size shares the readout's clamp, for the readout's reason. */
    names: !!get(SETTINGS.names, true),
    nameScale: clampScale(get(SETTINGS.nameScale, 1)),
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
  /* Names, by the same rule and for the same reason: `nameplate.visible` is
     Foundry's Display Name answer (assigned in `_refreshState`), and
     `mystify.mjs` reads it. Re-evaluated on every pass, so turning the setting
     off — or a token losing its name — hands the nameplate straight back. */
  if (token?.nameplate) token.nameplate.renderable = !host.reservesLabel(token);
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

  /* Pan and zoom change which bars are on screen, and the filtered container is
     measured from the ones that are. */
  on("canvasPan", () => host.cull());

  /* A drag preview is a clone that carries the real token's id. Every hook here
     refuses one: bound to a preview, the real token's bar follows the ghost
     around and is then destroyed along with it when the drag ends, and does not
     come back until something updates the token. Native bars are still
     suppressed on it, or the ghost drags Foundry's own bars along. */
  on("drawToken", (token) => {
    suppressNative(token);
    if (!token.isPreview) host.track(token);
  });
  on("destroyToken", (token) => { if (!token?.isPreview) host.remove(token?.id, token); });
  on("deleteToken", (doc) => host.remove(doc?.id));

  /* Where visibility is decided — and the only place it is.

     Foundry sets a render flag and fires hoverToken / controlToken straight
     away, but only assigns `token.bars.visible` later, in `_refreshState`, on
     the next pass; this hook is called after that pass. Deciding from the hover
     hooks read the answer one event stale, which inverted Hover-mode bars
     (hovering in hid them, hovering out showed them) and never noticed Alt at
     all, because highlightObjects fires no hook — only a refreshState on every
     token. Movement arrives here too, as refreshVisibility, which is how a
     token that walks out of sight loses its bar instead of keeping it.

     A draw is followed by exactly such a pass (`draw()` sets every flag), so
     `drawToken` builds and this decides. */
  on("refreshToken", (token, flags) => {
    suppressNative(token);
    if (token.isPreview) return;
    if (flags?.refreshBars || flags?.refreshSize) host.refreshToken(token);
    /* refreshNameplate is how a rename arrives; it is a decision like the rest,
       because the label's text is part of what is decided. */
    else if (flags?.refreshState || flags?.refreshVisibility || flags?.refreshNameplate) host.applyState(token);
    else host.reposition(token);
  });

  /* ── Names ────────────────────────────────────────────────────────────
     Three things change a name label without touching the token it is on: the
     Creaturedex's knowledge, PF2e's name-visibility switch, and who owns which
     character (a player's knowledge is their characters'). Each forgets the
     memoised answers and asks Foundry for a state pass, so the decision itself is
     still made in the refreshToken hook above and nowhere else. */
  const labelSetting = (setting) => { if (LABEL_SETTING_KEYS.includes(setting?.key)) host.invalidateLabels(); };
  on("updateSetting", labelSetting);
  on("createSetting", labelSetting);
  on("updateUser", (_user, changes) => { if (changes && "character" in changes) host.invalidateLabels(); });
  on("updateActor", (_actor, changes) => {
    if (changes?.ownership !== undefined || changes?.system?.details?.alliance !== undefined) host.invalidateLabels();
  });

  /* Value changes. `updateItem` is here for PF2e shields, whose HP lives on an
     item rather than on the actor.

     These read the numbers and never decide visibility. When they fire, Foundry
     has queued the render flags for whatever changed without applying them, so
     any visibility answer read here is the previous one; the refreshToken pass
     that follows is the one that knows. */
  const full = (token) => host.refreshToken(token, { decide: false });
  on("updateToken", (doc) => doc.object && full(doc.object));
  on("updateActor", (actor) => { for (const t of actor.getActiveTokens()) full(t); });
  on("updateItem", (item) => { for (const t of item.actor?.getActiveTokens?.() ?? []) full(t); });
  on("createItem", (item) => { for (const t of item.actor?.getActiveTokens?.() ?? []) full(t); });
  on("deleteItem", (item) => { for (const t of item.actor?.getActiveTokens?.() ?? []) full(t); });

  /* No hoverToken or controlToken listener, on purpose. Both fire before the
     render pass that updates what they change; the refreshState that pass sets
     reaches the refreshToken hook above, which is where the readout's hover gate
     and the bar's own visibility are both re-read. */

  /* The initiative tracker's guard break. It is a flag on the Combatant, so
     none of the actor/token hooks above can see it move — and unlike a value
     change it can land on a creature nothing has touched, which is exactly what
     happens when a break gauge empties on somebody else's turn. Registered
     whether or not the tracker is enabled: they are cheap listeners and
     `breakFx` is already false when it is off, which is a shorter path than
     wiring and unwiring them from a toggle that needs a reload anyway. */
  const combatantTokens = (combatant) => {
    for (const token of tokensForCombatant(combatant)) full(token);
  };
  on("updateCombatant", (combatant) => combatantTokens(combatant));
  on("createCombatant", (combatant) => combatantTokens(combatant));
  on("deleteCombatant", (combatant) => combatantTokens(combatant));
  /* Starting and ending a combat move every creature in it at once, and ending
     one leaves no combatants to walk. */
  on("combatStart", () => host.refreshAll());
  on("deleteCombat", () => host.refreshAll());

  /* Per-token placement. Both hooks are registered because a prototype token
     opens its own application class in v13; whichever one does not exist simply
     never fires. */
  on("renderTokenConfig", (app, element) => injectTokenConfig(app, element));
  on("renderPrototypeTokenConfig", (app, element) => injectTokenConfig(app, element));

  if (canvas?.ready) host.attach();
}

export function onDisable() {
  for (const [event, id] of H.splice(0)) Hooks.off(event, id);
  host.detach();
  /* Give Foundry its bars back. */
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token.bars) token.bars.renderable = true;
    if (token.nameplate) token.nameplate.renderable = true;   // and its nameplate
  }
}

export const api = {
  reconfigure,
  teardown: onDisable,
  get host() { return host; },
};
