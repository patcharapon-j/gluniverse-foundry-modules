/**
 * Careful Consumption — *Adventures+* p. 45.
 *
 * "You are careful to consume every drop. You Activate an Item that can be
 * consumed that takes 1-action or less to Activate. You gain the maximum
 * numerical benefits from consuming the item instead of rolling."
 *
 * ── Why this does not hook PF2e's consume path ──────────────────────────────
 *
 * `ConsumablePF2e#consume(quantity)` (`pf2e.mjs:50076`) takes only a number,
 * fires no hook, and builds a bare `DamageRoll(...).toMessage()` at
 * `pf2e.mjs:50105` — bypassing every modifier, damage die and rule-element
 * synthetic in the system. There is nothing to hook and nothing to configure.
 *
 * But that same shape is the way out: the path is thin and self-contained, so
 * rather than subverting it we simply do not call it. We build the *same*
 * `DamageRoll` from the same `(formula)[type,kind]` string, evaluate it with
 * `maximize: true`, and post it ourselves. PF2e's own apply-damage and
 * apply-healing buttons appear on the card because it is a genuine DamageRoll,
 * and no part of the system was patched to get there.
 *
 * The permissive variant — a button on an already-rolled card that rewrites the
 * result upward — is a separate, off-by-default setting. It is strictly better
 * than the rule, because a player only ever presses it after seeing a bad roll,
 * which deletes the "is this potion worth a third action when I don't know what
 * I'd have rolled" decision the activity exists to create.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { SETTINGS } from "./constants.mjs";
import { carefulQualifies } from "./rules.mjs";
import { carefulOn, get } from "./settings.mjs";
import { normalizeHtml } from "./pf2e.mjs";

const CLASS = "glvr-careful";

/** The shape `rules.mjs` needs, read off a PF2e consumable. */
export function describe(item) {
  const damage = item?.system?.damage ?? null;
  return {
    type: item?.type ?? null,
    actionCost: actionCostOf(item),
    formula: damage?.formula ?? null,
    kind: damage?.kind ?? null,
    damageType: damage?.type ?? "untyped",
  };
}

/** PF2e stores an activation cost under `system.uses`/`system.activation`; both shapes appear. */
function actionCostOf(item) {
  const raw =
    item?.system?.activation?.value ??
    item?.system?.uses?.value ??
    item?.system?.actionType?.value ??
    item?.system?.actions?.value ??
    null;
  if (raw === null || raw === undefined) return null;
  return typeof raw === "number" ? raw : String(raw);
}

export const qualifies = (item) =>
  carefulQualifies(describe(item), { healingOnly: get(SETTINGS.carefulHealingOnly, false) });

/** PF2e's DamageRoll class, which is registered on CONFIG rather than exported. */
function damageRollClass() {
  return (CONFIG.Dice?.rolls ?? []).find((r) => r?.name === "DamageRoll") ?? null;
}

/**
 * Consume one of `item`, taking the maximum instead of rolling.
 *
 * @param {Item} item
 * @param {{chirurgeon?: boolean}} [opts]  the book's Special clause: an item made
 *   by a Chirurgeon with greater field discovery rolls its HP and *adds* that to
 *   the maximum. PF2e records nothing that identifies such an item, so this is a
 *   caller-supplied flag rather than something detected.
 */
export async function consumeCarefully(item, { chirurgeon = false } = {}) {
  if (!qualifies(item)) return false;

  const { formula, kind, damageType } = describe(item);
  const DamageRoll = damageRollClass();
  if (!DamageRoll) {
    warn("pf2e-variant-rules | PF2e's DamageRoll class is unavailable; Careful Consumption stands down.");
    return false;
  }

  try {
    const expression = `(${formula})[${damageType},${kind ?? "damage"}]`;
    const roll = new DamageRoll(expression, item.getRollData());
    await roll.evaluate({ maximize: true });

    // The Special clause adds a genuine roll of the same formula on top.
    let bonus = null;
    if (chirurgeon) {
      bonus = new DamageRoll(expression, item.getRollData());
      await bonus.evaluate();
    }

    const total = roll.total + (bonus?.total ?? 0);
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: item.actor }),
      flavor: flavorFor(item, total, bonus),
      flags: { [SUITE_ID]: { careful: { maximized: true, chirurgeon, total } } },
    });

    await spendOne(item);
    return true;
  } catch (error) {
    warn("pf2e-variant-rules | Careful Consumption failed", error);
    return false;
  }
}

function flavorFor(item, total, bonus) {
  const name = escapeHtml(item?.name ?? "");
  const note = bonus
    ? game.i18n.format("GLVR.careful.flavorChirurgeon", { name, total: String(total), bonus: String(bonus.total) })
    : game.i18n.format("GLVR.careful.flavor", { name });
  return `<div class="${CLASS}-flavor"><span class="${CLASS}-tag">${escapeHtml(
    game.i18n.localize("GLVR.careful.tag")
  )}</span> ${note}</div>`;
}

