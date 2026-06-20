/**
 * Flatfinder Apex (Solo Boss) template — extra-turn automation.
 *
 * Flatfinder v3 §8 gives a lone boss more *actions* instead of bigger numbers:
 *
 *   "The boss takes its normal Prime turn, then an additional full turn at
 *    initiative count (its result − 10); a third at (−20) against a 5–6 PC party.
 *    Each extra turn is a true fresh turn, so the boss's Multiple Attack Penalty
 *    resets … Per-turn effects only resolve on the Prime turn."
 *
 * This module lets a GM flag an NPC as Apex and choose how many turns it takes,
 * then — in standard initiative — automatically inserts the extra turns into the
 * combat as additional Combatants at (rolled − 10), (rolled − 20), …  Each extra
 * turn is a genuine Foundry turn, so the system resets the boss's MAP for free.
 * The Prime turn is flagged and badged so the GM knows where the once-per-round,
 * start/end-of-turn effects resolve.
 *
 * Compatibility with gluniverse-initiative:
 *   That module already provides multi-turn bosses through its *Card* initiative
 *   mode (its own deck draws the extra slots). When Card mode is active we stand
 *   down — creating Combatants there would double the boss's turns. In Standard
 *   mode our extra Combatants render naturally as additional cards on its rail.
 */

import {
  APEX_DEFAULTS,
  APEX_EXTRA_FLAG,
  APEX_FLAG,
  APEX_INITIATIVE_STEP,
  APEX_PHASE_THRESHOLDS,
  APEX_PHASES_FLAG,
  APEX_PRIME_FLAG,
  APEX_TURNS_LIMITS,
  DEGREE_LABELS,
  GLUNI_MODULE_ID,
  MODULE_ID,
} from "./constants.js";
import { asElement, getSetting } from "./settings.js";
import { registerWrapper, WRAPPER } from "./lib/wrapper.js";

/* --------------------------------------------------------------------------- *
 * Small shared helpers
 * --------------------------------------------------------------------------- */

function clampTurns(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return APEX_TURNS_LIMITS.min;
  return Math.max(APEX_TURNS_LIMITS.min, Math.min(APEX_TURNS_LIMITS.max, n));
}

/** The Apex configuration stored on an actor, merged with defaults. */
export function getApexConfig(actor) {
  const raw = actor?.getFlag?.(MODULE_ID, APEX_FLAG) ?? {};
  return {
    enabled: !!raw.enabled,
    turns: clampTurns(raw.turns ?? APEX_DEFAULTS.turns),
  };
}

/** True when this actor is an Apex creature with more than one turn. */
export function isApexActor(actor) {
  if (actor?.type !== "npc") return false;
  const cfg = getApexConfig(actor);
  return cfg.enabled && cfg.turns > 1;
}

/** Resolve the Actor backing a sheet application (V1 or V2). */
function getActorFromSheet(app) {
  const doc = app?.actor ?? app?.document ?? app?.object ?? app?.options?.document;
  return doc?.documentName === "Actor" ? doc : null;
}

/** GM-only, NPC-only gate for the sheet control. */
function canConfigureApex(actor) {
  if (!actor || actor.type !== "npc") return false;
  return game.user?.isGM === true;
}

/** Only the one authoritative GM mutates the combat, to avoid duplicate writes. */
function isActiveGM() {
  const active = game.users?.activeGM;
  if (active) return active.id === game.user?.id;
  return game.user?.isGM === true && !game.users?.players?.some((u) => u.isGM && u.active);
}

/** Whether gluniverse-initiative's Card mode is the active turn engine. */
function gluniCardModeActive() {
  const mod = game.modules?.get(GLUNI_MODULE_ID);
  if (!mod?.active) return false;
  try {
    return game.settings.get(GLUNI_MODULE_ID, "initiativeMode") === "card";
  } catch (err) {
    return false;
  }
}

/* --------------------------------------------------------------------------- *
 * Combatant classification
 * --------------------------------------------------------------------------- */

/** An extra-turn Combatant we created, or null. Returns `{ primeId, index, total }`. */
function extraData(combatant) {
  return combatant?.getFlag?.(MODULE_ID, APEX_EXTRA_FLAG) ?? null;
}

/**
 * True when this combatant is one of the extra Apex turns we created — i.e. the
 * same boss acting again, not an additional threat. Used by the encounter-budget
 * math so a boss's extra turns aren't double-counted as separate creatures.
 */
