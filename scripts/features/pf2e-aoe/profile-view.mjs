/**
 * Spellglass — the profile manager's view model and card painter.
 *
 * Kept out of `profile-app.mjs` because that file builds an ApplicationV2
 * subclass at module scope and so only imports inside Foundry. This half is
 * plain: the app renders `templates/pf2e-aoe/profiles.hbs` from
 * `profilesContext()`, and the preview page renders the same template from the
 * same function, so the page judged there is the page a GM gets.
 */

import { lookFor } from "./presentation.mjs";
import { paintSwatchElement } from "./render/swatch.mjs";
import { BEHAVIORS, FUNCTIONS, MATERIALS } from "./schema.mjs";

export const DEFAULT_BODY = "#759dff";

/** The template context for a list of draft profiles; `t` localizes a key. */
export function profilesContext(profiles, t) {
  const localize = (namespace, values) => values.map((id) => ({ id, label: t(`GLAOE.${namespace}.${id}`) }));
  return {
    intro: t("GLAOE.Profiles.Intro"),
    profiles: profiles.map((entry) => ({
      ...entry,
      appearance: {
        ...entry.appearance,
        palette: { body: entry.appearance?.palette?.body ?? DEFAULT_BODY },
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
    labels: {
      name: t("GLAOE.Profiles.Name"), duplicate: t("GLAOE.Profiles.Duplicate"), remove: t("GLAOE.Profiles.Remove"),
      function: t("GLAOE.RegionStyle.Function"), material: t("GLAOE.RegionStyle.Material"),
      behavior: t("GLAOE.RegionStyle.Behavior"), intensity: t("GLAOE.RegionStyle.Intensity"),
      treatment: t("GLAOE.RegionStyle.Treatment"), color: t("GLAOE.RegionStyle.Color"),
    },
    empty: t("GLAOE.Profiles.Empty"), unsaved: t("GLAOE.Profiles.Unsaved"),
    add: t("GLAOE.Profiles.Add"), import: t("GLAOE.Profiles.Import"), export: t("GLAOE.Profiles.Export"), save: t("GLAOE.Profiles.Save"),
  };
}

/** One card's form values back into a profile. */
export function profileFromFields(entry) {
  return {
    id: entry.id, name: String(entry.name ?? "").trim().slice(0, 80),
    semantics: { function: entry.function, material: entry.material, behavior: entry.behavior },
    appearance: {
      palette: entry.colorMode === "custom" && entry.color ? { body: entry.color } : null,
      intensity: entry.intensity || null,
      treatment: entry.treatment || null,
    },
  };
}

/** Repaint one card's swatch from its own fields, and gate its colour input. */
export function paintProfileCard(card) {
  const value = (key) => card.querySelector(`[name$=".${key}"]`)?.value ?? "";
  const custom = value("colorMode") === "custom";
  const color = card.querySelector('input[type="color"]');
  if (color) color.disabled = !custom;
  const look = lookFor(
    { function: value("function"), material: value("material"), behavior: value("behavior") },
    { palette: custom ? { body: value("color") } : null, intensity: value("intensity") || undefined, treatment: value("treatment") || null },
  );
  paintSwatchElement(card.querySelector("[data-swatch]"), look);
}
