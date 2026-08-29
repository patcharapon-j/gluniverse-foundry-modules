import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { MOTION_TIER_DEFAULT } from "../../core/theme.mjs";
import { FEATURE_ID, OFFSET, PREFIX, READOUT, SEGMENTS, SETTINGS } from "./constants.mjs";
import { SHIELD_STYLES } from "./shader.mjs";
import { onInit, onReady, api, reconfigure } from "./main.mjs";

/**
 * The world/client split follows the suite's convention and one rule: a setting
 * that changes what the *table* reads is the GM's, and a setting that changes
 * what one person's *eyes* need is theirs. Two players describing "the red one"
 * must be describing the same bar; whether it animates is nobody else's
 * business.
 */
function registerSettings() {
  const world = (key, extra) => game.settings.register(SUITE_ID, key, {
    scope: "world", config: true, onChange: () => reconfigure(), ...extra,
  });
  const client = (key, extra) => game.settings.register(SUITE_ID, key, {
    scope: "client", config: true, onChange: () => reconfigure(), ...extra,
  });

  world(SETTINGS.enabledBars, {
    name: "GLRB.Settings.EnabledBars.Name",
    hint: "GLRB.Settings.EnabledBars.Hint",
    type: String,
    choices: { both: "GLRB.Settings.EnabledBars.Both", primary: "GLRB.Settings.EnabledBars.Primary" },
    default: "both",
  });

  world(SETTINGS.segmentMode, {
    name: "GLRB.Settings.SegmentMode.Name",
    hint: "GLRB.Settings.SegmentMode.Hint",
    type: String,
    choices: {
      count: "GLRB.Settings.SegmentMode.Count",
      perHp: "GLRB.Settings.SegmentMode.PerHp",
    },
    default: "count",
  });

  world(SETTINGS.segments, {
    name: "GLRB.Settings.Segments.Name",
    hint: "GLRB.Settings.Segments.Hint",
    type: Number,
    range: { min: 0, max: 20, step: 1 },
    default: 10,
  });

  world(SETTINGS.segmentSize, {
    name: "GLRB.Settings.SegmentSize.Name",
    hint: "GLRB.Settings.SegmentSize.Hint",
    type: Number,
    range: { min: SEGMENTS.sizeMin, max: SEGMENTS.sizeMax, step: 1 },
    default: 5,
  });

  /* The GM's say over the readout. It overrides each player's own choice
     rather than replacing the setting, so turning it back to "let each player
     choose" restores whatever they had picked. It cannot widen what a player is
     allowed to see: canViewNumbers consults the token's Display Bars first and
     the mode second, so a forced "always" still draws nothing on a token whose
     bars that player cannot see. */
  world(SETTINGS.numbersForce, {
    name: "GLRB.Settings.NumbersForce.Name",
    hint: "GLRB.Settings.NumbersForce.Hint",
    type: String,
    choices: {
      player: "GLRB.Settings.NumbersForce.Player",
      hover: "GLRB.Settings.NumbersForce.Hover",
      always: "GLRB.Settings.NumbersForce.Always",
      never: "GLRB.Settings.NumbersForce.Never",
    },
    default: "player",
  });

  world(SETTINGS.lowThreshold, {
    name: "GLRB.Settings.LowThreshold.Name",
    hint: "GLRB.Settings.LowThreshold.Hint",
    type: Number,
    range: { min: 5, max: 50, step: 5 },
    default: 25,
  });

  world(SETTINGS.floatingDeltas, {
    name: "GLRB.Settings.FloatingDeltas.Name",
    hint: "GLRB.Settings.FloatingDeltas.Hint",
    type: Boolean,
    default: false,
  });

  world(SETTINGS.pf2eLayers, {
    name: "GLRB.Settings.Pf2eLayers.Name",
    hint: "GLRB.Settings.Pf2eLayers.Hint",
    type: Boolean,
    default: true,
  });

  /* The shield's pattern is what tells a player the plate is *in front of* the
     hit points rather than being more of them, so it is the table's to agree on
     rather than each viewer's. Choices are built from the shader's own list, so
     a style added there without a string here shows up as a missing key rather
     than as a choice nobody can pick. */
  world(SETTINGS.shieldStyle, {
    name: "GLRB.Settings.ShieldStyle.Name",
    hint: "GLRB.Settings.ShieldStyle.Hint",
    type: String,
    choices: Object.fromEntries(SHIELD_STYLES.map((s) =>
      [s, `GLRB.Settings.ShieldStyle.${s.charAt(0).toUpperCase()}${s.slice(1)}`])),
    default: SHIELD_STYLES[0],
  });

  world(SETTINGS.bloom, {
    name: "GLRB.Settings.Bloom.Name",
    hint: "GLRB.Settings.Bloom.Hint",
    type: Boolean,
    default: true,
  });

  /* The world default placement. Per-token overrides live on the TokenDocument
     and are edited in Token Config; these are what every token without one
     uses, which for most worlds is every token. */
  world(SETTINGS.offsetX, {
    name: "GLRB.Settings.OffsetX.Name",
    hint: "GLRB.Settings.OffsetX.Hint",
    type: Number,
    range: { min: OFFSET.min, max: OFFSET.max, step: OFFSET.step },
    default: 0,
  });

  world(SETTINGS.offsetY, {
    name: "GLRB.Settings.OffsetY.Name",
    hint: "GLRB.Settings.OffsetY.Hint",
    type: Number,
    range: { min: OFFSET.min, max: OFFSET.max, step: OFFSET.step },
    default: 0,
  });

  client(SETTINGS.motionTier, {
    name: "GLRB.Settings.MotionTier.Name",
    hint: "GLRB.Settings.MotionTier.Hint",
    type: String,
    choices: {
      default: "GLRB.Settings.MotionTier.Full",
      reduced: "GLRB.Settings.MotionTier.Reduced",
      none: "GLRB.Settings.MotionTier.None",
    },
    default: MOTION_TIER_DEFAULT,
  });

  client(SETTINGS.ramp, {
    name: "GLRB.Settings.Ramp.Name",
    hint: "GLRB.Settings.Ramp.Hint",
    type: String,
    choices: { default: "GLRB.Settings.Ramp.Default", safe: "GLRB.Settings.Ramp.Safe" },
    default: "default",
  });

  client(SETTINGS.numberScale, {
    name: "GLRB.Settings.NumberScale.Name",
    hint: "GLRB.Settings.NumberScale.Hint",
    type: Number,
    range: { min: READOUT.min, max: READOUT.max, step: READOUT.step },
    default: 1,
  });

  client(SETTINGS.numbers, {
    name: "GLRB.Settings.Numbers.Name",
    hint: "GLRB.Settings.Numbers.Hint",
    type: String,
    choices: {
      hover: "GLRB.Settings.Numbers.Hover",
      always: "GLRB.Settings.Numbers.Always",
      never: "GLRB.Settings.Numbers.Never",
    },
    default: "hover",
  });
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.resource-bars.title",
  hint: "GLS.feature.resource-bars.hint",
  icon: "fa-solid fa-heart-pulse",
  settingPrefix: PREFIX,
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings,
  onInit,
  onReady,
  /* No onDisable: the registry only runs onInit/onReady, and flipping a
     feature off is a reload in this suite (see registry.appliesLive). The
     teardown path is still exported on the api for programmatic use. */
  api,
});