export function isApexExtraCombatant(combatant) {
  return !!extraData(combatant);
}

/** True for a "prime" Apex combatant (the rolled one, not one of our extras). */
function isPrimeCombatant(combatant) {
  return !extraData(combatant) && isApexActor(combatant?.actor);
}

/** All extra-turn combatants we created for a given prime combatant. */
function extrasFor(combat, primeId) {
  return combat.combatants.filter((c) => extraData(c)?.primeId === primeId);
}

/* --------------------------------------------------------------------------- *
 * Turn synchronisation
 * --------------------------------------------------------------------------- */

/** Re-entrancy guard so cascading combat hooks never rebuild the same prime twice. */
const rebuilding = new Set();

/**
 * Make the combat reflect a prime Apex combatant's configuration: create/refresh
 * its extra-turn combatants at (initiative − 10·k), or tear them down when Apex is
 * off / disabled by Card mode.
 */
async function syncApexTurns(combat, prime) {
  if (!combat || !prime || !isActiveGM()) return;
  if (rebuilding.has(prime.id)) return;

  const off =
    !getSetting("apexTurns") || !isApexActor(prime.actor) || gluniCardModeActive();
  const stale = extrasFor(combat, prime.id).map((c) => c.id);

  if (off) {
    rebuilding.add(prime.id);
    try {
      if (stale.length) await combat.deleteEmbeddedDocuments("Combatant", stale);
      if (prime.getFlag(MODULE_ID, APEX_PRIME_FLAG)) {
        await prime.unsetFlag(MODULE_ID, APEX_PRIME_FLAG);
      }
    } finally {
      rebuilding.delete(prime.id);
    }
    return;
  }

  const baseInit = prime.initiative;
  if (typeof baseInit !== "number") return; // not rolled yet — wait for initiative.

  const { turns } = getApexConfig(prime.actor);
  const wanted = turns - 1;

  rebuilding.add(prime.id);
  try {
    if (!prime.getFlag(MODULE_ID, APEX_PRIME_FLAG)) {
      await prime.setFlag(MODULE_ID, APEX_PRIME_FLAG, true);
    }
    // Simplest correct refresh: clear our old extras and recreate at the new value.
    if (stale.length) await combat.deleteEmbeddedDocuments("Combatant", stale);

    const create = [];
    for (let i = 1; i <= wanted; i++) {
      create.push({
        tokenId: prime.tokenId ?? null,
        sceneId: prime.sceneId ?? null,
        actorId: prime.actorId ?? null,
        hidden: prime.hidden,
        initiative: baseInit - APEX_INITIATIVE_STEP * i,
        flags: {
          [MODULE_ID]: {
            [APEX_EXTRA_FLAG]: { primeId: prime.id, index: i, total: turns },
          },
        },
      });
    }
    if (create.length) await combat.createEmbeddedDocuments("Combatant", create);
  } finally {
    rebuilding.delete(prime.id);
  }
}

/** Remove the extra turns belonging to a prime that was deleted. */
async function tearDownExtras(combat, primeId) {
  if (!combat || !isActiveGM()) return;
  const ids = extrasFor(combat, primeId).map((c) => c.id);
  if (ids.length) await combat.deleteEmbeddedDocuments("Combatant", ids);
}

/** Re-sync every Apex prime for one actor across the active combats (config change). */
async function resyncActor(actor) {
  if (!actor || !isActiveGM()) return;
  for (const combat of game.combats ?? []) {
    for (const c of combat.combatants) {
      if (extraData(c)) continue;
      if (c.actor?.id === actor.id && c.actor?.type === "npc") {
        await syncApexTurns(combat, c);
      }
    }
  }
}

/* --------------------------------------------------------------------------- *
 * Sheet control — "Apex" button on the NPC sheet
 * --------------------------------------------------------------------------- */

