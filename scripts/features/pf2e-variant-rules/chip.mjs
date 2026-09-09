/**
 * Chip Damage — *Adventures+* p. 45.
 *
 * "Missing a strike or a spell can lead to turns feeling unsatisfying. The Chip
 * Damage rule gives characters and enemies alike guaranteed damage."
 *
 * A missed Strike never rolls damage, so there is no damage card to hang this
 * on: the prompt goes on the card that *established the outcome* — the attack
 * roll or the saving throw — and the damage type is derived from the weapon or
 * spell rather than read off a roll.
 *
 * This runs in assist mode by default. PF2e exposes no hook on damage
 * application and nothing in this suite has ever written into that pipeline, so
 * the GM presses a button and the module never silently changes a number. The
 * `vr.chip.autoApply` setting opts into doing it automatically.
 *
 * The offer is stored as a message flag and the DOM is regenerated on every
 * render, never baked into message content — a client reconnecting mid-session
 * must not find a stale button claiming damage that was already applied.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { SETTINGS, FLAGS } from "./constants.mjs";
import { resolveChip } from "./rules.mjs";
import { chipOn, get } from "./settings.mjs";
import {
  normalizeHtml,
  contextType,
  outcomeOf,
  originItem,
  spellRankOf,
  rollingActor,
  targetActor,
  damageTypesOf,
  resistedTypesOf,
  persistentOnly,
  effectLevel,
  flattenReduction,
} from "./pf2e.mjs";
import { applyFlatDamage } from "./apply.mjs";

const CLASS = "glvr-chip";

/**
 * Work out whether this message deserves a chip-damage prompt, and for how much.
 * Returns null when it does not — the caller draws nothing.
 */
export function offerFor(message) {
  const kind = contextType(message);
  const outcome = outcomeOf(message);
  if (!kind || !outcome) return null;

  const attacker = rollingActor(message);
  const defender = targetActor(message);
  const item = originItem(message);
  const spellRank = spellRankOf(message);

  // A Strike's chip damage is the *attacker's* level; a spell's is twice its
  // rank, and rank is unaffected by anything a variant world does to levels.
  const trueLevel = effectLevel(attacker);
  const reduction = get(SETTINGS.chipUseFlattened, false) ? flattenReduction(attacker) : 0;
  const level = trueLevel - reduction;

  const result = resolveChip({
    kind,
    outcome,
    level,
    spellRank,
    damageTypes: damageTypesOf(item),
    resistedTypes: resistedTypesOf(defender),
    persistentOnly: persistentOnly(message),
  });

  if (!result.applies) return null;

  return {
    ...result,
    trueLevel,
    reduction,
    defenderUuid: defender?.uuid ?? null,
    defenderName: defender?.name ?? null,
    itemName: item?.name ?? null,
  };
}

/**
 * The one small line under the figure: where the number came from.
 *
 * Built from the basis `resolveChip` returned rather than recomputed here, so
 * the sum on screen and the damage the button applies cannot drift apart.
 */
function calcLine(offer) {
  const { basis, reduction } = offer;
  if (!basis) return "";

  let text;
  if (basis.source === "spell") {
    text = game.i18n.format("GLVR.chip.calcSpell", { rank: String(basis.rank) });
  } else if (reduction > 0) {
    text = game.i18n.format("GLVR.chip.calcFlattened", {
      level: String(offer.trueLevel),
      reduction: String(reduction),
    });
  } else {
    text = game.i18n.format("GLVR.chip.calcLevel", { level: String(basis.level) });
  }

  // A level-0 effect in a flattened world would chip for nothing; the clamp is
  // the reason the figure disagrees with the sum, so it has to be said.
  if (basis.clamped) {
    text = game.i18n.format("GLVR.chip.calcMinimum", { basis: text, min: String(basis.amount) });
  }
  return text;
}

/** Has this offer already been taken? Stored on the message so it survives reload. */
const settled = (message) => !!message?.getFlag?.(SUITE_ID, FLAGS.chip)?.applied;

async function markApplied(message, chosen, amount) {
  try {
    await message.setFlag(SUITE_ID, FLAGS.chip, { applied: true, chosen, amount, at: Date.now() });
  } catch {
    /* a message in a locked or deleted state simply keeps its button */
  }
}

/** " · " — the card's only separator, so the strip reads as one line. */
const DOT = " · ";

const iconButton = (cls, icon, labelKey) => {
  const label = escapeHtml(game.i18n.localize(labelKey));
  return `<button type="button" class="gl-btn ${cls}" title="${label}" aria-label="${label}"><i class="${icon}"></i></button>`;
};

/**
 * The offer, as one strip.
 *
 * This card lands under a roll everybody at the table has just read, so it does
 * not restate the rule: the figure, one line saying where the figure came from,
 * and the two things the GM can do about it.
 */
