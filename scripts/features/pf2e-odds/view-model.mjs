/**
 * The badge model — pure.
 *
 * Takes what PF2e said about a check (a probe result, see probe.mjs) and what a
 * viewer knows, and produces everything a surface draws. No `game` here: the
 * check tool and the preview page build models from fixtures, which is how the
 * visibility rules are proven rather than read.
 *
 * ## Who is unknown
 *
 * A check has a roller and a defender. Exactly the creature-side numbers are
 * gated:
 *
 *   • PC rolls against a creature  → the creature's DC is unknown (AC, a save
 *     DC, Perception DC). The roller's own modifier is always known.
 *   • A creature rolls against a PC → the creature's MODIFIER is unknown. The
 *     PC's DC is their own number.
 *   • Creature against creature    → players see nothing at all (Q10).
 *
 * A modifier range is folded into an equivalent DC range — the odds depend on
 * `mod − dc` alone — so the engine only ever reasons about one unknown.
 *
 * ## Bare and today's
 *
 * Knowledge is a range on the BARE stat (no visible status or circumstance
 * modifiers). Today's number is bare plus whatever situational delta PF2e
 * applied to this check — the off-guard from a flank, a frightened ogre's −1 —
 * which the table can see, and which the probe measures as `actual − bare`.
 */

import { CRIT_SUCCESS, SUCCESS, oddsOf, formatRange, pct, shift, isExact } from "../../core/pf2e-odds.mjs";
import { isPublicModifier } from "./constants.mjs";

export const SIDE = Object.freeze({ dc: "dc", mod: "mod", none: "none", open: "open" });

/**
 * Which number a viewer is missing.
 * @param {{rollerIsCreature: boolean, defenderIsCreature: boolean, isGM: boolean}} who
 */
export function unknownSide({ rollerIsCreature, defenderIsCreature, isGM }) {
  if (isGM) return SIDE.open;
  if (rollerIsCreature && defenderIsCreature) return SIDE.none;
  if (defenderIsCreature) return SIDE.dc;
  if (rollerIsCreature) return SIDE.mod;
  return SIDE.open;
}

/**
 * The DC range a viewer reasons with.
 *
 * @param {{
 *   side: string,
 *   mod: number, dc: number,           // today's true numbers (from the probe)
 *   bareMod?: number, bareDc?: number, // the same with situational modifiers off
 *   known: {lo:number, hi:number}|null // what the viewer knows of the BARE stat on the unknown side
 * }} spec
 * @returns {{lo,hi}|number|null}
 */
export function viewerDc({ side, mod, dc, bareMod = mod, bareDc = dc, known }) {
  if (side === SIDE.open) return dc;
  if (side === SIDE.none) return undefined;
  if (!known) return null;
  if (side === SIDE.dc) {
    // Today's DC = bare + (today − bare).
    const r = shift(known, dc - bareDc);
    return isExact(r) ? r.lo : r;
  }
  // SIDE.mod: today's modifier range = bare range + (today − bare).
  // Odds depend on mod − dc, so a mod range [a, b] against DC d is the same as
  // the true mod against DC range [d − (b − mod), d − (a − mod)].
  const m = shift(known, mod - bareMod);
  const r = { lo: dc - (m.hi - mod), hi: dc - (m.lo - mod) };
  return isExact(r) ? r.lo : r;
}

/**
 * Chips: the modifiers worth naming on a badge.
 *
 * MAP, every enabled status or circumstance modifier (the things that move from
 * turn to turn), degree adjustments, fortune, and the flat check. Item and
 * proficiency bonuses are not chips: they are the roller's standing number and
 * would turn every badge into a stat block.
 */
export function chipsOf({ mods = [], dcMods = [], adjustments = [], rollTwice = false, flat = null }) {
  const chips = [];
  for (const m of mods) {
    if (!m.enabled || !m.value) continue;
    if (m.slug === "multiple-attack-penalty") {
      chips.push({ key: "map", label: "GLOD.chip.map", value: m.value, tone: "neg" });
      continue;
    }
    if (m.kind !== "status" && m.kind !== "circumstance") continue;
    chips.push({ key: m.slug, label: m.label, value: m.value, tone: m.value > 0 ? "pos" : "warn" });
  }
  // A DC going DOWN is good for the roller, so the sign flips onto the roller's side.
  for (const m of dcMods) {
    if (!m.enabled || !m.value || (m.kind !== "status" && m.kind !== "circumstance")) continue;
    chips.push({ key: `dc:${m.slug}`, label: m.label, value: -m.value, tone: -m.value > 0 ? "pos" : "warn" });
  }
  for (const label of adjustments) chips.push({ key: `dos:${label}`, label, value: null, tone: "info" });
  if (rollTwice === "keep-higher") chips.push({ key: "fortune", label: "GLOD.chip.fortune", value: null, tone: "pos" });
  if (rollTwice === "keep-lower") chips.push({ key: "misfortune", label: "GLOD.chip.misfortune", value: null, tone: "warn" });
  // `rollTwice` is also a string ("keep-higher"), and "keep-higher".fixed is
  // String.prototype.fixed — truthy. Same guard as the engine's faceWeights.
  if (typeof rollTwice === "object" && Number.isInteger(rollTwice?.fixed)) chips.push({ key: "fixed", label: "GLOD.chip.fixed", value: rollTwice.fixed, tone: "info" });
  if (flat) chips.push({ key: "flat", label: flat.dc >= 11 ? "GLOD.chip.hidden" : "GLOD.chip.concealed", value: null, flatDc: flat.dc, chance: flat.chance, tone: "warn" });
  return chips;
}

