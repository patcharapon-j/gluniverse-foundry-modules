/**
 * Odds on the PF2e actor sheet.
 *
 * With exactly one target, every Strike's three MAP buttons, every spell with
 * an attack roll or a save, and every skill action the sheet lists as an item
 * (Demoralize, Grapple…) get an inline % and bar. Hovering or clicking one of
 * those rows ARMS it (tracker.mjs), so the targeting-line badge follows what
 * the player is looking at.
 *
 * PF2e's sheets are AppV1, so a render replaces the whole content and the
 * `render<Class>` hook runs for every class in the chain: `renderCharacterSheetPF2e`
 * covers the character sheet and its AttackPopout subclass. Every query here is
 * null-safe and every failure is swallowed: a sheet whose markup changed shows
 * no odds, it never throws inside PF2e's render.
 *
 * Verified selectors (PF2e 8.5.1 templates):
 *   Strike row   [data-strike][data-action-index]           actors/character/partials/strike.hbs:1, actors/npc/partials/attack.hbs:1
 *   MAP buttons  button[data-action="strike-attack"][data-variant-index]   strike.hbs:158, npc attack.hbs:38
 *   Spell row    li.spell[data-item-id][data-entry-id] › .defense         actors/partials/spell-collection.hbs:108-131
 *   Action row   li.action.item[data-item-id] › .button-group              actors/partials/action.hbs:1,23
 */

import { SETTINGS, SKILL_ACTIONS, TIMING, KNOWLEDGE_HOOK } from "./constants.mjs";
import { inlineHTML } from "./render.mjs";
import { get } from "./settings.mjs";
import { arm, mapIndex, onTrackerChange } from "./tracker.mjs";
import { modelFor } from "./view.mjs";

const SLOT = "glod-sheet-slot";
const MARK = "_glodSheet";

const on = () => !!get(SETTINGS.sheet, true);

const rootOf = (app, html) => {
  const el = html?.[0] ?? html ?? app?.element?.[0] ?? app?.element ?? null;
  return el instanceof HTMLElement ? el : null;
};

const soleTarget = () => (game.user?.targets?.size === 1 ? [...game.user.targets][0] ?? null : null);

const slugOf = (item) => {
  if (!item) return null;
  if (item.slug) return item.slug;
  try {
    return game.pf2e?.system?.sluggify?.(item.name ?? "") || null;
  } catch {
    return null;
  }
};

/* ── what a row is ───────────────────────────────────────────────────────── */

function strikeSlug(actor, row) {
  const i = Number(row?.dataset?.actionIndex);
  if (!Number.isInteger(i)) return null;
  const s = actor?.system?.actions?.[i];
  return s?.slug ?? s?.item?.slug ?? null;
}

function spellOf(actor, row) {
  const id = row?.dataset?.itemId;
  if (!id) return null;
  const spell = actor?.items?.get?.(id) ?? actor?.spellcasting?.get?.(row.dataset.entryId ?? "")?.spells?.get?.(id) ?? null;
  return spell?.type === "spell" ? spell : null;
}

function spellMode(spell) {
  if (!spell) return null;
  if (spell.isAttack) return "attack";
  if (spell.system?.defense?.save?.statistic) return "save";
  return null;
}

function skillActionOf(actor, row) {
  const slug = slugOf(actor?.items?.get?.(row?.dataset?.itemId ?? ""));
  return slug && slug in SKILL_ACTIONS ? slug : null;
}

/** The Armed descriptor for whatever row an event landed in, or null. */
function armedFor(actor, target) {
  const strikeRow = target?.closest?.("[data-strike][data-action-index]");
  if (strikeRow) {
    const slug = strikeSlug(actor, strikeRow);
    return slug ? { kind: "strike", slug } : null;
  }
  const spellRow = target?.closest?.("li.spell[data-item-id]");
  if (spellRow) {
    const spell = spellOf(actor, spellRow);
    const mode = spellMode(spell);
    return mode && spell.uuid ? { kind: "spell", uuid: spell.uuid, mode } : null;
  }
  const actionRow = target?.closest?.("li.action[data-item-id]");
  if (actionRow) {
    const action = skillActionOf(actor, actionRow);
    return action ? { kind: "skill", action } : null;
  }
  return null;
}

/* ── arming ──────────────────────────────────────────────────────────────── */

function bindArming(app, root) {
  if (root._glodArm) return;
  root._glodArm = true;
  let pending = null;
  const fire = (target) => {
    const actor = app.actor;
    if (!actor?.isOwner || !on()) return;
    const armed = armedFor(actor, target);
    if (armed) arm(actor, armed);
  };
  // Hover settles first, so sweeping the cursor down a list is one broadcast, not ten.
  root.addEventListener("pointerover", (event) => {
    clearTimeout(pending);
    const target = event.target;
    pending = setTimeout(() => fire(target), TIMING.debounce);
  });
  root.addEventListener(
    "click",
    (event) => {
      clearTimeout(pending);
      fire(event.target);
    },
    true
  );
}

/* ── decorating ──────────────────────────────────────────────────────────── */

