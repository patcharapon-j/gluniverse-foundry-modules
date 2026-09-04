/** GM manager for reusable schema-v2 world profiles. */

import { SUITE_ID } from "../../core/const.mjs";
import { SETTINGS } from "./constants.mjs";
import { normalizeWorldProfiles } from "./profiles.mjs";
import { BEHAVIORS, FUNCTIONS, MATERIALS } from "./schema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE = `modules/${SUITE_ID}/templates/pf2e-aoe/profiles.hbs`;
const t = (key) => game.i18n.localize(key);

function current() {
  try { return normalizeWorldProfiles(game.settings.get(SUITE_ID, SETTINGS.profiles)); }
  catch { return normalizeWorldProfiles(); }
}

function newId(existing) {
  let id;
  do { id = `world:${foundry.utils.randomID(12).toLowerCase()}`; } while (existing.has(id));
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

export class AoeProfilesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gl-aoe-profiles", tag: "form", classes: ["gls-scope", "gl-aoe-style-app", "gl-type"],
    window: { title: "GLAOE.Profiles.Title", icon: "fa-solid fa-sparkles", contentClasses: ["standard-form"], resizable: true },
    position: { width: 760, height: 720 },
    form: { handler: AoeProfilesApp.#submit, closeOnSubmit: false },
    actions: {
      add: AoeProfilesApp.#add, duplicate: AoeProfilesApp.#duplicate,
      remove: AoeProfilesApp.#remove, export: AoeProfilesApp.#export,
      import: AoeProfilesApp.#import,
    },
  };
  static PARTS = { form: { template: TEMPLATE } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const localize = (namespace, values) => values.map((id) => ({ id, label: t(`GLAOE.${namespace}.${id}`) }));
    return Object.assign(context, {
      intro: t("GLAOE.Profiles.Intro"), profiles: current().profiles.map((entry) => ({
        ...entry,
        appearance: {
          ...entry.appearance,
          palette: { body: entry.appearance?.palette?.body ?? "#759dff" },
          intensity: entry.appearance?.intensity ?? "",
          treatment: entry.appearance?.treatment ?? "",
        },
        colorMode: entry.appearance?.palette?.body ? "custom" : "auto",
      })),
      functions: localize("Function", FUNCTIONS), materials: localize("Material", MATERIALS),
      behaviors: localize("Behavior", BEHAVIORS),
      intensities: [{ id: "", label: t("GLAOE.Profiles.WorldIntensity") },
        ...["subtle", "balanced", "cinematic"].map((id) => ({ id, label: t(`GLAOE.Intensity.${id}`) }))],
      treatments: [{ id: "", label: t("GLAOE.Profiles.FunctionTreatment") },
        ...["grounded", "volumetric", "airborne"].map((id) => ({ id, label: t(`GLAOE.Treatment.${id}`) }))],
      colorModes: ["auto", "custom"].map((id) => ({ id, label: t(`GLAOE.ColorMode.${id}`) })),
      add: t("GLAOE.Profiles.Add"), import: t("GLAOE.Profiles.Import"), export: t("GLAOE.Profiles.Export"), save: t("GLAOE.Profiles.Save"),
    });
  }

  static async #submit(_event, _form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const profiles = Object.values(expanded.profiles ?? {}).map((entry) => ({
      id: entry.id, name: String(entry.name ?? "").trim().slice(0, 80),
      semantics: { function: entry.function, material: entry.material, behavior: entry.behavior },
      appearance: {
        palette: entry.colorMode === "custom" && entry.color ? { body: entry.color } : null,
        intensity: entry.intensity || null,
        treatment: entry.treatment || null,
      },
    }));
    await game.settings.set(SUITE_ID, SETTINGS.profiles, normalizeWorldProfiles({ schema: 1, profiles }));
    ui.notifications?.info(t("GLAOE.Profiles.Saved"));
    this.render({ force: true });
  }

  static async #add() {
    const data = current(); const ids = new Set(data.profiles.map((entry) => entry.id));
    const profiles = [...data.profiles, { id: newId(ids), name: t("GLAOE.Profiles.NewName"), semantics: { function: "neutral", material: "neutral", behavior: "static" }, appearance: { palette: null, intensity: null, treatment: null } }];
    await game.settings.set(SUITE_ID, SETTINGS.profiles, { schema: 1, profiles }); this.render({ force: true });
  }

  static async #duplicate(_event, target) {
    const id = target.closest("[data-profile-id]")?.dataset.profileId; const data = current();
    const source = data.profiles.find((entry) => entry.id === id); if (!source) return;
    const ids = new Set(data.profiles.map((entry) => entry.id));
    const copy = { ...source, id: newId(ids), name: `${source.name} ${t("GLAOE.Profiles.CopySuffix")}` };
    await game.settings.set(SUITE_ID, SETTINGS.profiles, { schema: 1, profiles: [...data.profiles, copy] }); this.render({ force: true });
  }

  static async #remove(_event, target) {
    const id = target.closest("[data-profile-id]")?.dataset.profileId; if (!id) return;
    const used = usage(id); if (used.length) { ui.notifications?.error(game.i18n.format("GLAOE.Profiles.InUse", { count: used.length })); return; }
    const data = current();
    await game.settings.set(SUITE_ID, SETTINGS.profiles, { schema: 1, profiles: data.profiles.filter((entry) => entry.id !== id) });
    this.render({ force: true });
  }

  static #export() {
    foundry.utils.saveDataToFile(JSON.stringify(current(), null, 2), "application/json", "spellglass-profiles.json");
  }

  static #import() {
    const input = document.createElement("input"); input.type = "file"; input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      try {
        const parsed = JSON.parse(await input.files?.[0]?.text()); const incoming = normalizeWorldProfiles(parsed);
        const data = current(); const ids = new Set(data.profiles.map((entry) => entry.id));
        const profiles = [...data.profiles];
        for (const entry of incoming.profiles) {
          const id = ids.has(entry.id) ? newId(ids) : entry.id; ids.add(id); profiles.push({ ...entry, id });
        }
        await game.settings.set(SUITE_ID, SETTINGS.profiles, { schema: 1, profiles }); this.render({ force: true });
      } catch { ui.notifications?.error(t("GLAOE.Profiles.ImportFailed")); }
    }, { once: true }); input.click();
  }
}
