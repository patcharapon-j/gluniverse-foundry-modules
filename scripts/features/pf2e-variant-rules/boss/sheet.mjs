/**
 * Boss Creatures — the NPC sheet panel.
 *
 * One panel on the NPC's main tab: mark the creature, read what that did to it,
 * and manage its Boss Abilities and Downfalls.
 *
 * GM-only, and unlike the dent readout that is the right call here rather than a
 * mistake: a boss's Downfalls are the thing the party is trying to *discover*
 * ("PCs can use Recall Knowledge to learn a boss's Downfalls"), so putting them
 * on a sheet a player can open would hand over the answer. What players see is
 * the initiative card and the chat card when a Downfall lands.
 */

import { warn } from "../../../core/const.mjs";
import { normalizeHtml } from "../pf2e.mjs";
import { ABILITY_KIND, DOWNFALL_TRIGGER } from "./constants.mjs";
import { ABILITIES, abilitiesOfKind, abilityById } from "./data.mjs";
import { MAX_ABILITIES, bossTurns, bossXpFactor, downfallBalance, tierOf, TIERS } from "./rules.mjs";
import { bossOn, storedProfile, TIER_ORDER, updateProfile } from "./profile.mjs";
import { addAbility, bossStats, costLabel, markBoss, refreshAbilityText, removeAbility, unmarkBoss } from "./apply.mjs";
import { syncCardConfig, isExtraTurn } from "./initiative.mjs";
import { canTrigger, currentPenalty, readState, readTelegraph, setTelegraph, triggerDownfall } from "./downfall.mjs";
import { announceDownfall, announceTelegraph } from "./chat.mjs";

const CLASS = "glvr-boss";
const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Where the panel goes, in falling order of preference — PF2e markup drifts. */
const SHEET_ANCHORS = [
  ".tab[data-tab='main'] .sidebar",
  ".tab[data-tab='main']",
  ".sheet-body .tab.active",
  ".sheet-body",
];

/**
 * This actor's primary combatant in the active encounter, or null.
 *
 * Skips the extra entries a boss owns: they carry no state of their own, and
 * writing a Downfall into one would put it on a document that is deleted and
 * recreated whenever the turn order moves.
 */
