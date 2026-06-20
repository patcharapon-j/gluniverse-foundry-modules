/**
 * GLUniverse Suite — Control Center.
 *
 * A premium etched-glass ApplicationV2 that is the single, grouped surface for
 * the whole suite. Every feature is a section: an enable toggle (or "Core" chip,
 * or a lock chip when a required system/module/feature is missing), the feature's
 * own settings rendered inline as controls, and buttons that open its specialized
 * editors. It replaces Foundry's flat native settings list (see catalog.mjs).
 *
 * Built without a Handlebars template so it stays self-contained, and it never
 * re-renders on interaction — controls mutate the DOM in place so the entrance
 * animation plays exactly once.
 */

import { SUITE_ID } from "./const.mjs";
import { Suite } from "./registry.mjs";
import { catalogFor } from "./catalog.mjs";

const { ApplicationV2 } = foundry.applications.api;

const T = (k, fallback) => {
  if (!k) return fallback ?? "";
  const s = game.i18n.localize(k);
  return s === k ? fallback ?? k : s;
};

const getSetting = (key) => {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return undefined;
  }
};

export class SuiteConfigApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "gls-control-center",
    classes: ["gls-scope", "gls-control-center"],
    tag: "div",
    window: {
      title: "GLS.config.title",
      icon: "fa-solid fa-sliders",
      resizable: true,
    },
    position: { width: 640, height: "auto" },
    actions: {
      toggle: SuiteConfigApp._onToggle,
      settingToggle: SuiteConfigApp._onSettingToggle,
      editor: SuiteConfigApp._onEditor,
      reload: SuiteConfigApp._onReload,
    },
  };

  /** key → menu App class, populated during render so editor buttons can open. */
  #editors = new Map();
  /** True once the user flips an enable toggle that only applies on reload. */
  #needsReload = false;

  async _prepareContext() {
    return { features: Suite.all() };
  }

  /* ----------------------------- control builders ----------------------------- */

  #settingControl(s) {
    const value = getSetting(s.key);
    const worldLocked = s.scope === "world" && !game.user?.isGM;

    if (s.control === "boolean") {
      const on = !!value;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gls-switch gls-switch-sm" + (on ? " is-on" : "");
      btn.dataset.action = "settingToggle";
      btn.dataset.setting = s.key;
      btn.setAttribute("aria-pressed", String(on));
      btn.disabled = worldLocked;
      btn.innerHTML = `<span class="gls-switch-track"><span class="gls-switch-thumb"></span></span>`;
      return btn;
    }

    if (s.control === "select") {
      const sel = document.createElement("select");
      sel.className = "gls-input gls-select";
      sel.dataset.setting = s.key;
      sel.dataset.control = "select";
      sel.disabled = worldLocked;
      for (const [val, label] of Object.entries(s.choices ?? {})) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = T(label, label);
        if (String(value) === val) opt.selected = true;
        sel.appendChild(opt);
      }
      return sel;
    }

    if (s.control === "range") {
      const r = s.range ?? {};
      const wrap = document.createElement("div");
      wrap.className = "gls-range";
      const input = document.createElement("input");
      input.type = "range";
      input.className = "gls-input";
      input.dataset.setting = s.key;
      input.dataset.control = "number";
      if (r.min != null) input.min = r.min;
      if (r.max != null) input.max = r.max;
      if (r.step != null) input.step = r.step;
      input.value = Number(value ?? r.min ?? 0);
      input.disabled = worldLocked;
      const out = document.createElement("span");
      out.className = "gls-range-val";
      out.textContent = input.value;
      input.addEventListener("input", () => (out.textContent = input.value));
      wrap.append(input, out);
      return wrap;
    }

    const input = document.createElement("input");
    input.type = s.control === "number" ? "number" : "text";
    input.className = "gls-input";
    input.dataset.setting = s.key;
    input.dataset.control = s.control;
    input.value = value ?? "";
    input.disabled = worldLocked;
    return input;
  }

  #settingRow(s) {
    const row = document.createElement("div");
    row.className = "gls-set-row";
    const meta = document.createElement("div");
    meta.className = "gls-set-meta";
    meta.innerHTML = `<div class="gls-set-name">${T(s.name, s.key)}</div>${
      s.hint ? `<div class="gls-set-hint">${T(s.hint, "")}</div>` : ""
    }`;
    const ctl = document.createElement("div");
    ctl.className = "gls-set-ctl";
    ctl.appendChild(this.#settingControl(s));
    row.append(meta, ctl);
    return row;
  }

  #editorButton(m) {
    if (m.type) this.#editors.set(m.key, m.type);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gls-btn gls-editor-btn";
    btn.dataset.action = "editor";
    btn.dataset.key = m.key;
    btn.innerHTML = `<i class="${m.icon}"></i> ${T(m.label, m.name)}`;
    return btn;
  }

  /* --------------------------------- render --------------------------------- */

  async _renderHTML() {
    this.#editors.clear();
    const wrap = document.createElement("div");
    wrap.className = "gls-fm-body";

    const intro = document.createElement("p");
    intro.className = "gls-fm-intro";
    intro.textContent = T(
      "GLS.config.intro",
      "Enable or disable each module and tune its settings here. Features that need a specific game system or companion feature unlock automatically when present."
    );
    wrap.appendChild(intro);

    const list = document.createElement("div");
    list.className = "gls-fm-list";

    for (const def of Suite.all()) {
      const available = Suite.available(def);
      const reason = Suite.unavailableReason(def);
      const on = def.core || (available && Suite._stored(def.id));
      const cat = catalogFor(def.id);
      const hasBody = available && (cat.settings.length || cat.menus.length);

      const section = document.createElement("div");
      section.className = "gls-fm-section gl-glass";
      section.dataset.feature = def.id;
      if (!available) section.classList.add("is-locked");
      if (on) section.classList.add("is-on");

      // -- header --
      const header = document.createElement("div");
      header.className = "gls-fm-row";
      header.innerHTML = `
        <div class="gls-fm-icon"><i class="${def.icon ?? "fa-solid fa-cube"}"></i></div>
        <div class="gls-fm-meta">
          <div class="gls-fm-name">${T(def.title, def.id)}</div>
          <div class="gls-fm-hint">${T(def.hint, "")}</div>
          ${reason ? `<div class="gls-fm-lock"><i class="fa-solid fa-lock"></i> ${reason}</div>` : ""}
        </div>
        <div class="gls-fm-ctl"></div>`;

      const ctl = header.querySelector(".gls-fm-ctl");
      if (def.core) {
        const chip = document.createElement("span");
        chip.className = "gls-fm-corechip";
        chip.textContent = T("GLS.config.core", "Core");
        ctl.appendChild(chip);
      } else {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "gls-switch" + (on ? " is-on" : "");
        sw.dataset.action = "toggle";
        sw.dataset.feature = def.id;
        sw.setAttribute("aria-pressed", String(on));
        sw.disabled = !available;
        sw.innerHTML = `<span class="gls-switch-track"><span class="gls-switch-thumb"></span></span>`;
        ctl.appendChild(sw);
      }
      section.appendChild(header);

      // -- body (settings + editors) --
      if (hasBody) {
        const body = document.createElement("div");
        body.className = "gls-sec-body";
        for (const s of cat.settings) body.appendChild(this.#settingRow(s));
        if (cat.menus.length) {
          const eds = document.createElement("div");
          eds.className = "gls-editor-row";
          for (const m of cat.menus) eds.appendChild(this.#editorButton(m));
          body.appendChild(eds);
        }
        section.appendChild(body);
      }

      list.appendChild(section);
    }

    wrap.appendChild(list);

    const foot = document.createElement("div");
    foot.className = "gls-fm-foot";
    foot.innerHTML = `
      <span class="gls-fm-note">${T(
        "GLS.config.reloadNote",
        "Settings apply instantly. Enabling or disabling a feature applies after a reload."
      )}</span>
      <button type="button" class="gls-btn gls-btn-accent" data-action="reload">
        <i class="fa-solid fa-rotate"></i> ${T("GLS.config.saveReload", "Save & Reload")}
      </button>`;
    wrap.appendChild(foot);

    return wrap;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  /** Wire change listeners for inline settings controls (selects/inputs). */
  _onRender(context, options) {
    const root = this.element;
    if (!root) return;
    root.querySelectorAll("[data-setting][data-control]").forEach((el) => {
      el.onchange = SuiteConfigApp.#onSettingChange.bind(this);
    });
  }

  /* -------------------------------- handlers -------------------------------- */

  static async _onToggle(event, target) {
    const id = target.dataset.feature;
    if (!id) return;
    const def = Suite.get(id);
    if (!def || def.core || !Suite.available(def)) return;
    const current = Suite._stored(id);
    const next = !current;
    await Suite.setEnabled(id, next);
    // Update the switch + section in place; no re-render, so animations don't replay.
    target.classList.toggle("is-on", next);
    target.setAttribute("aria-pressed", String(next));
    target.closest(".gls-fm-section")?.classList.toggle("is-on", next);
    if (!Suite.appliesLive(id)) {
      this.#needsReload = true;
      this.element?.classList.add("gls-needs-reload");
    }
  }

  static async _onSettingToggle(event, target) {
    const key = target.dataset.setting;
    if (!key || target.disabled) return;
    const next = target.getAttribute("aria-pressed") !== "true";
    try {
      await game.settings.set(SUITE_ID, key, next);
    } catch (e) {
      return ui.notifications?.error(`Could not update setting: ${e.message}`);
    }
    target.classList.toggle("is-on", next);
    target.setAttribute("aria-pressed", String(next));
  }

  static async #onSettingChange(event) {
    const el = event.currentTarget;
    const key = el.dataset.setting;
    if (!key) return;
    const raw = el.value;
    const value = el.dataset.control === "number" ? Number(raw) : raw;
    try {
      await game.settings.set(SUITE_ID, key, value);
    } catch (e) {
      ui.notifications?.error(`Could not update setting: ${e.message}`);
    }
  }

  static _onEditor(event, target) {
    const key = target.dataset.key;
    const Type = this.#editors.get(key);
    if (!Type) return;
    try {
      new Type().render(true);
    } catch (e) {
      ui.notifications?.error(`Could not open editor: ${e.message}`);
    }
  }

  static async _onReload() {
    foundry.utils.debounce(() => window.location.reload(), 50)();
  }
}
