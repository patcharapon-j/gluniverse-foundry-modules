/** PF2e AoE — preset-first schema-v2 fields appended to Region configuration. */

import { SUITE_ID } from "../../core/const.mjs";
import { FLAGS, SETTINGS } from "./constants.mjs";
import { inferredLabel } from "./data.mjs";
import { BUILTIN_PROFILES, normalizeWorldProfiles, profileById, resolveProfile } from "./profiles.mjs";
import {
  BEHAVIORS, FUNCTIONS, INTENSITIES, LABEL_MODES, MATERIALS, PRESENTATION_MODES,
  compactPresentation, normalizePresentation,
} from "./schema.mjs";

const MARK = "glAoePresentation";
const TREATMENT_IDS = Object.freeze(["grounded", "volumetric", "airborne"]);
const t = (key) => game.i18n.localize(key);
const get = (key, fallback) => { try { return game.settings.get(SUITE_ID, key); } catch { return fallback; } };

function field(label, input, hint) {
  const group = document.createElement("div");
  group.className = "form-group";
  const lab = document.createElement("label"); lab.textContent = label;
  const fields = document.createElement("div"); fields.className = "form-fields"; fields.appendChild(input);
  group.append(lab, fields);
  if (hint) { const p = document.createElement("p"); p.className = "hint"; p.textContent = hint; group.appendChild(p); }
  return group;
}

function select(name, values, selected, namespace, { blank = false } = {}) {
  const input = document.createElement("select"); input.name = name;
  if (blank) input.append(new Option(t("GLAOE.Common.None"), "", selected == null, selected == null));
  for (const value of values) input.append(new Option(t(`GLAOE.${namespace}.${value}`), value, value === selected, value === selected));
  return input;
}

function profileOptions(name, selected) {
  const input = document.createElement("select"); input.name = name;
  input.append(new Option(t("GLAOE.RegionStyle.ProfileNone"), "", !selected, !selected));
  const builtins = document.createElement("optgroup"); builtins.label = t("GLAOE.RegionStyle.BuiltinProfiles");
  for (const entry of BUILTIN_PROFILES) builtins.append(new Option(t(entry.nameKey), entry.id, entry.id === selected, entry.id === selected));
  input.append(builtins);
  const worlds = normalizeWorldProfiles(get(SETTINGS.profiles, {})).profiles;
  if (worlds.length) {
    const group = document.createElement("optgroup"); group.label = t("GLAOE.RegionStyle.WorldProfiles");
    for (const entry of worlds) group.append(new Option(entry.name, entry.id, entry.id === selected, entry.id === selected));
    input.append(group);
  }
  return input;
}

function summary(resolved) {
  return [t(`GLAOE.Function.${resolved.semantics.function}`), t(`GLAOE.Material.${resolved.semantics.material}`),
    t(`GLAOE.Behavior.${resolved.semantics.behavior}`)].join(" · ") + ` — ${t(`GLAOE.Confidence.${resolved.confidence}`)}`;
}

