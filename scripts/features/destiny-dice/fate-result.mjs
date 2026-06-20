import { FATE_DIE_DENOMINATION, FATE_DIE_NOTATION, FLAGS, KIND_OPPORTUNITY, MODULE_ID } from "./constants.mjs";
import { getFaceImagePaths, getFateFace, getKindLabel, normalizeKind } from "./settings.mjs";

const inFlightFateRolls = new Set();
const FATE_STRIP_PATTERN = /<(footer|section)\b[^>]*class="[^"]*glddf-fate-(?:strip|result)[^"]*"[^>]*>[\s\S]*?<\/\1>\s*/gi;

export function isPcCheckMessage(message) {
  const context = message?.flags?.pf2e?.context;
  const actor = message?.actor ?? message?.speakerActor;
  const firstRoll = message?.rolls?.at?.(0);
  const hasD20 = firstRoll?.dice?.some?.((die) => die.faces === 20) ?? message?.isCheckRoll ?? false;
  return !!context && hasD20 && !!actor?.isOfType?.("character");
}

export function canUserAddFate(message) {
  if (!isPcCheckMessage(message)) return false;
  if (message.getFlag(MODULE_ID, FLAGS.fate)) return false;
  const actor = message.actor ?? message.speakerActor;
  return game.user.isGM || message.isAuthor || !!actor?.isOwner;
}

export async function applyFateToMessage(message, { source = "manual" } = {}) {
  if (!message?.id || !canUserAddFate(message)) return null;
  if (inFlightFateRolls.has(message.id)) return null;
  inFlightFateRolls.add(message.id);
  try {
    const roll = await new Roll(FATE_DIE_NOTATION).evaluate({ allowInteractive: true });
    if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true);

    const face = getFaceResult(roll);
    if (!face) {
      console.error(`GLUniverse Destiny Dice | ${FATE_DIE_NOTATION} produced no readable face`, roll);
      ui.notifications?.error(game.i18n.format("GLDDF.Notify.NoFace", { notation: FATE_DIE_NOTATION }));
      return null;
    }

    const fate = {
      source,
      face: face.value,
      kind: normalizeKind(face.kind),
      bonus: face.bonus,
      accepted: null,
      roll: roll.toJSON(),
      user: game.user.id,
      appliedAt: Date.now(),
    };

    const updates = { [`flags.${MODULE_ID}.${FLAGS.fate}`]: fate };

    // A non-zero fate bonus is added to the check's final result as an untyped
    // bonus (the result is whatever this physical face is worth). Faces worth 0
    // — or a missing/null bonus — leave the roll untouched.
    const bonusUpdate = await applyFateBonusToCheckRoll(message, fate.bonus, getKindLabel(fate.kind));
    if (bonusUpdate) {
      updates.rolls = bonusUpdate.rolls;
      if (bonusUpdate.outcome) updates["flags.pf2e.context.outcome"] = bonusUpdate.outcome;
      if (bonusUpdate.unadjustedOutcome) updates["flags.pf2e.context.unadjustedOutcome"] = bonusUpdate.unadjustedOutcome;
      fate.bonusApplied = true;
    }

    const cleanedContent = (message.content ?? "").replace(FATE_STRIP_PATTERN, "");
    if (cleanedContent !== message.content) updates.content = cleanedContent;
    await message.update(updates);

    return fate;
  } finally {
    inFlightFateRolls.delete(message.id);
  }
}

export function registerFateRendering() {
  Hooks.on("renderChatMessageHTML", attachFateStrip);
}

function attachFateStrip(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
  if (!root) return;
  const content = root.querySelector?.(".message-content");
  if (!content) return;

  content.querySelectorAll(".glddf-fate-strip, .glddf-fate-result").forEach((node) => node.remove());

  const fate = message?.getFlag?.(MODULE_ID, FLAGS.fate);
  if (!fate) return;
  content.insertAdjacentHTML("beforeend", renderFateBar(fate));
}

function getFaceResult(roll) {
  const die = roll.dice.find((d) => d.faces === 6 && d.constructor?.DENOMINATION === FATE_DIE_DENOMINATION)
    ?? roll.dice.find((d) => d.faces === 6);
  const value = die?.results?.find((r) => r.active !== false && !r.discarded)?.result;
  if (!Number.isInteger(value)) return null;
  const face = getFateFace(value);
  return face ? { value, ...face } : null;
}

// PF2e degree-of-success ordering: index === degree value (0 = worst).
const DEGREE_OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];

