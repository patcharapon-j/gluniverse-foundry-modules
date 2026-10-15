/**
 * Building a badge model for a real roller, action and target — the glue
 * between PF2e (probe.mjs), what the viewer knows (knowledge.mjs), the MAP and
 * armed action (tracker.mjs), and the pure model (view-model.mjs).
 *
 * Every surface calls `modelFor`: the line badge, the sheet, the roll dialog,
 * the save prompt. One function, so a number never means two things on two
 * surfaces.
 *
 * The stream login always gets the PLAYER view, even when it holds GM rights:
 * the capture is watched by the players, and a badge that looks right on the
 * GM's monitor would print the truth on the recording.
 */

import { isConfiguredStreamUser } from "../stream/settings.js";
import { SKILL_ACTIONS, strikeStat } from "./constants.mjs";
import { flatDcFor, modelFromProbe } from "./model-from-probe.mjs";
import { cached, probeSave, probeSkillAction, probeSpellAttack, probeStrike } from "./probe.mjs";
import { armedOf, mapIndex } from "./tracker.mjs";

const ORDINAL = ["GLOD.attack.first", "GLOD.attack.second", "GLOD.attack.third"];

/** Does this user see the truth? GMs do, except the stream login. */
export function seesTruth(user = game.user) {
  if (!user?.isGM) return false;
  try {
    return !isConfiguredStreamUser(user);
  } catch {
    return true;
  }
}

const tokenDoc = (t) => t?.document ?? t ?? null;

/** A ranged Strike past its maximum range: PF2e would refuse it, so do we. */
function outOfRange(strike, rollerToken, targetToken) {
  const item = strike?.item;
  const max = item?.range?.max ?? null;
  if (!item?.isRanged || !Number.isFinite(max) || !rollerToken?.distanceTo) return false;
  try {
    return rollerToken.distanceTo(targetToken) > max;
  } catch {
    return false;
  }
}

/**
 * The model for one roller, one target, one action.
 *
 * @param {{
 *   roller: Actor, rollerToken?: Token, target: Token,
 *   action?: object|null,     // an Armed descriptor; default: the armed action, else the primary Strike
 *   map?: number|null,        // force a MAP index (the sheet's three buttons); default: tracked
 *   user?: User,
 * }} spec
 * @returns {Promise<object|null>}
 */
export async function modelFor({ roller, rollerToken = null, target, action = null, map = null, user = game.user }) {
  const targetActor = target?.actor ?? null;
  if (!roller || !targetActor || roller === targetActor) return null;
  const armed = action ?? armedOf(roller) ?? { kind: "strike", slug: null };
  const tracked = mapIndex(roller);
  const index = map ?? tracked.index;
  const truth = seesTruth(user);
  const key = `${roller.uuid}|${tokenDoc(target)?.uuid}|${JSON.stringify(armed)}|${index}`;

  if (armed.kind === "spell" && armed.mode === "save") return saveModel({ roller, targetActor, armed, truth, user, key });

  let probe = null;
  let stamps = "attack";
  let unknownModStat = null;
  let label = "";
  let sub = "";
  let flat = null;

  if (armed.kind === "strike") {
    probe = await cached(key, () => probeStrike(roller, { slug: armed.slug, map: index, target }));
    if (!probe) return null;
    const strike = (roller.system?.actions ?? []).find((s) => (s.slug ?? s.item?.slug) === probe.strike?.slug);
    if (outOfRange(strike, rollerToken, target)) return { state: "oor", label: probe.strike?.label ?? "" };
    label = probe.strike?.label ?? "";
    sub = ORDINAL[index];
    unknownModStat = probe.strike?.slug ? strikeStat(probe.strike.slug) : null;
    flat = flatDcFor(targetActor);
  } else if (armed.kind === "skill") {
    const def = SKILL_ACTIONS[armed.action];
    if (!def) return null;
    probe = await cached(key, () => probeSkillAction(roller, armed.action, { target, map: def.attack ? index : 0 }));
    label = `GLOD.action.${armed.action}`;
    sub = def.attack ? ORDINAL[index] : "";
    stamps = "check";
  } else if (armed.kind === "spell") {
    const spell = fromUuidSync(armed.uuid);
    if (!spell) return null;
    probe = await cached(key, () => probeSpellAttack(spell, { target, map: index }));
    label = spell.name;
    sub = ORDINAL[index];
    unknownModStat = "spell-attack";
    flat = flatDcFor(targetActor);
  }
  if (!probe?.dc) return null;

  return modelFromProbe({
    probe,
    roller,
    targetActor,
    truth,
    user,
    stamps,
    label,
    sub,
    flatDc: flat,
    mapOverride: tracked.manual && map == null,
    modStat: unknownModStat,
  });
}

/**
 * A save spell, priced from the caster's side: the chance the target does
 * WORSE than a success. The unknown is the target's save modifier, which the
 * ledger keeps as a DC (10 + modifier).
 */
async function saveModel({ roller, targetActor, armed, truth, user, key }) {
  const spell = fromUuidSync(armed.uuid);
  const save = spell?.system?.defense?.save?.statistic ?? null;
  const dc = spell?.spellcasting?.statistic?.dc?.value ?? null;
  if (!save || !Number.isFinite(dc)) return null;
  const probe = await cached(key, () => probeSave(targetActor, save, { dc, origin: roller, item: spell }));
  if (!probe?.dc) return null;
  // The saver rolls the die; the caster owns the DC.
  return modelFromProbe({
    probe,
    roller: targetActor,
    targetActor: roller,
    truth,
    user,
    invert: true,
    label: spell.name,
    sub: `GLOD.save.${save}`,
    stamps: "check",
    dcStat: "spell-dc",
    modStat: save,
  });
}

/** The model for a creature's save against a known DC — the chat card's save button. */
export async function saveButtonModel({ saver, save, dc, origin = null, item = null, user = game.user }) {
  if (!saver || !Number.isFinite(dc)) return null;
  const truth = seesTruth(user);
  const probe = await cached(`save|${saver.uuid}|${save}|${dc}|${origin?.uuid ?? ""}`, () => probeSave(saver, save, { dc, origin, item }));
  if (!probe?.dc) return null;
  // The roller is the one saving; the unknown is the CASTER's DC, which the
  // ledger keeps as "spell-dc".
  return modelFromProbe({
    probe,
    roller: saver,
    targetActor: origin,
    truth,
    user,
    label: `GLOD.save.${save}`,
    stamps: "check",
    dcStat: "spell-dc",
  });
}
