/**
 * PF2e AoE — constants shared by the shader, the host and the preview harness.
 *
 * Anything a number is needed for in BOTH the GLSL and the JS lives here, in
 * the shader's own space. A geometry constant restated in two places is the
 * failure this file exists to prevent: the plate drifts half off its own tab and
 * no diff shows you why.
 *
 * Dependency-free and side-effect-free so `tools/pf2e-aoe-preview.mjs` can
 * inline it verbatim.
 */

export const FEATURE_ID = "pf2e-aoe";
export const PREFIX = "aoe.";

/**
 * The fourteen archetype fill branches. Order is the `#define GL_ARCH_*` index
 * the shader compiles against — appending is safe, reordering is not.
 */
export const ARCHETYPES = Object.freeze([
  "ember",      // fire
  "frost",      // cold
  "arc",        // electricity
  "caustic",    // acid, poison
  "resonance",  // sonic, mental
  "radiance",   // vitality
  "umbra",      // void
  "spirit",     // spirit
  "force",      // force
  "kinetic",    // bludgeoning, piercing, slashing, bleed
  "verdant",    // no damage type: grease, web, entangling terrain
  "arcane",     // untyped, and every non-damaging area
  "generic",    // GM-authored ad-hoc area: flat colour, no material identity
  "warning",    // boss telegraph: pulsing hazard field and rotating sweep
]);

/**
 * Archetype -> the two emissive colours the shader ramps through: `tint` is
 * the body and `hot` is the energetic core. The map remains the shadow stop:
 * baking a dark third colour into a translucent overlay makes the area read as
 * an opaque material pasted over the scene.
 *
 * These are NOT derived from `pf2e-damage-dice/damage-types.mjs`, and the
 * temptation to derive them should be resisted: that table describes a die —
 * a lit object with a dark body and bright numerals — so for fire its
 * `background` is nearly black and for cold it is nearly white. Mapping either
 * onto an emissive area on a map gives the wrong answer, in opposite
 * directions. What must hold is that the two agree in HUE FAMILY, so a
 * fireball's dice and its area read as the same spell; the check tool asserts
 * that, not equality.
 *
 * Note what this table cannot fix: PF2e's cold and electricity are neighbours
 * in hue, and no honest palette separates them. That is the case for the
 * per-archetype behaviour branches in the shader rather than an argument
 * against them.
 */
export const ARCHETYPE_PALETTE = Object.freeze({
  ember:     { tint: [1.00, 0.42, 0.13], hot: [1.00, 0.94, 0.72] },
  frost:     { tint: [0.37, 0.78, 0.94], hot: [0.92, 0.99, 1.00] },
  arc:       { tint: [0.42, 0.55, 1.00], hot: [0.88, 0.94, 1.00] },
  caustic:   { tint: [0.62, 0.85, 0.15], hot: [0.93, 1.00, 0.62] },
  resonance: { tint: [0.80, 0.38, 1.00], hot: [0.98, 0.86, 1.00] },
  radiance:  { tint: [1.00, 0.86, 0.42], hot: [1.00, 1.00, 0.94] },
  umbra:     { tint: [0.34, 0.20, 0.52], hot: [0.72, 0.58, 0.92] },
  spirit:    { tint: [0.55, 0.95, 0.80], hot: [0.90, 1.00, 0.96] },
  force:     { tint: [0.52, 0.72, 1.00], hot: [0.90, 0.96, 1.00] },
  kinetic:   { tint: [0.72, 0.42, 0.30], hot: [0.96, 0.82, 0.68] },
  verdant:   { tint: [0.44, 0.68, 0.28], hot: [0.80, 0.92, 0.55] },
  arcane:    { tint: [0.68, 0.62, 1.00], hot: [0.92, 0.90, 1.00] },
  generic:   { tint: [0.46, 0.64, 1.00], hot: [0.46, 0.64, 1.00] },
  warning:   { tint: [1.00, 0.10, 0.15], hot: [1.00, 0.78, 0.62] },
});

/**
 * Damage type -> archetype. The 16 ids are PF2e's own (`CONFIG.PF2E.damageTypes`),
 * mirrored from `pf2e-damage-dice/damage-types.mjs`; the check tool fails if the
 * two ever disagree. Resolution order is trait override -> this table -> arcane.
 */
export const DAMAGE_ARCHETYPE = Object.freeze({
  fire: "ember",
  cold: "frost",
  electricity: "arc",
  acid: "caustic",
  poison: "caustic",
  sonic: "resonance",
  mental: "resonance",
  vitality: "radiance",
  void: "umbra",
  spirit: "spirit",
  force: "force",
  bludgeoning: "kinetic",
  piercing: "kinetic",
  slashing: "kinetic",
  bleed: "kinetic",
  untyped: "arcane",
});