/**
 * Spend one charge, mirroring what PF2e's own consume does: decrement quantity
 * and remove the item once none is left.
 */
async function spendOne(item) {
  const quantity = Number(item?.system?.quantity ?? 0) || 0;
  if (quantity > 1) return item.update({ "system.quantity": quantity - 1 });
  return item.delete();
}

/* ══════════════════════════════════════════════════════════════════════════
   ITEM SHEET — the rules-accurate entry point (decide before you roll)
   ══════════════════════════════════════════════════════════════════════════ */

const SHEET_ANCHORS = [
  ".tab[data-tab='details'] .form-group:last-of-type",
  ".tab[data-tab='details']",
  ".sheet-body .tab.active",
  ".sheet-body",
];

function onRenderItemSheet(app, html) {
  try {
    const root = normalizeHtml(html);
    const item = app?.item ?? app?.document ?? null;
    if (!root) return;

    root.querySelectorAll(`.${CLASS}-panel`).forEach((node) => node.remove());
    if (!carefulOn() || !item?.isOwner || !qualifies(item)) return;

    const host = SHEET_ANCHORS.map((sel) => root.querySelector(sel)).find(Boolean);
    if (!host) return;

    host.insertAdjacentHTML(
      "beforeend",
      `<section class="${CLASS}-panel">
        <header class="${CLASS}-head"><span class="${CLASS}-title">${escapeHtml(
          game.i18n.localize("GLVR.careful.title")
        )}</span><span class="${CLASS}-cost">${escapeHtml(
        game.i18n.localize("GLVR.careful.cost")
      )}</span></header>
        <p class="${CLASS}-line">${escapeHtml(game.i18n.localize("GLVR.careful.hint"))}</p>
        <div class="${CLASS}-acts">
          <button type="button" class="gl-btn gl-btn-accent ${CLASS}-go">${escapeHtml(
            game.i18n.localize("GLVR.careful.action")
          )}</button>
          <label class="${CLASS}-chirurgeon"><input type="checkbox" class="${CLASS}-chir"> ${escapeHtml(
            game.i18n.localize("GLVR.careful.chirurgeon")
          )}</label>
        </div>
      </section>`
    );

    const panel = root.querySelector(`.${CLASS}-panel`);
    panel?.querySelector(`.${CLASS}-go`)?.addEventListener("click", async () => {
      const chirurgeon = !!panel.querySelector(`.${CLASS}-chir`)?.checked;
      await consumeCarefully(item, { chirurgeon });
    });
  } catch {
    // A sheet that changed shape must never take the sheet down with it.
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   POST-ROLL VARIANT — off by default; the permissive reading
   ══════════════════════════════════════════════════════════════════════════ */

function onRenderChat(message, html) {
  const root = normalizeHtml(html);
  const content = root?.querySelector?.(".message-content");
  if (!content) return;

  content.querySelectorAll(`.${CLASS}-post`).forEach((node) => node.remove());
  if (!carefulOn() || !get(SETTINGS.carefulPostRoll, false)) return;
  if (message?.getFlag?.(SUITE_ID, "vr.careful")) return;
  if (!message?.isAuthor && !game.user.isGM) return;

  const roll = (message?.rolls ?? [])[0];
  if (!roll || typeof roll.maximumValue !== "number") return;
  if (roll.total >= roll.maximumValue) return;

  const item = message?.item ?? null;
  if (!item || item.type !== "consumable") return;

  content.insertAdjacentHTML(
    "beforeend",
    `<div class="${CLASS}-post">
      <button type="button" class="gl-btn ${CLASS}-max">${escapeHtml(
        game.i18n.format("GLVR.careful.maximize", { total: String(roll.maximumValue) })
      )}</button>
    </div>`
  );

  content.querySelector(`.${CLASS}-max`)?.addEventListener("click", async () => {
    try {
      await ChatMessage.create({
        speaker: message.speaker,
        content: `<div class="${CLASS}-flavor">${escapeHtml(
          game.i18n.format("GLVR.careful.maximized", {
            name: item.name,
            from: String(roll.total),
            to: String(roll.maximumValue),
          })
        )}</div>`,
        flags: { [SUITE_ID]: { "vr.careful": { maximized: true } } },
      });
    } catch (error) {
      warn("pf2e-variant-rules | could not post the maximized result", error);
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function registerCareful() {
  Hooks.on("renderItemSheet", onRenderItemSheet);
  Hooks.on("renderItemSheetPF2e", onRenderItemSheet);
  Hooks.on("renderChatMessageHTML", onRenderChat);
}
