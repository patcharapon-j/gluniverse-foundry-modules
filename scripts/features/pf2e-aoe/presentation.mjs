/** Runtime bridge from schema-v2 resolved profiles to the renderer's look. */

import { SUITE_ID } from "../../core/const.mjs";
import { lighten } from "../../core/theme.mjs";
import { SETTINGS } from "./constants.mjs";
import { inferredLabel } from "./data.mjs";
import { convertLegacyStyle } from "./migration.mjs";
import { resolveProfile } from "./profiles.mjs";
import { MATERIAL_COLORS, composeLook } from "./render/look.mjs";

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
  const look = composeLook({
    fn: semantics.function,
    secondary: semantics.secondaryFunction,
    material: semantics.material,
    accentMaterial: semantics.accent,
    behavior: semantics.behavior,
    treatment: resolved.appearance.treatment,
    intensity: resolved.appearance.intensity ?? get(SETTINGS.intensity, "balanced"),
    palette: resolved.appearance.palette,
    hotFrom: (body) => lighten(body, 0.58),
  });
  return Object.freeze({ resolved, look, color: look.body, label: resolved.label });
}

export function materialDescriptor(id) {
  const known = Boolean(MATERIAL_COLORS[id]);
  const [body, hot] = MATERIAL_COLORS[known ? id : "neutral"];
  return Object.freeze({ id: known ? id : "neutral", body, hot });
}
