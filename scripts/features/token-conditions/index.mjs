import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { MOTION_TIER_DEFAULT } from "../../core/theme.mjs";
import { FEATURE_ID, LIMITS, OFFSET, PREFIX, SETTINGS } from "./constants.mjs";
import { onInit, onReady, api, reconfigure } from "./main.mjs";

/**
 * The world/client split follows the suite's convention and one rule: a setting
 * that changes what the *table* reads is the GM's, and a setting that changes
 * what one person's *eyes* need is theirs. Two players describing "the red one"
 * must be describing the same plate; whether it animates, and whether they have
 * to hover to read a name, is nobody else's business.
 */
function registerSettings() {
  const world = (key, extra) => game.settings.register(SUITE_ID, key, {
    scope: "world", config: true, onChange: () => reconfigure(), ...extra,
  });
  const client = (key, extra) => game.settings.register(SUITE_ID, key, {
    scope: "client", config: true, onChange: () => reconfigure(), ...extra,
  });

  world(SETTINGS.showEffects, {
    name: "GLTC.Settings.ShowEffects.Name",
    hint: "GLTC.Settings.ShowEffects.Hint",
    type: Boolean,
    default: true,
  });

  world(SETTINGS.maxPlates, {
    name: "GLTC.Settings.MaxPlates.Name",
    hint: "GLTC.Settings.MaxPlates.Hint",
    type: Number,
    range: { min: LIMITS.platesMin, max: LIMITS.platesMax, step: 1 },
    default: 6,
  });

  world(SETTINGS.expiryWarn, {
    name: "GLTC.Settings.ExpiryWarn.Name",
    hint: "GLTC.Settings.ExpiryWarn.Hint",
    type: Number,
    range: { min: 0, max: LIMITS.expiryWarnMax, step: 1 },
    default: 1,
  });

  world(SETTINGS.side, {
    name: "GLTC.Settings.Side.Name",
    hint: "GLTC.Settings.Side.Hint",
    type: String,
    choices: { left: "GLTC.Settings.Side.Left", right: "GLTC.Settings.Side.Right" },
    default: "left",
  });

  /* Suppressing Foundry's own icons is a world setting because it changes what
     everybody at the table is looking at, and because a world where half the
     clients draw two sets of icons is a world nobody can describe a token in. */
  world(SETTINGS.suppressCore, {
    name: "GLTC.Settings.SuppressCore.Name",
    hint: "GLTC.Settings.SuppressCore.Hint",
    type: Boolean,
    default: true,
  });

  world(SETTINGS.bloom, {
    name: "GLTC.Settings.Bloom.Name",
    hint: "GLTC.Settings.Bloom.Hint",
    type: Boolean,
    default: true,
  });

  /* The world default placement. Per-token overrides live on the TokenDocument;
     these are what every token without one uses, which for most worlds is every
     token. */
  world(SETTINGS.offsetX, {
    name: "GLTC.Settings.OffsetX.Name",
    hint: "GLTC.Settings.OffsetX.Hint",
    type: Number,
    range: { min: OFFSET.min, max: OFFSET.max, step: OFFSET.step },
    default: 0,
  });

  world(SETTINGS.offsetY, {
    name: "GLTC.Settings.OffsetY.Name",
    hint: "GLTC.Settings.OffsetY.Hint",
    type: Number,
    range: { min: OFFSET.min, max: OFFSET.max, step: OFFSET.step },
    default: 0,
  });

  client(SETTINGS.motionTier, {
    name: "GLTC.Settings.MotionTier.Name",
    hint: "GLTC.Settings.MotionTier.Hint",
    type: String,
    choices: {
      default: "GLTC.Settings.MotionTier.Full",
      reduced: "GLTC.Settings.MotionTier.Reduced",
      none: "GLTC.Settings.MotionTier.None",
    },
    default: MOTION_TIER_DEFAULT,
  });

  client(SETTINGS.labels, {
    name: "GLTC.Settings.Labels.Name",
    hint: "GLTC.Settings.Labels.Hint",
    type: String,
    choices: {
      hover: "GLTC.Settings.Labels.Hover",
      always: "GLTC.Settings.Labels.Always",
      never: "GLTC.Settings.Labels.Never",
    },
    default: "hover",
  });

  client(SETTINGS.scale, {
    name: "GLTC.Settings.Scale.Name",
    hint: "GLTC.Settings.Scale.Hint",
    type: Number,
    range: { min: LIMITS.scaleMin, max: LIMITS.scaleMax, step: LIMITS.scaleStep },
    default: 1,
  });
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.token-conditions.title",
  hint: "GLS.feature.token-conditions.hint",
  icon: "fa-solid fa-bolt-lightning",
  settingPrefix: PREFIX,
  /* PF2e only, and honestly so. The plate, the tone system and the gauge are
     general, but everything that fills them — `actor.conditions.active`, the
     effect badge, `system.duration`, `system.tokenIcon.show`, `isIdentified` —
     is PF2e's data model. A "system-agnostic" version would read
     `actor.statuses` and draw a rail of nameless icons with no counters and no
     durations, which is Foundry's own icon grid with extra steps. */
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings,
  onInit,
  onReady,
  /* No onDisable: the registry only runs onInit/onReady, and flipping a feature
     off is a reload in this suite (see registry.appliesLive). The teardown path
     is still exported on the api for programmatic use. */
  api,
});
