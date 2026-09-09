/**
 * Dents — *Adventures+* pp. 45–46.
 *
 * "In this ruleset, items no longer have a broken threshold; instead, they have
 * the ability to take a number of dents."
 *
 * The dent count is authoritative and lives in our own flag. We then write the
 * item HP that makes PF2e agree, because `isBroken` and `isDestroyed` are pure
 * getters off HP (`pf2e.mjs:45097`) and shields read them to decide whether they
 * still grant an AC bonus. Without that reflection "broken" would be a word this
 * feature prints while no existing rule about broken items ever fires.
 *
 * Note this is a single derived field write, not an interception of the damage
 * pipeline — it carries none of the fragility that put Chip Damage in assist
 * mode.
 *
 * Two carve-outs the book states outright: a *sturdy* shield doubles both
 * thresholds, and **constructs do not use dents** — their items stay on PF2e's
 * own broken threshold. Objects that are not items (doors, walls) are out of
 * scope: Foundry models no hardness or HP for them at all, so the book's size
 * table ships as help text rather than as code.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { FLAGS, SETTINGS } from "./constants.mjs";
import { dentState, dentThresholds, hpForDents, dentsRepaired } from "./rules.mjs";
import { dentsOn, get } from "./settings.mjs";
import { normalizeHtml, itemDurability, isSturdyShield, isConstruct, contextType, outcomeOf } from "./pf2e.mjs";

const CLASS = "glvr-dent";

/** Items this rule applies to: physical, damageable, not carried by a construct. */
export function tracksDents(item) {
  if (!item?.isOfType?.("physical")) return false;
  if (itemDurability(item).max <= 0) return false;
  return !isConstruct(item.actor);
}

export const getDents = (item) => Math.max(0, Math.trunc(Number(item?.getFlag?.(SUITE_ID, FLAGS.dents)) || 0));

export const optionsFor = (item) => ({ sturdy: isSturdyShield(item) });

/**
 * Set an item's dent count and reflect it into HP.
 *
 * Both writes go in one update so a client never observes an item whose dents
 * and HP disagree.
 */
export async function setDents(item, count) {
  if (!tracksDents(item)) return false;
  const opts = optionsFor(item);
  const { destroyed } = dentThresholds(opts);
  const dents = Math.max(0, Math.min(destroyed, Math.trunc(Number(count) || 0)));
  const { max } = itemDurability(item);

  try {
    await item.update({
      [`flags.${SUITE_ID}.${FLAGS.dents}`]: dents,
      "system.hp.value": hpForDents(dents, max, opts),
    });
    return true;
  } catch (error) {
    warn("pf2e-variant-rules | could not write a dent count", error);
    return false;
  }
}

export const addDents = (item, delta) => setDents(item, getDents(item) + delta);

/**
 * May this client change a dent count?
 *
 * Reading and writing are deliberately separate questions. A dent is the state
 * of a player's own gear and they have to be able to see it — a readout behind
 * `isGM` looks perfectly correct on the GM's screen and is simply absent on
 * every other, which is the one failure nobody at the table can report. Writing
 * stays with the GM, who owns the fiction that put the dent there.
 */
const canEdit = () => !!game.user?.isGM;

/* ══════════════════════════════════════════════════════════════════════════
   ITEM SHEET — the primary surface
   ══════════════════════════════════════════════════════════════════════════ */

