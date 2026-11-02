/**
 * Diorama — shared constants.
 *
 * Pure and dependency-free: the check tool and the preview page import this
 * under plain Node / a bare browser page.
 *
 * Units used everywhere in this feature:
 *   • px    — Foundry canvas pixels.
 *   • cell  — one grid square. Three.js world space is 1 unit = 1 cell
 *             (x = px / gridSize, z = py / gridSize, y = height in cells).
 *   • q     — a quarter cell. Heights are stored and compared as integer q.
 *   • dist  — scene distance units (feet in PF2e): q / 4 * grid.distance.
 */

export const FEATURE_ID = "diorama";
export const PREFIX = "dio.";

/** Scene flag holding the saved terrain, keyed by Level id. */
export const FLAG_TERRAIN = "dio.terrain";
/** Scene flag: the GM marked this scene "3D off". */
export const FLAG_OFF = "dio.off";
/** Actor flag: GM-chosen standee art (a path). */
export const FLAG_STANDEE = "dio.standee";
/** Actor flag: creature height override in distance units. */
export const FLAG_CREATURE_HEIGHT = "dio.height";
/** Token flag: altitude above the ground (flying), distance units. */
export const FLAG_ALTITUDE = "dio.altitude";
/** Scene flag: the scene's environment (time of day, weather, atmosphere). environment.mjs owns its shape. */
export const FLAG_ENV = "dio.env";
/** Scene flag: placed props, keyed by Level id like the terrain. terrain/props.mjs owns its shape. */
export const FLAG_PROPS = "dio.props";

/** Settings (all keys start with PREFIX so the Control Center routes them). */
export const SETTINGS = Object.freeze({
  tiltShift: "dio.tiltShift",          // client: tilt-shift blur on/off
  grid: "dio.grid",                    // client: the square grid on the 3D ground
  effects: "dio.effects",              // client: conditions on the base ring (halo) or over the head (plate)
  yawSnap: "dio.yawSnap",              // world: camera turns in 90° (default) or 45° steps
  cutout: "dio.cutout",                // world: auto cut-out portrait backgrounds (opt-in)
  invite: "dio.invite",                // client: accept invites automatically / ask / never
  follow: "dio.followCombatant",       // client: follow the current combatant
  rules: "dio.rules",                  // world: height rules on/off (movement + occlusion + cover)
  stepHeight: "dio.stepHeight",        // world: default walkable rise, distance units
  wallHeight: "dio.wallHeight",        // world: default wall height, distance units
  wallMaterial: "dio.wallMaterial",    // world: default wall material preset
  effectOrient: "dio.effectOrient",    // world: per-file Sequencer orientation overrides
});

/** Sub-cells per cell per axis. Heights are painted at this resolution. */
export const SUB = 2;

/** Quarter-cells per cell. */
export const Q_PER_CELL = 4;

/** Ground kinds, stored in the low nibble of the kind byte. */
export const KIND = Object.freeze({
  FLOOR: 0,
  WATER: 1,
  PIT: 2,
  STAIRS: 3,
  RAMP: 4,
  VOID: 5,
});
export const KIND_KEYS = Object.freeze(["floor", "water", "pit", "stairs", "ramp", "void"]);

/** Stair/ramp direction (the way the steps go DOWN), high nibble of the kind byte. */
export const DIR = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });
export const DIR_VEC = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]);

/** Side (cliff) material presets. Keys are stored data; never rename. */
export const CLIFF_MATERIALS = Object.freeze(["earth", "stone", "edge", "ice", "wood", "brick"]);
/** Wall material presets. Keys are stored data; never rename. */
export const WALL_MATERIALS = Object.freeze(["stone", "plaster", "palisade", "hedge", "cave", "map"]);

/** Creature height by PF2e-style size key, in distance units (feet). */
export const SIZE_HEIGHT = Object.freeze({
  tiny: 2.5, sm: 3, small: 3, med: 6, medium: 6, lg: 10, large: 10,
  huge: 15, grg: 20, gargantuan: 20,
});
/** Eye sits at this fraction of creature height. */
export const EYE_FRACTION = 0.9;

/** Daggerheart range bands, in grid squares (inclusive upper bound). */
export const DH_BANDS = Object.freeze([
  { key: "melee", max: 1 },
  { key: "veryClose", max: 3 },
  { key: "close", max: 6 },
  { key: "far", max: 12 },
  { key: "veryFar", max: Infinity },
]);

/** PF2e falling into water treats the fall as this many feet shorter. */
export const PF2E_WATER_FALL_REDUCTION = 20;

