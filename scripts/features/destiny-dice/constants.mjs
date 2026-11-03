/**
 * Destiny Dice — every key, id and preset in one place.
 *
 * Pure: no `game`, no DOM. The check tool and the preview import this.
 *
 * Nothing here may be renamed. The setting keys, the flag keys and the preset
 * ids are world data: a world that picked "aegis-fallen" stored that string, and
 * every chat message that ever carried a fate stores `flags[SUITE_ID]["dd.fate"]`.
 */

export const MODULE_ID = "gluniverse-foundry-modules";
export const FEATURE_ID = "destiny-dice";

/* Dice So Nice keeps its own registry of systems and colorsets, separate from
   Foundry's settings scopes. This id is ours inside it and must stay stable. */
export const DSN_NAMESPACE = "gluniverse-destiny-dice";
export const DSN_COLORSET = `${DSN_NAMESPACE}-glass`;

/* The die term. `z` was claimed by the standalone module and every fate roll
   ever serialised says `1dz`, so it stays. */
export const FATE_DIE_DENOMINATION = "z";
export const FATE_DIE_NOTATION = `1d${FATE_DIE_DENOMINATION}`;
/* What is rolled when another package already holds `z`: a plain d6, read
   through the same face table. The fate is the same; only the 3D die differs. */
export const FALLBACK_NOTATION = "1d6";

/* Flags under the shared suite scope, prefixed so they cannot collide. */
export const FLAGS = Object.freeze({
  fate: "dd.fate",
  pendingFatedRoll: "dd.pendingFatedRoll",
});

/* PF2e roll option that marks a check the player tied fate to. It is the only
   marker that survives into the message: PF2e copies `context.options` into
   `flags.pf2e.context.options` and drops every key it does not know. */
export const FATED_OPTION = "glddf:fated-roll";
/* PF2e's own option on a hero point reroll (Check.rerollFromMessage). */
export const HERO_REROLL_OPTION = "check:reroll:hero-points";

export const FACE_NUMBERS = Object.freeze([1, 2, 3, 4, 5, 6]);

export const KIND_OPPORTUNITY = "opportunity";
export const KIND_COMPLICATION = "complication";
export const KIND_BLANK = "blank";
export const FATE_KINDS = Object.freeze([KIND_OPPORTUNITY, KIND_COMPLICATION, KIND_BLANK]);

/* Stored kind values from the standalone module's first naming. */
export const KIND_ALIASES = Object.freeze({
  tyranny: KIND_COMPLICATION,
  defiance: KIND_OPPORTUNITY,
});

export const PRESET_DEFAULT = "default";
export const PRESET_AEGIS_FALLEN = "aegis-fallen";
export const PRESET_TIDES_OF_DESTINY = "tides-of-destiny";
export const PRESET_IDS = Object.freeze([PRESET_DEFAULT, PRESET_AEGIS_FALLEN, PRESET_TIDES_OF_DESTINY]);

/* The printed die: two complications, two blanks, two opportunities. Presets
   share it; a preset changes words and tones, never the odds. */
export const DEFAULT_FACES = Object.freeze({
  1: Object.freeze({ kind: KIND_COMPLICATION, bonus: 4 }),
  2: Object.freeze({ kind: KIND_COMPLICATION, bonus: 2 }),
  3: Object.freeze({ kind: KIND_BLANK, bonus: 0 }),
  4: Object.freeze({ kind: KIND_BLANK, bonus: 0 }),
  5: Object.freeze({ kind: KIND_OPPORTUNITY, bonus: 0 }),
  6: Object.freeze({ kind: KIND_OPPORTUNITY, bonus: 0 }),
});

/**
 * A preset is a vocabulary and a set of tones. Nothing else.
 *
 * `labels` are i18n keys (the dynamic family `GLDDF.Preset.<id>.<kind>`; the
 * check resolves every one). `tones` name a key of `PALETTE` in core/theme.mjs,
 * which is the JS mirror of gl-tokens.css: the die's glyphs are baked from the
 * palette and the chat strip reads the same hue through `--gl-*`, so the die and
 * the card can never disagree about what colour an Opportunity is.
 */