function renderTrack(item, editable) {
  const dents = getDents(item);
  const opts = optionsFor(item);
  const { broken, destroyed } = dentThresholds(opts);
  const state = dentState(dents, opts);

  const cells = Array.from({ length: destroyed }, (_, i) => {
    const n = i + 1;
    const cls = n <= dents ? (n >= broken ? `${CLASS}-cell is-broken` : `${CLASS}-cell is-hit`) : `${CLASS}-cell`;
    return `<span class="${cls}">${n}</span>`;
  }).join("");

  // The GM gets the two nudges and a box to type an exact value into; a player
  // gets the same track and the same figure, without the controls.
  const controls = editable
    ? `<button type="button" class="gl-btn ${CLASS}-less" ${dents <= 0 ? "disabled" : ""}>&minus;</button>
       <input type="number" class="${CLASS}-set" value="${dents}" min="0" max="${destroyed}" step="1"
              aria-label="${escapeHtml(game.i18n.localize("GLVR.dents.override"))}"
              title="${escapeHtml(game.i18n.localize("GLVR.dents.override"))}">
       <span class="${CLASS}-of">/ ${destroyed}</span>
       <button type="button" class="gl-btn ${CLASS}-more" ${dents >= destroyed ? "disabled" : ""}>+</button>`
    : `<span class="${CLASS}-count">${dents} / ${destroyed}</span>`;

  return `<section class="${CLASS}-panel" data-state="${state}">
    <header class="${CLASS}-head">
      <span class="${CLASS}-title">${escapeHtml(game.i18n.localize("GLVR.dents.title"))}</span>
      <span class="${CLASS}-state">${escapeHtml(game.i18n.localize(`GLVR.dents.state.${state}`))}</span>
    </header>
    <div class="${CLASS}-track">${cells}</div>
    <footer class="${CLASS}-foot">
      ${controls}
      <span class="${CLASS}-scale">${escapeHtml(
        game.i18n.format("GLVR.dents.scale", { broken: String(broken), destroyed: String(destroyed) })
      )}</span>
    </footer>
  </section>`;
}

