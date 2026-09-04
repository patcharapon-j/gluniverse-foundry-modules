/** Pure schema and normalization contracts for Spellglass presentation v2. */

export const PRESENTATION_SCHEMA = 2;
export const EVIDENCE_VERSION = 1;

export const FUNCTIONS = Object.freeze([
  "harm", "restore", "support", "protect", "hinder", "control",
  "conceal", "terrain", "detect", "summon", "hazard", "neutral",
]);

export const MATERIALS = Object.freeze([
  "fire", "cold", "electricity", "acid", "poison", "sonic", "force",
  "kinetic", "vitality", "void", "spirit", "holy", "unholy", "light",
  "shadow", "mental", "illusion", "air", "earth", "water", "wood",
  "metal", "plant", "fungal", "arcane", "neutral",
]);

export const BEHAVIORS = Object.freeze([
  "impact", "pulse", "flow", "grow", "contain", "sweep", "linger",
  "sustain", "trigger", "static",
]);

export const AUDIENCES = Object.freeze(["all", "allies", "enemies", "self", "unknown"]);
export const SOURCES = Object.freeze([
  "spell", "action", "feat", "feature", "item", "aura", "region", "hazard", "unknown",
]);
export const GEOMETRIES = Object.freeze([
  "burst", "cone", "cube", "cylinder", "emanation", "line", "ring",
  "square", "circle", "ellipse", "rectangle", "polygon", "token", "grid", "unknown",
]);
export const SENSES = Object.freeze(["visual", "auditory", "olfactory", "tremor", "mental", "other"]);
export const CONFIDENCE = Object.freeze(["high", "medium", "low"]);
export const PRESENTATION_MODES = Object.freeze(["auto", "profile", "custom", "native"]);
export const LABEL_MODES = Object.freeze(["inherit", "custom", "hidden"]);
export const INTENSITIES = Object.freeze(["subtle", "balanced", "cinematic"]);
export const QUALITIES = Object.freeze(["auto", "low", "medium", "high"]);

const SETS = Object.freeze({
  function: new Set(FUNCTIONS),
  material: new Set(MATERIALS),
  behavior: new Set(BEHAVIORS),
  audience: new Set(AUDIENCES),
  source: new Set(SOURCES),
  geometry: new Set(GEOMETRIES),
  sense: new Set(SENSES),
});
const HEX = /^#[0-9a-f]{6}$/i;
const PROFILE_ID = /^(?:builtin|world|[a-z][a-z0-9-]{1,31}):[a-z0-9][a-z0-9._-]{0,63}$/;

const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const text = (value, max = 80) => String(value ?? "").trim().slice(0, max);
const enumValue = (axis, value, fallback) => SETS[axis].has(value) ? value : fallback;

export function isProfileId(value, { allowExtension = true } = {}) {
  if (typeof value !== "string" || !PROFILE_ID.test(value)) return false;
  if (allowExtension) return true;
  return value.startsWith("builtin:") || value.startsWith("world:");
}

export function normalizeSemantics(value = {}) {
  const raw = plain(value) ? value : {};
  const primaryFunction = enumValue("function", raw.function, "neutral");
  const primaryMaterial = enumValue("material", raw.material, "neutral");
  const secondaryFunction = enumValue("function", raw.secondaryFunction, null);
  const accent = enumValue("material", raw.accent, null);
  const senses = [...new Set((Array.isArray(raw.senses) ? raw.senses : [])
    .filter((sense) => SETS.sense.has(sense)))];
  return Object.freeze({
    function: primaryFunction,
    secondaryFunction: secondaryFunction === primaryFunction ? null : secondaryFunction,
    material: primaryMaterial,
    accent: accent === primaryMaterial ? null : accent,
    behavior: enumValue("behavior", raw.behavior, "static"),
    audience: enumValue("audience", raw.audience, "unknown"),
    senses: Object.freeze(senses),
    source: enumValue("source", raw.source, "unknown"),
    geometry: enumValue("geometry", raw.geometry, "unknown"),
  });
}

export function normalizeAppearance(value = {}) {
  const raw = plain(value) ? value : {};
  const palette = plain(raw.palette)
    ? Object.freeze(Object.fromEntries(["body", "hot", "accent"]
      .filter((key) => HEX.test(raw.palette[key] ?? ""))
      .map((key) => [key, String(raw.palette[key]).toLowerCase()])))
    : null;
  const intensity = INTENSITIES.includes(raw.intensity) ? raw.intensity : null;
  const treatment = ["grounded", "volumetric", "airborne"].includes(raw.treatment)
    ? raw.treatment : null;
  return Object.freeze({ palette: Object.keys(palette ?? {}).length ? palette : null, intensity, treatment });
}