function openApexConfigDialog(actor) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  const cfg = getApexConfig(actor);
  const L = (k) => game.i18n.localize(k);

  const content = `
    <div class="flatfinder-apex-dialog" autocomplete="off">
      <p class="ff-apex-note">${L("PF2E-FLATFINDER.Apex.Dialog.Hint")}</p>
      <label class="ff-apex-field" style="display:flex;align-items:center;gap:.5em;margin:.4em 0;">
        <input type="checkbox" name="enabled" ${cfg.enabled ? "checked" : ""}>
        <span>${L("PF2E-FLATFINDER.Apex.Dialog.Enabled")}</span>
      </label>
      <label class="ff-apex-field" style="display:flex;flex-direction:column;gap:.2em;margin:.4em 0;">
        <span>${L("PF2E-FLATFINDER.Apex.Dialog.Turns")}</span>
        <input type="number" name="turns" min="${APEX_TURNS_LIMITS.min}" max="${APEX_TURNS_LIMITS.max}" step="1" value="${cfg.turns}">
        <small style="opacity:.75;">${L("PF2E-FLATFINDER.Apex.Dialog.TurnsHint")}</small>
      </label>
    </div>`;

  const save = async (form) => {
    const enabled = !!form?.elements?.enabled?.checked;
    const turns = clampTurns(form?.elements?.turns?.value);
    // The updateActor hook below picks up the flag change and re-syncs the combat.
    await actor.setFlag(MODULE_ID, APEX_FLAG, { enabled, turns });
  };

  if (DialogV2) {
    new DialogV2({
      window: { title: game.i18n.format("PF2E-FLATFINDER.Apex.Dialog.Title", { name: actor.name }) },
      classes: ["flatfinder-apex-config-dialog"],
      position: { width: 440 },
      content,
      buttons: [
        {
          action: "save",
          icon: "fa-solid fa-check",
          label: game.i18n.localize("PF2E-FLATFINDER.Apex.Dialog.Save"),
          default: true,
          callback: (event, button) => save(button.form),
        },
      ],
    }).render({ force: true });
    return;
  }

  // Fallback for environments without DialogV2.
  new Dialog({
    title: game.i18n.format("PF2E-FLATFINDER.Apex.Dialog.Title", { name: actor.name }),
    content,
    buttons: {
      save: {
        icon: '<i class="fa-solid fa-check"></i>',
        label: game.i18n.localize("PF2E-FLATFINDER.Apex.Dialog.Save"),
        callback: (html) => save(asElement(html)?.querySelector("form") ?? asElement(html)),
      },
    },
    default: "save",
  }).render(true);
}

/** Add the Apex button to a V1 header-buttons array. */
function addApexHeaderButton(app, buttons) {
  const actor = getActorFromSheet(app);
  if (!canConfigureApex(actor)) return;
  if (buttons.some((b) => b.class === "flatfinder-apex-config")) return;
  buttons.unshift({
    label: game.i18n.localize("PF2E-FLATFINDER.Apex.Button"),
    class: "flatfinder-apex-config",
    icon: "fa-solid fa-crown",
    onclick: (event) => {
      event?.preventDefault?.();
      openApexConfigDialog(actor);
    },
  });
}

/** Add the Apex control to a V2 header-controls array. */
function addApexHeaderControl(app, controls) {
  const actor = getActorFromSheet(app);
  if (!canConfigureApex(actor)) return;
  if (controls.some((c) => c.action === "flatfinder-apex-config")) return;
  controls.unshift({
    action: "flatfinder-apex-config",
    icon: "fa-solid fa-crown",
    label: game.i18n.localize("PF2E-FLATFINDER.Apex.Button"),
    onClick: (event) => {
      event?.preventDefault?.();
      openApexConfigDialog(actor);
    },
    visible: true,
  });
}

/**
 * Mark the NPC sheet as Apex so its content reads as a solo boss at a glance:
 * an etched "APEX" emblem banner pinned to the top of the sheet body (carrying a
 * one-click counteract action for the GM) plus a contained amber tint on the
 * crown control. We deliberately avoid an outer window glow — its bloom spills
 * past the sheet and tints the PF2e token HUD that overlays it. The treatment
 * tracks the live config — toggling Apex off (or disabling the feature) strips
 * it on re-render.
 */
