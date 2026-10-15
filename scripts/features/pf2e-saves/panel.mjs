/**
 * Save Resolution — the panel window. One per session, keyed by its card.
 *
 * Built in a memoised factory, never at module scope: model.mjs and render.mjs
 * are loaded by the check tool under plain Node, where `foundry` does not exist.
 * The window holds two things nobody else needs: the GM's per-row multiplier
 * overrides (never written anywhere — a stored multiplier would name the
 * degree), and whether the effects drawer is open.
 */

import { err } from "../../core/const.mjs";
import { sessionHTML } from "./render.mjs";

let _Panel = null;
let _main = null;
const main = async () => (_main ??= await import("./main.mjs"));

export function SavesPanel() {
  if (_Panel) return _Panel;
  const { ApplicationV2 } = foundry.applications.api;
  const T = (k) => game.i18n.localize(k);

  _Panel = class SavesPanelApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["glsv-panel", "gl-type"],
      tag: "section",
      window: { title: "GLSV.panel.title", icon: "fa-solid fa-list-check", resizable: true },
      position: { width: 520, height: "auto" },
    };

    constructor(options = {}) {
      super(options);
      this.messageId = options.messageId;
      this.overrides = new Map();
      this.configOpen = false;
    }

    get title() {
      const s = game.messages.get(this.messageId);
      const name = s?.getFlag?.("gluniverse-foundry-modules", "sv.session")?.spellName;
      return name ? `${T("GLSV.panel.title")} — ${name}` : T("GLSV.panel.title");
    }

    async _renderHTML() {
      const { buildView } = await main();
      const message = game.messages.get(this.messageId);
      const view = message ? await buildView(message, { overrides: this.overrides, configOpen: this.configOpen }) : null;
      return view ? sessionHTML(view, { t: T }) : `<p class="glsv-empty">${T("GLSV.gone")}</p>`;
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
      if (content._glsvWired) return;
      content._glsvWired = true;
      content.addEventListener("click", (event) => this.#onClick(event));
      content.addEventListener("change", (event) => this.#onChange(event));
      content.addEventListener("toggle", (event) => {
        if (event.target?.classList?.contains("glsv-config")) this.configOpen = event.target.open;
      }, true);
    }

    async #onClick(event) {
      const el = event.target.closest("[data-action]");
      if (!el || !this.element.contains(el)) return;
      const { actions } = await main();
      const fn = actions[el.dataset.action];
      if (!fn) return;
      event.preventDefault();
      el.disabled = true;
      try {
        await fn(this.messageId, el.dataset.row ?? null, this.overrides, el);
      } catch (e) {
        err("pf2e-saves: panel action failed", e);
      } finally {
        if (el.isConnected) el.disabled = false;
      }
    }

    async #onChange(event) {
      const el = event.target.closest("[data-change]");
      if (!el) return;
      if (el.dataset.change === "rowMult") {
        this.overrides.set(el.dataset.row, Number(el.value));
        return this.render();
      }
      const { changes } = await main();
      try {
        await changes[el.dataset.change]?.(this.messageId, el);
      } catch (e) {
        err("pf2e-saves: panel edit failed", e);
      }
    }
  };
  return _Panel;
}