/**
 * The whole model.
 *
 * @param {{
 *   probe: {mod:number, mods:Array, dc:{value:number}|null, dos?:Array, options?:string[], rollTwice?:any, type?:string},
 *   dcMods?: Array, bareMod?: number, bareDc?: number,
 *   who: {rollerIsCreature:boolean, defenderIsCreature:boolean, isGM:boolean},
 *   known: {lo,hi}|null,
 *   flatDc?: number|null,
 *   invert?: boolean,      // the roller is the TARGET of the viewer's effect (a save against their spell)
 *   label: string, sub?: string, stamps?: "attack"|"check", dcLabel?: string,
 *   lie?: boolean, contradiction?: boolean,
 *   playersKnown?: {lo,hi}|null   // for the GM's "players see" tag
 * }} spec
 */
export function buildModel(spec) {
  const { probe, who, known, flatDc = null, invert = false } = spec;
  if (!probe || !probe.dc || !Number.isFinite(probe.dc.value)) return null;
  const side = unknownSide(who);
  if (side === SIDE.none) return null;

  const base = { mod: probe.mod, dos: probe.dos ?? null, baseOptions: probe.options ?? null, rollTwice: probe.rollTwice ?? false, flatDc, goal: SUCCESS, invert };
  const truth = oddsOf({ ...base, dc: probe.dc.value });
  const dcSeen = viewerDc({ side, mod: probe.mod, dc: probe.dc.value, bareMod: spec.bareMod, bareDc: spec.bareDc, known });
  const shown = side === SIDE.open ? truth : oddsOf({ ...base, dc: dcSeen });

  let gm = null;
  if (who.isGM) {
    const playerSide = unknownSide({ ...who, isGM: false });
    if (playerSide === SIDE.dc || playerSide === SIDE.mod) {
      const seen = viewerDc({ side: playerSide, mod: probe.mod, dc: probe.dc.value, bareMod: spec.bareMod, bareDc: spec.bareDc, known: spec.playersKnown ?? null });
      const theirs = oddsOf({ ...base, dc: seen });
      gm = { truth: truth.headline, players: theirs.headline, playersExact: theirs.exact, lie: !!spec.lie, contradiction: !!spec.contradiction };
    }
  }

  // A creature's attack nobody has seen is "Attack": its Strike's name is
  // Offense knowledge the dex sells, not something a targeting line gives away.
  const anonymous = side === SIDE.mod && !shown.known && (spec.stamps ?? "attack") === "attack";
  return {
    label: anonymous ? "GLOD.unseen.attackLabel" : spec.label ?? "",
    sub: spec.sub ?? "",
    stamps: spec.stamps ?? "attack",
    invert: !!invert,
    side,
    state: !shown.known ? "unknown" : shown.exact ? "exact" : "range",
    odds: shown,
    headline: formatRange(shown.headline),
    crit: shown.known ? formatRange(shown.crit) : null,
    dcText: side === SIDE.mod ? null : dcText(shown.dc),
    dcLabel: spec.dcLabel ?? "GLOD.word.dc",
    // The unknown side's modifiers are the creature's: a player sees only the
    // public ones (its conditions, cover). The viewer's own are all theirs.
    chips: chipsOf({
      mods: side === SIDE.mod ? (probe.mods ?? []).filter((m) => m.slug === "multiple-attack-penalty" || isPublicModifier(m)) : probe.mods ?? [],
      dcMods: side === SIDE.dc ? (spec.dcMods ?? []).filter(isPublicModifier) : spec.dcMods ?? [],
      // A creature's own degree adjustments (its Evasion) are its business.
      adjustments: side === SIDE.mod ? [] : shown.adjustments,
      rollTwice: probe.rollTwice,
      flat: shown.flat,
    }),
    gm,
    // A lie is the GM's to see. The player's model is built on the believed
    // number and carries no trace of it — a lie they can see is not a lie.
    lie: who.isGM && !!spec.lie,
  };
}

/** "21", "19–22", "≥ 19", "≤ 26", or null. */
export function dcText(range) {
  if (!range) return null;
  if (range.lo === range.hi) return `${range.lo}`;
  if (!Number.isFinite(range.lo)) return `≤ ${range.hi}`;
  if (!Number.isFinite(range.hi)) return `≥ ${range.lo}`;
  return `${range.lo}–${range.hi}`;
}

/** For the compact tag: the headline alone, or ??? */
export const compactText = (model) => model?.headline ?? "???";

export { pct, CRIT_SUCCESS };
