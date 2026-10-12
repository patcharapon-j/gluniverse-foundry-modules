/**
 * GLUniverse Suite — Control Center.
 *
 * The single, grouped settings surface for the whole suite. Every feature is a
 * collapsible row: its enable checkbox (or a "Core" tag, or a lock when a
 * required system/module/feature is missing) sits on the summary line, and its
 * hint, settings and editor buttons sit behind it, collapsed by default. It
 * replaces Foundry's flat native settings list (see catalog.mjs).
 *
 * Deliberately unstyled: the markup is Foundry's own `.standard-form` /
 * `.form-group` vocabulary, built from the same DataFields the native Settings
 * sheet uses, so it reads exactly like core configuration. The only CSS is a
 * few layout rules in gl-tokens.css.
 *
 * Built without a Handlebars template, and it never re-renders on interaction —
 * controls mutate the DOM in place so open sections and scroll position survive.
 */

import { SUITE_ID } from "./const.mjs";
import { Suite } from "./registry.mjs";
import { catalogFor, SUITE_SECTION } from "./catalog.mjs";

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

const icon = (cls) => {
  const i = document.createElement("i");
  i.className = cls;
  i.inert = true;
  return i;
};

const hint = (text) => {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = text;
  return p;
};

export class SuiteConfigApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "gls-control-center",
    classes: ["gls-control-center"],
    tag: "div",
    window: {
      title: "GLS.config.title",
      icon: "fa-solid fa-sliders",
      resizable: true,
    },
    position: { width: 560, height: "auto" },
    actions: {
      editor: SuiteConfigApp._onEditor,
      reload: SuiteConfigApp._onReload,
    },
  };

  /** key → menu App class, populated during render so editor buttons can open. */
  #editors = new Map();
  /** key → catalog entry, so a change can be written back with the right type. */
  #settings = new Map();

  async _prepareContext() {
    return { features: Suite.all() };
  }

  /* ----------------------------- control builders ----------------------------- */

  /** The same DataField Foundry's own Settings sheet would build for `s`. */
  #field(s) {
    const f = foundry.data.fields;
    const r = s.range ?? {};
    switch (s.control) {
      case "boolean":
        return new f.BooleanField();
      case "range":
        return new f.NumberField({ required: true, nullable: false, min: r.min, max: r.max, step: r.step });
      case "number":
        return new f.NumberField({ required: true, nullable: false });
      case "select":
        return s.numeric
          ? new f.NumberField({ required: true, nullable: false, choices: s.choices })
          : new f.StringField({ required: true, choices: s.choices });
      default:
        return new f.StringField({ required: true });
    }
  }

  #settingRow(s) {
    this.#settings.set(s.key, s);
    const value = getSetting(s.key);
    return this.#field(s).toFormGroup(
      { label: T(s.name, s.key), hint: T(s.hint, ""), rootId: this.id },
      {
        name: s.key,
        value: s.control === "boolean" ? !!value : value,
        disabled: s.scope === "world" && !game.user?.isGM,
        localize: true,
      }
    );
  }

  /** An editor menu, drawn the way the native Settings sheet draws a submenu. */
  #editorRow(m) {
    if (m.type) this.#editors.set(m.key, m.type);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.action = "editor";
    btn.dataset.key = m.key;
    const label = document.createElement("span");
    label.textContent = T(m.label, m.name);
    btn.append(icon(m.icon), label);
    return foundry.applications.fields.createFormGroup({ label: T(m.name, m.key), hint: T(m.hint, ""), input: btn });
  }

  /** The suite-wide section (interface scale, etc.) — shown to everyone, open by
   *  default. Its client settings are per-user, so every user can edit them. */
  #suiteSection(cat) {
    const section = document.createElement("details");
    section.className = "gls-cc-item";
    section.open = true;
    const summary = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "gls-cc-name";
    name.textContent = T("GLS.config.suite.title", "GLUniverse Suite");
    summary.append(icon("gls-cc-caret fa-solid fa-chevron-right"), icon("fa-solid fa-gear"), name);
    const body = document.createElement("div");
    body.className = "gls-cc-body";
    body.append(hint(T("GLS.config.suite.hint", "Suite-wide preferences that apply to your screen only.")));
    for (const s of cat.settings) body.appendChild(this.#settingRow(s));
    section.append(summary, body);
    return section;
  }

  /** The lock line under a feature whose requirement is missing. */
  #lockLine(reason) {
    const p = hint("");
    p.className = "hint gls-cc-lock";
    p.append(icon("fa-solid fa-lock"), ` ${reason}`);
    return p;
  }

  /** One feature row. `isGM` gates the enable checkbox + editor buttons; the
   *  caller decides which settings/menus to pass (players get only their own
   *  per-client settings, no GM editors). */
  #featureSection(def, { isGM, on, available, reason, settings, menus }) {
    const section = document.createElement("details");
    section.className = "gls-cc-item";
    section.dataset.feature = def.id;
    section.classList.toggle("is-locked", !available);
    // Whether the feature could run when this window was built. A dependent that
    // only becomes available through a toggle here has not started this session,
    // so its settings and editors stay hidden until the reload.
    section.dataset.available = String(available);

    const summary = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "gls-cc-name";
    name.textContent = T(def.title, def.id);
    summary.append(icon("gls-cc-caret fa-solid fa-chevron-right"), icon(def.icon ?? "fa-solid fa-cube"), name);

    const lock = icon("gls-cc-lockicon fa-solid fa-lock");
    lock.hidden = !reason;
    summary.appendChild(lock);

    // Feature enablement is a world setting → only the GM gets the checkbox/tag.
    if (isGM) {
      if (def.core) {
        const tag = document.createElement("span");
        tag.className = "hint";
        tag.textContent = T("GLS.config.core", "Core");
        summary.appendChild(tag);
      } else {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.dataset.feature = def.id;
        box.checked = on;
        box.disabled = !available;
        box.setAttribute("aria-label", T(def.title, def.id));
        summary.appendChild(box);
      }
    }

    const body = document.createElement("div");
    body.className = "gls-cc-body";
    const featureHint = T(def.hint, "");
    if (featureHint) body.appendChild(hint(featureHint));
    if (reason) body.appendChild(this.#lockLine(reason));

    if (settings.length || menus.length) {
      // Settings belong to a running feature: hidden while it is off or locked.
      const fields = document.createElement("div");
      fields.className = "gls-cc-fields";
      fields.hidden = !(available && on);
      for (const s of settings) fields.appendChild(this.#settingRow(s));
      for (const m of menus) fields.appendChild(this.#editorRow(m));
      body.appendChild(fields);
    }

    section.append(summary, body);
    return section;
  }

  /* --------------------------------- render --------------------------------- */

  async _renderHTML() {
    this.#editors.clear();
    this.#settings.clear();
    const isGM = !!game.user?.isGM;
    const wrap = document.createElement("div");
    wrap.className = "standard-form gls-cc";

    wrap.appendChild(
      hint(
        isGM
          ? T(
              "GLS.config.intro",
              "Enable or disable each module and tune its settings here. Features that need a specific game system or companion feature unlock automatically when present."
            )
          : T(
              "GLS.config.introPlayer",
              "Personalize the GLUniverse Suite for your screen. These preferences affect only you — your GM controls which features are enabled."
            )
      )
    );

    const list = document.createElement("div");
    list.className = "gls-cc-list scrollable";

    // Suite-wide section (e.g. interface scale) above the feature list.
    const suite = catalogFor(SUITE_SECTION);
    // World-scoped suite settings (GM choices like icon-only header buttons)
    // are hidden from players — they couldn't save them anyway.
    const suiteSettings = isGM ? suite.settings : suite.settings.filter((s) => s.scope !== "world");
    if (suiteSettings.length) list.appendChild(this.#suiteSection({ ...suite, settings: suiteSettings }));

    for (const def of Suite.all()) {
      const available = Suite.available(def);
      const reason = Suite.unavailableReason(def);
      const on = def.core || (available && Suite._stored(def.id));
      const cat = catalogFor(def.id);

      if (!isGM) {
        // Players only see live features that expose a per-client setting they
        // can actually change — world settings and GM editors are omitted.
        if (!available || !on) continue;
        const mine = cat.settings.filter((s) => s.scope !== "world");
        if (!mine.length) continue;
        list.appendChild(this.#featureSection(def, { isGM, on, available, reason, settings: mine, menus: [] }));
        continue;
      }

      list.appendChild(
        this.#featureSection(def, { isGM, on, available, reason, settings: cat.settings, menus: cat.menus })
      );
    }

    wrap.appendChild(list);

    if (isGM) {
      wrap.appendChild(
        hint(T("GLS.config.reloadNote", "Settings apply instantly. Enabling or disabling a feature applies after a reload."))
      );
      const foot = document.createElement("footer");
      foot.className = "form-footer";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.action = "reload";
      btn.dataset.reload = "";
      const label = document.createElement("span");
      label.textContent = T("GLS.config.saveReload", "Save & Reload");
      btn.append(icon("fa-solid fa-rotate"), label);
      foot.appendChild(btn);
      wrap.appendChild(foot);
    } else {
      wrap.appendChild(
        hint(T("GLS.config.playerNote", "Your preferences save instantly and apply to your screen only."))
      );
    }

    return wrap;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  /** One delegated listener for every checkbox and inline setting control. The
   *  element outlives re-renders, so it is bound once. */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // A section opening grows an auto-height window downward; re-clamp it to
    // the viewport so the footer stays on screen. `toggle` does not bubble.
    this.element?.addEventListener("toggle", () => this.setPosition(), true);
    this.element?.addEventListener("change", (event) => {
      const el = event.target;
      if (el.dataset?.feature) return this.#onFeatureToggle(el);
      // Only the named control itself — a range-picker's inner inputs bubble
      // their own change events too.
      if (el.name && this.#settings.has(el.name)) return this.#onSettingChange(el);
    });
  }

  /* -------------------------------- handlers -------------------------------- */

  /** Show a feature's settings only while it is available and switched on. */
  #syncFields(section, on) {
    const fields = section.querySelector(".gls-cc-fields");
    if (fields) fields.hidden = !on;
  }

  /**
   * Re-sync the sections of every feature that gates on `id` via
   * `requiresFeature`. Their availability changes the instant the parent flips,
   * but the sections around it were built before it did — and this window never
   * re-renders, so a child left looking live is a checkbox whose next click the
   * guard in `#onFeatureToggle` refuses with nothing shown for it. Mirrors what
   * `#featureSection` would have drawn: the lock, and settings that an
   * unavailable feature is not offered at all.
   */
  #syncDependents(id) {
    const root = this.element;
    if (!root) return;
    for (const def of Suite.all()) {
      if (!Suite._list(def.requiresFeature).includes(id)) continue;
      const section = root.querySelector(`.gls-cc-item[data-feature="${CSS.escape(def.id)}"]`);
      if (!section) continue;

      const available = Suite.available(def);
      const on = available && Suite._stored(def.id);
      section.classList.toggle("is-locked", !available);

      const box = section.querySelector('summary input[type="checkbox"]');
      if (box) {
        box.disabled = !available;
        box.checked = on;
      }
      this.#syncFields(section, on && section.dataset.available === "true");

      const reason = Suite.unavailableReason(def);
      const lockIcon = section.querySelector(".gls-cc-lockicon");
      if (lockIcon) lockIcon.hidden = !reason;
      const lock = section.querySelector(".gls-cc-lock");
      if (!reason) lock?.remove();
      else if (lock) lock.replaceWith(this.#lockLine(reason));
      else {
        const body = section.querySelector(".gls-cc-body");
        body?.insertBefore(this.#lockLine(reason), body.querySelector(".gls-cc-fields"));
      }

      // A dependent may itself have dependents.
      this.#syncDependents(def.id);
    }
  }

  async #onFeatureToggle(box) {
    const id = box.dataset.feature;
    const def = Suite.get(id);
    if (!def || def.core || !Suite.available(def)) {
      box.checked = !box.checked;
      return;
    }
    const next = box.checked;
    try {
      await Suite.setEnabled(id, next);
    } catch (e) {
      box.checked = !next;
      return ui.notifications?.error(game.i18n.format("GLS.config.err.setSetting", { message: e.message }));
    }
    // Update in place; no re-render, so open sections stay open.
    const section = box.closest(".gls-cc-item");
    if (section) this.#syncFields(section, next);
    this.#syncDependents(id);
    // A feature that cannot switch live needs the reload: say so on the button.
    if (!Suite.appliesLive(id)) this.element?.querySelector("[data-reload]")?.classList.add("bright");
  }

  async #onSettingChange(el) {
    const s = this.#settings.get(el.name);
    if (!s || el.disabled) return;
    let value = el.value;
    if (s.control === "boolean") value = el.checked;
    else if (s.control === "number" || s.control === "range" || (s.control === "select" && s.numeric)) {
      value = Number(value);
    }
    try {
      await game.settings.set(SUITE_ID, s.key, value);
    } catch (e) {
      // Put the control back to what is actually stored.
      const stored = getSetting(s.key);
      if (s.control === "boolean") el.checked = !!stored;
      else el.value = stored ?? "";
      ui.notifications?.error(game.i18n.format("GLS.config.err.setSetting", { message: e.message }));
    }
  }

  static _onEditor(event, target) {
    const key = target.dataset.key;
    const Type = this.#editors.get(key);
    if (!Type) return;
    try {
      new Type().render(true);
    } catch (e) {
      ui.notifications?.error(game.i18n.format("GLS.config.err.openEditor", { message: e.message }));
    }
  }

  static async _onReload() {
    foundry.utils.debounce(() => window.location.reload(), 50)();
  }
}