/**
 * Shedding, cheapest loss first. Bound with Budget.ladder in the renderer.
 * Vision, lighting correctness and fog are never shed.
 */
export const SHED_ORDER = Object.freeze([
  "tiltShift",
  "atmosphere",       // fog, haze, light shafts, cloud shadows
  "embers",           // the sparks rising off fires (render/torches.mjs)
  "weatherParticles", // full → reduced particle counts first, then none
  "fogDrift",         // the fog of war's mist holds still
  "ambientOcclusion",
  "softShadows",
  "torchShadows",     // figures' shadows away from torches, torch-side shading
  "propDetail",       // prop and cliff relief, foliage sway
  "shadows",
  "torchFlicker",     // lights burn steady, flames hold their shape
  "water",
  "standeeDust",      // the puff where a standee lands (walk, fall, drop)
  "standeeSway",      // idle sway, and a flyer's hover on its stand
  "markerMotion",    // the target reticle's breathe and the target lines' glint
  "areaMotion",      // the slow glow rising through a spell area's volume (render/areas.mjs)
  "effectLights",
  "renderScale",
  "fpsCap",
]);

/** Every duration this feature animates with (ms). */
export const TIMING = Object.freeze({
  camera: 420,       // yaw / pitch / zoom tween
  door: 360,         // door leaf swing
  wallCut: 260,      // camera-facing wall lowering
  standeeStep: 140,  // standee hop per grid step while moving
  standeeSettle: 200, // a landed standee's card springing back from its squash
  standeeFall: 300,  // a standee dropping one cell off a ledge (gravity: longer drops take √ as long)
  dustLife: 560,     // a landing's dust puff, from the footfall to gone
  hoverLoop: 6400,   // a flyer's hover: two breaths and one sway per loop
  ping: 1600,
  reticleBreathe: 1800, // one in-and-out of a target reticle's arrows
  linkGlint: 2400,      // a glint's run along a target line, source to target
  inviteTimeout: 30000,
  bakeThrottle: 50,  // light / vision bake coalescing
  liftUp: 260,       // a picked-up miniature rising off the table (past its height and back)
  liftDrop: 260,     // and falling onto the square it is set down on
  holdBob: 1700,     // one slow rise and fall of a miniature held in the hand
  holdSend: 50,      // a held miniature's pose, at most this often to the table
  holdStale: 4000,   // a remote hold with no word for this long is dropped
  holdKeep: 1000,    // a hand held still says it is still holding this often (well inside holdStale)
  holdAwait: 1500,   // a miniature just set down waits this long for Foundry's move before going back
  reachDebounce: 60, // reach recompute coalescing
  flickerStep: 170,  // one noise step of a torch's flicker at Foundry speed 5
  flickerGentle: 900, // one noise step of a warm light with no animation
  lightPulse: 2600,  // one breath of a "pulse" light at Foundry speed 5
  torchFade: 450,    // a light joining or leaving the few lights that shade figures
  flameLick: 620,    // a flame's tongues rising through its own height
  emberRise: 2400,   // one spark's life, from the fire to gone
  fogDrift: 40000,   // the fog of war's mist drifting FOG_DRIFT_CELLS (3) cells downwind
  areaDrift: 7200,   // one glow band rising through a spell area, floor to crown
});

/**
 * Camera presets. Yaw steps are 45°; pitch presets in degrees above the horizon.
 * The default is the low 30° of classic 2:1 isometric, where a grid square reads
 * as a diamond twice as wide as it is tall.
 */
export const CAMERA = Object.freeze({
  yawSteps: 8,
  /** Yaw snaps the GM may choose, in degrees; 90 keeps the four isometric diagonals. */
  yawSnaps: Object.freeze([90, 45]),
  pitches: Object.freeze([30, 45, 65]),
  defaultPitch: 0,
  minZoom: 0.35,
  maxZoom: 4,
});

/**
 * Yaw steps (of 45°) per turn under a snap, and a step forced onto that snap.
 * Step 0 is the 45° diagonal, so a 90° snap keeps the even steps.
 */
export const yawStride = (snapDeg) => (Number(snapDeg) === 45 ? 1 : 2);
export function snapYawStep(step, snapDeg) {
  const n = CAMERA.yawSteps, k = yawStride(snapDeg);
  const s = Math.round(Number(step) || 0);
  return (((Math.round(s / k) * k) % n) + n) % n;
}

/** Socket message types. */
export const MSG = Object.freeze({
  invite: "invite",
  summon: "summon",
  hold: "hold",
});

/** Texture resolution of the light / vision bakes, px per cell. */
export const BAKE_PX_PER_CELL = 16;