function decorateApexSheet(app, html) {
  const actor = getActorFromSheet(app);
  if (!actor || actor.type !== "npc") return;

  const element = asElement(html) ?? asElement(app?.element) ?? app?.element;
  const root = element?.closest?.(".app, .application, .window-app") ?? element;
  if (!root) return;

  const isApex = getSetting("apexTurns") && isApexActor(actor);

  if (!isApex) {
    root.classList.remove("flatfinder-apex-sheet");
    root.removeAttribute("data-apex-turns");
    root.querySelector(".flatfinder-apex-emblem")?.remove();
    return;
  }

  const { turns } = getApexConfig(actor);
  root.classList.add("flatfinder-apex-sheet");
  root.dataset.apexTurns = String(turns);

  // The emblem sits as a banner at the top of the sheet body so the content
  // itself — not just the window chrome — reads as Apex.
  const content = root.querySelector(".window-content") ?? root;
  let emblem = root.querySelector(".flatfinder-apex-emblem");
  if (!emblem || emblem.parentElement !== content) {
    emblem?.remove();
    emblem = document.createElement("div");
    emblem.className = "flatfinder-apex-emblem";
    content.prepend(emblem);
  }
  emblem.dataset.tooltip = game.i18n.localize("PF2E-FLATFINDER.Apex.Sheet.Tooltip");
  emblem.innerHTML = `
    <i class="fa-solid fa-crown" aria-hidden="true"></i>
    <span class="ff-apex-emblem-label">${game.i18n.localize("PF2E-FLATFINDER.Apex.Sheet.Emblem")}</span>
    <span class="ff-apex-emblem-turns">${game.i18n.format("PF2E-FLATFINDER.Apex.Sheet.Turns", { turns })}</span>`;

  // A counteract action lives on the sheet too, so the GM can roll the boss's
  // once-per-turn condition counteract without opening the combat tracker
  // (Flatfinder §8, Component 3). innerHTML above resets the emblem each render,
  // so we always (re)build the button and its listener here.
  if (game.user?.isGM) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flatfinder-apex-emblem-counteract";
    btn.dataset.tooltip = game.i18n.localize("PF2E-FLATFINDER.Apex.Counteract.Button");
    btn.innerHTML = `
      <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
      <span>${game.i18n.localize("PF2E-FLATFINDER.Apex.Counteract.SheetButton")}</span>`;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      apexCounteract(actor).catch((err) =>
        console.error(`${MODULE_ID} | Apex counteract error`, err)
      );
    });
    emblem.appendChild(btn);
  }
}

/** Inject a titlebar button directly (covers sheets that don't fire the above). */
function injectApexTitlebarButton(app, html) {
  const actor = getActorFromSheet(app);
  if (!canConfigureApex(actor)) return;

  const element = asElement(html) ?? asElement(app?.element) ?? app?.element;
  const wrapper = element?.closest?.(".app, .application, .window-app") ?? element;
  const header = app?.window?.header ?? wrapper?.querySelector?.(".window-header");
  if (!header || header.querySelector(".flatfinder-apex-config")) return;

  const button = document.createElement("a");
  button.className = "header-button header-control flatfinder-apex-config";
  button.dataset.action = "flatfinder-apex-config";
  button.title = game.i18n.localize("PF2E-FLATFINDER.Apex.Button");
  button.innerHTML = `<i class="fa-solid fa-crown" aria-hidden="true"></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openApexConfigDialog(actor);
  });

  const close = header.querySelector('[data-action="close"], .close, [data-action="minimize"]');
  if (close) header.insertBefore(button, close);
  else header.appendChild(button);
}

/* --------------------------------------------------------------------------- *
 * Combat-tracker decoration — Prime / extra-turn badges
 * --------------------------------------------------------------------------- */

export function decorateApexTracker(app, html) {
  const root = asElement(html);
  if (!root) return;
  const combat = app?.viewed ?? app?.combat ?? game.combats?.viewed ?? game.combat;
  if (!combat) return;

  for (const row of root.querySelectorAll("[data-combatant-id]")) {
    row.querySelector(".flatfinder-apex-tag")?.remove();
    const combatant = combat.combatants.get(row.dataset.combatantId);
    if (!combatant) continue;

    const extra = extraData(combatant);
    const prime = !extra && combatant.getFlag(MODULE_ID, APEX_PRIME_FLAG);
    if (!extra && !prime) continue;

    const total = extra?.total ?? getApexConfig(combatant.actor).turns;
    const ordinal = extra ? extra.index + 1 : 1;

    const tag = document.createElement("span");
    tag.className = "flatfinder-apex-tag";
    tag.dataset.prime = prime ? "true" : "false";
    tag.dataset.tooltip = prime
      ? game.i18n.localize("PF2E-FLATFINDER.Apex.Tag.PrimeTooltip")
      : game.i18n.localize("PF2E-FLATFINDER.Apex.Tag.ExtraTooltip");
    tag.textContent = prime
      ? game.i18n.format("PF2E-FLATFINDER.Apex.Tag.Prime", { total })
      : game.i18n.format("PF2E-FLATFINDER.Apex.Tag.Extra", { n: ordinal, total });

    const name = row.querySelector(".token-name, .combatant-name, h4, .name");
    if (name) name.appendChild(tag);
    else row.appendChild(tag);

    // Prime rows get a one-click counteract action for the GM (Component 3).
    if (prime && game.user?.isGM && !row.querySelector(".flatfinder-apex-counteract-btn")) {
      const btn = document.createElement("a");
      btn.className = "flatfinder-apex-counteract-btn";
      btn.dataset.tooltip = game.i18n.localize("PF2E-FLATFINDER.Apex.Counteract.Button");
      btn.innerHTML = `<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>`;
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        apexCounteract(combatant.actor).catch((err) =>
          console.error(`${MODULE_ID} | Apex counteract error`, err)
        );
      });
      tag.insertAdjacentElement("afterend", btn);
    }
  }
}

/* --------------------------------------------------------------------------- *
 * Component 1 (per-turn-effects guard) — Flatfinder §8:
 *   "Per-turn effects only resolve on the Prime turn."
 * PF2e processes persistent damage, condition reduction (frightened, etc.) and
 * turn-based effect expiry in CombatantPF2e#startTurn / #endTurn. We skip those
 * for our extra-turn combatants so they never fire twice in a round.
 * --------------------------------------------------------------------------- */

function registerApexTurnGuard() {
  const proto = CONFIG?.Combatant?.documentClass?.prototype;
  if (!proto) return;

  for (const method of ["startTurn", "endTurn"]) {
    if (typeof proto[method] !== "function") continue;
    try {
      registerWrapper(
        `CONFIG.Combatant.documentClass.prototype.${method}`,
        function (wrapped, ...args) {
          try {
            if (getSetting("apexTurns") && getSetting("apexPerTurnGuard") && extraData(this)) {
              // An extra Apex turn is a fresh turn for the action economy, but its
              // per-turn effects do NOT resolve — only the Prime turn's do.
              return method === "endTurn" ? Promise.resolve() : undefined;
            }
          } catch (err) {
            console.error(`${MODULE_ID} | Apex per-turn guard error`, err);
          }
          return wrapped(...args);
        },
        WRAPPER
      );
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to wrap Combatant.${method}`, err);
    }
  }
}

