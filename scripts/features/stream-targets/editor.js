/**
 * GLUniverse Targeting Lines — standalone editor.
 *
 * Registered as a settings menu so the Control Center surfaces it as an "Open
 * editor" button. `tgt.settings` is an Object setting, and an Object setting
 * with no menu in front of it is a config a GM can only reach from the console.
 *
 * The class is built in a **memoised factory** rather than at module scope:
 * `foundry.applications.api` does not exist under plain Node, and this module is
 * reachable from the repo's check tooling through its own settings module. A
 * top-level `const { ApplicationV2 } = foundry.applications.api` takes the
 * tooling down rather than the feature — the same trap `pf2e-variant-rules`
 * documents for its dent-config sheet.
 */

import { renderSection } from "./panel.js";

let Cls = null;

export function TargetingEditor() {
  if (Cls) return Cls;

  const { ApplicationV2 } = foundry.applications.api;

  Cls = class TargetingLinesEditor extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "gluniverse-targeting-lines-editor",
      classes: ["gluniverse-stream-director"],
      tag: "form",
      window: { title: "GLUNIVERSE_STREAM.settings.targetingSettings.name", icon: "fas fa-crosshairs" },
      position: { width: 560, height: "auto" }
    };

    async _renderHTML() {
      return `<div class="gluniverse-stream-director-body">${await renderSection()}</div>`;
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
      return content;
    }

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      this.element.addEventListener("change", (event) => this.#onChange(event));
      this.element.addEventListener("submit", (event) => event.preventDefault());
    }

    async #onChange(event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (!target.name) return;
      const { claimChange } = await import("./panel.js");
      const value = target.type === "checkbox"
        ? target.checked
        : target.type === "range" || target.type === "number"
          ? Number(target.value)
          : target.value;
      await claimChange(target.name, value);
      this.render();
    }
  };

  return Cls;
}

/**
 * The class Foundry is handed for the settings menu. `registerMenu` throws unless
 * `type` is an ApplicationV2 (or FormApplication) subclass, and that throw lands
 * inside `Suite.registerAllSettings`, which swallows it — so a plain class here
 * meant no "Open editor" button and an Object setting reachable only from the
 * console. Memoised and built at registerSettings time, never at module scope,
 * for the same Node reason as the editor. It never renders itself: it hands off
 * to one editor window, so a repeat click brings that window forward.
 */
let MenuCls = null;
let editor = null;

export function TargetingEditorMenu() {
  if (MenuCls) return MenuCls;
  const { ApplicationV2 } = foundry.applications.api;
  MenuCls = class TargetingEditorMenuShim extends ApplicationV2 {
    render() {
      editor ??= new (TargetingEditor())();
      editor.render({ force: true });
      return this;
    }
  };
  return MenuCls;
}
