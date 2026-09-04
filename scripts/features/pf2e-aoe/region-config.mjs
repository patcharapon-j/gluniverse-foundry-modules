/** PF2e AoE — fields appended to Foundry's Region configuration form. */

import { SUITE_ID } from "../../core/const.mjs";
import { ARCHETYPES, FLAGS } from "./constants.mjs";
import { authoredStyle } from "./data.mjs";

const MARK = "glAoeStyle";
const t = (key) => game.i18n.localize(key);

function field(label, input, hint) {
  const group = document.createElement("div");
  group.className = "form-group";
  const lab = document.createElement("label");
  lab.textContent = label;
  const fields = document.createElement("div");
  fields.className = "form-fields";
  fields.appendChild(input);
  group.append(lab, fields);
  if (hint) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = hint;
    group.appendChild(p);
  }
  return group;
}

export function injectRegionStyle(app, element) {
  if (!game.user?.isGM) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const regionDoc = app?.document ?? app?.object;
  if (!root || regionDoc?.documentName !== "Region" || root.querySelector(`[data-${MARK}]`)) return;
  const form = root.matches("form") ? root : root.querySelector("form");
  if (!form) return;

  let raw = {};
  try { raw = regionDoc.getFlag(SUITE_ID, FLAGS.style) ?? {}; } catch { /* no flag */ }
  const resolved = authoredStyle(regionDoc);
  const prefix = `flags.${SUITE_ID}.${FLAGS.style}`;
  const section = globalThis.document.createElement("fieldset");
  section.dataset[MARK] = "1";
  section.className = "gl-aoe-region-style";
  const legend = globalThis.document.createElement("legend");
  legend.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> ${t("GLAOE.RegionStyle.Legend")}`;
  section.appendChild(legend);

  const archetype = globalThis.document.createElement("select");
  archetype.name = `${prefix}.archetype`;
  const auto = globalThis.document.createElement("option");
  auto.value = "";
  auto.textContent = t("GLAOE.RegionStyle.Auto");
  archetype.appendChild(auto);
  for (const id of ARCHETYPES) {
    const option = globalThis.document.createElement("option");
    option.value = id;
    option.textContent = t(`GLAOE.Archetype.${id}`);
    option.selected = raw.archetype === id;
    archetype.appendChild(option);
  }
  section.appendChild(field(t("GLAOE.RegionStyle.Archetype"), archetype, t("GLAOE.RegionStyle.ArchetypeHint")));

  const color = globalThis.document.createElement("input");
  color.type = "color";
  color.name = `${prefix}.color`;
  color.value = raw.color ?? resolved.color;
  const colorOverride = globalThis.document.createElement("input");
  colorOverride.type = "checkbox";
  colorOverride.name = `${prefix}.colorOverride`;
  colorOverride.checked = raw.colorOverride ?? Boolean(raw.color);
  color.disabled = !colorOverride.checked;
  colorOverride.addEventListener("change", () => { color.disabled = !colorOverride.checked; });
  const colorFields = globalThis.document.createElement("div");
  colorFields.className = "gl-aoe-color-override";
  const toggleLabel = globalThis.document.createElement("label");
  toggleLabel.className = "checkbox";
  toggleLabel.append(colorOverride, ` ${t("GLAOE.RegionStyle.ColorOverride")}`);
  colorFields.append(toggleLabel, color);
  section.appendChild(field(t("GLAOE.RegionStyle.Color"), colorFields, t("GLAOE.RegionStyle.ColorHint")));

  const label = globalThis.document.createElement("input");
  label.type = "text";
  label.name = `${prefix}.label`;
  label.maxLength = 80;
  label.value = raw.label ?? "";
  label.placeholder = t("GLAOE.RegionStyle.LabelPlaceholder");
  section.appendChild(field(t("GLAOE.RegionStyle.Label"), label, t("GLAOE.RegionStyle.LabelHint")));

  const footer = form.querySelector("footer.form-footer, .form-footer");
  if (footer) footer.before(section); else form.appendChild(section);
  try { app?.setPosition?.({ height: "auto" }); } catch { /* fixed sheet */ }
}
