/**
 * GLUniverse Suite — Steady the Spell / Invite the Surge, on the sheet.
 *
 * These are declarations a caster makes BEFORE committing a spell, so they have
 * to be reachable in the two seconds before the click that casts it — and
 * visibly armed, or a player will forget they set one. The spellcasting tab is
 * where somebody already is when they pick a spell, so that is where the choice
 * belongs; a control anywhere else is one the table stops using by session four.
 *
 * The bar renders only where it can mean something: on a character sheet, for a
 * user who owns that actor, while the world is actually unstable. At Stable
 * there is nothing to steady and nothing to invite, and an always-present pair
 * of dead buttons would train people to ignore them.
 */

import { escapeHTML } from "../../core/util.mjs";
import { ARM_MODES, armedMode, currentLevel, levelLabel, modeLabel, setArmedMode, visibleLevel } from "./settings.mjs";
import { levelConfig, isConcealed } from "./settings.mjs";
import { resolveExposure } from "./levels.mjs";

/** Where the bar is injected, in preference order. PF2e's own sheet markup has
 *  changed shape across releases, so this falls back rather than vanishing. */
const SPELL_TAB_SELECTORS = [
  ".tab[data-tab='spellcasting'] .spellcasting-entry-list",
  ".tab[data-tab='spellcasting'] .directory-list",
  ".tab[data-tab='spellcasting'] .inventory-list",
  ".tab[data-tab='spellcasting']",
];

export function registerSheet() {
  // Both hook names are wired: PF2e sheets are ApplicationV2 on current
  // releases and V1 on older ones, and the two fire different hooks.
  Hooks.on("renderCharacterSheetPF2e", onRenderSheet);
  Hooks.on("renderActorSheetPF2e", onRenderSheet);
}

function onRenderSheet(app, html) {
  try {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
    const actor = app?.actor ?? app?.document ?? null;
    if (!root || !actor?.isOwner || actor.type !== "character") return;

    root.querySelectorAll(".glas-arm-bar").forEach((node) => node.remove());

    // Concealed: the player has not been told the world is unstable, so the
    // controls that only exist because it is unstable stay hidden too.
    if (isConcealed() && !game.user.isGM) return;
    if (visibleLevel() === "stable") return;

    const host = SPELL_TAB_SELECTORS.map((sel) => root.querySelector(sel)).find(Boolean);
    if (!host) return;

    host.insertAdjacentHTML("beforebegin", render(actor));
    wire(root, actor);
  } catch {
    /* A sheet that changed shape must never break the sheet itself. */
  }
}

function render(actor) {
  const mode = armedMode(actor.id);
  const level = currentLevel();
  const config = levelConfig();

  /* Show what each choice actually buys, resolved through the real rules rather
     than described in prose: the effective level a steadied cast would use, and
     the row an invited one would be read against. A player choosing between them
     should not have to hold the ladder in their head. */
  const steadied = resolveExposure(level, "steadied", config);
  const invited = resolveExposure(level, "invited", config);

  const button = (id, icon, detail) => {
    const on = mode === id;
    return `<button type="button" class="glas-arm-btn ${on ? "is-armed" : ""}" data-glas-arm="${id}"
              aria-pressed="${on}" title="${escapeHTML(game.i18n.localize(`GLAS.hud.arm.${id}`))}">
      <i class="fa-solid ${icon}" aria-hidden="true"></i>
      <span class="glas-arm-name">${escapeHTML(modeLabel(id))}</span>
      <span class="glas-arm-detail">${escapeHTML(detail)}</span>
    </button>`;
  };

  const steadyDetail = steadied.rollsDie
    ? game.i18n.format("GLAS.sheet.steadyTo", { level: levelLabel(steadied.effective), threshold: steadied.threshold })
    : game.i18n.localize("GLAS.sheet.steadyToStable");

  return `<section class="glas-arm-bar gl-type glas-level-${level}">
    <header class="glas-arm-head">
      <span class="glas-arm-kicker">${escapeHTML(game.i18n.localize("GLAS.hud.armLabel"))}</span>
      <span class="glas-arm-level">${escapeHTML(levelLabel(level))}</span>
    </header>
    <div class="glas-arm-row">
      ${button("steadied", "fa-hand-holding-magic", steadyDetail)}
      ${button("invited", "fa-bolt", game.i18n.format("GLAS.sheet.inviteTo", { row: escapeHTML(game.i18n.localize(`GLAS.row.${invited.row}`)) }))}
    </div>
    <p class="glas-arm-note">${escapeHTML(game.i18n.localize("GLAS.sheet.note"))}</p>
  </section>`;
}

function wire(root, actor) {
  for (const button of root.querySelectorAll(".glas-arm-bar [data-glas-arm]")) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const wanted = button.dataset.glasArm;
      if (!ARM_MODES.includes(wanted)) return;
      // Pressing the armed mode again disarms it. The two can never stack, so
      // arming one always replaces the other.
      const next = armedMode(actor.id) === wanted ? "none" : wanted;
      await setArmedMode(next, actor.id);
      // Repaint in place rather than re-rendering the whole sheet, which would
      // scroll the player back to the top of a long spell list mid-decision.
      for (const other of root.querySelectorAll(".glas-arm-bar [data-glas-arm]")) {
        const on = other.dataset.glasArm === next;
        other.classList.toggle("is-armed", on);
        other.setAttribute("aria-pressed", String(on));
      }
    });
  }
}
