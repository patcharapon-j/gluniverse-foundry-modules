/**
 * Dents — *Adventures+* pp. 45–46.
 *
 * "In this ruleset, items no longer have a broken threshold; instead, they have
 * the ability to take a number of dents."
 *
 * The dent count is authoritative and lives in our own flag. Where an item has
 * HP we also write the value that makes PF2e agree, because `isBroken` and
 * `isDestroyed` are pure getters off HP and shields read them to decide whether
 * they still grant an AC bonus. Without that reflection "broken" would be a word
 * this feature prints while no existing rule about broken items ever fires.
 *
 * That reflection is a consequence of the dent count, never a precondition for
 * it. PF2e authors item HP on shields and almost nothing else — every other
 * physical item ships `hp: { value: 0, max: 0 }` — so requiring HP before
 * drawing the track hid this rule from every weapon and every suit of armour in
 * a real world. See `DENTABLE`.
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
import { CARRIER_TYPES, DEFAULT_DENT_CONFIG, DENT_TYPES, FLAGS, SETTINGS } from "./constants.mjs";
import { dentState, dentThresholds, hpForDents, dentsRepaired } from "./rules.mjs";
import { dentsOn, get } from "./settings.mjs";
import { normalizeHtml, itemDurability, isSturdyShield, isConstruct, contextType, outcomeOf } from "./pf2e.mjs";
import { HARDNESS_SOURCE, hardnessOf } from "./hardness.mjs";

const CLASS = "glvr-dent";

/**
 * The table's dent configuration.
 *
 * Read at call time rather than captured, so changing a threshold in the config
 * sheet is reflected on the next sheet render instead of the next reload. A
 * world that has never opened that sheet reads the shipped defaults, which are
 * the printed rule exactly.
 */
export function dentConfig() {
  const stored = get(SETTINGS.dentsConfig, null);
  if (!stored || typeof stored !== "object") return DEFAULT_DENT_CONFIG;
  return {
    ...DEFAULT_DENT_CONFIG,
    ...stored,
    types: { ...DEFAULT_DENT_CONFIG.types, ...(stored.types ?? {}) },
    grades: { ...DEFAULT_DENT_CONFIG.grades, ...(stored.grades ?? {}) },
    materials: { ...(stored.materials ?? {}) },
  };
}

/**
 * Items this rule applies to: a configured type, not carried by a construct.
 *
 * Which types those are is the GM's, but that it is a *type* question and not an
 * HP question is not. PF2e ships **every** physical item with
 * `hp: { value: 0, max: 0 }` and `hardness: 0` (`template.json`'s `physical`
 * template), and only a handful of shields in the compendium override it.
 * Gating this feature on item HP therefore silenced it on every item in a real
 * world — including the weapons and armour the rule is written for — while
 * looking like a careful guard. Item HP is what the dent count *reflects into*
 * where it exists, never what decides whether dents apply.
 */
export function tracksDents(item, config = null) {
  if (!item?.isOfType?.("physical")) return false;
  const cfg = config ?? dentConfig();
  if (!DENT_TYPES.includes(item.type)) return false;
  if (!cfg.types?.[item.type]) return false;
  return !isConstruct(item.actor);
}

export const getDents = (item) => Math.max(0, Math.trunc(Number(item?.getFlag?.(SUITE_ID, FLAGS.dents)) || 0));

/**
 * The three things about an item that can move its thresholds.
 *
 * Material and grade are read straight off PF2e's own `system.material`, so a
 * config row is looked up by the key the system already stores and there is no
 * translation step to drift.
 */
export const optionsFor = (item) => ({
  sturdy: isSturdyShield(item),
  material: item?.system?.material?.type ?? null,
  grade: item?.system?.material?.grade ?? null,
  size: item?.system?.size ?? null,
  // Possession, not size, decides whether the object table applies. An item on
  // a creature is gear at a flat 2/4 however large it is; anything else — a
  // loot actor standing in for a chest or a door, or no actor at all — is
  // scenery, which is what that table is written for.
  carried: CARRIER_TYPES.includes(item?.actor?.type ?? ""),
  override: dentOverride(item),
});

