/** GM manager for reusable schema-v2 world profiles. */

import { SUITE_ID } from "../../core/const.mjs";
import { SETTINGS } from "./constants.mjs";
import { normalizeWorldProfiles } from "./profiles.mjs";
import { paintProfileCard, profileFromFields, profilesContext } from "./profile-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE = `modules/${SUITE_ID}/templates/pf2e-aoe/profiles.hbs`;
const t = (key) => game.i18n.localize(key);

function saved() {
  try { return normalizeWorldProfiles(game.settings.get(SUITE_ID, SETTINGS.profiles)); }
  catch { return normalizeWorldProfiles(); }
}

function newId(existing) {
  let id;
  do { id = `world:${foundry.utils.randomID(12).toLowerCase()}`; } while (existing.has(id));
  existing.add(id);
  return id;
}

function usage(id) {
  const found = [];
  for (const scene of game.scenes ?? []) for (const region of scene.regions ?? []) {
    let profileId = null; try { profileId = region.getFlag(SUITE_ID, "aoe.presentation")?.profileId; } catch { /* inaccessible */ }
    if (profileId === id) found.push(region.uuid);
  }
  return found;
}

/**
 * The manager edits a DRAFT. Add, duplicate, remove and import change the
 * draft and re-render; only Save writes the world setting. The old manager
 * wrote the setting on every one of those and re-rendered from it, so adding a
 * profile threw away every unsaved edit on the page, and an edited profile
 * was silently re-linked to every Region using it the moment the GM clicked
 * Add somewhere else.
 */
export class AoeProfilesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gl-aoe-profiles", tag: "form", classes: ["gls-scope", "gl-aoe-style-app", "gl-type"],
    window: { title: "GLAOE.Profiles.Title", icon: "fa-solid fa-sparkles", contentClasses: ["standard-form"], resizable: true },
    position: { width: 720, height: 680 },
    form: { handler: AoeProfilesApp.#submit, closeOnSubmit: false },
    actions: {
      add: AoeProfilesApp.#add, duplicate: AoeProfilesApp.#duplicate,
      remove: AoeProfilesApp.#remove, export: AoeProfilesApp.#export,
      import: AoeProfilesApp.#import,
    },
  };
  static PARTS = { form: { template: TEMPLATE } };

  /** The profiles on screen; null until the first render reads the setting. */
  #draft = null;
  #dirty = false;

  get draft() {
    this.#draft ??= saved().profiles.map((entry) => foundry.utils.deepClone(entry));
    return this.#draft;
  }

  /** Fold whatever is typed into the cards back into the draft. */
  #capture() {
    const form = this.element?.matches?.("form") ? this.element : this.element?.querySelector?.("form");
    if (!form || !this.#draft) return;
    const FDE = foundry.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
    const expanded = foundry.utils.expandObject(new FDE(form).object);
    const fields = Object.values(expanded.profiles ?? {});
    if (fields.length !== this.#draft.length) return;
    this.#draft = fields.map(profileFromFields);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, profilesContext(this.draft, t));
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    for (const card of root.querySelectorAll("[data-profile-id]")) paintProfileCard(card);
    this.#showDirty();
    if (root.dataset.glAoeBound) return;
    root.dataset.glAoeBound = "1";
    const changed = (event) => {
      const card = event.target?.closest?.("[data-profile-id]");
      if (!card) return;
      this.#dirty = true;
      paintProfileCard(card);
      this.#showDirty();
    };
    root.addEventListener("change", changed);
    root.addEventListener("input", changed);
  }

  #showDirty() {
    const flag = this.element?.querySelector?.("[data-dirty]");
    if (flag) flag.hidden = !this.#dirty;
  }

  static async #submit() {
    this.#capture();
    await game.settings.set(SUITE_ID, SETTINGS.profiles, normalizeWorldProfiles({ schema: 1, profiles: this.draft }));
    ui.notifications?.info(t("GLAOE.Profiles.Saved"));
    this.#draft = null;
    this.#dirty = false;
    this.render({ force: true });
  }

  static #add() {
    this.#capture();
    const ids = new Set(this.draft.map((entry) => entry.id));
    this.draft.push({
      id: newId(ids), name: t("GLAOE.Profiles.NewName"),
      semantics: { function: "neutral", material: "neutral", behavior: "static" },
      appearance: { palette: null, intensity: null, treatment: null },
    });
    this.#dirty = true;
    this.render();
  }

  static #duplicate(_event, target) {
    this.#capture();
    const id = target.closest("[data-profile-id]")?.dataset.profileId;
    const index = this.draft.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const ids = new Set(this.draft.map((entry) => entry.id));
    const source = this.draft[index];
    const copy = { ...foundry.utils.deepClone(source), id: newId(ids), name: `${source.name} ${t("GLAOE.Profiles.CopySuffix")}`.slice(0, 80) };
    this.draft.splice(index + 1, 0, copy);
    this.#dirty = true;
    this.render();
  }

  static #remove(_event, target) {
    this.#capture();
    const id = target.closest("[data-profile-id]")?.dataset.profileId;
    if (!id) return;
    const used = usage(id);
    if (used.length) { ui.notifications?.error(game.i18n.format("GLAOE.Profiles.InUse", { count: used.length })); return; }
    this.#draft = this.draft.filter((entry) => entry.id !== id);
    this.#dirty = true;
    this.render();
  }

  static #export() {
    this.#capture();
    const data = normalizeWorldProfiles({ schema: 1, profiles: this.draft });
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", "spellglass-profiles.json");
  }

  static #import() {
    this.#capture();
    const input = document.createElement("input"); input.type = "file"; input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      try {
        const parsed = JSON.parse(await input.files?.[0]?.text());
        const incoming = normalizeWorldProfiles(parsed);
        const ids = new Set(this.draft.map((entry) => entry.id));
        for (const entry of incoming.profiles) {
          const id = ids.has(entry.id) ? newId(ids) : entry.id;
          ids.add(id);
          this.draft.push({ ...entry, id });
        }
        this.#dirty = true;
        this.render();
      } catch { ui.notifications?.error(t("GLAOE.Profiles.ImportFailed")); }
    }, { once: true }); input.click();
  }
}
