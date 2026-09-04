/** Pure PF2e/Foundry semantic evidence collection. Description text is ignored. */

import { BEHAVIORS, FUNCTIONS, GEOMETRIES, MATERIALS, SOURCES } from "./schema.mjs";

const FUNCTION_SET = new Set(FUNCTIONS);
const MATERIAL_SET = new Set(MATERIALS);
const BEHAVIOR_SET = new Set(BEHAVIORS);
const SOURCE_SET = new Set(SOURCES);
const GEOMETRY_SET = new Set(GEOMETRIES);

const TRAIT_MATERIAL = Object.freeze({
  fire: "fire", cold: "cold", electricity: "electricity", acid: "acid", poison: "poison",
  sonic: "sonic", force: "force", vitality: "vitality", void: "void", spirit: "spirit",
  holy: "holy", unholy: "unholy", light: "light", darkness: "shadow", mental: "mental",
  illusion: "illusion", air: "air", earth: "earth", water: "water", wood: "wood",
  metal: "metal", plant: "plant", fungus: "fungal", fungal: "fungal",
});
const DAMAGE_MATERIAL = Object.freeze({
  fire: "fire", cold: "cold", electricity: "electricity", acid: "acid", poison: "poison",
  sonic: "sonic", force: "force", vitality: "vitality", void: "void", spirit: "spirit",
  mental: "mental", bludgeoning: "kinetic", piercing: "kinetic", slashing: "kinetic",
  bleed: "kinetic", untyped: "arcane",
});
const TYPE_SOURCE = Object.freeze({ spell: "spell", action: "action", feat: "feat", effect: "feature", equipment: "item", consumable: "item", weapon: "item" });
const AREA_GEOMETRY = Object.freeze({ burst: "burst", cone: "cone", cube: "cube", cylinder: "cylinder", emanation: "emanation", line: "line", ring: "ring", square: "square" });

/** Curated structured exceptions for terms whose traits alone are ambiguous. */
export const CURATED_SLUGS = Object.freeze({
  "bless": { function: "support", material: "holy", behavior: "sustain" },
  "bane": { function: "hinder", material: "unholy", behavior: "sustain" },
  "circle-of-protection": { function: "protect", material: "holy", behavior: "contain" },
  "darkness": { function: "conceal", material: "shadow", behavior: "linger" },
  "detect-magic": { function: "detect", material: "arcane", behavior: "sweep" },
  "entangling-flora": { function: "terrain", material: "plant", behavior: "grow" },
  "grease": { function: "terrain", material: "neutral", behavior: "linger" },
  "silence": { function: "conceal", material: "sonic", behavior: "contain" },
  "summon-animal": { function: "summon", material: "spirit", behavior: "grow" },
  "wall-of-force": { function: "protect", material: "force", behavior: "contain" },
});

const asArray = (value) => value instanceof Set ? [...value]
  : Array.isArray(value) ? value
    : value && typeof value === "object" ? Object.keys(value).filter((key) => value[key]) : [];
const slug = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function itemFor(source, options) {
  const document = source?.document ?? source;
  const origin = document?.flags?.pf2e?.origin ?? options.origin ?? {};
  if (options.item) return options.item;
  if (source?.item) return source.item;
  if (typeof options.resolveUuid !== "function") return null;
  const uuid = origin.uuid ?? origin.itemUuid;
  try {
    const resolved = uuid ? options.resolveUuid(uuid) : null;
    return resolved?.original ?? resolved;
  }
  catch { return null; }
}

function collectDamageTypes(value, out = new Set(), depth = 0) {
  if (value == null || depth > 8) return out;
  if (typeof value === "string") {
    if (value in DAMAGE_MATERIAL) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectDamageTypes(child, out, depth + 1);
    return out;
  }
  if (typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    if (["type", "damageType", "damage-type"].includes(key) && typeof child === "string" && child in DAMAGE_MATERIAL) out.add(child);
    else if (["damage", "damages", "formula", "instances", "persistent", "rolls"].includes(key) || depth < 2) collectDamageTypes(child, out, depth + 1);
  }
  return out;
}

function record(out, axis, value, weight, source, reason) {
  const allowed = axis === "function" ? FUNCTION_SET : axis === "material" ? MATERIAL_SET : axis === "behavior" ? BEHAVIOR_SET : null;
  if (!allowed?.has(value)) return;
  out.push(Object.freeze({ axis, value, weight, source, reason }));
}

function modifier(out, axis, value, weight, source, reason) {
  out.push(Object.freeze({ axis, value, weight, source, reason }));
}

