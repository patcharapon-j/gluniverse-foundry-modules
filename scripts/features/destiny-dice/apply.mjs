/**
 * The one writer: throw the fate die for a check message and record it.
 *
 * Who may write: the message's author or a GM. Foundry lets nobody else update
 * a ChatMessage, and the old version offered "Add Fate Die" to anyone who owned
 * the actor, so a player whose check the GM rolled got the menu entry, threw the
 * die, and then failed on the write with an error. The rule is checked here and
 * nowhere else.
 *
 * Guards against a second fate on one check, each for a different road:
 *   - the flag itself (a fated message is never offered again),
 *   - `inFlight` (one client clicking twice, or the auto path and the menu at
 *     once on the same client),
 *   - the roll's own `glddfFateBonusApplied` option (a stale document copy),
 *   - a re-read of the flag after the die lands (another client won the race).
 */

import { err } from "../../core/const.mjs";
import { DSN_COLORSET, DSN_NAMESPACE, FATED_OPTION, FLAGS, HERO_REROLL_OPTION, MODULE_ID, TIMING } from "./constants.mjs";
import { naturalOf, normalizeFate, shiftDegree } from "./fate.mjs";
import { fateNotation, ownsFateDie } from "./fate-die.mjs";
import { face as readFace, t } from "./settings.mjs";

const inFlight = new Set();
/* PF2e check types the fate die may ride. Initiative is left out: a bonus on
   the message would not reach the combatant's initiative, so the card and the
   tracker would disagree. */
const FATEABLE = new Set(["check", "skill-check", "saving-throw", "perception-check", "attack-roll", "flat-check", "spell-attack-roll"]);
/* Content earlier versions baked into the message body. */
const OLD_STRIP = /<(footer|section)\b[^>]*class="[^"]*glddf-fate-(?:strip|result)[^"]*"[^>]*>[\s\S]*?<\/\1>\s*/gi;

const now = () => globalThis.game?.time?.serverTime ?? Date.now();
const optionsOf = (message) => {
  const o = message?.flags?.pf2e?.context?.options;
  return Array.isArray(o) ? o : o instanceof Set ? [...o] : [];
};

export function isPcCheckMessage(message) {
  const context = message?.flags?.pf2e?.context;
  if (!context || (context.type && !FATEABLE.has(context.type))) return false;
  const actor = message.actor ?? message.speakerActor;
  if (!actor?.isOfType?.("character")) return false;
  const roll = message.rolls?.[0];
  return !!roll?.dice?.some?.((d) => d.faces === 20);
}

export const fateOf = (message) => normalizeFate(message?.getFlag?.(MODULE_ID, FLAGS.fate));

/** Which automatic road this message is on, or null. */
export function autoSource(message) {
  const options = optionsOf(message);
  if (options.includes(FATED_OPTION)) return "dialog";
  if (message?.flags?.pf2e?.context?.isReroll && options.includes(HERO_REROLL_OPTION)) return "hero-point-reroll";
  return null;
}

/**
 * Whether `user` may add a fate to this message right now.
 *
 * A check on an automatic road is the author's client's to throw; for a short
 * while after it posts, nobody else is offered the menu entry, or a GM clicking
 * at the same moment would put two dice on one check.
 */
export function canAddFate(message, user = globalThis.game?.user) {
  if (!isPcCheckMessage(message) || fateOf(message)) return false;
  if (!(user?.isGM || message.isAuthor)) return false;
  if (inFlight.has(message.id)) return false;
  const pending = autoSource(message) && !message.isAuthor && now() - (message.timestamp ?? 0) < TIMING.pendingQuiet;
  return !pending;
}

/** Wait until the check's own 3D dice have landed, so the fate die follows them. */
async function afterCheckDice(message) {
  const dice3d = globalThis.game?.dice3d;
  if (!dice3d?.waitFor3DAnimationByMessageID) return;
  // DSN marks the message as animating in its own createChatMessage hook.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.race([
    dice3d.waitFor3DAnimationByMessageID(message.id),
    new Promise((resolve) => setTimeout(resolve, TIMING.diceSettle)),
  ]);
}

/** Point the fate roll's die at our Dice So Nice system, whatever the user picked. */
function tagForDiceSoNice(roll) {
  if (!ownsFateDie()) return;
  for (const die of roll.dice ?? []) {
    die.options ??= {};
    die.options.colorset = DSN_COLORSET;
    die.options.appearance = { ...(die.options.appearance ?? {}), colorset: DSN_COLORSET, system: DSN_NAMESPACE };
  }
}

function faceOfRoll(roll) {
  const die = roll.dice?.find((d) => d.faces === 6);
  const value = die?.results?.find((r) => r.active !== false && !r.discarded)?.result;
  return Number.isInteger(value) ? readFace(value) : null;
}

