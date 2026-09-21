/**
 * Hexcrawl — the Arrival card and its encounter roll (GM only).
 *
 * Journey to Horizon's per-hex beat, reduced to what the book would have you
 * look at: where you are, how hard the going is, what it cost, what is waiting
 * there, what the party has heard — and a button for the encounter dice the
 * scene config says to roll. The GM decides everything else.
 *
 * The card is WHISPERED to GM users and carries prepared encounter text,
 * rumour truth and GM notes; it is a snapshot taken when the party arrived.
 * The roll is a real Foundry Roll attached to the message, so Dice So Nice and
 * friends animate it. Dice count, die size and trigger all come from the scene
 * config, which is how the feature stays system agnostic.
 *
 * "This leg": the sum of the recorded moves sharing the current leg id (see
 * movement.mjs LEG_FLAG). The card's "New leg" button starts a new one. It is a
 * sum over the move history, so it is bounded by MOVE_HISTORY_CAP moves.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import {
  displayName, effectiveBlight, effectiveRating, effectiveTerrain, encounterDice, getHex, getRegion,
} from "./model.mjs";
import { L, F, costLabel, ratingName, secondsLabel, terrainName } from "./labels.mjs";
import { glyphSvg, pipsHTML } from "./tooltip.mjs";
import { legSeconds, newLeg } from "./movement.mjs";
import { readMap } from "./store.mjs";

const CARD_FLAG = "hex.card";

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const speaker = () => ({ alias: L("GLHEX.card.speaker") });

/** Build the arrival card HTML (a snapshot, GM eyes only). */
export function arrivalHTML(scene, record) {
  const map = readMap(scene);
  const k = record.to;
  const h = getHex(map, k), region = getRegion(map, k);
  const terrain = effectiveTerrain(map, k);
  const rating = effectiveRating(map, k);
  const dice = encounterDice(map, k);
  const title = displayName(map, k) || terrainName(map, terrain.id);
  const rows = [];

  rows.push(`<header class="glhex-card-head"><i class="fa-solid fa-person-hiking"></i>`
    + `<div><div class="glhex-card-kicker gl-tech-label">${escapeHTML(L("GLHEX.card.arrival"))}</div>`
    + `<div class="glhex-card-title">${escapeHTML(title)}</div></div></header>`);

  rows.push(`<div class="glhex-card-line">${glyphSvg(terrain.glyph, terrain.color)}<span>${escapeHTML(terrainName(map, terrain.id))}</span>`
    + (effectiveBlight(map, k) ? `<span class="glhex-tip-blight">${escapeHTML(L("GLHEX.tooltip.blight"))}</span>` : "")
    + `</div>`);
  if (rating) rows.push(`<div class="glhex-card-line" data-glhex-rating="${rating}">${pipsHTML(rating)}<span class="glhex-rating-word">${escapeHTML(ratingName(rating))}</span></div>`);

  rows.push(`<dl class="glhex-card-facts">`
    + `<dt>${escapeHTML(L("GLHEX.card.costLabel"))}</dt><dd class="gl-numeric">${escapeHTML(costLabel(map.config, record.cost ?? 0))}</dd>`
    + `<dt>${escapeHTML(L("GLHEX.card.legLabel"))}</dt><dd class="gl-numeric">${escapeHTML(secondsLabel(map.config, legSeconds(scene)))}</dd>`
    + (record.advanced ? `<dt></dt><dd class="glhex-card-note">${escapeHTML(L("GLHEX.card.timeAdvanced"))}</dd>` : "")
    + `</dl>`);

  if (region?.enc?.text) rows.push(section(L("GLHEX.card.encounter"), escapeHTML(region.enc.text)));
  if (region?.rumor?.text) {
    rows.push(section(L("GLHEX.card.rumor"),
      `${escapeHTML(region.rumor.text)}<div class="glhex-card-meta">${escapeHTML(L(`GLHEX.truth.${region.rumor.truth}`))} · `
      + `${escapeHTML(L(region.rumor.known ? "GLHEX.tooltip.known" : "GLHEX.tooltip.unknown"))}</div>`));
  }
  const notes = [h.nt, region?.notes].filter(Boolean).map((n) => `<p>${escapeHTML(n)}</p>`).join("");
  if (notes) rows.push(section(L("GLHEX.card.notes"), notes));

  const actions = [];
  if (dice.formula) {
    actions.push(`<button type="button" class="gl-btn gl-btn-accent glhex-card-btn" data-glhex-action="roll">`
      + `<i class="fa-solid fa-dice"></i> ${escapeHTML(F("GLHEX.card.roll", { formula: dice.formula }))}</button>`);
  }
  actions.push(`<button type="button" class="gl-btn glhex-card-btn" data-glhex-action="leg">`
    + `<i class="fa-solid fa-flag-checkered"></i> ${escapeHTML(L("GLHEX.card.newLeg"))}</button>`);
  rows.push(`<footer class="glhex-card-actions">${actions.join("")}</footer>`);
  if (dice.formula) rows.push(`<div class="glhex-card-hint">${escapeHTML(F("GLHEX.card.triggerHint", { trigger: dice.trigger }))}</div>`);

  return `<div class="glhex-card gl-type">${rows.join("")}</div>`;
}