function sourceType(item, origin, aura, document) {
  if (aura) return "aura";
  const type = item?.type ?? origin.type ?? document?.flags?.pf2e?.origin?.type;
  if (SOURCE_SET.has(type)) return type;
  return TYPE_SOURCE[type] ?? (document?.documentName === "Region" ? "region" : "unknown");
}

function geometryType(source, document) {
  const area = document?.flags?.pf2e?.areaShape;
  if (AREA_GEOMETRY[area]) return AREA_GEOMETRY[area];
  const shapes = source?.animationState?.shapes ?? document?.shapes;
  const shape = shapes?.contents?.[0] ?? shapes?.[0] ?? shapes?.at?.(0);
  return GEOMETRY_SET.has(shape?.type) ? shape.type : "unknown";
}

/** Return deterministic evidence records from structured source data only. */
export function collectEvidence(source, options = {}) {
  const out = [];
  const document = source?.document ?? source ?? {};
  const origin = document?.flags?.pf2e?.origin ?? options.origin ?? {};
  const aura = source?.glAoeAuraRenderer ?? options.aura ?? null;
  const item = itemFor(source, options);
  const itemSlug = slug(item?.slug ?? item?.system?.slug ?? origin.slug ?? aura?.slug ?? document?.name);
  const rollOptionTerms = asArray(origin.rollOptions).flatMap((option) => {
    const parts = String(option ?? "").toLowerCase().split(":").filter(Boolean);
    return [option, ...parts];
  });
  const traits = new Set([
    ...asArray(origin.traits), ...rollOptionTerms,
    ...asArray(item?.system?.traits?.value), ...asArray(aura?.traits),
  ].map(slug));

  const explicit = options.explicitSemantics;
  if (explicit && typeof explicit === "object") {
    record(out, "function", explicit.function, 100, "explicit", "explicit primary function");
    record(out, "function", explicit.secondaryFunction, 95, "explicit", "explicit secondary function");
    record(out, "material", explicit.material, 100, "explicit", "explicit primary material");
    record(out, "material", explicit.accent, 95, "explicit", "explicit material accent");
    record(out, "behavior", explicit.behavior, 100, "explicit", "explicit behavior");
  }

  const curated = CURATED_SLUGS[itemSlug];
  if (curated) {
    record(out, "function", curated.function, 82, "curated", `curated slug ${itemSlug}`);
    record(out, "material", curated.material, 82, "curated", `curated slug ${itemSlug}`);
    record(out, "behavior", curated.behavior, 82, "curated", `curated slug ${itemSlug}`);
  }

  const damages = collectDamageTypes(item?.system?.damage ?? origin.damage);
  for (const type of damages) {
    record(out, "function", type === "vitality" && traits.has("healing") ? "restore" : "harm", 72, "damage", `${type} damage instance`);
    record(out, "material", DAMAGE_MATERIAL[type], 72, "damage", `${type} damage material`);
  }
  if (traits.has("healing")) record(out, "function", "restore", 78, "trait", "healing trait");
  if (traits.has("aura")) record(out, "behavior", "sustain", 44, "trait", "aura trait");
  if (traits.has("incapacitation") || traits.has("manipulate")) record(out, "function", "control", 34, "trait", "control-associated trait");
  if (traits.has("illusion")) record(out, "function", "conceal", 38, "trait", "illusion trait");
  if (traits.has("summon") || traits.has("summoned")) record(out, "function", "summon", 66, "trait", "summoning trait");
  if (traits.has("trap") || traits.has("hazard")) record(out, "function", "hazard", 72, "trait", "hazard trait");
  for (const trait of traits) if (TRAIT_MATERIAL[trait]) record(out, "material", TRAIT_MATERIAL[trait], 48, "trait", `${trait} trait`);

  const movement = options.regionBehavior ?? document?.behaviors?.find?.((behavior) => /terrain|difficult|movement/i.test(behavior?.type ?? behavior?.system?.type ?? ""));
  if (movement) {
    record(out, "function", "terrain", 76, "region-behavior", "recognized movement behavior");
    record(out, "behavior", "linger", 58, "region-behavior", "persistent terrain behavior");
  }
  if (aura) {
    record(out, "behavior", aura.events?.length ? "pulse" : "sustain", 62, "aura", "live PF2e aura lifecycle");
    modifier(out, "audience", aura.affects ?? aura.audience ?? "unknown", 70, "aura", "PF2e aura audience");
  }

  modifier(out, "source", sourceType(item, origin, aura, document), 80, "structure", "originating document type");
  modifier(out, "geometry", geometryType(source, document), 80, "structure", "authoritative Region area shape");
  if (traits.has("auditory")) modifier(out, "sense", "auditory", 50, "trait", "auditory trait");
  if (traits.has("visual")) modifier(out, "sense", "visual", 50, "trait", "visual trait");
  return Object.freeze(out);
}