/** The GM's per-item ruling, or null. */
export const dentOverride = (item) => item?.getFlag?.(SUITE_ID, FLAGS.dentOverride) ?? null;

/**
 * Write or clear one item's override.
 *
 * A field left blank clears rather than storing zero: "no opinion" and "this
 * breaks at zero dents" are different rulings and the second one would make an
 * item arrive already destroyed.
 */
export async function setDentOverride(item, { broken, destroyed, hardness } = {}) {
  const clean = {};
  for (const [key, value] of Object.entries({ broken, destroyed, hardness })) {
    const n = Math.trunc(Number(value));
    if (value !== "" && value != null && Number.isFinite(n)) clean[key] = Math.max(0, n);
  }
  try {
    if (!Object.keys(clean).length) await item.unsetFlag(SUITE_ID, FLAGS.dentOverride);
    else await item.setFlag(SUITE_ID, FLAGS.dentOverride, clean);
    return true;
  } catch (error) {
    warn("pf2e-variant-rules | could not write a dent override", error);
    return false;
  }
}

/**
 * Set an item's dent count and reflect it into HP.
 *
 * Both writes go in one update so a client never observes an item whose dents
 * and HP disagree.
 */
export async function setDents(item, count) {
  const config = dentConfig();
  if (!tracksDents(item, config)) return false;
  const opts = optionsFor(item);
  const { destroyed } = dentThresholds(opts, config);
  const dents = Math.max(0, Math.min(destroyed, Math.trunc(Number(count) || 0)));
  const { max } = itemDurability(item);

  // The HP reflection only means something on an item that has HP: PF2e's
  // `isBroken` / `isDestroyed` both begin `max > 0`, so on the great majority of
  // items — which ship at 0/0 — there is no getter to keep honest and the flag
  // stands alone.
  const update = { [`flags.${SUITE_ID}.${FLAGS.dents}`]: dents };
  if (max > 0) update["system.hp.value"] = hpForDents(dents, max, opts, config);

  try {
    await item.update(update);
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
  const config = dentConfig();
  const dents = getDents(item);
  const opts = optionsFor(item);
  const { broken, destroyed } = dentThresholds(opts, config);
  const state = dentState(dents, opts, config);
  const hardness = hardnessOf(item, config);

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
    <div class="${CLASS}-facts">
      <span class="${CLASS}-fact" title="${escapeHtml(game.i18n.localize(`GLVR.dents.hardnessFrom.${hardness.source}`))}">
        ${escapeHtml(game.i18n.format("GLVR.dents.hardness", { value: String(hardness.value) }))}
        <em class="${CLASS}-src">${escapeHtml(game.i18n.localize(`GLVR.dents.source.${hardness.source}`))}</em>
      </span>
      ${
        opts.carried
          ? ""
          : `<span class="${CLASS}-fact">${escapeHtml(
              game.i18n.format("GLVR.dents.asObject", {
                size: game.i18n.localize(`GLVR.dents.size.${opts.size ?? "med"}`),
              })
            )}</span>`
      }
      ${editable ? `<button type="button" class="gl-btn ${CLASS}-cfg">${escapeHtml(game.i18n.localize("GLVR.dents.perItem"))}</button>` : ""}
    </div>
  </section>`;
}

/**
 * Where the panel goes, in falling order of preference — PF2e markup drifts.
 *
 * The first choice puts the track immediately above the Publication fieldset
 * that closes every Details tab, so it reads as the last of the item's own
 * fields rather than as something bolted past the end of the sheet. Each entry
 * carries its own insert position: a panel appended *inside* a form group would
 * land between a label and its input.
 */
const SHEET_ANCHORS = [
  [".tab[data-tab='details'] fieldset.publication", "beforebegin"],
  [".tab[data-tab='details']", "beforeend"],
  [".sheet-body .tab.active", "beforeend"],
  [".sheet-body", "beforeend"],
];

function onRenderItemSheet(app, html) {
  try {
    const root = normalizeHtml(html);
    const item = app?.item ?? app?.document ?? null;
    if (!root) return;

    root.querySelectorAll(`.${CLASS}-panel`).forEach((node) => node.remove());

    if (!dentsOn()) return;
    if (!item?.isOwner || !tracksDents(item)) return;

    const spot = SHEET_ANCHORS.map(([sel, where]) => [root.querySelector(sel), where]).find(([node]) => node);
    if (!spot) return;

    const editable = canEdit();
    spot[0].insertAdjacentHTML(spot[1], renderTrack(item, editable));
    if (!editable) return;

    const panel = root.querySelector(`.${CLASS}-panel`);
    panel?.querySelector(`.${CLASS}-more`)?.addEventListener("click", () => addDents(item, 1));
    panel?.querySelector(`.${CLASS}-less`)?.addEventListener("click", () => addDents(item, -1));
    panel?.querySelector(`.${CLASS}-cfg`)?.addEventListener("click", () => openOverride(item));
    panel?.querySelector(`.${CLASS}-set`)?.addEventListener("change", (event) => {
      // An override is an absolute value, not a nudge; `setDents` clamps it to
      // the item's own destroyed threshold, which a sturdy shield doubles.
      setDents(item, event.currentTarget.value);
    });
  } catch {
    // A sheet that changed shape must never take the sheet down with it.
  }
}

/**
 * The GM's per-item ruling, as three optional numbers.
 *
 * Every field is blank-means-inherit, and the placeholder shows what it would
 * inherit — so a GM can see the number they are about to replace without
 * having to clear the field to find out. That is the difference between an
 * override that is usable mid-session and one that is a guess.
 */
async function openOverride(item) {
  const config = dentConfig();
  const opts = optionsFor(item);
  const { broken, destroyed } = dentThresholds({ ...opts, override: null }, config);
  // A plain shape rather than a spread of the document: spreading a Foundry
  // Document does not reliably carry what `hardnessOf` reads, and the point here
  // is precisely to ask what the item WOULD resolve to with no override on it.
  const inherited = hardnessOf({ type: item.type, system: item.system, flags: {} }, config);
  const current = dentOverride(item) ?? {};
  const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

  const field = (name, label, placeholder) => `
    <div class="glvr-cfg-field">
      <label for="glvr-ov-${name}">${escapeHtml(L(label))}</label>
      <input id="glvr-ov-${name}" type="number" name="${name}" step="1" min="0"
             value="${current[name] ?? ""}" placeholder="${escapeHtml(String(placeholder))}">
    </div>`;

  const content = `<div class="glvr-cfg-block glvr-cfg-item">
    <p class="glvr-cfg-note">${escapeHtml(L("GLVR.dents.perItemHint"))}</p>
    <div class="glvr-cfg-grid">
      ${field("broken", "GLVR.dentConfig.broken", broken)}
      ${field("destroyed", "GLVR.dentConfig.destroyed", destroyed)}
      ${field("hardness", "GLVR.dents.hardnessLabel", inherited.value)}
    </div>
  </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: L("GLVR.dents.perItem"), icon: "fa-solid fa-sliders" },
    classes: ["glvr-cfg-root"],
    content,
    ok: { label: L("GLVR.dentConfig.save"), callback: (_e, button) => new FormDataExtended(button.form).object },
    rejectClose: false,
  }).catch(() => null);
  if (!result) return;
  await setDentOverride(item, result);
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
  const config = dentConfig();
  const dents = getDents(item);
  const opts = optionsFor(item);
  const { destroyed } = dentThresholds(opts, config);
  const state = dentState(dents, opts, config);
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