export const PRESETS = Object.freeze({
  [PRESET_DEFAULT]: Object.freeze({
    name: "GLDDF.Settings.Preset.Default",
    labels: Object.freeze({
      [KIND_OPPORTUNITY]: "GLDDF.Preset.default.opportunity",
      [KIND_COMPLICATION]: "GLDDF.Preset.default.complication",
      [KIND_BLANK]: "GLDDF.Preset.default.blank",
    }),
    tones: Object.freeze({ [KIND_OPPORTUNITY]: "info", [KIND_COMPLICATION]: "hazard", [KIND_BLANK]: "textDim" }),
  }),
  [PRESET_AEGIS_FALLEN]: Object.freeze({
    name: "GLDDF.Settings.Preset.AegisFallen",
    labels: Object.freeze({
      [KIND_OPPORTUNITY]: "GLDDF.Preset.aegis-fallen.opportunity",
      [KIND_COMPLICATION]: "GLDDF.Preset.aegis-fallen.complication",
      [KIND_BLANK]: "GLDDF.Preset.aegis-fallen.blank",
    }),
    tones: Object.freeze({ [KIND_OPPORTUNITY]: "hazard", [KIND_COMPLICATION]: "signal", [KIND_BLANK]: "textDim" }),
  }),
  [PRESET_TIDES_OF_DESTINY]: Object.freeze({
    name: "GLDDF.Settings.Preset.TidesOfDestiny",
    labels: Object.freeze({
      [KIND_OPPORTUNITY]: "GLDDF.Preset.tides-of-destiny.opportunity",
      [KIND_COMPLICATION]: "GLDDF.Preset.tides-of-destiny.complication",
      [KIND_BLANK]: "GLDDF.Preset.tides-of-destiny.blank",
    }),
    tones: Object.freeze({ [KIND_OPPORTUNITY]: "cyan", [KIND_COMPLICATION]: "violet", [KIND_BLANK]: "textDim" }),
  }),
});

/* PALETTE key → the token the stylesheet reads. Every tone a preset names must
   be here, and `[data-tone]` in destiny-dice.css must have a rule for it. */
export const TONE_TOKENS = Object.freeze({
  info: "--gl-info",
  hazard: "--gl-hazard",
  signal: "--gl-signal",
  cyan: "--gl-cyan",
  violet: "--gl-violet",
  textDim: "--gl-text-dim",
});

/**
 * Every face-art path the feature has ever shipped, under both install roots.
 *
 * The art itself is gone (the die is baked at runtime now, see raster.mjs), but
 * a world may still have one of these stored as a face's "custom" image. The
 * GM-side migration clears any of them back to "follow the preset" instead of
 * pointing Dice So Nice at a file that no longer exists.
 */
const LEGACY_ART = [
  "blank", "complication-2", "complication-4", "opportunity",
  "defiance", "defiance-2", "tyranny-2", "tyranny-4",
  "aegis-fallen/blank", "aegis-fallen/defiance", "aegis-fallen/tyranny-2", "aegis-fallen/tyranny-4",
  "tides-of-destiny/blank", "tides-of-destiny/storm-2", "tides-of-destiny/storm-4", "tides-of-destiny/tide",
];
export const LEGACY_IMAGE_PATHS = Object.freeze(new Set(LEGACY_ART.flatMap((base) => [
  `modules/${MODULE_ID}/assets/${FEATURE_ID}/dice/${base}.png`,
  `modules/gluniverse-destiny-dice/assets/dice/${base}.png`,
  base.includes("/") ? null : base,
].filter(Boolean))));

/* Motion tiers (the in-app "Animation Style" setting, an explicit choice). */
export const MOTION_TIERS = Object.freeze(["reduced", "default", "cinematic"]);
export const MOTION_TIER_DEFAULT = "default";

/* Emission on the die, 0..2. Zero sends Dice So Nice no emissive at all. */
export const EMISSIVE_INTENSITY_DEFAULT = 1.0;
export const EMISSIVE_INTENSITY_MIN = 0;
export const EMISSIVE_INTENSITY_MAX = 2;
export const EMISSIVE_INTENSITY_STEP = 0.05;

/**
 * When the fate is thrown, in ms. Only the JS side lives here; every duration
 * passes through the motion scale before it is used.
 *
 *   revealWindow  a fate this young plays its arrival; older renders are still
 *   diceSettle    how long to wait for the check's own 3D dice before throwing
 *   pendingQuiet  how long an auto-fated check hides "Add Fate Die" for others
 */
export const TIMING = Object.freeze({
  revealWindow: 4000,
  diceSettle: 8000,
  pendingQuiet: 20000,
});

/* The arrival, as one table, so the preview and the check read the same beats. */
export const REVEAL = Object.freeze({
  slab: 260,
  die: 520,
  dieAt: 40,
  rule: 420,
  text: 300,
  textAt: 160,
  textStep: 60,
  bonus: 360,
  bonusAt: 260,
  shift: 320,
  shiftAt: 420,
});
