/**
 * Hexcrawl — landmark icon picker.
 *
 * `pickIcon({ icon, img })` → Promise<{ icon, img } | null>. A curated shortlist
 * of map-relevant Font Awesome 6 solid icons, a search over the FULL icon set
 * (discovered at runtime from the loaded stylesheets, so it tracks whatever
 * Font Awesome build Foundry ships), and "Use image…" through FilePicker.
 *
 * Closing the window without choosing resolves null — the caller keeps what it
 * had.
 */

import { escapeHTML } from "../../../core/util.mjs";
import { L, tpl } from "./shared.mjs";

export const ICON_PICKER_ID = "glhex-icon-picker";

/** FA6 free/solid names chosen for maps. Every one exists in FA 6.1+. */
export const CURATED_ICONS = Object.freeze([
  "tower-observation", "chess-rook", "dungeon", "archway", "landmark", "monument",
  "place-of-worship", "torii-gate", "vihara", "church", "house", "house-chimney",
  "city", "shop", "beer-mug-empty", "campground", "tents", "tent", "fire",
  "mountain", "mountain-sun", "volcano", "tree", "tree-city", "water", "bridge",
  "road", "signs-post", "anchor", "ship", "sailboat", "flag", "compass",
  "map-location-dot", "gem", "coins", "crown", "key", "door-open", "scroll",
  "book-skull", "skull", "skull-crossbones", "bone", "dragon", "spider", "ghost",
  "paw", "hand-sparkles", "wand-sparkles", "hat-wizard", "star", "eye",
  "circle-question", "circle-exclamation", "triangle-exclamation", "hourglass-half",
]);

const MAX_RESULTS = 240;
const iconClass = (name) => `fa-solid fa-${name}`;
const nameOf = (cls) => /(?:^|\s)fa-(?!solid\b|regular\b|brands\b|light\b|thin\b|duotone\b)([a-z0-9-]+)/.exec(cls ?? "")?.[1] ?? null;

let _allIcons = null;

/**
 * Every Font Awesome icon name the page's stylesheets define: single-class
 * selectors `.fa-name` (optionally `::before`) whose rule declares `--fa` (FA
 * 6.5+) or `content` (older 6.x). Cached after the first scan.
 */
export function scanIcons() {
  if (_allIcons) return _allIcons;
  const found = new Set();
  const re = /^\.fa-([a-z0-9-]+)(?:::?before)?$/;
  const visit = (rules) => {
    for (const rule of rules ?? []) {
      if (rule.selectorText && rule.style) {
        const content = rule.style.getPropertyValue("content");
        const glyph = rule.style.getPropertyValue("--fa") || (content && content !== "none" && content !== "normal" && content !== '""');
        if (glyph) {
          for (const sel of rule.selectorText.split(",")) {
            const m = re.exec(sel.trim());
            if (m) found.add(m[1]);
          }
        }
      }
      try { if (rule.cssRules?.length) visit(rule.cssRules); } catch { /* cross-origin */ }
      try { if (rule.styleSheet) visit(rule.styleSheet.cssRules); } catch { /* cross-origin */ }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { visit(sheet.cssRules); } catch { /* cross-origin sheet */ }
  }
  _allIcons = [...found].sort();
  return _allIcons;
}

let _App = null;

function IconPickerApp() {
  if (_App) return _App;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  _App = class HexIconPicker extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: ICON_PICKER_ID,
      classes: ["glhex-app", "glhex-editor", "glhex-icon-picker"],
      tag: "section",
      window: { title: "GLHEX.app.icon.title", icon: "fa-solid fa-icons", resizable: true },
      position: { width: 420, height: 480 },
      actions: {
        choose: HexIconPicker.#onChoose,
        image: HexIconPicker.#onImage,
        cancel: function () { this.close(); },
      },
    };

    static PARTS = { main: { template: tpl("icon-picker") } };

    constructor(options = {}) {
      super(options);
      this.current = { icon: options.current?.icon ?? null, img: options.current?.img ?? null };
      this.resolver = options.resolve ?? (() => {});
      this.settled = false;
    }

    #settle(value) {
      if (this.settled) return;
      this.settled = true;
      this.resolver(value);
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const cur = nameOf(this.current.icon);
      return {
        ...context,
        curated: CURATED_ICONS.map((n) => ({ name: n, cls: iconClass(n), active: n === cur })),
        currentImg: this.current.img,
      };
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const input = this.element.querySelector("[data-icon-search]");
      input?.addEventListener("input", () => this.#search(input.value));
      input?.focus();
    }

    #search(raw) {
      const q = raw.trim().toLowerCase().replace(/^fa-(solid\s+fa-)?/, "");
      const grid = this.element.querySelector("[data-results]");
      const curated = this.element.querySelector("[data-curated]");
      const note = this.element.querySelector("[data-result-note]");
      if (!grid) return;
      if (!q) {
        grid.hidden = true; curated.hidden = false; note.textContent = "";
        return;
      }
      const words = q.split(/\s+/).filter(Boolean);
      const all = scanIcons();
      const hits = all.filter((n) => words.every((w) => n.includes(w)));
      const shown = hits.slice(0, MAX_RESULTS);
      grid.innerHTML = shown.map((n) => {
        const name = escapeHTML(n);
        return `<button type="button" class="glhex-icon" data-action="choose" data-icon="${name}" data-tooltip="${name}" aria-label="${name}"><i class="fa-solid fa-${name}"></i></button>`;
      }).join("");
      grid.hidden = false;
      curated.hidden = true;
      note.textContent = !all.length
        ? L("GLHEX.app.icon.noIndex")
        : hits.length > shown.length
          ? L("GLHEX.app.icon.more", { shown: shown.length, n: hits.length })
          : hits.length ? "" : L("GLHEX.app.icon.noMatch");
    }

    static #onChoose(event, target) {
      const name = target.dataset.icon;
      if (!name) return;
      this.#settle({ icon: iconClass(name), img: null });
      this.close();
    }

    static #onImage() {
      const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      const fp = new FP({
        type: "image",
        current: this.current.img ?? "",
        callback: (path) => {
          if (!path) return;
          this.#settle({ icon: null, img: path });
          this.close();
        },
      });
      fp.render(true);
    }

    _onClose(options) {
      super._onClose(options);
      this.#settle(null);
    }
  };

  return _App;
}

/** Open the picker. Resolves { icon, img } or null on cancel. */
export async function pickIcon(current = {}) {
  const prior = foundry.applications.instances.get(ICON_PICKER_ID);
  if (prior) await prior.close();
  const Cls = IconPickerApp();
  return new Promise((resolve) => {
    const app = new Cls({ current, resolve });
    app.render({ force: true });
  });
}