/* --------------------------------------------------------------------------- *
 * Component 4 (HP phases) — Flatfinder §8:
 *   Crossing 66% / 33% HP triggers a beat: a free turn, shedding one condition,
 *   and a tactics shift. We fire a once-per-threshold reminder for the GM.
 * --------------------------------------------------------------------------- */

async function postPhaseCard(combatant, threshold, fraction) {
  const pct = Math.round(threshold * 100);
  const hpPct = Math.round(fraction * 100);
  const L = (k) => game.i18n.localize(k);
  const content = `
    <div class="flatfinder-apex-phase">
      <div class="ff-ap-head">
        <span class="ff-ap-kicker">${L("PF2E-FLATFINDER.Apex.Phase.Kicker")}</span>
        <span class="ff-ap-name">${foundry.utils.escapeHTML?.(combatant.name) ?? combatant.name}</span>
        <span class="ff-ap-hp">${game.i18n.format("PF2E-FLATFINDER.Apex.Phase.At", { pct, hp: hpPct })}</span>
      </div>
      <ul class="ff-ap-beats">
        <li>${L("PF2E-FLATFINDER.Apex.Phase.FreeTurn")}</li>
        <li>${L("PF2E-FLATFINDER.Apex.Phase.ShedCondition")}</li>
        <li>${L("PF2E-FLATFINDER.Apex.Phase.Tactics")}</li>
      </ul>
    </div>`;

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor: combatant.actor }),
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    flags: { [MODULE_ID]: { "ff.apexPhase": true } },
  });
}

async function checkApexPhases(actor) {
  if (!isActiveGM() || !getSetting("apexTurns") || !getSetting("apexPhases")) return;
  if (!isApexActor(actor)) return;

  const hp = actor.system?.attributes?.hp;
  if (!hp || !hp.max) return;
  const fraction = hp.value / hp.max;

  for (const combat of game.combats ?? []) {
    if (!combat.started) continue;
    for (const c of combat.combatants) {
      if (extraData(c) || c.actor?.id !== actor.id) continue;
      const fired = [...(c.getFlag(MODULE_ID, APEX_PHASES_FLAG) ?? [])];
      let changed = false;
      for (const threshold of APEX_PHASE_THRESHOLDS) {
        if (fraction <= threshold && !fired.includes(threshold)) {
          fired.push(threshold);
          changed = true;
          await postPhaseCard(c, threshold, fraction);
        }
      }
      if (changed) await c.setFlag(MODULE_ID, APEX_PHASES_FLAG, fired);
    }
  }
}

