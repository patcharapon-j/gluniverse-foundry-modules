/**
 * GLUniverse Suite — Feature Manager.
 *
 * A premium etched-glass ApplicationV2 listing every feature in the suite with
 * a polished toggle. Unavailable features (missing system / dependency) render
 * locked with an explanatory chip. Built without a Handlebars template so it
 * has no external file dependency and stays self-contained.
 */

import { SUITE_ID, SUITE_TITLE } from "./const.mjs";
import { Suite } from "./registry.mjs";

const { ApplicationV2 } = foundry.applications.api;

const T = (k, fallback) => {
  const s = game.i18n.localize(k);
  return s === k ? fallback ?? k : s;
};

export class SuiteConfigApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "gls-feature-manager",
    classes: ["gls-scope", "gls-feature-manager"],
    tag: "div",
    window: {
      title: "GLS.config.title",
      icon: "fa-solid fa-sliders",
      resizable: true,
    },
    position: { width: 560, height: "auto" },
    actions: {
      toggle: SuiteConfigApp._onToggle,
      reload: SuiteConfigApp._onReload,
    },
  };

  /** Pending (unsaved) toggle state, keyed by feature id. */
  #pending = {};

  async _prepareContext() {
    return { features: Suite.all() };
  }

  async _renderHTML() {
    const features = Suite.all();
    const wrap = document.createElement("div");
    wrap.className = "gls-fm-body";

    const intro = document.createElement("p");
    intro.className = "gls-fm-intro";
    intro.textContent = T(
      "GLS.config.intro",
      "Enable or disable each module in the suite. Some features require a specific game system or companion module and unlock automatically when present."
    );
    wrap.appendChild(intro);

    const list = document.createElement("div");
    list.className = "gls-fm-list";

    for (const def of features) {
      const available = Suite.available(def);
      const reason = Suite.unavailableReason(def);
      const stored = def.id in this.#pending ? this.#pending[def.id] : Suite._stored(def.id);
      const on = def.core || (available && stored);

      const row = document.createElement("div");
      row.className = "gls-fm-row gl-glass";
      if (!available) row.classList.add("is-locked");
      if (on) row.classList.add("is-on");

      row.innerHTML = `
        <div class="gls-fm-icon"><i class="${def.icon ?? "fa-solid fa-cube"}"></i></div>
        <div class="gls-fm-meta">
          <div class="gls-fm-name">${T(def.title, def.id)}</div>
          <div class="gls-fm-hint">${T(def.hint, "")}</div>
          ${reason ? `<div class="gls-fm-lock"><i class="fa-solid fa-lock"></i> ${reason}</div>` : ""}
        </div>
        <div class="gls-fm-ctl"></div>`;

      const ctl = row.querySelector(".gls-fm-ctl");
      if (def.core) {
        const chip = document.createElement("span");
        chip.className = "gls-fm-corechip";
        chip.textContent = T("GLS.config.core", "Core");
        ctl.appendChild(chip);
      } else {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "gls-switch";
        sw.dataset.action = "toggle";
        sw.dataset.feature = def.id;
        sw.setAttribute("aria-pressed", String(on));
        sw.disabled = !available;
        if (on) sw.classList.add("is-on");
        sw.innerHTML = `<span class="gls-switch-track"><span class="gls-switch-thumb"></span></span>`;
        ctl.appendChild(sw);
      }
      list.appendChild(row);
    }

    wrap.appendChild(list);

    const foot = document.createElement("div");
    foot.className = "gls-fm-foot";
    foot.innerHTML = `
      <span class="gls-fm-note">${T("GLS.config.reloadNote", "Toggling a feature applies after a reload.")}</span>
      <button type="button" class="gls-btn gls-btn-accent" data-action="reload">
        <i class="fa-solid fa-rotate"></i> ${T("GLS.config.saveReload", "Save & Reload")}
      </button>`;
    wrap.appendChild(foot);

    return wrap;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  static async _onToggle(event, target) {
    const id = target.dataset.feature;
    if (!id) return;
    const def = Suite.get(id);
    if (!def || def.core || !Suite.available(def)) return;
    const current = id in this.#pending ? this.#pending[id] : Suite._stored(id);
    this.#pending[id] = !current;
    await Suite.setEnabled(id, !current);
    this.render();
  }

  static async _onReload() {
    foundry.utils.debounce(() => window.location.reload(), 50)();
  }
}
