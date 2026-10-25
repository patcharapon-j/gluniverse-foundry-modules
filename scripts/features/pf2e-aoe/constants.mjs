/**
 * PF2e AoE — identifiers and contracts shared by the data adapter, the host
 * and the renderer. The look itself (colours, patterns, rims, motion) lives in
 * `render/look.mjs`.
 *
 * Dependency-free and side-effect-free, so the check tool and the preview page
 * import it directly.
 */

export const FEATURE_ID = "pf2e-aoe";
export const PREFIX = "aoe.";

/**
 * The fourteen legacy archetype ids of the schema-v1 `aoe.style` flag. Nothing
 * draws from these any more; `migration.mjs` maps each onto schema-v2
 * semantics, and their `GLAOE.Archetype.*` names stay for old flag data.
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
 * The three lattice states. A square is `covered` when PF2e says the area
 * reaches it, `blocked` when it reaches but line of effect does not (PF2e's own
 * `testCollision` split, which it would otherwise paint as a black crosshatch
 * over our fill), and `outside` otherwise. Encoded in the red channel of the
 * rules cells at these exact values — `render/outline.mjs` reads them back.
 */
export const CELL = Object.freeze({ outside: 0.0, blocked: 0.5, covered: 1.0 });

/** Shape ids, as `regionGeometry()` reports them and `render/outline.mjs` draws them. */
export const SHAPE = Object.freeze({ burst: 0, cone: 1, emanation: 2, line: 3 });

/** Grid squares of margin kept around an area's bounds for its glow and echo. */
export const AREA_PAD = 1.25;

/** Settings keys, all prefixed (the catalog warns on any that are not). */
export const SETTINGS = Object.freeze({
  motionTier: `${PREFIX}motionTier`,
  maxConcurrent: `${PREFIX}maxConcurrent`,
  styleDefaults: `${PREFIX}styleDefaults`, // world: archetype -> #RRGGBB
  schemaVersion: `${PREFIX}schemaVersion`,
  profiles: `${PREFIX}profiles`,
  intensity: `${PREFIX}intensity`,
  quality: `${PREFIX}quality`,
});

/** Flags we stamp, scoped to SUITE_ID and prefixed. */
export const FLAGS = Object.freeze({
  /* Per-region GM-authored presentation:
     { archetype: ARCHETYPES[number], colorOverride: boolean,
       color: "#RRGGBB", label: string }.
     `color` overrides both built-in and generic defaults; the host derives the
     restrained hot stop from it. `label` is display text, never an i18n key. */
  style: `${PREFIX}style`,
  suppress: `${PREFIX}suppress`, // opt one region out of our rendering
  presentation: `${PREFIX}presentation`,
  sceneNative: `${PREFIX}nativePresentation`,
});
