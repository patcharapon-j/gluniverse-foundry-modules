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
  let level = effectLevel(attacker);
  if (get(SETTINGS.chipUseFlattened, false)) level -= flattenReduction(attacker);

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
    defenderUuid: defender?.uuid ?? null,
    defenderName: defender?.name ?? null,
    itemName: item?.name ?? null,
  };
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

function render(offer) {
  const { amount, types, chosen, negated, defenderName, itemName } = offer;
  const target = defenderName ? escapeHtml(defenderName) : game.i18n.localize("GLVR.chip.theTarget");

  const head = negated
    ? game.i18n.format("GLVR.chip.negated", { target, type: localizeType(chosen) })
    : game.i18n.format("GLVR.chip.body", { target, amount: String(amount) });

  const picker =
    types.length > 1
      ? `<div class="${CLASS}-types">${types
          .map(
            (t) =>
              `<button type="button" class="${CLASS}-type" data-type="${escapeHtml(t)}" aria-pressed="${
                t === chosen ? "true" : "false"
              }">${escapeHtml(localizeType(t))}${
                t === chosen && negated
                  ? `<span class="${CLASS}-why">${escapeHtml(game.i18n.localize("GLVR.chip.resists"))}</span>`
                  : ""
              }</button>`
          )
          .join("")}</div>`
      : "";

  const hero = negated
    ? ""
    : `<div class="${CLASS}-hero"><span class="${CLASS}-num">${amount}</span><span class="${CLASS}-unit">${escapeHtml(
        game.i18n.localize("GLVR.chip.unit")
      )}</span>${
        itemName ? `<span class="${CLASS}-src">${escapeHtml(itemName)}</span>` : ""
      }</div>`;

  const actions = negated
    ? `<button type="button" class="gl-btn ${CLASS}-dismiss">${escapeHtml(
        game.i18n.localize("GLVR.chip.dismiss")
      )}</button>`
    : `<button type="button" class="gl-btn gl-btn-accent ${CLASS}-apply">${escapeHtml(
        game.i18n.localize("GLVR.chip.apply")
      )}</button>
       <button type="button" class="gl-btn ${CLASS}-dismiss">${escapeHtml(
         game.i18n.localize("GLVR.chip.skip")
       )}</button>`;

  return `<section class="${CLASS}">
    <header class="${CLASS}-head">
      <span class="${CLASS}-title">${escapeHtml(game.i18n.localize("GLVR.chip.title"))}</span>
    </header>
    <div class="${CLASS}-body">
      <p class="${CLASS}-line">${head}</p>
      ${hero}
      ${picker}
      <div class="${CLASS}-acts">${actions}</div>
    </div>
  </section>`;
}

function renderResolved(flag) {
  const text = flag.amount
    ? game.i18n.format("GLVR.chip.applied", { amount: String(flag.amount), type: localizeType(flag.chosen) })
    : game.i18n.localize("GLVR.chip.appliedNone");
  return `<section class="${CLASS} is-resolved">
    <div class="${CLASS}-body"><p class="${CLASS}-line">${escapeHtml(text)}</p></div>
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
