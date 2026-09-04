/** Pure legacy Spellglass migration preflight and conversion. No document writes. */

import { EVIDENCE_VERSION, PRESENTATION_SCHEMA, normalizePresentation } from "./schema.mjs";

export const LEGACY_ARCHETYPE_MAP = Object.freeze({
  ember: { function: "harm", material: "fire", behavior: "impact" },
  frost: { function: "harm", material: "cold", behavior: "linger" },
  arc: { function: "harm", material: "electricity", behavior: "pulse" },
  caustic: { function: "harm", material: "acid", behavior: "flow" },
  resonance: { function: "harm", material: "sonic", behavior: "pulse" },
  radiance: { function: "restore", material: "vitality", behavior: "pulse" },
  umbra: { function: "harm", material: "void", behavior: "linger" },
  spirit: { function: "harm", material: "spirit", behavior: "pulse" },
  force: { function: "harm", material: "force", behavior: "impact" },
  kinetic: { function: "harm", material: "kinetic", behavior: "impact" },
  verdant: { function: "terrain", material: "plant", behavior: "grow" },
  arcane: { function: "neutral", material: "arcane", behavior: "sustain" },
  generic: { function: "neutral", material: "neutral", behavior: "static" },
  warning: { function: "hazard", material: "neutral", behavior: "trigger" },
});

const HEX = /^#[0-9a-f]{6}$/i;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);

export function convertLegacyStyle(value = {}, { suppressed = false } = {}) {
  const raw = plain(value) ? value : {};
  if (raw.schema === PRESENTATION_SCHEMA) return normalizePresentation(raw);
  if (suppressed) return normalizePresentation({ schema: PRESENTATION_SCHEMA, mode: "native" });
  const semantics = LEGACY_ARCHETYPE_MAP[raw.archetype] ?? LEGACY_ARCHETYPE_MAP.generic;
  const appearance = {};
  if (raw.colorOverride !== false && HEX.test(raw.color ?? "")) {
    appearance.palette = { body: String(raw.color).toLowerCase() };
  }
  const label = own(raw, "label")
    ? raw.label ? { mode: "custom", value: raw.label } : { mode: "hidden", value: "" }
    : { mode: "inherit", value: "" };
  return normalizePresentation({
    schema: PRESENTATION_SCHEMA,
    mode: "custom",
    snapshot: { semantics, confidence: LEGACY_ARCHETYPE_MAP[raw.archetype] ? "medium" : "low", evidenceVersion: EVIDENCE_VERSION },
    overrides: { appearance },
    label,
  });
}

/** Inspect serializable candidates and return a deterministic, downloadable report payload. */
export function migrationPreflight(candidates = [], options = {}) {
  const entries = [];
  const warnings = [];
  for (const candidate of [...candidates].sort((a, b) => String(a.uuid).localeCompare(String(b.uuid)))) {
    const style = candidate?.style;
    if (!plain(style) && !candidate?.suppressed) continue;
    const entryWarnings = [];
    if (style?.archetype != null && !LEGACY_ARCHETYPE_MAP[style.archetype]) entryWarnings.push(`unknown archetype: ${style.archetype}`);
    if (style?.color != null && !HEX.test(style.color)) entryWarnings.push(`invalid color: ${style.color}`);
    if (style?.label != null && typeof style.label !== "string") entryWarnings.push("label is not text");
    const entry = Object.freeze({
      uuid: String(candidate.uuid ?? ""),
      original: Object.freeze({ style: structuredCloneSafe(style), suppressed: Boolean(candidate.suppressed) }),
      presentation: convertLegacyStyle(style, { suppressed: candidate.suppressed }),
      warnings: Object.freeze(entryWarnings),
    });
    entries.push(entry);
    for (const warning of entryWarnings) warnings.push(`${entry.uuid}: ${warning}`);
  }
  return Object.freeze({
    schema: 1,
    targetSchema: PRESENTATION_SCHEMA,
    moduleVersion: String(options.moduleVersion ?? "unknown"),
    systemVersion: String(options.systemVersion ?? "unknown"),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    counts: Object.freeze({ candidates: candidates.length, affected: entries.length, warnings: warnings.length }),
    legacySettings: structuredCloneSafe(options.legacySettings ?? {}),
    entries: Object.freeze(entries),
    warnings: Object.freeze(warnings),
  });
}

function structuredCloneSafe(value) {
  if (value == null) return value;
  try { return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  catch { return null; }
}