// Adds the fate bonus to the message's primary check roll as a labeled, untyped
// numeric term and re-derives the degree of success against the check DC. The
// bonus is only applied for non-zero, finite values, and never twice for the
// same roll. Returns the serialized roll data plus any outcome changes, or null
// when nothing was applied (so the caller can skip the roll update entirely).
async function applyFateBonusToCheckRoll(message, bonus, label) {
  if (!Number.isFinite(bonus) || bonus === 0) return null;

  const roll = message?.rolls?.at?.(0);
  if (!roll || roll.options?.glddfFateBonusApplied) return null;

  try {
    const terms = foundry.dice.terms;
    const flavor = label || game.i18n.localize("GLDDF.Roll.FateBonusLabel");
    const operator = new terms.OperatorTerm({ operator: bonus >= 0 ? "+" : "-" });
    const numeric = new terms.NumericTerm({ number: Math.abs(bonus), options: { flavor } });
    if (!operator._evaluated) await operator.evaluate();
    if (!numeric._evaluated) await numeric.evaluate();

    roll.terms.push(operator, numeric);
    roll._total = Number(roll._total ?? roll.total ?? 0) + bonus;
    roll.options = roll.options ?? {};
    roll.options.glddfFateBonusApplied = true;
    roll.options.glddfFateBonus = bonus;
    if (typeof roll.resetFormula === "function") roll.resetFormula();

    const result = {};

    // Only checks rolled against a DC have a degree of success to re-derive.
    const context = message.flags?.pf2e?.context;
    const dc = Number(context?.dc?.value);
    const dieResult = getD20Result(roll);
    if (Number.isInteger(dc) && Number.isInteger(dieResult)) {
      const unadjusted = baseDegree(roll._total, dc);
      const adjusted = adjustDegreeForNatural(unadjusted, dieResult);
      roll.options.degreeOfSuccess = adjusted;
      result.outcome = DEGREE_OUTCOMES[adjusted];
      result.unadjustedOutcome = DEGREE_OUTCOMES[unadjusted];
    }

    result.rolls = message.rolls.map((r) => r.toJSON());
    return result;
  } catch (error) {
    console.error("GLUniverse Destiny Dice | Failed to add Fate Die bonus to check roll", error);
    return null;
  }
}

function getD20Result(roll) {
  const die = roll.dice?.find((d) => d.faces === 20);
  const active = die?.results?.find((r) => r.active !== false && !r.discarded);
  return Number.isInteger(active?.result) ? active.result : (Number.isInteger(die?.total) ? die.total : null);
}

// PF2e: beat the DC by 10+ → critical success, meet/beat → success, miss by
// 10+ → critical failure, otherwise failure.
function baseDegree(total, dc) {
  const delta = total - dc;
  if (delta >= 10) return 3;
  if (delta >= 0) return 2;
  if (delta <= -10) return 0;
  return 1;
}

// A natural 20 shifts the result up one step; a natural 1 shifts it down one.
function adjustDegreeForNatural(degree, dieResult) {
  if (dieResult === 20) return Math.min(3, degree + 1);
  if (dieResult === 1) return Math.max(0, degree - 1);
  return degree;
}

// A freshly-applied fate plays the reveal-contract ceremony (§6.3); re-renders
// of an older message (scroll, edit) render the strip in its settled state.
const FATE_REVEAL_WINDOW_MS = 4000;

function renderFateBar(fate) {
  const kind = normalizeKind(fate.kind);
  const kindLabel = getKindLabel(kind);
  const isFresh = Number.isFinite(fate.appliedAt) && Date.now() - fate.appliedAt < FATE_REVEAL_WINDOW_MS;
  const classes = [
    "glddf-fate-strip",
    `glddf-${kind}`,
    fate.accepted === false ? "glddf-refused" : "",
    isFresh && fate.accepted !== false ? "glddf-reveal" : "",
  ].filter(Boolean).join(" ");

  const showBonus = kind !== KIND_OPPORTUNITY && fate.bonus !== 0;
  const bonusLockup = showBonus
    ? `<div class="glddf-fate-bonus">
        <span class="glddf-fate-bonus-num">${formatSignedNumber(fate.bonus)}</span>
        <span class="glddf-fate-bonus-unit">MOD</span>
      </div>`
    : "";

  // Fake technical designator — pure provenance garnish (§4.2).
  const serial = `GLU·FATE · 0${fate.face}`;

  return `<footer class="${classes}" data-fate-face="${fate.face}">
    <i class="glddf-cut" aria-hidden="true"></i>
    <i class="glddf-bracket" aria-hidden="true"></i>
    ${renderGlyph(fate)}
    <div class="glddf-fate-body">
      <div class="glddf-fate-lines">
        <span class="glddf-fate-kicker">${serial}</span>
        <span class="glddf-fate-name">${kindLabel}</span>
      </div>
      ${bonusLockup}
    </div>
  </footer>`;
}

function renderGlyph(fate) {
  const paths = getFaceImagePaths(fate.face);
  if (paths?.image) {
    return `<img class="glddf-fate-face" src="${paths.image}" alt="" />`;
  }
  return `<span class="glddf-fate-glyph"><i class="fa-regular fa-circle-dot"></i></span>`;
}

function formatSignedNumber(value) {
  return value > 0 ? `+${value}` : String(value);
}