function strip(root) {
  for (const el of root?.querySelectorAll?.(`.${SLOT}`) ?? []) el.remove();
}

/** A host's slot: reused when present, so a refresh never flickers. */
function slotIn(host) {
  let slot = host.querySelector(`:scope > .${SLOT}`);
  if (!slot) {
    slot = document.createElement("span");
    slot.className = SLOT;
    host.append(slot);
  }
  return slot;
}

/** Every (slot, model spec) pair the sheet offers. */
function jobsFor(actor, root) {
  const jobs = [];
  for (const row of root.querySelectorAll("[data-strike][data-action-index]")) {
    const slug = strikeSlug(actor, row);
    if (!slug) continue;
    for (const btn of row.querySelectorAll('button[data-action="strike-attack"][data-variant-index]')) {
      // Alternate usages (thrown, melee) are their own weapon; the slug names the main one.
      if (btn.hasAttribute("data-alt-usage") || btn.closest(".alt-usage")) continue;
      const map = Number(btn.dataset.variantIndex);
      if (!(map >= 0 && map <= 2)) continue;
      jobs.push({ host: btn, action: { kind: "strike", slug }, map });
    }
  }
  for (const row of root.querySelectorAll("li.spell[data-item-id]")) {
    const spell = spellOf(actor, row);
    const mode = spellMode(spell);
    if (!mode || !spell.uuid) continue;
    const host = row.querySelector(".defense") ?? row.querySelector(".item-name");
    if (host) jobs.push({ host, action: { kind: "spell", uuid: spell.uuid, mode }, map: null });
  }
  for (const row of root.querySelectorAll("li.action[data-item-id]")) {
    const action = skillActionOf(actor, row);
    if (!action) continue;
    const host = row.querySelector(".button-group") ?? row.querySelector(".name");
    if (host) jobs.push({ host, action: { kind: "skill", action }, map: null });
  }
  return jobs;
}

async function decorate(app, root) {
  if (!root) return;
  const gen = (app._glodGen = (app._glodGen ?? 0) + 1);
  const actor = app.actor;
  const target = soleTarget();
  if (!on() || !actor || !target?.actor || target.actor === actor) {
    strip(root);
    return;
  }
  const rollerToken = app.token?.object ?? actor.getActiveTokens?.()[0] ?? null;
  app._glodMap = JSON.stringify(mapIndex(actor));

  const jobs = jobsFor(actor, root);
  // Placeholders first, synchronously; a slot no job claims this pass is stale.
  const live = new Set(jobs.map((j) => (j.slot = slotIn(j.host))));
  for (const el of root.querySelectorAll(`.${SLOT}`)) if (!live.has(el)) el.remove();

  // One probe at a time: a sheet can carry thirty buttons, and PF2e's roll
  // pipeline is not free. A newer pass (or a closed sheet) stops this one.
  for (const job of jobs) {
    if (app._glodGen !== gen || !job.slot.isConnected) return;
    let model = null;
    try {
      model = await modelFor({ roller: actor, rollerToken, target, action: job.action, map: job.map });
    } catch {
      model = null;
    }
    if (app._glodGen !== gen || !job.slot.isConnected) return;
    const html = inlineHTML(model);
    if (html) job.slot.innerHTML = html;
    else job.slot.remove();
  }
}

function onRender(app, html) {
  try {
    if (app?.constructor?.name === "NPCSheetPF2e" && !game.user?.isGM) return;
    const root = rootOf(app, html);
    if (!root || !app.actor) return;
    app[MARK] = true;
    bindArming(app, root);
    decorate(app, root).catch(() => {});
  } catch {
    /* never break PF2e's render */
  }
}

/* ── refresh without re-rendering ───────────────────────────────────────── */

function openSheets() {
  return Object.values(ui.windows ?? {}).filter((app) => app?.[MARK] && app.rendered !== false);
}

function refresh(filter = () => true) {
  for (const app of openSheets()) {
    if (!filter(app)) continue;
    try {
      decorate(app, rootOf(app, null)).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

export function wireSheet() {
  Hooks.on("renderCharacterSheetPF2e", onRender);
  Hooks.on("renderNPCSheetPF2e", onRender);

  const debounce = foundry.utils.debounce;
  const onTargets = debounce(() => refresh(), TIMING.debounce);
  // What the party knows changed: every open sheet's odds may have.
  Hooks.on(KNOWLEDGE_HOOK, onTargets);
  Hooks.on("targetToken", (user) => {
    if (user === game.user) onTargets();
  });

  // The tracker fires on arming too; only a MAP step changes what a sheet shows.
  const dirty = new Set();
  const flush = debounce(() => {
    const ids = new Set(dirty);
    dirty.clear();
    refresh((app) => {
      if (!ids.has(null) && !ids.has(app.actor?.id)) return false;
      return JSON.stringify(mapIndex(app.actor)) !== app._glodMap;
    });
  }, TIMING.debounce);
  onTrackerChange((actorId) => {
    dirty.add(actorId ?? null);
    flush();
  });
}
