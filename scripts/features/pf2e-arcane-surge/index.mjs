/**
 * GLUniverse Suite — Arcane Surge adapter.
 *
 * The Sea of Stars makes magic unreliable. An eligible casting in an unstable
 * area rolls a bespoke d20 whose glyph faces ARE the odds; a surge posts a
 * banner on the spell's own card, tears the screen for two seconds, and hands
 * the GM a severity card to roll. Interpretation is the GM's and the theme
 * collections live outside this module entirely.
 *
 * Deliberately NOT gated on `clocks-tracker`: the stability chip renders into
 * that HUD's slot when it exists and into its own panel when it does not. A
 * spellcasting subsystem should not stop working because somebody turned the
 * calendar off.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { MOTION_TIER_DEFAULT, applyMotionTier } from "../../core/theme.mjs";
import { syncAmbient } from "./ambient.mjs";
import { ArcaneSurgeConfigApp } from "./config-app.mjs";
import { DEFAULT_ELIGIBILITY, FEATURE_ID, LEVELS, PREFIX, SETTINGS } from "./constants.mjs";
import { onLevelChanged, paint } from "./hud.mjs";
import { api, onInit, onReady } from "./main.mjs";

function registerSettings() {
  /* ── World state ───────────────────────────────────────────────────
     The level is a world setting, so its onChange fires on every connected
     client already — which is the whole reason this feature needs no socket to
     distribute it. The suite's weather works the same way. */
  game.settings.register(SUITE_ID, SETTINGS.level, {
    scope: "world",
    config: false,
    type: String,
    choices: Object.fromEntries(LEVELS.map((level) => [level, `GLAS.level.${level}`])),
    default: "stable",
    onChange: onLevelChanged,
  });

  game.settings.register(SUITE_ID, SETTINGS.levelConfig, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      // The die's face layout is derived from the thresholds, so changing them
      // changes the die. DSN presets are registered once at ready, so the new
      // layout lands on the next reload; the odds themselves apply immediately.
      paint();
    },
  });

  game.settings.register(SUITE_ID, SETTINGS.eligibility, {
    scope: "world",
    config: false,
    type: Object,
    default: { ...DEFAULT_ELIGIBILITY },
  });

  game.settings.register(SUITE_ID, SETTINGS.conceal, {
    name: "GLAS.settings.conceal.name",
    hint: "GLAS.settings.conceal.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      paint();
      syncAmbient();
    },
  });

  /* ── Client preferences ────────────────────────────────────────────
     The overlay runs for hours, so the switch that turns it off belongs to the
     person whose machine is running it. */
  game.settings.register(SUITE_ID, SETTINGS.ambient, {
    name: "GLAS.settings.ambient.name",
    hint: "GLAS.settings.ambient.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: syncAmbient,
  });

  game.settings.register(SUITE_ID, SETTINGS.dieVisibility, {
    name: "GLAS.settings.dieVisibility.name",
    hint: "GLAS.settings.dieVisibility.hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      always: "GLAS.settings.dieVisibility.always",
      surge: "GLAS.settings.dieVisibility.surge",
      never: "GLAS.settings.dieVisibility.never",
    },
    default: "always",
  });

  game.settings.register(SUITE_ID, SETTINGS.motionTier, {
    name: "GLAS.settings.motionTier.name",
    hint: "GLAS.settings.motionTier.hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      default: "GLAS.settings.motionTier.default",
      reduced: "GLAS.settings.motionTier.reduced",
      cinematic: "GLAS.settings.motionTier.cinematic",
    },
    default: MOTION_TIER_DEFAULT,
    onChange: (tier) => applyMotionTier(tier),
  });

  /* The player's own declaration about their own next casting. Client-scoped so
     it can never leak into somebody else's cast. */
  game.settings.register(SUITE_ID, SETTINGS.armed, {
    scope: "client",
    config: false,
    type: String,
    default: "none",
    onChange: paint,
  });

  game.settings.registerMenu(SUITE_ID, `${PREFIX}configMenu`, {
    name: "GLAS.config.menuName",
    label: "GLAS.config.menuLabel",
    hint: "GLAS.config.menuHint",
    icon: "fa-solid fa-wand-sparkles",
    type: ArcaneSurgeConfigApp,
    restricted: true,
  });
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.pf2e-arcane-surge.title",
  hint: "GLS.feature.pf2e-arcane-surge.hint",
  icon: "fa-solid fa-wand-sparkles",
  settingPrefix: PREFIX,
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings,
  onInit,
  onReady,
  api,
});