/* --------------------------------------------------------------------------- *
 * Component 3 (condition resilience) — Flatfinder §8:
 *   Once per turn, as an action, the boss may counteract a condition it has
 *   suffered for a full turn, using its highest save modifier and counteracting
 *   at its full creature level. We roll the check and post it; the GM applies it.
 * --------------------------------------------------------------------------- */

function highestSaveMod(actor) {
  const saves = actor?.saves ?? {};
  let best = -Infinity;
  for (const key of ["fortitude", "reflex", "will"]) {
    const mod = saves[key]?.mod ?? saves[key]?.check?.mod ?? saves[key]?.totalModifier;
    if (typeof mod === "number") best = Math.max(best, mod);
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * A creature's counteract rank (Player Core, Counteracting): halve its level and
 * round up, minimum 0. Flatfinder §8 has the boss counteract at its full creature
 * level, so we derive the rank from the unmodified creature level.
 */
export function counteractRank(level) {
  const lvl = Number(level);
  if (!Number.isFinite(lvl)) return 0;
  return Math.max(0, Math.ceil(lvl / 2));
}

/** The typical level band of a counteract rank (Player Core counteract table). */
function rankLevelBand(rank) {
  return { low: 2 * rank - 1, high: 2 * rank };
}

/**
 * The four counteract outcomes for a given counteract rank, expressed as the
 * highest *target* rank (and its level band) each degree of success can
 * counteract — Player Core: Crit Success +3, Success +1, Failure −1, Crit
 * Failure none.
 */
export function counteractOutcomes(rank) {
  return [
    { degree: 3, label: DEGREE_LABELS[3], rank: rank + 3 },
    { degree: 2, label: DEGREE_LABELS[2], rank: rank + 1 },
    { degree: 1, label: DEGREE_LABELS[1], rank: rank - 1 },
    { degree: 0, label: DEGREE_LABELS[0], rank: null },
  ];
}

/** Render the per-tier "what does this counteract" table rows for the chat card. */
function counteractTableRows(rank) {
  const L = (k) => game.i18n.localize(k);
  const dash = L("PF2E-FLATFINDER.Apex.Counteract.None");
  const degreeKey = ["critical-failure", "failure", "success", "critical-success"];

  return counteractOutcomes(rank)
    .map((o) => {
      let cell;
      if (o.rank === null || o.rank < 0) {
        cell = `<span class="ff-ac-fail">${dash}</span>`;
      } else {
        const band = rankLevelBand(o.rank);
        const levels = game.i18n.format("PF2E-FLATFINDER.Apex.Counteract.Levels", {
          low: band.low,
          high: band.high,
        });
        cell =
          `<span class="ff-ac-rank">${game.i18n.format("PF2E-FLATFINDER.Apex.Counteract.Rank", { rank: o.rank })}</span>` +
          `<span class="ff-ac-band">${levels}</span>`;
      }
      return `
        <tr data-degree="${degreeKey[o.degree]}">
          <th scope="row">${L(o.label)}</th>
          <td>${cell}</td>
        </tr>`;
    })
    .join("");
}

export async function apexCounteract(actor) {
  if (!actor) return;
  const mod = highestSaveMod(actor);
  if (mod === null) {
    ui.notifications?.warn(game.i18n.localize("PF2E-FLATFINDER.Apex.Counteract.NoSave"));
    return;
  }
  const level = actor.level ?? actor.system?.details?.level?.value ?? 0;
  const rank = counteractRank(level);
  const roll = await new Roll("1d20 + @mod", { mod }).evaluate();
  const L = (k) => game.i18n.localize(k);
  const flavor = `
    <div class="flatfinder-apex-counteract">
      <span class="ff-ac-kicker">${L("PF2E-FLATFINDER.Apex.Counteract.Kicker")}</span>
      <span class="ff-ac-note">${game.i18n.format("PF2E-FLATFINDER.Apex.Counteract.Note", { level, rank })}</span>
      <table class="ff-ac-table">
        <thead>
          <tr>
            <th scope="col">${L("PF2E-FLATFINDER.Apex.Counteract.ColResult")}</th>
            <th scope="col">${L("PF2E-FLATFINDER.Apex.Counteract.ColCounteracts")}</th>
          </tr>
        </thead>
        <tbody>${counteractTableRows(rank)}</tbody>
      </table>
      <span class="ff-ac-foot">${L("PF2E-FLATFINDER.Apex.Counteract.Foot")}</span>
    </div>`;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    flags: { [MODULE_ID]: { "ff.apexCounteract": true } },
  });
}

