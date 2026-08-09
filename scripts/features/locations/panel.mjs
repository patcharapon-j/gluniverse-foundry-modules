/**
 * GLUniverse Suite — Locations: the GM panel.
 *
 * A thumbnail deck plus one editor row. The editor does double duty on purpose:
 * filled in and sent with "Travel" it is the quick-travel path (go somewhere
 * once, store nothing), and filled in and sent with "Save" it is the deck
 * editor. Two surfaces for what is one form would just be two places to keep in
 * sync.
 *
 * No tags and no folders. Search covers a few dozen entries, and a tagging
 * system is the classic thing that gets built and then never populated.
 */

import { featurePath } from "../../core/const.mjs";
import {
  FEATURE_ID, findEntry, getCurrent, getHome, listEntries,
  deleteEntry, upsertEntry, readBackground,
} from "./deck.mjs";
import { DEFAULT_STYLE, STYLES, STYLE_GROUPS, goHome, preview, travel } from "./travel.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const APP_ID = "glloc-panel";

const filePicker = () =>
  foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

export class LocationsPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: APP_ID,
    classes: ["glloc-panel"],
    window: { title: "GLLOC.panel.title", icon: "fa-solid fa-map-location-dot", resizable: true },
    position: { width: 460, height: "auto" },
    actions: {
      travel: LocationsPanel._onTravel,
      edit: LocationsPanel._onEdit,
      remove: LocationsPanel._onRemove,
      home: LocationsPanel._onHome,
      pick: LocationsPanel._onPick,
      preview: LocationsPanel._onPreview,
      go: LocationsPanel._onGo,
      save: LocationsPanel._onSave,
      reset: LocationsPanel._onReset,
    },
  };

  static PARTS = {
    main: { template: featurePath(FEATURE_ID, "templates/panel.hbs") },
  };

  /** The deck entry currently loaded into the editor, or null for a fresh one. */
  #editing = null;

  /**
   * Open, reusing the live instance. Never a toggle: one scene-control click can
   * arrive through both the tool's `onChange` and the bound DOM listener, and a
   * toggle would flash the window open and immediately shut it again.
   */
  static open() {
    const existing = foundry.applications.instances.get(APP_ID);
    if (existing) {
      existing.render({ force: true });
      return existing;
    }
    const panel = new LocationsPanel();
    panel.render({ force: true });
    return panel;
  }

  static refresh() {
    foundry.applications.instances.get(APP_ID)?.render();
  }

  async _prepareContext() {
    const scene = canvas?.scene;
    const current = getCurrent(scene);
    const entries = listEntries().map((e) => ({
      ...e,
      isCurrent: !!current && e.id === current,
      subtitle: e.subtitle ?? "",
    }));

    return {
      entries,
      hasEntries: entries.length > 0,
      home: getHome(scene),
      draft: this.#editing ?? { style: DEFAULT_STYLE },
      editingName: this.#editing?.name ?? "",
      styleGroups: STYLE_GROUPS.map((group) => ({
        group,
        label: game.i18n.localize(`GLLOC.group.${group}`),
        styles: Object.entries(STYLES)
          .filter(([, spec]) => spec.group === group)
          .map(([id]) => ({
            id,
            label: game.i18n.localize(`GLLOC.style.${id}`),
            selected: id === (this.#editing?.style ?? DEFAULT_STYLE),
          })),
      })),
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const search = this.element.querySelector(".glloc-search");
    search?.addEventListener("input", () => this.#applyFilter(search.value));
  }

  /** Filter in place rather than re-rendering — the input keeps focus. */
  #applyFilter(term) {
    const needle = String(term ?? "").trim().toLowerCase();
    for (const card of this.element.querySelectorAll(".glloc-card")) {
      const hay = `${card.dataset.name ?? ""} ${card.dataset.subtitle ?? ""}`.toLowerCase();
      card.hidden = !!needle && !hay.includes(needle);
    }
  }

  /** Everything the editor row currently holds, as an entry-shaped object. */
  #draft() {
    const root = this.element;
    const value = (name) => root.querySelector(`[name="${name}"]`)?.value?.trim() ?? "";
    return {
      id: this.#editing?.id ?? null,
      name: value("name"),
      subtitle: value("subtitle"),
      img: value("img"),
      style: value("style") || DEFAULT_STYLE,
      accent: value("accent"),
      darkness: value("darkness"),
      playlistId: value("playlistId"),
    };
  }

  /* ── Deck actions ───────────────────────────────────────────────────── */

  static async _onTravel(event, target) {
    const entry = findEntry(target.dataset.id);
    if (!entry) return;
    await travel(entry);
    this.render();
  }

  static _onEdit(event, target) {
    event.stopPropagation();
    this.#editing = findEntry(target.dataset.id);
    this.render();
  }

  static async _onRemove(event, target) {
    event.stopPropagation();
    const entry = findEntry(target.dataset.id);
    if (!entry) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("GLLOC.confirm.deleteTitle") },
      content: `<p>${game.i18n.format("GLLOC.confirm.delete", { name: entry.name })}</p>`,
    });
    if (!ok) return;
    await deleteEntry(entry.id);
    if (this.#editing?.id === entry.id) this.#editing = null;
    this.render();
  }

  static async _onHome() {
    await goHome();
    this.render();
  }

  /* ── Editor actions ─────────────────────────────────────────────────── */

  static _onPick() {
    const input = this.element.querySelector('[name="img"]');
    new (filePicker())({
      type: "imagevideo",
      current: input?.value ?? "",
      callback: (path) => {
        if (input) input.value = path;
      },
    }).browse();
  }

  static _onPreview() {
    const draft = this.#draft();
    // A preview plates the *current* backdrop, so it auditions the shape and
    // timing of a style rather than the destination art.
    return preview({ ...draft, img: readBackground(canvas?.scene).src ?? draft.img }, draft.style);
  }

  static async _onGo() {
    const draft = this.#draft();
    if (!draft.img) return ui.notifications?.warn(game.i18n.localize("GLLOC.warn.noImage"));
    await travel(draft);
    this.render();
  }

  static async _onSave() {
    const draft = this.#draft();
    if (!draft.img) return ui.notifications?.warn(game.i18n.localize("GLLOC.warn.noImage"));
    this.#editing = await upsertEntry(draft, this.#editing?.id ?? null);
    this.render();
  }

  static _onReset() {
    this.#editing = null;
    this.render();
  }
}

/** Re-render the open panel when the deck or the scene's marker changes. */
export function watchDeck() {
  Hooks.on("updateScene", (scene) => {
    if (scene?.id === canvas?.scene?.id) LocationsPanel.refresh();
  });
}
