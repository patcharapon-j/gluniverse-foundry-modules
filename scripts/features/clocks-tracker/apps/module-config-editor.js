/**
 * Module Configuration editor — one place to enable/disable every module and
 * sub-module the package ships. Renders the FEATURE_TREE as a tree of toggles
 * (a parent dims and disables its whole subtree when switched off) and writes
 * the result back to either the moduleConfig blob or each node's backing world
 * setting, whichever it declares.
 */

import { MODULE_ID, SETTINGS } from "../const.js";
import { Features } from "../features.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ModuleConfigEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async show() {
    if (!game.user.isGM) return;
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    return this.instance;
  }

  static DEFAULT_OPTIONS = {
    id: "glct-module-config",
    classes: ["glct", "glct-caledit", "glct-modcfg"],
    tag: "form",
    window: { title: "GLCT.moduleConfig.title", icon: "fa-solid fa-toggle-on", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      resetConfig: ModuleConfigEditor.prototype._onReset,
      saveConfig: ModuleConfigEditor.prototype._onSave
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/module-config-editor.hbs` } };

  /** Recursively map a node (by path) and its children into render rows. */
  _row(path, depth, parentOn) {
    const node = Features.node(path);
    if (!node) return null;
    const isPF2e = game.system?.id === "pf2e";
    if (node.pf2eOnly && !isPF2e) return null;
    const on = Features.self(path);
    const effectiveOn = parentOn && on;
    const children = (node.children ?? [])
      .map(c => this._row(`${path}.${c.key}`, depth + 1, effectiveOn))
      .filter(Boolean);
    return {
      path,
      label: game.i18n.localize(node.label),
      hint: node.hint ? game.i18n.localize(node.hint) : "",
      icon: node.icon ?? "",
      depth,
      checked: on,
      disabled: !parentOn,           // a child can't be edited while its parent is off
      isGroup: depth === 0,
      children
    };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rows = Features.tree.map(n => this._row(n.key, 0, true)).filter(Boolean);
    return Object.assign(context, { rows });
  }

  /** Live cascade: toggling a checkbox enables/disables its descendants' inputs. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    root.querySelectorAll('input[type="checkbox"][data-path]').forEach(cb => {
      cb.addEventListener("change", () => this._cascade(cb));
      this._cascade(cb);
    });
  }

  /** Grey out and (visually) follow every descendant of a parent that is off. */
  _cascade(cb) {
    const path = cb.dataset.path;
    const on = cb.checked;
    this.element.querySelectorAll('input[type="checkbox"][data-path]').forEach(child => {
      const cp = child.dataset.path;
      if (cp === path || !cp.startsWith(`${path}.`)) return;
      const row = child.closest(".mc-row");
      // A descendant is editable only if EVERY ancestor checkbox above it is on.
      const parentsOn = this._ancestorsOn(cp);
      child.disabled = !parentsOn;
      row?.classList.toggle("mc-disabled", !parentsOn);
    });
  }

  /** Walk the live checkboxes to see if every ancestor of `path` is checked. */
  _ancestorsOn(path) {
    const parts = path.split(".");
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur ? `${cur}.${parts[i]}` : parts[i];
      const box = this.element.querySelector(`input[data-path="${cur}"]`);
      if (box && !box.checked) return false;
    }
    return true;
  }

  async _onReset() {
    // Reset every leaf to its declared default (blob nodes wiped; settings-backed
    // nodes set back to their default), then re-render.
    const blob = {};
    const writes = [];
    for (const cb of this.element.querySelectorAll('input[type="checkbox"][data-path]')) {
      const node = Features.node(cb.dataset.path);
      if (!node) continue;
      if (node.setting) writes.push(game.settings.set(MODULE_ID, node.setting, !!node.default));
    }
    await Promise.all([game.settings.set(MODULE_ID, SETTINGS.moduleConfig, blob), ...writes]);
    try { ui.controls?.render?.(); } catch { /* ignore */ }
    ui.notifications.info(game.i18n.localize("GLCT.moduleConfig.reset"));
    this.render();
  }

  async _onSave() {
    const blob = {};
    const writes = [];
    for (const cb of this.element.querySelectorAll('input[type="checkbox"][data-path]')) {
      const node = Features.node(cb.dataset.path);
      if (!node) continue;
      const value = !!cb.checked;
      if (node.setting) writes.push(game.settings.set(MODULE_ID, node.setting, value));
      else blob[cb.dataset.path] = value;
    }
    // Write the blob last-ish; its onChange reconciles the HUDs structurally,
    // while each settings-backed write fires that feature's own onChange.
    await Promise.all([...writes, game.settings.set(MODULE_ID, SETTINGS.moduleConfig, blob)]);
    try { ui.controls?.render?.(); } catch { /* ignore */ }
    ui.notifications.info(game.i18n.localize("GLCT.moduleConfig.saved"));
    this.render();
  }
}

/** Register the settings menu that opens this editor. */
export function registerModuleConfigMenu() {
  game.settings.registerMenu(MODULE_ID, "moduleConfigEditor", {
    name: "GLCT.moduleConfig.title",
    label: "GLCT.moduleConfig.label",
    hint: "GLCT.moduleConfig.hint",
    icon: "fa-solid fa-toggle-on",
    type: ModuleConfigEditor,
    restricted: true
  });
}