export function injectRegionStyle(app, element) {
  if (!game.user?.isGM) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const regionDoc = app?.document ?? app?.object;
  if (!root || regionDoc?.documentName !== "Region" || root.querySelector(`[data-${MARK}]`)) return;
  const form = root.matches("form") ? root : root.querySelector("form");
  if (!form) return;
  let raw = {}; try { raw = regionDoc.getFlag(SUITE_ID, FLAGS.presentation) ?? {}; } catch { /* no flag */ }
  const presentation = normalizePresentation(raw);
  const resolved = resolveProfile(regionDoc, { suiteId: SUITE_ID, presentation,
    worldProfiles: get(SETTINGS.profiles, {}), inheritedLabel: inferredLabel(regionDoc) });
  const prefix = `flags.${SUITE_ID}.${FLAGS.presentation}`;
  const section = document.createElement("fieldset"); section.dataset[MARK] = "1"; section.className = "gl-aoe-region-style";
  const legend = document.createElement("legend");
  legend.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> ${t("GLAOE.RegionStyle.Legend")}`;
  section.appendChild(legend);
  const diagnostic = document.createElement("p");
  diagnostic.className = `gl-aoe-classification${resolved.needsClassification ? " is-uncertain" : ""}`;
  diagnostic.textContent = summary(resolved); section.appendChild(diagnostic);
  const schema = document.createElement("input"); schema.type = "hidden"; schema.name = `${prefix}.schema`; schema.value = "2"; section.appendChild(schema);

  const mode = select(`${prefix}.mode`, PRESENTATION_MODES, presentation.mode, "Mode");
  section.appendChild(field(t("GLAOE.RegionStyle.Mode"), mode, t("GLAOE.RegionStyle.ModeHint")));
  const profile = profileOptions(`${prefix}.profileId`, presentation.profileId);
  const profileField = field(t("GLAOE.RegionStyle.Profile"), profile, t("GLAOE.RegionStyle.ProfileHint"));
  const detach = document.createElement("button"); detach.type = "button"; detach.className = "gl-btn";
  detach.innerHTML = `<i class="fa-solid fa-link-slash"></i> ${t("GLAOE.RegionStyle.Detach")}`;
  profile.parentElement.append(detach); section.appendChild(profileField);

  const advanced = document.createElement("details"); advanced.className = "gl-aoe-advanced";
  const advancedSummary = document.createElement("summary"); advancedSummary.textContent = t("GLAOE.RegionStyle.Advanced"); advanced.append(advancedSummary);
  const semantics = presentation.overrides.semantics;
  advanced.append(
    field(t("GLAOE.RegionStyle.Function"), select(`${prefix}.overrides.semantics.function`, FUNCTIONS, semantics.function, "Function", { blank: true })),
    field(t("GLAOE.RegionStyle.SecondaryFunction"), select(`${prefix}.overrides.semantics.secondaryFunction`, FUNCTIONS, semantics.secondaryFunction, "Function", { blank: true })),
    field(t("GLAOE.RegionStyle.Material"), select(`${prefix}.overrides.semantics.material`, MATERIALS, semantics.material, "Material", { blank: true })),
    field(t("GLAOE.RegionStyle.AccentMaterial"), select(`${prefix}.overrides.semantics.accent`, MATERIALS, semantics.accent, "Material", { blank: true })),
    field(t("GLAOE.RegionStyle.Behavior"), select(`${prefix}.overrides.semantics.behavior`, BEHAVIORS, semantics.behavior, "Behavior", { blank: true })),
    field(t("GLAOE.RegionStyle.Intensity"), select(`${prefix}.overrides.appearance.intensity`, INTENSITIES, presentation.overrides.appearance.intensity, "Intensity", { blank: true })),
    field(t("GLAOE.RegionStyle.Treatment"), select(`${prefix}.overrides.appearance.treatment`, TREATMENT_IDS, presentation.overrides.appearance.treatment, "Treatment", { blank: true })),
  );
  const paletteEnabled = Boolean(presentation.overrides.appearance.palette?.body);
  const paletteMarker = document.createElement("input"); paletteMarker.type = "hidden";
  paletteMarker.name = `${prefix}._paletteEnabled`; paletteMarker.value = paletteEnabled ? "true" : "false";
  advanced.append(paletteMarker);
  const colorControl = document.createElement("div"); colorControl.className = "gl-aoe-color-override";
  const colorToggleLabel = document.createElement("label"); colorToggleLabel.className = "checkbox";
  const colorToggle = document.createElement("input"); colorToggle.type = "checkbox"; colorToggle.checked = paletteEnabled;
  colorToggleLabel.append(colorToggle, ` ${t("GLAOE.RegionStyle.ColorOverride")}`);
  const color = document.createElement("input"); color.type = "color";
  color.name = `${prefix}.overrides.appearance.palette.body`;
  color.value = presentation.overrides.appearance.palette?.body ?? "#759dff";
  color.disabled = !paletteEnabled;
  colorControl.append(colorToggleLabel, color);
  colorToggle.addEventListener("change", () => {
    color.disabled = !colorToggle.checked;
    paletteMarker.value = colorToggle.checked ? "true" : "false";
  });
  advanced.append(field(t("GLAOE.RegionStyle.Color"), colorControl, t("GLAOE.RegionStyle.ColorHintV2")));
  section.appendChild(advanced);

  const labelMode = select(`${prefix}.label.mode`, LABEL_MODES, presentation.label.mode, "LabelMode");
  section.appendChild(field(t("GLAOE.RegionStyle.LabelMode"), labelMode));
  const label = document.createElement("input"); label.type = "text"; label.name = `${prefix}.label.value`; label.maxLength = 80;
  label.value = presentation.label.value; label.placeholder = inferredLabel(regionDoc) || t("GLAOE.RegionStyle.LabelPlaceholder");
  label.disabled = presentation.label.mode !== "custom";
  labelMode.addEventListener("change", () => { label.disabled = labelMode.value !== "custom"; });
  section.appendChild(field(t("GLAOE.RegionStyle.Label"), label, t("GLAOE.RegionStyle.LabelHintV2")));

  const update = () => { profile.disabled = mode.value !== "profile"; advanced.toggleAttribute("hidden", mode.value === "native"); };
  detach.addEventListener("click", () => {
    const selected = profileById(profile.value, get(SETTINGS.profiles, {})); if (!selected) return;
    for (const [key, value] of Object.entries(selected.semantics)) {
      const input = advanced.querySelector(`[name="${prefix}.overrides.semantics.${key}"]`);
      if (input && !Array.isArray(value)) input.value = value ?? "";
    }
    const selectedAppearance = selected.appearance ?? {};
    const selectedIntensity = advanced.querySelector(`[name="${prefix}.overrides.appearance.intensity"]`);
    const selectedTreatment = advanced.querySelector(`[name="${prefix}.overrides.appearance.treatment"]`);
    if (selectedIntensity) selectedIntensity.value = selectedAppearance.intensity ?? "";
    if (selectedTreatment) selectedTreatment.value = selectedAppearance.treatment ?? "";
    const selectedColor = selectedAppearance.palette?.body;
    colorToggle.checked = Boolean(selectedColor); color.disabled = !selectedColor;
    paletteMarker.value = selectedColor ? "true" : "false";
    if (selectedColor) color.value = selectedColor;
    mode.value = "custom"; profile.value = ""; advanced.open = true; update();
  });
  mode.addEventListener("change", update); update();
  const footer = form.querySelector("footer.form-footer, .form-footer");
  if (footer) footer.before(section); else form.appendChild(section);
  try { app?.setPosition?.({ height: "auto" }); } catch { /* fixed sheet */ }
}

export function normalizeRegionPresentationUpdate(document, changes) {
  const path = `flags.${SUITE_ID}.${FLAGS.presentation}`;
  let raw = foundry.utils.getProperty(changes, path);
  if (raw == null) return;
  let prior = null; try { prior = document.getFlag(SUITE_ID, FLAGS.presentation); } catch { /* inaccessible */ }
  const fullUpdate = Object.hasOwn(raw, "schema") || Object.hasOwn(raw, "mode") || Object.hasOwn(raw, "_paletteEnabled");
  if (!fullUpdate && prior) raw = foundry.utils.mergeObject(foundry.utils.deepClone(prior), raw, { inplace: true });
  const paletteWasExplicitlyDisabled = Object.hasOwn(raw, "_paletteEnabled")
    && raw._paletteEnabled !== true && raw._paletteEnabled !== "true";
  if (Object.hasOwn(raw, "_paletteEnabled")) {
    const enabled = raw._paletteEnabled === true || raw._paletteEnabled === "true";
    delete raw._paletteEnabled;
    if (!enabled && raw.overrides?.appearance) delete raw.overrides.appearance.palette;
  }
  if (raw.mode === "auto" && !raw.snapshot && prior?.snapshot) raw.snapshot = prior.snapshot;
  const compact = compactPresentation(raw);
  if (!compact.profileId && prior?.profileId) compact["-=profileId"] = null;
  if (!compact.snapshot && prior?.snapshot) compact["-=snapshot"] = null;
  if (!compact.overrides && prior?.overrides) compact["-=overrides"] = null;
  if (!compact.label && prior?.label) compact["-=label"] = null;
  if (compact.overrides && prior?.overrides) {
    for (const branch of ["semantics", "appearance"]) {
      for (const key of Object.keys(prior.overrides?.[branch] ?? {})) {
        if (compact.overrides?.[branch]?.[key] != null) continue;
        compact.overrides[branch] ??= {};
        compact.overrides[branch][`-=${key}`] = null;
      }
    }
  }
  /* A disabled color control is authoritative even when the rest of the
     appearance branch still contains intensity or treatment overrides. */
  if (paletteWasExplicitlyDisabled && prior?.overrides?.appearance?.palette && compact.overrides) {
    compact.overrides.appearance ??= {};
    compact.overrides.appearance["-=palette"] = null;
  }
  foundry.utils.setProperty(changes, path, compact);
}
