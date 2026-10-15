/**
 * A probe-shaped answer → a badge model, for a real roller and defender.
 *
 * The one place that decides WHICH number a viewer is missing and looks up
 * what they know of it. view.mjs (the line badge, the sheet, the save prompt)
 * and dialog.mjs (PF2e's roll dialog, which hands us the probe's fields
 * directly rather than being probed) both go through here, so the two can
 * never disagree about who is told what.
 *
 * Roles are the d20's, not the turn's: `roller` is whoever rolls the die and
 * `defender` owns the DC. For a save, the saver is the roller and the caster
 * is the defender, and `invert` prices it from the caster's side.
 */

import { STATS, statForDcSlug, statKind } from "./constants.mjs";
import { isCreature, knownStat, playersKnow } from "./knowledge.mjs";
import { bareDc, bareMod } from "./probe.mjs";
import { SIDE, buildModel, unknownSide } from "./view-model.mjs";

/** The flat check standing in front of an attack on this creature. */
export function flatDcFor(actor) {
  if (!actor?.hasCondition) return null;
  if (actor.hasCondition("hidden") || actor.hasCondition("invisible")) return 11;
  if (actor.hasCondition("concealed")) return 5;
  return null;
}

/** A DC statistic's modifiers in the probe's own shape. */
export function dcModsOf(dcStatistic) {
  return (dcStatistic?.modifiers ?? []).map((m) => ({
    slug: m.slug,
    label: m.label,
    value: m.modifier,
    kind: m.type ?? "untyped",
    enabled: !!m.enabled && !m.ignored,
  }));
}

/**
 * @param {{
 *   probe: object,                 // probe.mjs result shape
 *   roller: Actor,                 // rolls the d20
 *   targetActor?: Actor|null,      // owns the DC (may be null: a save with no known origin)
 *   truth: boolean,                // does this viewer see the truth (view.mjs seesTruth)
 *   user?: User,
 *   stamps?: "attack"|"check", label?: string, sub?: string,
 *   flatDc?: number|null, invert?: boolean, mapOverride?: boolean,
 *   dcStat?: string|null,          // ledger key of the defender's DC; default from probe.dc.slug
 *   modStat?: string|null,         // ledger key of the roller's modifier, when the roller is the unknown
 * }} spec
 * @returns {object|null} a view-model.mjs model
 */
export function modelFromProbe({
  probe,
  roller,
  targetActor = null,
  truth,
  user = globalThis.game?.user,
  stamps = "attack",
  label = "",
  sub = "",
  flatDc = null,
  invert = false,
  mapOverride = false,
  dcStat,
  modStat = null,
  dcLabel = undefined,
}) {
  if (!probe?.dc || !roller) return null;
  const who = { rollerIsCreature: isCreature(roller), defenderIsCreature: !!targetActor && isCreature(targetActor), isGM: !!truth };
  const side = unknownSide({ ...who, isGM: false });
  const dcKey = dcStat === undefined ? statForDcSlug(probe.dc.slug) : dcStat;
  const subject =
    side === SIDE.dc && targetActor ? { actor: targetActor, stat: dcKey } : side === SIDE.mod ? { actor: roller, stat: modStat } : null;

  // A save is kept in the ledger as a DC (10 + modifier); when the saver's
  // modifier is the unknown, fold it back.
  const asMod = side === SIDE.mod && !!subject?.stat && statKind(subject.stat) === "dc";
  const conv = (r) => (r ? (asMod ? { lo: r.lo - 10, hi: r.hi - 10 } : r) : null);

  const mine = subject?.stat && !truth ? knownStat(subject.actor, subject.stat, { user }) : null;
  const theirs = subject?.stat && truth ? playersKnow(subject.actor, subject.stat) : null;
  const hasStat = !!probe.dcStatistic;

  return buildModel({
    probe,
    dcMods: hasStat ? dcModsOf(probe.dcStatistic) : [],
    bareMod: bareMod(probe),
    bareDc: hasStat ? bareDc(probe.dcStatistic, probe.dc.value) : probe.dc.value,
    who,
    known: conv(mine?.range),
    playersKnown: conv(theirs?.range),
    lie: !!theirs?.lie,
    contradiction: !!theirs?.contradiction,
    flatDc,
    invert,
    label,
    sub,
    stamps,
    mapOverride,
    dcLabel: dcLabel ?? STATS[dcKey]?.label,
  });
}