function render(offer) {
  const { amount, types, chosen, negated, defenderName } = offer;
  const targetRaw = defenderName ?? game.i18n.localize("GLVR.chip.theTarget");

  const meta = negated
    ? escapeHtml(game.i18n.format("GLVR.chip.negated", { target: targetRaw, type: localizeType(chosen) }))
    : `${escapeHtml(localizeType(chosen))}${DOT}${escapeHtml(targetRaw)}`;

  const picker =
    types.length > 1
      ? `<div class="${CLASS}-types">${types
          .map(
            (t) =>
              `<button type="button" class="${CLASS}-type" data-type="${escapeHtml(t)}" aria-pressed="${
                t === chosen ? "true" : "false"
              }">${escapeHtml(localizeType(t))}</button>`
          )
          .join("")}</div>`
      : "";

  const actions = negated
    ? iconButton(`${CLASS}-dismiss`, "fa-solid fa-xmark", "GLVR.chip.dismiss")
    : `<button type="button" class="gl-btn gl-btn-accent ${CLASS}-apply">${escapeHtml(
        game.i18n.localize("GLVR.chip.apply")
      )}</button>${iconButton(`${CLASS}-dismiss`, "fa-solid fa-xmark", "GLVR.chip.skip")}`;

  return `<section class="${CLASS}${negated ? " is-negated" : ""}">
    <div class="${CLASS}-row">
      <span class="${CLASS}-tag">${escapeHtml(game.i18n.localize("GLVR.chip.title"))}</span>
      <span class="${CLASS}-num">${negated ? 0 : amount}</span>
      <span class="${CLASS}-meta">
        <span class="${CLASS}-what" title="${meta}">${meta}</span>
        <span class="${CLASS}-calc">${escapeHtml(calcLine(offer))}</span>
      </span>
      <span class="${CLASS}-acts">${actions}</span>
    </div>
    ${picker}
  </section>`;
}

function renderResolved(flag) {
  const text = flag.amount
    ? game.i18n.format("GLVR.chip.applied", { amount: String(flag.amount), type: localizeType(flag.chosen) })
    : game.i18n.localize("GLVR.chip.appliedNone");
  return `<section class="${CLASS} is-resolved">
    <div class="${CLASS}-row">
      <span class="${CLASS}-tag">${escapeHtml(game.i18n.localize("GLVR.chip.title"))}</span>
      <span class="${CLASS}-what">${escapeHtml(text)}</span>
    </div>
  </section>`;
}

function wire(root, message, offer) {
  let chosen = offer.chosen;
  let negated = offer.negated;

  for (const button of root.querySelectorAll(`.${CLASS}-type`)) {
    button.addEventListener("click", () => {
      chosen = button.dataset.type;
      // Re-deciding the type re-decides whether a resistance negates it.
      const defender = offer.defenderUuid ? fromUuidSync(offer.defenderUuid) : null;
      negated = resistedTypesOf(defender).includes(chosen);
      for (const other of root.querySelectorAll(`.${CLASS}-type`)) {
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
      }
      // The strip is the whole card now, so re-deciding the type has to move the
      // figure and the line with it, not just grey a button out.
      const card = root.querySelector(`.${CLASS}`);
      card?.classList.toggle("is-negated", negated);
      const num = root.querySelector(`.${CLASS}-num`);
      if (num) num.textContent = String(negated ? 0 : offer.amount);
      const what = root.querySelector(`.${CLASS}-what`);
      if (what) {
        const targetRaw = offer.defenderName ?? game.i18n.localize("GLVR.chip.theTarget");
        what.textContent = negated
          ? game.i18n.format("GLVR.chip.negated", { target: targetRaw, type: localizeType(chosen) })
          : `${localizeType(chosen)}${DOT}${targetRaw}`;
        what.title = what.textContent;
      }
      const apply = root.querySelector(`.${CLASS}-apply`);
      if (apply) apply.disabled = negated;
    });
  }

  root.querySelector(`.${CLASS}-apply`)?.addEventListener("click", async () => {
    if (negated) return;
    const defender = offer.defenderUuid ? fromUuidSync(offer.defenderUuid) : null;
    await applyFlatDamage(defender, offer.amount);
    await markApplied(message, chosen, offer.amount);
  });

  root.querySelector(`.${CLASS}-dismiss`)?.addEventListener("click", async () => {
    await markApplied(message, chosen, 0);
  });
}

function onRender(message, html) {
  const root = normalizeHtml(html);
  const content = root?.querySelector?.(".message-content");
  if (!content) return;

  // Always clear first: a re-render must not stack a second prompt, and a rule
  // switched off mid-session must lose its button on the next repaint.
  content.querySelectorAll(`.${CLASS}`).forEach((node) => node.remove());

  if (!chipOn()) return;

  // Assist mode is a GM tool. The prompt names the defender's resistances, so
  // showing it to players would leak defences they have not learned.
  if (!game.user.isGM) return;

  const flag = message?.getFlag?.(SUITE_ID, FLAGS.chip);
  if (flag?.applied) {
    content.insertAdjacentHTML("beforeend", renderResolved(flag));
    return;
  }

  const offer = offerFor(message);
  if (!offer) return;

  content.insertAdjacentHTML("beforeend", render(offer));
  wire(content, message, offer);
}

/**
 * Auto-apply, for tables that opted into it.
 *
 * Runs on create rather than render so it fires once, and only on the single
 * acting GM — every connected client receives `createChatMessage`, so an
 * un-gated handler would apply the damage once per GM in the world.
 */
async function onCreate(message) {
  if (!chipOn() || !get(SETTINGS.chipAutoApply, false)) return;
  if (!game.user.isGM || game.users?.activeGM !== game.user) return;
  if (settled(message)) return;

  const offer = offerFor(message);
  if (!offer || offer.negated || offer.amount <= 0) return;

  const defender = offer.defenderUuid ? fromUuidSync(offer.defenderUuid) : null;
  await applyFlatDamage(defender, offer.amount);
  await markApplied(message, offer.chosen, offer.amount);
}

const localizeType = (type) =>
  type ? game.i18n.localize(CONFIG.PF2E?.damageTypes?.[type] ?? type) : game.i18n.localize("GLVR.chip.untyped");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function registerChip() {
  Hooks.on("renderChatMessageHTML", onRender);
  Hooks.on("createChatMessage", onCreate);
}
