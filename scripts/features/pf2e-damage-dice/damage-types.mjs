/**
 * GLUniverse Suite — PF2e Damage Dice: the damage-type table.
 *
 * One entry per Pathfinder 2e damage type. This is the single source of truth
 * shared by three consumers:
 *
 *   • `dsn.mjs`                    — builds a Dice So Nice colorset + texture +
 *                                    dice-preset family from each entry.
 *   • `apply.mjs`                  — resolves a rolled die to its entry.
 *   • `tools/gen-damage-textures.mjs` — reads `id` + `texture` to know which
 *                                    maps it must bake, and asserts coverage.
 *
 * ── On the colours ──
 * `docs/DESIGN_SYSTEM.md` forbids hardcoding a *suite* colour in JS, but allows
 * a feature to carry domain colours "only when they carry distinct meaning (a
 * weather tint, a cargo category) — those are data, not theme". A damage type's
 * hue is exactly that: acid must read as acid at a glance across the table, and
 * it must not shift when someone rethemes the suite accent. The one type with
 * no colour of its own — `untyped` — is therefore the one type routed through
 * `PALETTE.accent`.
 *
 * ── On the materials ──
 * `material` must be one of Dice So Nice's shader presets: plastic, metal,
 * wood, glass, resin, frosted, chrome, pristine, iridescent, stone, velvet.
 * Anything else silently falls back to plastic.
 */

import { PALETTE, darken, lighten, mix } from "../../core/theme.mjs";

/** Family name declared in `styles/gl-fonts.css`, pinned to weight 700 there. */
export const DICE_FONT = "Google Sans Code";

/** Prefix for every id this feature registers with Dice So Nice. */
export const DSN_PREFIX = "gl-dmg-";

/** Asset folder, relative to the feature's `assets/` root. */
export const TEXTURE_DIR = "textures";

const accent = PALETTE.accent;

/**
 * The 16 damage types PF2e actually rolls (`CONFIG.PF2E.damageTypes`).
 * `air` / `earth` / `metal` / `water` exist in PF2e only as IWR entries and
 * weapon traits, never as an instance type, so they are deliberately absent.
 *
 * Per entry:
 *   background  array → Dice So Nice picks one per die, so a 4d6 fire roll
 *                       lands as four related-but-distinct dice.
 *   emissive    0 disables the glow pass for the type entirely.
 *   emissiveLabels  glow the numerals as well as the emission map.
 */