/**
 * Trait overrides, highest precedence first. PF2e's damage type under-describes
 * a lot of areas — a divine fire spell and a wizard's fireball roll identically
 * and should not look identical. `flags.pf2e.origin.traits` carries these.
 */
export const TRAIT_ARCHETYPE = Object.freeze([
  ["holy", "radiance"],
  ["light", "radiance"],
  ["healing", "radiance"],
  ["unholy", "umbra"],
  ["darkness", "umbra"],
  ["death", "umbra"],
]);

/**
 * The three lattice states. A square is `covered` when PF2e says the area
 * reaches it, `blocked` when it reaches but line of effect does not (PF2e's own
 * `testCollision` split, which it would otherwise paint as a black crosshatch
 * over our fill), and `outside` otherwise. Encoded in the red channel of the
 * cell texture at these exact values — the shader compares against them.
 */
export const CELL = Object.freeze({ outside: 0.0, blocked: 0.5, covered: 1.0 });

/** Shape ids for `uShape`. Matches the SDF branch in the shader. */
export const SHAPE = Object.freeze({ burst: 0, cone: 1, emanation: 2, line: 3 });

/**
 * Geometry, all in GRID SQUARES unless the name says px.
 *
 * `latticeSeam` and `rimWidth` are the two that must never be sized here in
 * grid units at render time — they are hairlines, and a hairline sized in
 * geometry units is ~2px on a HiDPI display and sub-pixel on an ordinary one,
 * where `glDetail` deletes it. These are the *targets*; the shader converts
 * them through `uTexel` into device pixels. See SCALE_PRELUDE in core/glsl.mjs.
 */
export const LAYOUT = Object.freeze({
  latticeSeamPx: 1.15,   // device px: the seam between two covered squares
  rimWidthPx: 1.8,       // device px: the boundary pass, never occluded
  skirtRise: 0.85,       // grid squares of fake vertical the skirt climbs
  skirtFadeIn: 0.55,     // fraction of the skirt faded out toward the interior
  scorchSpread: 0.35,    // grid squares the scorch decal bleeds past the edge
  moteDensity: 2.4,      // motes per grid square at full fidelity
  moteRise: 1.6,         // grid squares a mote climbs over its life
});

/**
 * The three treatments under review.
 *
 * Ground-versus-air balance is the structural axis all fourteen archetypes
 * inherit, so it is the expensive one to get wrong. The first pass varied only
 * that balance, and the three read as one look at three exposures rather than
 * as three answers. Each now also carries a CHARACTER vector: how much the
 * floor is marked, how much particulate stands in the air, how hard the
 * boundary is drawn, and how much the fill churns.
 *
 * `grounded` is PINNED. Its four character multipliers are all exactly 1, so
 * it renders bit-identically to the version that was approved; the other two
 * are pushed away from it rather than all three away from each other.
 *
 *   grounded    an etched plate on the floor. Hard rim, crisp seams, the fill
 *               lit rather than boiling. You read the squares first.
 *   volumetric  a standing wall of flame at the boundary. The floor is barely
 *               marked; nearly everything is in the skirt and the churn.
 *   airborne    a suspended cloud. No floor contact, the boundary a suggestion,
 *               and the shape carried almost entirely by rising embers.
 */
export const TREATMENTS = Object.freeze([
  { id: "grounded",   label: "Grounded",
    ground: 1.00, air: 0.30, skirt: 0.45,
    scorch: 1.00, motes: 1.00, rim: 1.00, turb: 1.00 },
  { id: "volumetric", label: "Volumetric",
    ground: 0.42, air: 0.95, skirt: 1.55,
    scorch: 0.22, motes: 0.55, rim: 0.50, turb: 1.45 },
  { id: "airborne",   label: "Airborne",
    ground: 0.14, air: 1.50, skirt: 0.22,
    scorch: 0.00, motes: 2.40, rim: 0.28, turb: 1.75 },
]);

/** Settings keys, all prefixed (the catalog warns on any that are not). */
export const SETTINGS = Object.freeze({
  motionTier: `${PREFIX}motionTier`,
  replaceAuraRender: `${PREFIX}replaceAuraRender`,
  maxConcurrent: `${PREFIX}maxConcurrent`,
  styleDefaults: `${PREFIX}styleDefaults`, // world: archetype -> #RRGGBB
});

/** Flags we stamp, scoped to SUITE_ID and prefixed. */
export const FLAGS = Object.freeze({
  /* Per-region GM-authored presentation:
     { archetype: ARCHETYPES[number], color: "#RRGGBB", label: string }.
     `color` overrides both built-in and generic defaults; the host derives the
     restrained hot stop from it. `label` is display text, never an i18n key. */
  style: `${PREFIX}style`,
  suppress: `${PREFIX}suppress`, // opt one region out of our rendering
});
