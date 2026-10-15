/**
 * Building a badge model for a real roller, action and target — the glue
 * between PF2e (probe.mjs), what the viewer knows (knowledge.mjs), the armed
 * action and its MAP button (tracker.mjs), and the pure model (view-model.mjs).
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
import { isCreature } from "./knowledge.mjs";
import { cached, probeSave, probeSkillAction, probeSpellAttack, probeStrike, strikeOf } from "./probe.mjs";
import { armedOf } from "./tracker.mjs";
import { mapOf } from "./armed.mjs";

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

/**
 * A creature's name as this viewer may see it: PF2e's own answer
 * (`playersCanSeeName`) for anyone short of the truth — the stream login
 * included, since the players watch it. Blank rather than a placeholder: the
 * plate simply drops its "›› target" half.
 */
export function nameFor(token, actor = null, user = game.user) {
  const doc = tokenDoc(token);
  if (!seesTruth(user) && (doc ? doc.playersCanSeeName === false : !!actor && isCreature(actor))) return "";
  return doc?.name ?? actor?.name ?? "";
}

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
 *   map?: number|null,        // force a MAP index (the sheet's three buttons); default: the armed button
 *   user?: User,
 * }} spec
 * @returns {Promise<object|null>}
 */
export async function modelFor({ roller, rollerToken = null, target, action = null, map = null, user = game.user }) {
  const targetActor = target?.actor ?? null;
  if (!roller || !targetActor || roller === targetActor) return null;
  const armed = action ?? armedOf(roller) ?? { kind: "strike", slug: null };
  const index = map ?? mapOf(armed);
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
    // Range first: past it PF2e refuses the Strike with a toast, so asking it
    // would warn the player on every redraw and never price anything.
    const strike = strikeOf(roller, armed.slug);
    if (outOfRange(strike, rollerToken, target)) return { state: "oor", label: strike?.label ?? strike?.item?.name ?? "" };
    probe = await cached(key, () => probeStrike(roller, { slug: armed.slug, map: index, target }));
    if (!probe) return null;
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
  // Only a spell's DC is the caster's "spell DC"; a breath weapon or an
  // affliction is a DC the ledger has no name for, so it stays unknown.
  // A caster we cannot resolve is unknown too, unless PF2e prints DCs.
  const dcPublic = !!game.pf2e?.settings?.metagame?.dcs;
  return modelFromProbe({
    probe,
    roller: saver,
    targetActor: origin,
    truth,
    user,
    label: `GLOD.save.${save}`,
    stamps: "check",
    dcStat: item?.type === "spell" ? "spell-dc" : null,
    dcPublic,
  });
}