/**
 * The check roll with the bonus added, as a new roll (the document's own copy is
 * never mutated, so a failed update leaves the message as it was).
 */
async function withBonus(message, bonus, label) {
  const source = message.rolls?.[0];
  if (!source) return null;
  const data = source.toJSON();
  const roll = Roll.fromData(foundry.utils.deepClone(data));
  let before = Number(roll.total ?? roll._total);
  if (!Number.isFinite(before)) return null;

  // A hero point reroll clones the fated roll, so it arrives carrying the old
  // fate's term and marker. Take the old bonus out before adding the new one.
  const inherited = source.options?.glddfFateBonusApplied ? Number(source.options.glddfFateBonus) || 0 : 0;
  if (inherited !== 0) {
    const at = roll.terms.findLastIndex((term, i) => i > 0 && term?.number === Math.abs(inherited)
      && term.options?.flavor === label && roll.terms[i - 1]?.operator === (inherited > 0 ? "+" : "-"));
    if (at < 0) return null;
    roll.terms.splice(at - 1, 2);
    before -= inherited;
    roll._total = before;
    roll.resetFormula?.();
  }

  if (bonus !== 0) {
    const { OperatorTerm, NumericTerm } = foundry.dice.terms;
    const op = new OperatorTerm({ operator: bonus >= 0 ? "+" : "-" });
    const num = new NumericTerm({ number: Math.abs(bonus), options: { flavor: label } });
    await op.evaluate();
    await num.evaluate();
    roll.terms.push(op, num);
    roll._total = before + bonus;
    roll.resetFormula?.();
  }
  roll.options ??= {};
  roll.options.glddfFateBonusApplied = true;
  roll.options.glddfFateBonus = bonus;

  const context = message.flags?.pf2e?.context;
  const shift = shiftDegree({
    total: before,
    bonus,
    dc: Number(context?.dc?.value),
    natural: naturalOf(data),
    dosAdjustments: context?.dosAdjustments ?? null,
  });
  if (shift) roll.options.degreeOfSuccess = ["criticalFailure", "failure", "success", "criticalSuccess"].indexOf(shift.after);
  return { roll, shift, total: before + bonus, changed: bonus !== 0 || inherited !== 0 };
}

/**
 * Throw the fate die for `message` and write the result.
 * @returns {Promise<object|null>} the stored fate, or null when nothing was written
 */
export async function applyFate(message, { source = "manual", wait = false } = {}) {
  if (!message?.id || !canAddFate(message)) return null;
  inFlight.add(message.id);
  try {
    if (wait) await afterCheckDice(message);

    const roll = await new Roll(fateNotation()).evaluate({ allowInteractive: true });
    tagForDiceSoNice(roll);
    const dice3d = globalThis.game?.dice3d;
    if (dice3d) {
      // The fate die is shown to whoever may see the check, never wider.
      const whisper = message.whisper?.length ? [...message.whisper] : null;
      await dice3d.showForRoll(roll, game.user, true, whisper, !!message.blind, null, message.speaker);
    }

    // Someone else's fate landed while ours was in the air.
    if (fateOf(game.messages?.get(message.id) ?? message)) return null;

    const face = faceOfRoll(roll);
    if (!face) {
      err(`Destiny Dice | ${roll.formula} produced no readable face`, roll);
      ui.notifications?.error(t("GLDDF.Notify.NoFace", { notation: roll.formula }));
      return null;
    }

    const label = t("GLDDF.Roll.FateBonusLabel");
    const bonusRoll = await withBonus(message, face.bonus, label);
    const fate = {
      source,
      face: face.face,
      kind: face.kind,
      bonus: face.bonus,
      accepted: null,
      roll: roll.toJSON(),
      user: game.user.id,
      appliedAt: now(),
      bonusApplied: !!bonusRoll && face.bonus !== 0,
      before: bonusRoll?.shift?.before ?? null,
      after: bonusRoll?.shift?.after ?? null,
    };

    const updates = { [`flags.${MODULE_ID}.${FLAGS.fate}`]: fate };
    if (bonusRoll?.changed) {
      updates.rolls = [bonusRoll.roll.toJSON(), ...message.rolls.slice(1).map((r) => r.toJSON())];
      if (bonusRoll.shift) {
        updates["flags.pf2e.context.outcome"] = bonusRoll.shift.after;
        updates["flags.pf2e.context.unadjustedOutcome"] = bonusRoll.shift.unadjusted;
      }
    }
    const content = message.content ?? "";
    const cleaned = content.replace(OLD_STRIP, "");
    if (cleaned !== content) updates.content = cleaned;
    await message.update(updates);
    return fate;
  } catch (e) {
    err("Destiny Dice | could not apply the fate die", e);
    ui.notifications?.error(t("GLDDF.Notify.RollFailed"));
    return null;
  } finally {
    inFlight.delete(message.id);
  }
}