export const DAMAGE_TYPES = Object.freeze({
  /* ── Physical ─────────────────────────────────────────────────────── */
  bludgeoning: {
    label: "PF2E.Damage.RollFlavor.bludgeoning",
    background: ["#3c4148", "#454b53", "#2f343a", "#4d545d"],
    foreground: "#e8edf2",
    outline: "#0b0d10",
    edge: "#5a626c",
    material: "stone",
    emissive: 0,
    emissiveLabels: false,
  },
  piercing: {
    label: "PF2E.Damage.RollFlavor.piercing",
    background: ["#59626e", "#6b7684", "#4a525c", "#646f7d"],
    foreground: "#f4f8fc",
    outline: "#0a0d12",
    edge: "#8b96a4",
    material: "metal",
    emissive: 0,
    emissiveLabels: false,
  },
  slashing: {
    label: "PF2E.Damage.RollFlavor.slashing",
    background: ["#4e5a63", "#616f79", "#3f4952", "#55636d"],
    foreground: "#eef5f8",
    outline: "#080c10",
    edge: "#9aa9b3",
    material: "chrome",
    emissive: 0,
    emissiveLabels: false,
  },
  bleed: {
    label: "PF2E.Damage.RollFlavor.bleed",
    background: ["#6d0f18", "#8a1420", "#4e0a10", "#a01a26"],
    foreground: "#ffd9d4",
    outline: "#1a0305",
    edge: "#3d060c",
    material: "velvet",
    emissive: 0.45,
    emissiveLabels: false,
  },

  /* ── Energy ───────────────────────────────────────────────────────── */
  acid: {
    label: "PF2E.Damage.RollFlavor.acid",
    background: ["#3f5c10", "#547a16", "#6b9a1c", "#2e440b"],
    foreground: "#eaffb0",
    outline: "#16210a",
    edge: "#7fb524",
    material: "iridescent",
    emissive: 0.9,
    emissiveLabels: false,
  },
  cold: {
    label: "PF2E.Damage.RollFlavor.cold",
    background: ["#9fd7ea", "#b9e6f5", "#7fc3da", "#cdeef9"],
    foreground: "#0d2a35",
    outline: "#eafcff",
    edge: "#dff5fd",
    material: "glass",
    emissive: 0.6,
    emissiveLabels: false,
  },
  electricity: {
    label: "PF2E.Damage.RollFlavor.electricity",
    background: ["#12203f", "#1b3163", "#0c1730", "#162951"],
    foreground: "#d6ecff",
    outline: "#04070f",
    edge: "#4d8fe0",
    material: "metal",
    emissive: 1.8,
    emissiveLabels: true,
  },
  fire: {
    label: "PF2E.Damage.RollFlavor.fire",
    background: ["#4a1305", "#6d1d06", "#8f2a08", "#2f0c03"],
    foreground: "#ffdca8",
    outline: "#1a0601",
    edge: "#c2510e",
    material: "stone",
    emissive: 2.0,
    emissiveLabels: true,
  },
  sonic: {
    label: "PF2E.Damage.RollFlavor.sonic",
    background: ["#3a1150", "#4d1769", "#2a0c3b", "#5c1d7d"],
    foreground: "#f3d6ff",
    outline: "#100418",
    edge: "#8a3cb8",
    material: "resin",
    emissive: 1.2,
    emissiveLabels: true,
  },
  vitality: {
    label: "PF2E.Damage.RollFlavor.vitality",
    background: ["#7a5a12", "#9c7418", "#5d440d", "#b98d1f"],
    foreground: "#fffbe8",
    outline: "#2a1d03",
    edge: "#e0b53d",
    material: "pristine",
    emissive: 1.7,
    emissiveLabels: true,
  },
  void: {
    label: "PF2E.Damage.RollFlavor.void",
    background: ["#150c22", "#1e1131", "#0c0715", "#251540"],
    foreground: "#d6c2ff",
    outline: "#000000",
    edge: "#3a2160",
    material: "velvet",
    emissive: 1.3,
    emissiveLabels: true,
  },
  force: {
    label: "PF2E.Damage.RollFlavor.force",
    background: ["#241a4d", "#2f2266", "#1a123a", "#372a75"],
    foreground: "#e6e0ff",
    outline: "#070417",
    edge: "#6f5ed8",
    material: "pristine",
    emissive: 1.6,
    emissiveLabels: true,
  },

  /* ── Uncategorised ────────────────────────────────────────────────── */
  mental: {
    label: "PF2E.Damage.RollFlavor.mental",
    background: ["#4a1240", "#612057", "#350c2d", "#722a66"],
    foreground: "#ffd9f5",
    outline: "#14040f",
    edge: "#a24a92",
    material: "velvet",
    emissive: 1.0,
    emissiveLabels: false,
  },
  poison: {
    label: "PF2E.Damage.RollFlavor.poison",
    background: ["#1f3d1f", "#2b552b", "#16301a", "#356b34"],
    foreground: "#c9ffbf",
    outline: "#050f06",
    edge: "#4e8f4a",
    material: "resin",
    emissive: 0.8,
    emissiveLabels: false,
  },
  spirit: {
    label: "PF2E.Damage.RollFlavor.spirit",
    background: ["#2b2f3d", "#383e52", "#202432", "#434a61"],
    foreground: "#fff4d0",
    outline: "#0a0c12",
    edge: "#b7a479",
    material: "frosted",
    emissive: 1.4,
    emissiveLabels: true,
  },
  untyped: {
    label: "PF2E.Damage.RollFlavor.untyped",
    // The only type with no colour of its own — so it, alone, follows the
    // suite accent. Rethemeing `--gl-accent` moves these with it.
    background: [darken(accent, 0.72), darken(accent, 0.66), darken(accent, 0.78), darken(accent, 0.6)],
    foreground: lighten(accent, 0.82),
    outline: PALETTE.ink0,
    edge: mix(accent, PALETTE.ink2, 0.45),
    material: "glass",
    // Etched glass does not light up: its emission map is deliberately black,
    // so declaring a glow here would register a whole system to render nothing.
    emissive: 0,
    emissiveLabels: false,
  },
});

/** Stable iteration order — also the order the Control Center preview uses. */
export const DAMAGE_TYPE_IDS = Object.freeze(Object.keys(DAMAGE_TYPES));

/**
 * Persistent damage is a *flag* on an instance, not a type of its own, so it
 * gets no texture family. It reads as "the same damage, still burning": the
 * glow is pushed harder and the numerals are forced to glow with it.
 */
export const PERSISTENT_EMISSIVE_BOOST = 1.75;

/** Lowest glow we will bother enabling for a persistent instance. */
export const PERSISTENT_EMISSIVE_FLOOR = 0.9;

/** Dice So Nice colorset name for a damage type. */
export const colorsetName = (id) => `${DSN_PREFIX}${id}`;

/** Dice So Nice texture id for a damage type. */
export const textureName = (id) => `${DSN_PREFIX}${id}`;

/** Dice So Nice system id for a damage type (carries the emission maps). */
export const systemName = (id) => `${DSN_PREFIX}${id}`;