function findCombatant(actor) {
  const combat = game.combat;
  if (!combat) return null;
  for (const entry of combat.combatants) {
    const combatant = Array.isArray(entry) ? entry[1] : entry;
    if (combatant?.actor?.id !== actor.id) continue;
    if (isExtraTurn(combatant)) continue;
    return combatant;
  }
  return null;
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

function renderUnmarked() {
  const buttons = TIER_ORDER.map(
    (tier) =>
      `<button type="button" class="gl-btn ${CLASS}-mark" data-tier="${tier}" title="${esc(
        L(`GLVR.boss.tierHint.${tier}`)
      )}">${esc(L(`GLVR.boss.tier.${tier}`))}</button>`
  ).join("");

  return `<section class="${CLASS}-panel" data-state="none">
    <header class="${CLASS}-head">
      <span class="${CLASS}-title">${esc(L("GLVR.boss.panel"))}</span>
    </header>
    <p class="${CLASS}-empty">${esc(L("GLVR.boss.notABoss"))}</p>
    <div class="${CLASS}-actions">${buttons}</div>
  </section>`;
}

/** One statistic, as a figure with its label and the sum behind it. */
function stat(label, value, hint) {
  return `<div class="${CLASS}-stat"${hint ? ` title="${esc(hint)}"` : ""}>
    <span class="${CLASS}-stat-label">${esc(label)}</span>
    <span class="${CLASS}-stat-value">${esc(value)}</span>
  </div>`;
}

function renderStats(actor, profile) {
  const { baseLevel, level, dc, modifier, flatten } = bossStats(actor);
  const record = tierOf(profile.tier);
  const hp = actor.system?.attributes?.hp;

  const flatNote = flatten < 0 ? L("GLVR.boss.flattened", { value: String(flatten) }) : "";

  return `<div class="${CLASS}-stats">
    ${stat(L("GLVR.boss.stat.level"), `${level}`, L("GLVR.boss.statHint.level"))}
    ${stat(L("GLVR.boss.stat.hp"), `${hp?.value ?? 0} / ${hp?.max ?? 0}`, L("GLVR.boss.statHint.hp", {
      base: String(profile.baseHp),
      factor: `${record.hpFactor}x`,
    }))}
    ${stat(L("GLVR.boss.stat.dc"), `${dc}`, [L("GLVR.boss.statHint.dc"), flatNote].filter(Boolean).join(" "))}
    ${stat(L("GLVR.boss.stat.modifier"), `+${modifier}`, L("GLVR.boss.statHint.modifier"))}
    ${stat(L("GLVR.boss.stat.turns"), `${bossTurns(profile.tier)}`)}
    ${stat(L("GLVR.boss.stat.xp"), `${bossXpFactor(profile.tier)}x`, L("GLVR.boss.statHint.xp", {
      factor: String(bossXpFactor(profile.tier)),
    }))}
    ${stat(L("GLVR.boss.stat.baseLevel"), `${baseLevel}`)}
  </div>`;
}

function renderAbilities(profile) {
  const rows = profile.abilities
    .map((id) => abilityById(id))
    .filter(Boolean)
    .map(
      (entry) => `<li class="${CLASS}-row" data-kind="${entry.kind}">
        <span class="${CLASS}-row-name">${esc(L(`GLVR.boss.ability.${entry.id}.name`))}</span>
        <span class="${CLASS}-row-cost">${esc(costLabel(entry))}</span>
        <button type="button" class="${CLASS}-drop" data-id="${entry.id}"
          title="${esc(L("GLVR.boss.abilities.remove"))}" aria-label="${esc(L("GLVR.boss.abilities.remove"))}">
          <i class="fa-solid fa-xmark"></i></button>
      </li>`
    )
    .join("");

  const groups = Object.values(ABILITY_KIND)
    .map((kind) => {
      const options = abilitiesOfKind(kind)
        .filter((entry) => !profile.abilities.includes(entry.id))
        .map((entry) => `<option value="${entry.id}">${esc(L(`GLVR.boss.ability.${entry.id}.name`))}</option>`)
        .join("");
      if (!options) return "";
      return `<optgroup label="${esc(L(`GLVR.boss.abilities.kind.${kind}`))}">${options}</optgroup>`;
    })
    .join("");

  const full = profile.abilities.length >= MAX_ABILITIES;
  const picker = full
    ? `<p class="${CLASS}-note">${esc(L("GLVR.boss.abilities.full", { max: String(MAX_ABILITIES) }))}</p>`
    : `<div class="${CLASS}-add">
        <select class="${CLASS}-pick" aria-label="${esc(L("GLVR.boss.abilities.add"))}">${groups}</select>
        <button type="button" class="gl-btn gl-btn-accent ${CLASS}-add-ability">${esc(
          L("GLVR.boss.abilities.add")
        )}</button>
      </div>`;

  return `<section class="${CLASS}-group">
    <header class="${CLASS}-group-head">
      <span>${esc(L("GLVR.boss.abilities.heading"))}</span>
      <span class="${CLASS}-count">${esc(
        L("GLVR.boss.abilities.count", { count: String(profile.abilities.length), max: String(MAX_ABILITIES) })
      )}</span>
    </header>
    ${rows ? `<ul class="${CLASS}-list">${rows}</ul>` : `<p class="${CLASS}-empty">${esc(L("GLVR.boss.abilities.empty"))}</p>`}
    ${picker}
  </section>`;
}

function renderDownfalls(profile) {
  const rows = profile.downfalls
    .map(
      (downfall, index) => `<li class="${CLASS}-row" data-index="${index}">
        <span class="${CLASS}-row-name">${esc(L(`GLVR.boss.trigger.${downfall.type}`))}</span>
        <input type="text" class="${CLASS}-note" data-index="${index}" value="${esc(downfall.note ?? "")}"
          placeholder="${esc(L("GLVR.boss.downfalls.notePlaceholder"))}"
          aria-label="${esc(L("GLVR.boss.downfalls.note"))}">
        <button type="button" class="${CLASS}-drop-downfall" data-index="${index}"
          title="${esc(L("GLVR.boss.downfalls.remove"))}" aria-label="${esc(L("GLVR.boss.downfalls.remove"))}">
          <i class="fa-solid fa-xmark"></i></button>
      </li>`
    )
    .join("");

  const options = Object.values(DOWNFALL_TRIGGER)
    .map(
      (type) =>
        `<option value="${type}" title="${esc(L(`GLVR.boss.triggerHint.${type}`))}">${esc(
          L(`GLVR.boss.trigger.${type}`)
        )}</option>`
    )
    .join("");

  const balance = downfallBalance({ abilities: profile.abilities.length, downfalls: profile.downfalls.length });
  const note = balance.balanced
    ? `<p class="${CLASS}-note is-good">${esc(
        L("GLVR.boss.downfalls.balanced", { count: String(balance.downfalls) })
      )}</p>`
    : `<p class="${CLASS}-note is-warn">${esc(
        L("GLVR.boss.downfalls.unbalanced", {
          abilities: String(balance.abilities),
          downfalls: String(balance.downfalls),
        })
      )}</p>`;

  return `<section class="${CLASS}-group">
    <header class="${CLASS}-group-head"><span>${esc(L("GLVR.boss.downfalls.heading"))}</span></header>
    ${rows ? `<ul class="${CLASS}-list">${rows}</ul>` : `<p class="${CLASS}-empty">${esc(L("GLVR.boss.downfalls.empty"))}</p>`}
    ${note}
    <div class="${CLASS}-add">
      <select class="${CLASS}-pick-trigger" aria-label="${esc(L("GLVR.boss.downfalls.trigger"))}">${options}</select>
      <button type="button" class="gl-btn gl-btn-accent ${CLASS}-add-downfall">${esc(
        L("GLVR.boss.downfalls.add")
      )}</button>
    </div>
  </section>`;
}

/**
 * The live half of the panel: only drawn while the boss is actually in a fight.
 *
 * Triggering a Downfall is a mid-combat action, so the buttons that do it appear
 * exactly when they can do something and are absent the rest of the time — a
 * "Trigger now" button on a boss sitting in the sidebar has no encounter to
 * write its state into and would silently do nothing.
 */
function renderEncounter(actor, profile) {
  const combatant = findCombatant(actor);
  if (!combatant) return "";

  const penalty = currentPenalty(combatant);
  const telegraph = readTelegraph(combatant);

  const rows = profile.downfalls
    .map((downfall) => {
      const ready = canTrigger(combatant, downfall.id);
      const state = readState(combatant);
      const label = ready
        ? L("GLVR.boss.downfalls.fire")
        : state.fired[downfall.id] === state.roundSerial
          ? L("GLVR.boss.downfalls.immune")
          : L("GLVR.boss.downfalls.spent");
      return `<li class="${CLASS}-row">
        <span class="${CLASS}-row-name">${esc(L(`GLVR.boss.trigger.${downfall.type}`))}</span>
        <span class="${CLASS}-row-note">${esc(downfall.note ?? "")}</span>
        <button type="button" class="gl-btn ${CLASS}-fire" data-id="${esc(downfall.id)}"
          ${ready ? "" : "disabled"}>${esc(label)}</button>
      </li>`;
    })
    .join("");

  const options = profile.abilities
    .map((id) => abilityById(id))
    .filter(Boolean)
    .map((entry) => `<option value="${entry.id}"${telegraph?.ability === entry.id ? " selected" : ""}>${esc(
      L(`GLVR.boss.ability.${entry.id}.name`)
    )}</option>`)
    .join("");

  const telegraphBlock = options
    ? `<div class="${CLASS}-add">
        <select class="${CLASS}-pick-telegraph" aria-label="${esc(L("GLVR.boss.telegraph.heading"))}">${options}</select>
        <input type="text" class="${CLASS}-telegraph-target" value="${esc(telegraph?.target ?? "")}"
          placeholder="${esc(L("GLVR.boss.telegraph.targetPlaceholder"))}"
          aria-label="${esc(L("GLVR.boss.telegraph.target"))}">
        <button type="button" class="gl-btn gl-btn-accent ${CLASS}-telegraph">${esc(
          L("GLVR.boss.telegraph.heading")
        )}</button>
        ${telegraph ? `<button type="button" class="gl-btn ${CLASS}-telegraph-clear">${esc(L("GLVR.boss.telegraph.clear"))}</button>` : ""}
      </div>`
    : "";

  return `<section class="${CLASS}-group ${CLASS}-live">
    <header class="${CLASS}-group-head">
      <span>${esc(L("GLVR.boss.downfalls.fire"))}</span>
      ${penalty < 0
        ? `<span class="${CLASS}-penalty">${esc(L("GLVR.boss.downfalls.penalty", { value: String(penalty) }))}</span>`
        : ""}
    </header>
    ${rows ? `<ul class="${CLASS}-list">${rows}</ul>` : `<p class="${CLASS}-empty">${esc(L("GLVR.boss.downfalls.empty"))}</p>`}
    <p class="${CLASS}-note">${esc(telegraph ? L("GLVR.boss.telegraph.active", {
      ability: L(`GLVR.boss.ability.${telegraph.ability}.name`),
    }) : L("GLVR.boss.telegraph.none"))}</p>
    ${telegraphBlock}
  </section>`;
}

function renderMarked(actor, profile) {
  return `<section class="${CLASS}-panel" data-tier="${profile.tier}" data-state="boss">
    <header class="${CLASS}-head">
      <span class="${CLASS}-title">${esc(L("GLVR.boss.panel"))}</span>
      <span class="${CLASS}-tier">${esc(L(`GLVR.boss.tier.${profile.tier}`))}</span>
      <button type="button" class="${CLASS}-unmark" title="${esc(L("GLVR.boss.unmark"))}"
        aria-label="${esc(L("GLVR.boss.unmark"))}"><i class="fa-solid fa-xmark"></i></button>
    </header>
    ${renderStats(actor, profile)}
    ${renderEncounter(actor, profile)}
    ${renderAbilities(profile)}
    ${renderDownfalls(profile)}
    <div class="${CLASS}-actions">
      ${TIER_ORDER.filter((tier) => tier !== profile.tier)
        .map(
          (tier) =>
            `<button type="button" class="gl-btn ${CLASS}-mark" data-tier="${tier}" title="${esc(
              L(`GLVR.boss.tierHint.${tier}`)
            )}">${esc(L(`GLVR.boss.tier.${tier}`))}</button>`
        )
        .join("")}
    </div>
  </section>`;
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

function wire(root, actor) {
  const panel = root.querySelector(`.${CLASS}-panel`);
  if (!panel) return;

  for (const button of panel.querySelectorAll(`.${CLASS}-mark`)) {
    button.addEventListener("click", async () => {
      const tier = button.dataset.tier;
      await markBoss(actor, tier);
      await syncCardConfig(actor, bossTurns(tier));
      await refreshAbilityText(actor);
      actor.sheet?.render(false);
    });
  }

  panel.querySelector(`.${CLASS}-unmark`)?.addEventListener("click", async () => {
    await unmarkBoss(actor);
    await syncCardConfig(actor, 1);
    actor.sheet?.render(false);
  });

  panel.querySelector(`.${CLASS}-add-ability`)?.addEventListener("click", async () => {
    const id = panel.querySelector(`.${CLASS}-pick`)?.value;
    if (!id) return;
    await addAbility(actor, id);
    actor.sheet?.render(false);
  });

  for (const button of panel.querySelectorAll(`.${CLASS}-drop`)) {
    button.addEventListener("click", async () => {
      await removeAbility(actor, button.dataset.id);
      actor.sheet?.render(false);
    });
  }

  panel.querySelector(`.${CLASS}-add-downfall`)?.addEventListener("click", async () => {
    const type = panel.querySelector(`.${CLASS}-pick-trigger`)?.value;
    const profile = storedProfile(actor);
    if (!type || !profile) return;
    await updateProfile(actor, {
      downfalls: [...profile.downfalls, { id: foundry.utils.randomID(), type, note: "" }],
    });
    actor.sheet?.render(false);
  });

  for (const button of panel.querySelectorAll(`.${CLASS}-drop-downfall`)) {
    button.addEventListener("click", async () => {
      const profile = storedProfile(actor);
      if (!profile) return;
      const index = Number(button.dataset.index);
      await updateProfile(actor, { downfalls: profile.downfalls.filter((_, i) => i !== index) });
      actor.sheet?.render(false);
    });
  }

  for (const button of panel.querySelectorAll(`.${CLASS}-fire`)) {
    button.addEventListener("click", async () => {
      const combatant = findCombatant(actor);
      if (!combatant) return;
      const profile = storedProfile(actor);
      const downfall = profile?.downfalls.find((entry) => entry.id === button.dataset.id);
      const result = await triggerDownfall(combatant, button.dataset.id);
      if (result.applied) await announceDownfall(actor, result, downfall);
      actor.sheet?.render(false);
    });
  }

  panel.querySelector(`.${CLASS}-telegraph`)?.addEventListener("click", async () => {
    const combatant = findCombatant(actor);
    const id = panel.querySelector(`.${CLASS}-pick-telegraph`)?.value;
    if (!combatant || !id) return;
    const target = panel.querySelector(`.${CLASS}-telegraph-target`)?.value ?? "";
    await setTelegraph(combatant, id, target);
    await announceTelegraph(actor, id, target);
    actor.sheet?.render(false);
  });

  panel.querySelector(`.${CLASS}-telegraph-clear`)?.addEventListener("click", async () => {
    const combatant = findCombatant(actor);
    if (!combatant) return;
    await setTelegraph(combatant, null);
    actor.sheet?.render(false);
  });

  // The note is saved on blur and the sheet is deliberately *not* re-rendered:
  // a GM typing a trigger description would otherwise lose the caret on every
  // keystroke that happened to land while the sheet repainted.
  for (const input of panel.querySelectorAll(`.${CLASS}-note[data-index]`)) {
    input.addEventListener("change", async () => {
      const profile = storedProfile(actor);
      if (!profile) return;
      const index = Number(input.dataset.index);
      const downfalls = profile.downfalls.map((entry, i) =>
        i === index ? { ...entry, note: input.value } : entry
      );
      await updateProfile(actor, { downfalls });
    });
  }
}

function onRenderSheet(app, html) {
  try {
    const root = normalizeHtml(html);
    const actor = app?.actor ?? app?.document ?? null;
    if (!root || !actor) return;

    root.querySelectorAll(`.${CLASS}-panel`).forEach((node) => node.remove());

    if (!bossOn()) return;
    // Downfalls are what the party is meant to discover; the panel that lists
    // them is a GM tool, not a readout.
    if (!game.user?.isGM) return;
    if (actor.type !== "npc") return;

    const host = SHEET_ANCHORS.map((sel) => root.querySelector(sel)).find(Boolean);
    if (!host) return;

    const profile = storedProfile(actor);
    host.insertAdjacentHTML("beforeend", profile ? renderMarked(actor, profile) : renderUnmarked());
    wire(root, actor);
  } catch (error) {
    // A sheet that changed shape must never take the sheet down with it.
    warn("pf2e-variant-rules | boss panel failed to render", error);
  }
}

export function registerBossSheet() {
  // One name is enough: AppV1 fires the render hook for every class in the
  // sheet's inheritance chain, and `NPCSheetPF2e` is the most specific one that
  // covers both PF2e NPC sheets without also running on every character sheet.
  Hooks.on("renderNPCSheetPF2e", onRenderSheet);
  Hooks.on("renderSimpleNPCSheet", onRenderSheet);
}

/** Exported for the check tool: the panel must never gate a *write* on nothing. */
export const SHEET_HOST_ANCHORS = SHEET_ANCHORS;
export const ALL_ABILITY_IDS = ABILITIES.map((entry) => entry.id);
export const ALL_TIERS = Object.keys(TIERS);