const section = (label, body) => `<section class="glhex-card-section"><div class="gl-tech-label">${escapeHTML(label)}</div><div>${body}</div></section>`;

export async function postArrivalCard(scene, record) {
  const map = readMap(scene);
  const dice = encounterDice(map, record.to);
  return ChatMessage.create({
    content: arrivalHTML(scene, record),
    whisper: gmIds(),
    speaker: speaker(),
    flags: { [SUITE_ID]: { hex: { card: { kind: "arrival", scene: scene.id, key: record.to, formula: dice.formula, trigger: dice.trigger, move: record.id } } } },
  });
}

/** Roll the encounter dice and post the result, whispered to GMs. */
export async function rollEncounter({ formula, trigger, key, scene: sceneId }) {
  if (!game.user.isGM || !formula) return;
  const roll = await new Roll(formula).evaluate();
  const results = roll.dice.flatMap((d) => d.results.filter((r) => r.active !== false).map((r) => r.result));
  const hit = results.some((v) => v <= trigger);
  const scene = game.scenes.get(sceneId);
  const map = scene ? readMap(scene) : null;
  const where = map && key ? (displayName(map, key) || terrainName(map, effectiveTerrain(map, key).id)) : "";
  const chips = results.map((v) => `<span class="glhex-die${v <= trigger ? " is-hit" : ""}">${v}</span>`).join("");
  const content = `<div class="glhex-card glhex-roll gl-type${hit ? " is-triggered" : " is-quiet"}">`
    + `<header class="glhex-card-head"><i class="fa-solid fa-dice"></i><div>`
    + `<div class="glhex-card-kicker gl-tech-label">${escapeHTML(F("GLHEX.card.rolled", { formula }))}${where ? ` · ${escapeHTML(where)}` : ""}</div>`
    + `<div class="glhex-card-title">${escapeHTML(L(hit ? "GLHEX.card.triggered" : "GLHEX.card.quiet"))}</div></div></header>`
    + `<div class="glhex-dice">${chips}</div>`
    + `<div class="glhex-card-hint">${escapeHTML(F("GLHEX.card.triggerHint", { trigger }))}</div></div>`;
  return ChatMessage.create({
    content,
    rolls: [roll],
    whisper: gmIds(),
    speaker: speaker(),
    sound: CONFIG.sounds?.dice,
    flags: { [SUITE_ID]: { hex: { card: { kind: "encounter", hit } } } },
  });
}

/** renderChatMessageHTML: wire the card's buttons for GMs; strip them for anyone else. */
export function onRenderChatMessage(message, html) {
  const card = message?.getFlag?.(SUITE_ID, CARD_FLAG);
  if (!card || card.kind !== "arrival") return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const buttons = root.querySelectorAll("[data-glhex-action]");
  if (!game.user.isGM) { buttons.forEach((b) => b.remove()); return; }
  for (const b of buttons) {
    if (b.dataset.glhexBound) continue;
    b.dataset.glhexBound = "1";
    b.addEventListener("click", async (ev) => {
      ev.preventDefault();
      b.disabled = true;
      try {
        if (b.dataset.glhexAction === "roll") await rollEncounter(card);
        else if (b.dataset.glhexAction === "leg") {
          const scene = game.scenes.get(card.scene);
          if (scene) { await newLeg(scene); ui.notifications.info(L("GLHEX.notify.newLeg")); }
        }
      } catch (e) {
        warn("hexcrawl | arrival card action failed", e);
      } finally {
        b.disabled = false;
      }
    });
  }
}