export function normalizeLabel(value = {}) {
  const raw = plain(value) ? value : {};
  const mode = LABEL_MODES.includes(raw.mode) ? raw.mode : "inherit";
  return Object.freeze({ mode, value: mode === "custom" ? text(raw.value) : "" });
}

export function normalizeSnapshot(value) {
  if (!plain(value)) return null;
  return Object.freeze({
    semantics: normalizeSemantics(value.semantics),
    confidence: CONFIDENCE.includes(value.confidence) ? value.confidence : "low",
    evidenceVersion: Number.isInteger(value.evidenceVersion) ? value.evidenceVersion : EVIDENCE_VERSION,
  });
}

/** Normalize untrusted stored Region presentation. Unknown enum IDs never escape. */
export function normalizePresentation(value = {}) {
  const raw = plain(value) ? value : {};
  const mode = PRESENTATION_MODES.includes(raw.mode) ? raw.mode : "auto";
  const semantics = plain(raw.overrides?.semantics) ? raw.overrides.semantics : {};
  const normalizedSemantics = normalizeSemantics(semantics);
  const sparseSemantics = {};
  for (const key of Object.keys(semantics)) {
    const axis = key === "secondaryFunction" ? "function" : key === "accent" ? "material" : key;
    if (["function", "material", "behavior", "audience", "source", "geometry"].includes(axis)
      && SETS[axis].has(semantics[key])) sparseSemantics[key] = normalizedSemantics[key];
    if (key === "senses" && Array.isArray(semantics.senses)) sparseSemantics.senses = normalizedSemantics.senses;
  }
  const appearance = normalizeAppearance(raw.overrides?.appearance);
  const sparseAppearance = Object.fromEntries(Object.entries(appearance).filter(([, entry]) => entry != null));
  return Object.freeze({
    schema: PRESENTATION_SCHEMA,
    mode,
    profileId: mode === "profile" && isProfileId(raw.profileId) ? raw.profileId : null,
    snapshot: normalizeSnapshot(raw.snapshot),
    overrides: Object.freeze({
      semantics: Object.freeze(sparseSemantics),
      appearance: Object.freeze(sparseAppearance),
    }),
    label: normalizeLabel(raw.label),
  });
}

/** Compact normalized presentation data for storage. */
export function compactPresentation(value = {}) {
  const normalized = normalizePresentation(value);
  const out = { schema: PRESENTATION_SCHEMA, mode: normalized.mode };
  if (normalized.mode === "profile" && normalized.profileId) out.profileId = normalized.profileId;
  if (normalized.snapshot) out.snapshot = normalized.snapshot;
  const semantics = Object.fromEntries(Object.entries(normalized.overrides.semantics)
    .filter(([, entry]) => entry != null && (!Array.isArray(entry) || entry.length)));
  const appearance = Object.fromEntries(Object.entries(normalized.overrides.appearance)
    .filter(([, entry]) => entry != null));
  if (Object.keys(semantics).length || Object.keys(appearance).length) {
    out.overrides = {};
    if (Object.keys(semantics).length) out.overrides.semantics = semantics;
    if (Object.keys(appearance).length) out.overrides.appearance = appearance;
  }
  if (normalized.label.mode !== "inherit" || normalized.label.value) out.label = normalized.label;
  return out;
}

export function validatePresentation(value) {
  const errors = [];
  if (!plain(value)) return { valid: false, errors: ["presentation must be an object"] };
  if (value.schema !== PRESENTATION_SCHEMA) errors.push(`schema must be ${PRESENTATION_SCHEMA}`);
  if (!PRESENTATION_MODES.includes(value.mode)) errors.push("mode is unknown");
  if (value.profileId != null && !isProfileId(value.profileId)) errors.push("profileId is invalid");
  if (value.mode === "profile" && !isProfileId(value.profileId)) errors.push("profile mode requires profileId");
  if (plain(value.label) && !LABEL_MODES.includes(value.label.mode)) errors.push("label mode is unknown");
  const semantics = value.overrides?.semantics;
  if (plain(semantics)) {
    for (const [key, entry] of Object.entries(semantics)) {
      const axis = key === "secondaryFunction" ? "function" : key === "accent" ? "material" : key;
      if (["function", "material", "behavior", "audience", "source", "geometry"].includes(axis)
        && !SETS[axis].has(entry)) errors.push(`unknown ${key}: ${entry}`);
      if (key === "senses" && (!Array.isArray(entry) || entry.some((sense) => !SETS.sense.has(sense)))) {
        errors.push("senses contain an unknown value");
      }
    }
  }
  if (own(value, "label") && value.label?.mode === "custom" && typeof value.label.value !== "string") {
    errors.push("custom label value must be a string");
  }
  return { valid: errors.length === 0, errors };
}

export function presentationLabel(presentation, inherited = "") {
  const label = normalizeLabel(presentation?.label);
  if (label.mode === "hidden") return "";
  if (label.mode === "custom") return label.value;
  return text(inherited);
}