/** Where the panel goes, in falling order of preference — PF2e markup drifts. */
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

    if (!dentsOn()) return;
    if (!item?.isOwner || !tracksDents(item)) return;

    const host = SHEET_ANCHORS.map((sel) => root.querySelector(sel)).find(Boolean);
    if (!host) return;

    const editable = canEdit();
    host.insertAdjacentHTML("beforeend", renderTrack(item, editable));
    if (!editable) return;

    const panel = root.querySelector(`.${CLASS}-panel`);
    panel?.querySelector(`.${CLASS}-more`)?.addEventListener("click", () => addDents(item, 1));
    panel?.querySelector(`.${CLASS}-less`)?.addEventListener("click", () => addDents(item, -1));
    panel?.querySelector(`.${CLASS}-set`)?.addEventListener("change", (event) => {
      // An override is an absolute value, not a nudge; `setDents` clamps it to
      // the item's own destroyed threshold, which a sturdy shield doubles.
      setDents(item, event.currentTarget.value);
    });
  } catch {
    // A sheet that changed shape must never take the sheet down with it.
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   ACTOR SHEET — the count, in line, on the row the player already reads
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Where the badge goes inside an inventory row, in falling order of preference.
 *
 * `.item-name` is the block holding the item's `<h4>` and its uses counter, so
 * the badge lands beside the name rather than in the price or bulk columns.
 */
const ROW_ANCHORS = [".item-name", ".data", ":scope"];

/** An intact item says nothing; a dented one says how badly, in one glance. */
function renderBadge(item) {
  const dents = getDents(item);
  const opts = optionsFor(item);
  const { destroyed } = dentThresholds(opts);
  const state = dentState(dents, opts);
  const label = game.i18n.format("GLVR.dents.badge", {
    dents: String(dents),
    destroyed: String(destroyed),
    state: game.i18n.localize(`GLVR.dents.state.${state}`),
  });

  return `<span class="${CLASS}-chip" data-state="${state}" title="${escapeHtml(label)}" aria-label="${escapeHtml(
    label
  )}"><i class="fa-solid fa-shield-halved"></i>${dents}<span class="${CLASS}-chip-of">/${destroyed}</span></span>`;
}

/** Resolve the item a row stands for. Subitems carry a different attribute. */
function rowItem(actor, row) {
  const id = row.dataset.itemId ?? row.dataset.subitemId ?? null;
  const direct = id ? actor?.items?.get?.(id) : null;
  if (direct) return direct;
  const uuid = row.dataset.uuid ?? null;
  return uuid ? fromUuidSync(uuid) : null;
}

function onRenderActorSheet(app, html) {
  try {
    const root = normalizeHtml(html);
    const actor = app?.actor ?? app?.document ?? null;
    if (!root || !actor) return;

    root.querySelectorAll(`.${CLASS}-chip`).forEach((node) => node.remove());
    if (!dentsOn()) return;

    for (const row of root.querySelectorAll("li[data-item-id], li[data-subitem-id]")) {
      const item = rowItem(actor, row);
      if (!item || !tracksDents(item) || getDents(item) <= 0) continue;

      const host = ROW_ANCHORS.map((sel) => (sel === ":scope" ? row : row.querySelector(sel))).find(Boolean);
      host?.insertAdjacentHTML("beforeend", renderBadge(item));
    }
  } catch {
    // A sheet that changed shape must never take the sheet down with it.
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   REPAIR — assist button on the check card
   ══════════════════════════════════════════════════════════════════════════ */

/** Repairable items the roller can actually reach, most damaged first. */
function repairCandidates(actor) {
  const items = (actor?.items ?? []).filter((i) => tracksDents(i) && getDents(i) > 0);
  return items.sort((a, b) => getDents(b) - getDents(a));
}

function isRepairCheck(message) {
  if (contextType(message) !== "skill-check") return false;
  const context = message?.flags?.pf2e?.context ?? {};
  const domains = context.domains ?? [];
  const options = context.options ?? [];
  if (!domains.includes("crafting")) return false;
  return options.some((o) => typeof o === "string" && o.includes("repair")) || /repair/i.test(context.identifier ?? "");
}

function renderRepair(removed, candidates) {
  const rows = candidates
    .slice(0, 4)
    .map(
      (i) =>
        `<button type="button" class="gl-btn ${CLASS}-fix" data-item="${escapeHtml(i.id)}">${escapeHtml(
          i.name
        )} <span class="${CLASS}-fix-n">${getDents(i)}</span></button>`
    )
    .join("");

  return `<section class="${CLASS}-repair">
    <header class="${CLASS}-head">
      <span class="${CLASS}-title">${escapeHtml(game.i18n.localize("GLVR.dents.repairTitle"))}</span>
    </header>
    <p class="${CLASS}-line">${escapeHtml(
      game.i18n.format("GLVR.dents.repairBody", { count: String(removed) })
    )}</p>
    <div class="${CLASS}-fixes">${rows}</div>
  </section>`;
}

function onRenderChat(message, html) {
  const root = normalizeHtml(html);
  const content = root?.querySelector?.(".message-content");
  if (!content) return;

  content.querySelectorAll(`.${CLASS}-repair`).forEach((node) => node.remove());

  if (!dentsOn() || !get(SETTINGS.dentsRepair, true) || !game.user.isGM) return;
  if (!isRepairCheck(message)) return;

  const removed = dentsRepaired(outcomeOf(message));
  if (removed <= 0) return;

  const actor = message?.actor ?? null;
  const candidates = repairCandidates(actor);
  if (!candidates.length) return;

  content.insertAdjacentHTML("beforeend", renderRepair(removed, candidates));

  for (const button of content.querySelectorAll(`.${CLASS}-fix`)) {
    button.addEventListener("click", async () => {
      const item = actor?.items?.get?.(button.dataset.item);
      if (item) await addDents(item, -removed);
    });
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function registerDents() {
  Hooks.on("renderItemSheet", onRenderItemSheet);
  Hooks.on("renderItemSheetPF2e", onRenderItemSheet);
  // One name is enough here: Foundry's AppV1 fires the render hook for every
  // class in the sheet's inheritance chain, and `ActorSheetPF2e` is in all of
  // them. Registering the core name as well would just do the same pass twice
  // over an inventory that can run to fifty rows.
  Hooks.on("renderActorSheetPF2e", onRenderActorSheet);
  Hooks.on("renderChatMessageHTML", onRenderChat);
}

export const _internals = { isRepairCheck, repairCandidates };
