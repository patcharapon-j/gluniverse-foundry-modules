/**
 * PF2e Odds — the read-only "Observed: AC 19–22 · Will DC ≥ 18" line in the
 * Creaturedex GM view.
 *
 * It attaches from the outside, on the `renderCreaturedexApp` hook Foundry
 * fires for every ApplicationV2 subclass by class name, and reads the entry's
 * kind off the render context (`detail.key`) the dex already prepares. Nothing
 * in the dex is edited and nothing is written to it: the dex pins "the reveal
 * is the GM's click, no roll hook", and an observed range is not a reveal — it
 * is printed beside the stat block, outside every section, in this feature's
 * own class prefix, for the GM only.
 *
 * A ledger change re-renders an open dex so the line keeps up; a render is a
 * read, so that does not touch the dex's own store either.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { SETTINGS } from "./constants.mjs";
import { PARTY, readKind, contradicted } from "./ledger-model.mjs";
import { partyCharacterIds, partyMode, readLedger } from "./knowledge.mjs";
import { compareStats, rangeText, statLabel } from "./observations-app.mjs";

const DEX_APP_ID = "gldex-app";
const HINT_CLASS = "glod-dexhint";
/** Where the line goes: beside Defense, or the hazard's equivalent, else under the header. */
const ANCHORS = ['.gldex-section[data-section="defense"]', '.gldex-section[data-section="disable"]'];

let wired = false;

const L = (key, fallback) => {
  const s = game.i18n.localize(key);
  return s === key ? (fallback ?? key) : s;
};

/** What the players, taken together, have observed about one kind. */
function observed(kind) {
  const ledger = readLedger();
  if (!ledger?.[kind]) return [];
  const owners = partyMode() ? [PARTY] : partyCharacterIds();
  const known = readKind(ledger, kind, owners);
  return Object.keys(known)
    .filter((stat) => known[stat])
    .sort(compareStats)
    .map((stat) => ({
      stat,
      text: `${statLabel(stat)} ${rangeText(storeOpen(known[stat]), stat)}`,
      reset: contradicted(ledger, kind, stat),
    }));
}

/** readKind hands back ±Infinity for open ends; rangeText reads the stored (null) form. */
const storeOpen = (r) => ({ lo: Number.isFinite(r?.lo) ? r.lo : null, hi: Number.isFinite(r?.hi) ? r.hi : null });

function hintHTML(rows) {
  const resetTitle = escapeHTML(L("GLOD.dexHint.resetHint", "Reset by a contradicting roll"));
  const items = rows
    .map(
      (r) =>
        `<span class="${HINT_CLASS}-stat${r.reset ? " is-reset" : ""}"${r.reset ? ` title="${resetTitle}"` : ""}>` +
        `${escapeHTML(r.text)}${r.reset ? ' <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' : ""}</span>`
    )
    .join(`<span class="${HINT_CLASS}-sep" aria-hidden="true">·</span>`);
  return (
    `<span class="${HINT_CLASS}-label" title="${escapeHTML(L("GLOD.dexHint.title", "What the party has seen at the table — never written to the dex"))}">` +
    `<i class="fa-solid fa-binoculars" aria-hidden="true"></i> ${escapeHTML(L("GLOD.dexHint.label", "Observed"))}</span>` +
    `<span class="${HINT_CLASS}-stats">${items}</span>`
  );
}

function onRender(app, element, context) {
  if (!game.user?.isGM) return;
  const root = element instanceof HTMLElement ? element : app?.element;
  if (!root) return;
  root.querySelectorAll(`.${HINT_CLASS}`).forEach((el) => el.remove());

  const kind = context?.detail?.key ?? root.querySelector(".gldex-forget[data-key]")?.dataset?.key ?? null;
  if (!kind) return;
  const rows = observed(kind);
  if (!rows.length) return;

  const hint = document.createElement("p");
  hint.className = HINT_CLASS;
  hint.innerHTML = hintHTML(rows);

  const anchor = ANCHORS.map((s) => root.querySelector(s)).find(Boolean);
  if (anchor) anchor.after(hint);
  else root.querySelector(".gldex-detail-head")?.after(hint);
}

/** Wire once, from the feature's onReady. Idempotent. */
export function wireDexHint() {
  if (wired) return;
  wired = true;
  Hooks.on("renderCreaturedexApp", onRender);
  Hooks.on("updateSetting", (setting) => {
    if (!game.user?.isGM) return;
    if (String(setting?.key ?? "") !== `${SUITE_ID}.${SETTINGS.ledger}`) return;
    const app = foundry.applications.instances?.get?.(DEX_APP_ID);
    if (app?.rendered) app.render();
  });
}
