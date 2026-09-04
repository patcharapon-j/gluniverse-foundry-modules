/** Runtime bridge from schema-v2 resolved profiles to compositional shader inputs. */

import { SUITE_ID } from "../../core/const.mjs";
import { hexToRgbFloat, lighten } from "../../core/theme.mjs";
import { SETTINGS } from "./constants.mjs";
import { inferredLabel } from "./data.mjs";
import { convertLegacyStyle } from "./migration.mjs";
import { resolveProfile } from "./profiles.mjs";
import { BEHAVIORS, FUNCTIONS, MATERIALS } from "./schema.mjs";

const MATERIAL = Object.freeze({
  fire: ["#ff6a21", "#fff0b8", 0], cold: ["#62c9ef", "#effdff", 1],
  electricity: ["#718aff", "#eef3ff", 2], acid: ["#9ed926", "#f2ff9e", 3],
  poison: ["#7fc93a", "#e8ff9b", 3], sonic: ["#c15eff", "#fae3ff", 4],
  force: ["#82b7ff", "#ecf7ff", 8], kinetic: ["#bd7555", "#f2d0b5", 9],
  vitality: ["#ffe16b", "#ffffef", 5], void: ["#583485", "#bda0e8", 6],
  spirit: ["#8df2cb", "#e8fff7", 7], holy: ["#ffe681", "#fffef1", 5],
  unholy: ["#6e3d91", "#d0abe7", 6], light: ["#fff09b", "#ffffff", 5],
  shadow: ["#4b376c", "#aa91c7", 6], mental: ["#cf6ef2", "#ffe8ff", 4],
  illusion: ["#b18cff", "#f6edff", 11], air: ["#9adbec", "#f1fdff", 11],
  earth: ["#a6754e", "#e5c39c", 9], water: ["#3ca7df", "#c7f4ff", 11],
  wood: ["#8bb45e", "#d9edaa", 10], metal: ["#9ba9bd", "#edf4ff", 9],
  plant: ["#72af48", "#cfe98c", 10], fungal: ["#9b7ac9", "#e7d6fa", 10],
  arcane: ["#a89cff", "#eeebff", 11], neutral: ["#759dff", "#c9dcff", 12],
});

const FUNCTION_ACCENT = Object.freeze({
  harm: "#ff6b52", restore: "#8fffc0", support: "#78dfff", protect: "#a8c8ff",
  hinder: "#ffb154", control: "#d49aff", conceal: "#8c86aa", terrain: "#b6cf78",
  detect: "#fff08d", summon: "#8ff4dc", hazard: "#ff3f4e", neutral: "#aebdd4",
});

const TREATMENT = Object.freeze({
  grounded: { mix: [1, 0.30, 0.45], char: [1, 1, 1, 1] },
  volumetric: { mix: [0.42, 0.95, 1.55], char: [0.22, 0.55, 0.50, 1.45] },
  airborne: { mix: [0.14, 1.50, 0.22], char: [0, 2.40, 0.28, 1.75] },
});
const DEFAULT_TREATMENT = Object.freeze({
  conceal: "airborne", terrain: "grounded", protect: "grounded", hazard: "grounded",
  summon: "volumetric", harm: "volumetric",
});
const ENTER_MODE = Object.freeze({ impact: 2, pulse: 2, flow: 1, grow: 1, contain: 0, sweep: 0, linger: 1, sustain: 0, trigger: 2, static: 0 });
const INTENSITY = Object.freeze({ subtle: 0.78, balanced: 1, cinematic: 1.18 });

function get(key, fallback) {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
}

function resolveUuid(uuid) {
  try { return typeof fromUuidSync === "function" ? fromUuidSync(uuid) : null; }
  catch { return null; }
}

function inherited(document, region) {
  const aura = region?.glAoeAuraRenderer;
  if (aura?.name && aura?.token?.visible) return String(aura.name).slice(0, 80);
  return inferredLabel(document);
}

export function presentationStyle(region, options = {}) {
  const document = region?.document ?? region;
  let presentation = options.presentation;
  try {
    if (!presentation && !document?.getFlag?.(SUITE_ID, "aoe.presentation")) {
      const legacy = document?.getFlag?.(SUITE_ID, "aoe.style");
      const suppressed = Boolean(document?.getFlag?.(SUITE_ID, "aoe.suppress"));
      if (legacy || suppressed) presentation = convertLegacyStyle(legacy, { suppressed });
    }
  } catch { /* inaccessible flags */ }
  const resolved = resolveProfile(region, {
    suiteId: SUITE_ID,
    worldProfiles: options.worldProfiles ?? get(SETTINGS.profiles, { schema: 1, profiles: [] }),
    inheritedLabel: inherited(document, region),
    presentation,
    classification: { resolveUuid, item: options.item, aura: region?.glAoeAuraRenderer },
  });
  if (resolved.native) return null;
  const semantics = resolved.semantics;
  const base = MATERIAL[semantics.material] ?? MATERIAL.neutral;
  const palette = resolved.appearance.palette ?? {};
  const color = palette.body ?? base[0];
  const hot = palette.hot ?? (palette.body ? lighten(color, 0.58) : base[1]);
  const accent = palette.accent ?? FUNCTION_ACCENT[semantics.function] ?? FUNCTION_ACCENT.neutral;
  const treatmentId = resolved.appearance.treatment ?? DEFAULT_TREATMENT[semantics.function] ?? "grounded";
  const treatment = TREATMENT[treatmentId] ?? TREATMENT.grounded;
  const intensityId = resolved.appearance.intensity ?? get(SETTINGS.intensity, "balanced");
  return Object.freeze({
    resolved,
    color,
    tint: new Float32Array(hexToRgbFloat(color)),
    hot: new Float32Array(hexToRgbFloat(hot)),
    accent: new Float32Array(hexToRgbFloat(accent)),
    materialIndex: base[2],
    functionIndex: FUNCTIONS.indexOf(semantics.function),
    secondaryFunctionIndex: semantics.secondaryFunction ? FUNCTIONS.indexOf(semantics.secondaryFunction) : -1,
    behaviorIndex: BEHAVIORS.indexOf(semantics.behavior),
    canonicalMaterialIndex: MATERIALS.indexOf(semantics.material),
    enterMode: ENTER_MODE[semantics.behavior] ?? 0,
    mix: new Float32Array(treatment.mix.map((value) => value * (INTENSITY[intensityId] ?? 1))),
    character: new Float32Array(treatment.char),
    label: resolved.label,
  });
}

export function materialDescriptor(id) {
  const entry = MATERIAL[id] ?? MATERIAL.neutral;
  return Object.freeze({ id: MATERIAL[id] ? id : "neutral", body: entry[0], hot: entry[1], proceduralFamily: entry[2] });
}
