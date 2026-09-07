/**
 * GLUniverse Suite — the stability chip.
 *
 * Renders into the `[data-stability]` cell the time-tracker HUD offers, and into
 * its own small floating panel when that HUD is not running. The feature
 * deliberately does NOT declare `requiresFeature: "clocks-tracker"`: a PF2e
 * spellcasting subsystem that stops working because somebody turned off the
 * calendar would be a surprising way to lose it.
 *
 * The chip is also where the instability itself is DRAWN — glass cracking out
 * of the label that names it, spreading further the worse the level gets. See
 * `cracks.mjs` for why that is here rather than over the board.
 *
 * The chip is a readout, not a control panel. Steady the Spell and Invite the
 * Surge live on the character sheet's spellcasting tab, where a player is
 * already looking when they choose a spell — see `sheet.mjs`.
 *
 * A GM clicking the chip gets a level picker: four names, nothing else. The
 * descriptions that used to sit under them made the popover taller than the HUD
 * and told a GM what they already know — this is a switch that gets thrown mid
 * -sentence, not documentation. The prose still exists, on the chip's tooltip.
 *
 * Changing the level says nothing in chat: the cracks spread and the chip
 * flashes, and the party notices the world getting worse rather than being told.
 * A line reading "Stability: Unraveling" is a stat readout, which is the
 * opposite of the point.
 */

import { escapeHTML } from "../../core/util.mjs";
import { LEVELS } from "./constants.mjs";
import { currentLevel, isConcealed, levelHint, levelLabel, setLevel, visibleLevel } from "./settings.mjs";
import { syncCracks } from "./cracks.mjs";

const SLOT_SELECTOR = "[data-stability]";
const STANDALONE_ID = "glas-standalone";

let lastPainted = null;

export function registerHud() {
  // The time HUD re-renders often (clock ticks, collapse, scene change) and
  // rebuilds its own DOM each time, so the chip is repainted after every render
  // rather than mounted once.
  Hooks.on("renderGlctHud", () => paint());
  Hooks.on("canvasReady", () => paint());
}

/** Where the chip goes: the HUD's slot, or our own panel. */
function resolveHost() {
  const slot = document.querySelector(`#glct-hud ${SLOT_SELECTOR}`);
  if (slot) {
    document.getElementById(STANDALONE_ID)?.remove();
    return slot;
  }
  let standalone = document.getElementById(STANDALONE_ID);
  if (!standalone) {
    standalone = document.createElement("div");
    standalone.id = STANDALONE_ID;
    standalone.className = "glas-standalone gl-type";
    document.body.appendChild(standalone);
  }
  return standalone;
}

export function paint() {
  const level = visibleLevel();
  const host = resolveHost();
  if (!host) return;

  // Concealed and not a GM: no chip at all. The mechanics keep running
  // underneath — a surge still fires — the party simply has not noticed yet.
  if (isConcealed() && !game.user.isGM) {
    host.innerHTML = "";
    lastPainted = null;
    // Still synced, not skipped: this is the path a GM takes when they conceal
    // the level mid-session, and the cracks have to close on every screen.
    syncCracks();
    return;
  }

  const changed = lastPainted !== null && lastPainted !== level;
  host.innerHTML = render(level, changed);
  wire(host);
  lastPainted = level;

  /* The HUD rebuilds its own DOM on every clock tick, so the crack canvas is
     re-parented into the chip that was just painted rather than recreated. The
     context — and the program compiled into it at load — survives that. */
  syncCracks(host.querySelector(".glas-stability"));
}

function render(level, flash) {
  const classes = [
    "glas-chip",
    `glas-level-${level}`,
    game.user.isGM ? "glas-clickable" : "",
    flash ? "glas-flash" : "",
  ].filter(Boolean).join(" ");

  const hint = game.user.isGM ? game.i18n.localize("GLAS.hud.gmHint") : levelHint(level);

  return `<div class="glas-stability">
    <button type="button" class="${classes}" data-glas-chip
            title="${escapeHTML(hint)}" aria-label="${escapeHTML(levelLabel(level))}">
      <span class="glas-chip-mark" aria-hidden="true"></span>
      <span class="glas-chip-level">${escapeHTML(levelLabel(level))}</span>
      ${isConcealed() ? `<span class="glas-chip-conceal" title="${escapeHTML(game.i18n.localize("GLAS.hud.concealed"))}"><i class="fa-solid fa-eye-slash"></i></span>` : ""}
    </button>
  </div>`;
}

function wire(host) {
  const chip = host.querySelector("[data-glas-chip]");
  if (chip && game.user.isGM) chip.addEventListener("click", (event) => openPicker(event.currentTarget));
}

/* ══════════════════════════════════════════════════════════════════════
   The GM's level picker
   ══════════════════════════════════════════════════════════════════════ */

function openPicker(anchor) {
  document.querySelector(".glas-picker")?.remove();

  const picker = document.createElement("div");
  picker.className = "glas-picker gl-type";
  /* Name and marker only. The description belongs on the hover, not in the
     list: four paragraphs made the popover taller than the HUD it hangs off,
     and a GM throwing this switch mid-sentence is not reading them. */
  picker.innerHTML = LEVELS.map((level) => `
    <button type="button" class="glas-picker-row ${level === currentLevel() ? "is-current" : ""}"
            data-level="${level}" title="${escapeHTML(levelHint(level))}">
      <span class="glas-picker-mark glas-level-${level}" aria-hidden="true"></span>
      <span class="glas-picker-name">${escapeHTML(levelLabel(level))}</span>
    </button>`).join("");

  document.body.appendChild(picker);
  position(picker, anchor);

  for (const row of picker.querySelectorAll("[data-level]")) {
    row.addEventListener("click", async () => {
      await setLevel(row.dataset.level);
      picker.remove();
    });
  }

  // Close on the next click anywhere else, or on Escape. Registered on the next
  // tick so the click that opened it does not immediately close it again.
  setTimeout(() => {
    const close = (event) => {
      if (event.type === "click" && picker.contains(event.target)) return;
      if (event.type === "keydown" && event.key !== "Escape") return;
      picker.remove();
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
  }, 0);
}

/**
 * Place the popover under its anchor, kept inside the viewport.
 *
 * The chip lives in a HUD the user can drag anywhere, including hard against
 * the right edge or low enough that a downward popover would open off-screen.
 * Measuring after mount and flipping is the only way to be sure — the previous
 * version pinned it to the anchor's bottom-left unconditionally and ran off the
 * screen whenever the HUD was not near the top-left.
 */
function position(picker, anchor) {
  const box = anchor.getBoundingClientRect();
  const size = picker.getBoundingClientRect();
  const margin = 8;

  let left = box.left;
  if (left + size.width > window.innerWidth - margin) left = window.innerWidth - size.width - margin;
  if (left < margin) left = margin;

  let top = box.bottom + margin;
  if (top + size.height > window.innerHeight - margin) {
    const above = box.top - size.height - margin;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - size.height - margin);
  }

  picker.style.left = `${Math.round(left)}px`;
  picker.style.top = `${Math.round(top)}px`;
}

/** Called from the level setting's onChange, on every client. */
export function onLevelChanged() {
  // `paint()` re-attaches and re-syncs the cracks, so the level's new colour
  // and reach arrive with the label that names it rather than a frame later.
  paint();
}

export function destroyHud() {
  document.getElementById(STANDALONE_ID)?.remove();
  document.querySelector(".glas-picker")?.remove();
  lastPainted = null;
}