/* --------------------------------------------------------------------------- *
 * Registration
 * --------------------------------------------------------------------------- */

export function registerApex() {
  // Sheet control — cover V1 buttons, V2 controls, and a direct titlebar inject.
  Hooks.on("getActorSheetHeaderButtons", addApexHeaderButton);
  Hooks.on("getApplicationHeaderButtons", addApexHeaderButton);
  Hooks.on("getApplicationV1HeaderButtons", addApexHeaderButton);
  Hooks.on("getHeaderControlsApplicationV2", addApexHeaderControl);
  Hooks.on("renderApplicationV1", injectApexTitlebarButton);
  Hooks.on("renderApplicationV2", injectApexTitlebarButton);
  Hooks.on("renderActorSheet", injectApexTitlebarButton);

  // Make the sheet content itself read as Apex (frame, header accent, emblem).
  Hooks.on("renderApplicationV1", decorateApexSheet);
  Hooks.on("renderApplicationV2", decorateApexSheet);
  Hooks.on("renderActorSheet", decorateApexSheet);

  // Combat synchronisation.
  Hooks.on("updateCombatant", (combatant, changed) => {
    if (extraData(combatant)) return; // never react to our own extras
    if (!("initiative" in changed)) return;
    if (!isApexActor(combatant.actor)) return;
    syncApexTurns(combatant.parent, combatant).catch((err) =>
      console.error(`${MODULE_ID} | Apex sync error`, err)
    );
  });

  Hooks.on("createCombatant", (combatant) => {
    if (extraData(combatant)) return;
    if (!isApexActor(combatant.actor)) return;
    // Build now if it already has an initiative (added mid-combat).
    if (typeof combatant.initiative === "number") {
      syncApexTurns(combatant.parent, combatant).catch((err) =>
        console.error(`${MODULE_ID} | Apex sync error`, err)
      );
    }
  });

  Hooks.on("deleteCombatant", (combatant) => {
    if (extraData(combatant)) return; // an extra leaving is fine
    tearDownExtras(combatant.parent, combatant.id).catch((err) =>
      console.error(`${MODULE_ID} | Apex teardown error`, err)
    );
  });

  Hooks.on("updateActor", (actor, changed) => {
    // The flag is stored under the suite scope with the dotted "ff.apex" key, so
    // the update diff nests it as flags[MODULE_ID].ff.apex. Detect it robustly.
    const scopeChanges = changed?.flags?.[MODULE_ID];
    const apexChanged =
      scopeChanges != null &&
      foundry.utils.getProperty(scopeChanges, APEX_FLAG) !== undefined;
    if (apexChanged) {
      resyncActor(actor).catch((err) =>
        console.error(`${MODULE_ID} | Apex resync error`, err)
      );
    }
    // HP-phase beats (Component 4) — react to a hit-point change.
    if (changed?.system?.attributes?.hp) {
      checkApexPhases(actor).catch((err) =>
        console.error(`${MODULE_ID} | Apex phase error`, err)
      );
    }
  });

  // Unlinked-token bosses carry their HP on the token delta, not the world actor.
  Hooks.on("updateToken", (tokenDoc, changed) => {
    if (!changed?.delta && !changed?.actorData) return;
    const actor = tokenDoc?.actor;
    if (actor) {
      checkApexPhases(actor).catch((err) =>
        console.error(`${MODULE_ID} | Apex phase error`, err)
      );
    }
  });

  // Per-turn-effects guard (Component 1) — wrap the system's turn processing.
  registerApexTurnGuard();
}

/**
 * Public API for macros / other modules. The suite exposes this on
 * `game.modules.get("gluniverse-suite").api.features.flatfinder` via the
 * adapter's `api` field, so we no longer mutate the module object directly.
 */
export const apexApi = {
  configureApex: openApexConfigDialog,
  getApexConfig,
  isApexActor,
  apexCounteract,
};
