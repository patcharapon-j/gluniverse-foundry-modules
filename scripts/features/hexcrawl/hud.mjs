/**
 * Hexcrawl — token HUD buttons (GM, hexcrawl scenes only).
 *
 *   Party token   — toggles flags[SUITE_ID].hex.party = { on, sight }.
 *                   Right-click edits the sight override (blank = scene default).
 *   Undo move     — rewinds the scene's last recorded move, when it was this
 *                   token's (movement.mjs undoLastMove).
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { FLAGS } from "./constants.mjs";
import { L, F } from "./labels.mjs";
import { isParty, partyFlag } from "./party.mjs";
import { lastMove, undoLastMove } from "./movement.mjs";
import { isHexcrawlScene, readMap } from "./store.mjs";

function button({ cls, icon, label, active = false, disabled = false }) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `control-icon glhex-hud ${cls}${active ? " active" : ""}`;
  b.dataset.tooltip = label;
  b.setAttribute("aria-label", label);
  if (disabled) b.disabled = true;
  b.innerHTML = `<i class="${icon}"></i>`;
  return b;
}

async function promptSight(doc) {
  const { DialogV2 } = foundry.applications.api;
  const map = readMap(doc.parent);
  const cur = partyFlag(doc)?.sight;
  const content = `<div class="glhex-sight-dialog gl-type"><label>${escapeHTML(L("GLHEX.hud.sightLabel"))}
    <input type="number" name="sight" min="0" max="6" step="1" value="${cur ?? ""}" placeholder="${map.config.sight}"></label>
    <p class="hint">${escapeHTML(F("GLHEX.hud.sightHint", { n: map.config.sight }))}</p></div>`;
  const value = await DialogV2.prompt({
    window: { title: L("GLHEX.hud.sightTitle") },
    classes: ["glhex-dialog"],
    content,
    ok: { label: L("GLHEX.hud.save"), callback: (_ev, btn) => btn.form.elements.sight.value },
    rejectClose: false,
  }).catch(() => null);
  if (value === null || value === undefined) return;
  const sight = String(value).trim() === "" ? null : Math.max(0, Math.min(6, Math.round(Number(value) || 0)));
  await doc.setFlag(SUITE_ID, FLAGS.party, { on: true, sight });
}

export function onRenderTokenHUD(hud, html) {
  try {
    if (!game.user.isGM) return;
    const doc = hud?.document ?? hud?.object?.document;
    const scene = doc?.parent;
    if (!doc || !isHexcrawlScene(scene)) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const column = root?.querySelector(".col.right") ?? root?.querySelector(".col.left");
    if (!column || column.querySelector(".glhex-hud")) return;

    const on = isParty(doc);
    const party = button({
      cls: "glhex-hud-party", icon: "fa-solid fa-person-hiking", active: on,
      label: L(on ? "GLHEX.hud.partyOff" : "GLHEX.hud.partyOn"),
    });
    party.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const f = partyFlag(doc);
      await doc.setFlag(SUITE_ID, FLAGS.party, { on: !f?.on, sight: f?.sight ?? null });
      if (hud.rendered) hud.render();
    });
    party.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      promptSight(doc).catch((e) => warn("hexcrawl | sight prompt failed", e));
    });
    column.append(party);

    if (on) {
      const last = lastMove(scene);
      const mine = last?.token === doc.id;
      const undo = button({
        cls: "glhex-hud-undo", icon: "fa-solid fa-clock-rotate-left", disabled: !mine,
        label: mine ? L("GLHEX.hud.undoMove") : L("GLHEX.hud.noMove"),
      });
      undo.addEventListener("click", async (ev) => {
        ev.preventDefault();
        undo.disabled = true;
        const ok = await undoLastMove(scene).catch((e) => { warn("hexcrawl | undo move failed", e); return false; });
        if (ok) ui.notifications.info(L("GLHEX.notify.moveUndone"));
        if (hud.rendered) hud.render();
      });
      column.append(undo);
    }
  } catch (e) {
    warn("hexcrawl | token HUD injection failed", e);
  }
}
