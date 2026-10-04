/**
 * Theatre — constants shared by every half of the feature.
 *
 * Pure: no `game`, no `foundry`, no `canvas`, no PIXI. The check tool and the
 * preview page import this under plain Node / a bare browser page.
 */

export const FEATURE_ID = "theatre";
export const PREFIX = "th.";
export const I18N = "GLTH";

/** World / client settings (all under SUITE_ID, all prefixed). */
export const SETTINGS = Object.freeze({
  chatOnCut: "th.chatOnCut",       // world  Boolean — post a location line to chat on a cut (off)
  defaultStyle: "th.defaultStyle", // world  String  — STYLES key a new Theatre scene starts with
  defaultFace: "th.defaultFace",   // world  String  — FACES key a new Theatre scene starts with
});

/** Scene flag keys (scope SUITE_ID). Dotted keys nest: flags[SUITE_ID].th.shots */
export const FLAGS = Object.freeze({
  enabled: "th.enabled",   // Boolean — this scene is a Theatre scene
  shots: "th.shots",       // Shot[] (model.mjs), ordered
  config: "th.config",     // SceneConfig (model.mjs)
  state: "th.state",       // PlayState (model.mjs) — what is on screen, and the last cue
  restore: "th.restore",   // RestoreData — what Convert replaced, so Leave can put it back
});

/** The fixed world rectangle a Theatre scene is laid out on. Shots cover it. */
export const FRAME = Object.freeze({ width: 3840, height: 2160 });

/**
 * Transition styles. i18n: GLTH.style.<key>.name / .hint
 *   centre    — dip to black, centred title with tracking collapse (the default)
 *   chapter   — push-in dissolve, lower-left chapter title with band wipe
 *   credits   — letterbox bars close and reopen, credit-style title in the lower bar
 *   wipe      — soft diagonal wipe, upper-right title with words rising
 *   cut       — instant swap, centred title only
 *   interlude — text card over black; the image does not change
 */
export const STYLES = Object.freeze(["centre", "chapter", "credits", "wipe", "cut", "interlude"]);
export const DEFAULT_STYLE = "centre";

/** Cue kinds a GM can fire. i18n: GLTH.cue.<key> */
export const CUE_KINDS = Object.freeze(["shot", "title", "card", "black", "clear"]);

/**
 * Title typefaces. Every family here is declared in styles/gl-fonts.css and
 * bundled under assets/fonts/ (all OFL). `secondary` is the eyebrow/subtitle
 * voice paired with that title face. i18n: GLTH.face.<key>
 */
export const FACES = Object.freeze({
  gsflex: Object.freeze({
    family: "\"Google Sans Flex\", sans-serif", weight: 850, stretch: "140%", track: "-0.02em", upper: true,
    secondary: Object.freeze({ family: "\"Google Sans Flex\", sans-serif", weight: 300, stretch: "100%", style: "normal", track: "0.45em", upper: true }),
  }),
  archivo: Object.freeze({
    family: "\"Archivo\", sans-serif", weight: 800, stretch: "125%", track: "0.02em", upper: true,
    secondary: Object.freeze({ family: "\"Archivo\", sans-serif", weight: 300, stretch: "100%", style: "normal", track: "0.4em", upper: true }),
  }),
  cinzel: Object.freeze({
    family: "\"Cinzel\", serif", weight: 700, stretch: "100%", track: "0.06em", upper: true,
    secondary: Object.freeze({ family: "\"Cormorant Garamond\", serif", weight: 400, stretch: "100%", style: "italic", track: "0.12em", upper: false }),
  }),
  cormorant: Object.freeze({
    family: "\"Cormorant Garamond\", serif", weight: 600, stretch: "100%", track: "0.03em", upper: true,
    secondary: Object.freeze({ family: "\"Cormorant Garamond\", serif", weight: 300, stretch: "100%", style: "italic", track: "0.1em", upper: false }),
  }),
  oxanium: Object.freeze({
    family: "\"Oxanium\", sans-serif", weight: 700, stretch: "100%", track: "0.04em", upper: true,
    secondary: Object.freeze({ family: "\"Oxanium\", sans-serif", weight: 300, stretch: "100%", style: "normal", track: "0.4em", upper: true }),
  }),
});
export const FACE_KEYS = Object.freeze(Object.keys(FACES));
export const DEFAULT_FACE = "gsflex";

/** Ken Burns drift modes. i18n: GLTH.drift.<key> */
export const DRIFT_MODES = Object.freeze(["push", "pull", "panLeft", "panRight", "none"]);

/**
 * Timing constants (ms, at motion scale 1). The ONLY place a Theatre duration
 * is written; everything else multiplies these by the motion scale.
 */
export const TIMING = Object.freeze({
  hold: 4000,          // default title hold, after the title finishes arriving
  holdMin: 1000,
  holdMax: 20000,
  cueLead: 300,        // a cue is stamped this far in the future so every client starts together
  lateGrace: 1500,     // a client that receives a cue later than this after its start settles instead of playing
  driftPeriod: 26000,  // one Ken Burns leg
  tagDelay: 1000,      // corner tag appears this long after the title leaves
});

/** Video extensions a shot may use (muted, looping). */
export const VIDEO_RE = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i;

/**
 * How long a client waits for a shot's image before starting its cue anyway
 * (ms, real time — a network wait, not a motion beat, so never motion-scaled).
 * Added by the core worker (W5) for preload.mjs's readiness gate.
 */
export const LOAD_TIMEOUT = 6000;
