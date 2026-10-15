/**
 * Odds beside a chat card's save button.
 *
 * A spell card's "Reflex DC 22" button (templates/chat/spell-card.hbs:33,
 * `button[data-action="spell-save"][data-save][data-dc]`) gets the reader's own
 * chance of making it, gated on what they have learned of the caster's DC.
 * PF2e's older generic `button[data-action=save]` (pf2e.mjs UserVisibilityPF2e)
 * carries the same two attributes and is read the same way.
 *
 * A player sees their own character. The GM sees each controlled token's
 * (up to four), refreshed as the selection changes. Nothing is ever drawn for
 * someone the reader does not own.
 */

import { SETTINGS, TIMING, KNOWLEDGE_HOOK } from "./constants.mjs";
import { inlineHTML } from "./render.mjs";
import { get } from "./settings.mjs";
import { saveButtonModel } from "./view.mjs";
import { escapeHTML } from "../../core/util.mjs";

const SAVES = new Set(["fortitude", "reflex", "will"]);
const BUTTONS = 'button[data-action="spell-save"][data-save][data-dc], button[data-action="save"][data-save][data-dc]';
const ROW = "glod-save-odds";
const MAX_GM = 4;

const on = () => !!get(SETTINGS.savePrompt, true);
const t = (k) => game.i18n.localize(k);

function savers() {
  if (game.user.isGM) {
    const seen = new Set();
    const out = [];
    for (const token of canvas?.tokens?.controlled ?? []) {
      const actor = token?.actor;
      if (!actor || seen.has(actor.uuid)) continue;
      seen.add(actor.uuid);
      out.push(actor);
      if (out.length >= MAX_GM) break;
    }
    return out;
  }
  const own = game.user.character;
  if (own?.isOwner) return [own];
  const controlled = (canvas?.tokens?.controlled ?? []).map((tk) => tk.actor).find((a) => a?.isOwner && a.hasPlayerOwner);
  return controlled ? [controlled] : [];
}

async function decorate(message, root) {
  if (!on() || !root) return;
  const buttons = [...root.querySelectorAll(BUTTONS)];
  if (!buttons.length) return;
  const origin = message?.actor ?? message?.item?.actor ?? null;
  const item = message?.item ?? null;
  const who = savers();
  const gen = (root._glodSaveGen = (root._glodSaveGen ?? 0) + 1);
  for (const old of root.querySelectorAll(`.${ROW}`)) old.remove();

  for (const btn of buttons) {
    const save = btn.dataset.save;
    const dc = Number(btn.dataset.dc);
    if (!SAVES.has(save) || !Number.isFinite(dc) || !who.length) continue;

    const row = document.createElement("div");
    row.className = ROW;
    row.dataset.for = save;
    row.dataset.tooltip = t("GLOD.savePrompt.tooltip");
    btn.after(row);

    for (const saver of who) {
      if (saver === origin) continue;
      let model = null;
      try {
        model = await saveButtonModel({ saver, save, dc, origin, item });
      } catch {
        model = null;
      }
      if (root._glodSaveGen !== gen || !row.isConnected) return;
      const html = inlineHTML(model);
      if (!html) continue;
      const cell = document.createElement("span");
      cell.className = "glod-save-cell";
      cell.innerHTML = (game.user.isGM ? `<span class="glod-save-who">${escapeHTML(saver.name)}</span>` : "") + html;
      row.append(cell);
    }
    if (!row.childElementCount) row.remove();
  }
}

function onRender(message, html) {
  try {
    const root = html?.[0] ?? html;
    if (!(root instanceof HTMLElement)) return;
    decorate(message, root).catch(() => {});
  } catch {
    /* never break the chat log */
  }
}

/** Every rendered card with a save button, wherever it is drawn (log, popout, notification). */
function refreshAll() {
  if (!on()) return;
  for (const btn of document.querySelectorAll(BUTTONS)) {
    const root = btn.closest("[data-message-id]");
    const message = game.messages?.get(root?.dataset?.messageId ?? "");
    if (root && message && !root._glodSaveQueued) {
      root._glodSaveQueued = true;
      queueMicrotask(() => {
        root._glodSaveQueued = false;
        decorate(message, root).catch(() => {});
      });
    }
  }
}

export function wireSavePrompts() {
  Hooks.on("renderChatMessageHTML", onRender);
  const debounced = foundry.utils.debounce(refreshAll, TIMING.debounce);
  Hooks.on(KNOWLEDGE_HOOK, debounced);
  // The GM's savers are the selection; a player's only change with their character.
  Hooks.on("controlToken", () => {
    if (game.user.isGM) debounced();
  });
}
