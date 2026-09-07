/**
 * GLUniverse Suite — the stability chip and the arm control.
 *
 * The chip renders into a `[data-stability]` slot in the time-tracker HUD when
 * that feature is running, and into its own small floating panel when it is not.
 * The feature deliberately does NOT declare `requiresFeature: "clocks-tracker"`:
 * a PF2e spellcasting subsystem that stops working because somebody turned off
 * the calendar would be a surprising way to lose it.
 *
 * The arm control sits immediately beside the chip, so the thing you arm is in
 * the same glance as the thing that makes you want to arm it. It is disabled
 * while Stable, because the draft is explicit that inviting is only possible
 * where actual instability exists.
 *
 * A GM clicking the chip gets a level picker. Changing the level says nothing in
 * chat — the overlay cross-fades and the chip flashes, and the party notices the
 * world getting worse rather than being told. A chat line reading
 * "Stability: Unraveling" is a stat readout, which is the opposite of the point.
 */

import { escapeHTML } from "../../core/util.mjs";
import { LEVELS } from "./constants.mjs";
import { armedMode, currentLevel, isConcealed, levelHint, levelLabel, modeLabel, setArmedMode, setLevel, visibleLevel } from "./settings.mjs";
import { syncAmbient } from "./ambient.mjs";

const SLOT_SELECTOR = "[data-stability]";
const STANDALONE_ID = "glas-standalone";

let lastPainted = null;

/* ══════════════════════════════════════════════════════════════════════
   Mounting
   ══════════════════════════════════════════════════════════════════════ */

export function registerHud() {
  // The time HUD re-renders often (clock ticks, collapse, scene change) and
  // wipes its own DOM each time, so the chip is repainted after every render
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
  const mode = armedMode();
  const host = resolveHost();
  if (!host) return;

  // Concealed and not a GM: no chip at all. The mechanics keep running
  // underneath — a surge still fires — the party simply has not noticed yet.
  if (isConcealed() && !game.user.isGM) {
    host.innerHTML = "";
    lastPainted = null;
    return;
  }

  const changed = lastPainted !== null && lastPainted !== level;
  host.innerHTML = render(level, mode, changed);
  wire(host);
  lastPainted = level;
}

function render(level, mode, flash) {
  const canArm = level !== "stable";
  const classes = ["glas-chip", `glas-level-${level}`, flash ? "glas-flash" : ""].filter(Boolean).join(" ");
  const gmHint = game.user.isGM ? game.i18n.localize("GLAS.hud.gmHint") : levelHint(level);

  const arm = canArm
    ? `<span class="glas-arm" role="group" aria-label="${escapeHTML(game.i18n.localize("GLAS.hud.armLabel"))}">
        ${armButton("steadied", mode)}
        ${armButton("invited", mode)}
      </span>`
    : "";

  return `<div class="glas-stability">
    <button type="button" class="${classes}" data-glas-chip
            title="${escapeHTML(gmHint)}" aria-label="${escapeHTML(levelLabel(level))}">
      <span class="glas-chip-mark" aria-hidden="true"></span>
      <span class="glas-chip-text">
        <span class="glas-chip-kicker">${escapeHTML(game.i18n.localize("GLAS.hud.kicker"))}</span>
        <span class="glas-chip-level">${escapeHTML(levelLabel(level))}</span>
      </span>
      ${isConcealed() ? `<span class="glas-chip-conceal" title="${escapeHTML(game.i18n.localize("GLAS.hud.concealed"))}"><i class="fa-solid fa-eye-slash"></i></span>` : ""}
    </button>
    ${arm}
  </div>`;
}

function armButton(mode, active) {
  const on = active === mode;
  const icon = mode === "steadied" ? "fa-hand-holding-magic" : "fa-bolt";
  return `<button type="button" class="glas-arm-btn ${on ? "is-armed" : ""}" data-glas-arm="${mode}"
          title="${escapeHTML(game.i18n.localize(`GLAS.hud.arm.${mode}`))}"
          aria-pressed="${on}">
    <i class="fa-solid ${icon}" aria-hidden="true"></i>
    <span class="glas-arm-label">${escapeHTML(modeLabel(mode))}</span>
  </button>`;
}

function wire(host) {
  const chip = host.querySelector("[data-glas-chip]");
  if (chip && game.user.isGM) chip.addEventListener("click", (event) => openPicker(event.currentTarget));

  for (const button of host.querySelectorAll("[data-glas-arm]")) {
    button.addEventListener("click", async () => {
      const wanted = button.dataset.glasArm;
      // Pressing the armed mode again disarms it; the two modes cannot stack, so
      // arming one always replaces the other.
      await setArmedMode(armedMode() === wanted ? "none" : wanted);
      paint();
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   The GM's level picker
   ══════════════════════════════════════════════════════════════════════ */

function openPicker(anchor) {
  document.querySelector(".glas-picker")?.remove();

  const picker = document.createElement("div");
  picker.className = "glas-picker gl-type";
  picker.innerHTML = LEVELS.map((level) => `
    <button type="button" class="glas-picker-row ${level === currentLevel() ? "is-current" : ""}" data-level="${level}">
      <span class="glas-picker-mark glas-level-${level}" aria-hidden="true"></span>
      <span class="glas-picker-text">
        <span class="glas-picker-name">${escapeHTML(levelLabel(level))}</span>
        <span class="glas-picker-hint">${escapeHTML(levelHint(level))}</span>
      </span>
    </button>`).join("");

  document.body.appendChild(picker);

  const box = anchor.getBoundingClientRect();
  picker.style.left = `${Math.round(box.left)}px`;
  picker.style.top = `${Math.round(box.bottom + 8)}px`;

  for (const row of picker.querySelectorAll("[data-level]")) {
    row.addEventListener("click", async () => {
      await setLevel(row.dataset.level);
      picker.remove();
    });
  }

  // Close on the next click anywhere else. Registered on the next tick so the
  // click that opened it does not immediately close it again.
  setTimeout(() => {
    const close = (event) => {
      if (picker.contains(event.target)) return;
      picker.remove();
      document.removeEventListener("click", close);
    };
    document.addEventListener("click", close);
  }, 0);
}

/** Called from the level setting's onChange, on every client. */
export function onLevelChanged() {
  paint();
  syncAmbient();
}

export function destroyHud() {
  document.getElementById(STANDALONE_ID)?.remove();
  document.querySelector(".glas-picker")?.remove();
  lastPainted = null;
}
