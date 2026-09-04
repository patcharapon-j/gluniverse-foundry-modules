/** Built-in/world/extension profiles and pure Region resolution precedence. */

import { classify } from "./classifier.mjs";
import {
  PRESENTATION_SCHEMA, isProfileId, normalizeAppearance, normalizePresentation,
  normalizeSemantics, presentationLabel,
} from "./schema.mjs";

const profile = (id, semantics, appearance = {}) => Object.freeze({
  id: `builtin:${id}`,
  nameKey: `GLAOE.Profile.${id}`,
  semantics: normalizeSemantics(semantics),
  appearance: normalizeAppearance(appearance),
});

export const BUILTIN_PROFILES = Object.freeze([
  profile("flame-burst", { function: "harm", material: "fire", behavior: "impact" }, { treatment: "volumetric" }),
  profile("rime-field", { function: "harm", material: "cold", behavior: "linger" }, { treatment: "grounded" }),
  profile("storm-arc", { function: "harm", material: "electricity", behavior: "pulse" }, { treatment: "airborne" }),
  profile("caustic-pool", { function: "harm", material: "acid", behavior: "flow" }, { treatment: "grounded" }),
  profile("venom-cloud", { function: "harm", material: "poison", behavior: "linger" }, { treatment: "airborne" }),
  profile("resonance-wave", { function: "harm", material: "sonic", behavior: "pulse" }),
  profile("renewal", { function: "restore", material: "vitality", behavior: "pulse" }),
  profile("spirit-mend", { function: "restore", material: "spirit", behavior: "flow" }),
  profile("blessing", { function: "support", material: "holy", behavior: "sustain" }),
  profile("arcane-link", { function: "support", material: "arcane", behavior: "pulse" }),
  profile("force-ward", { function: "protect", material: "force", behavior: "contain" }),
  profile("stone-bastion", { function: "protect", material: "earth", behavior: "contain" }, { treatment: "grounded" }),
  profile("binding-field", { function: "hinder", material: "force", behavior: "contain" }),
  profile("mental-drag", { function: "hinder", material: "mental", behavior: "pulse" }),
  profile("containment", { function: "control", material: "arcane", behavior: "contain" }),
  profile("water-sweep", { function: "control", material: "water", behavior: "sweep" }),
  profile("shadow-veil", { function: "conceal", material: "shadow", behavior: "linger" }, { treatment: "airborne" }),
  profile("mirage", { function: "conceal", material: "illusion", behavior: "flow" }),
  profile("verdant-ground", { function: "terrain", material: "plant", behavior: "grow" }, { treatment: "grounded" }),
  profile("shifting-earth", { function: "terrain", material: "earth", behavior: "flow" }, { treatment: "grounded" }),
  profile("revelation-scan", { function: "detect", material: "light", behavior: "sweep" }),
  profile("summoning-gate", { function: "summon", material: "spirit", behavior: "grow" }),
  profile("armed-hazard", { function: "hazard", material: "metal", behavior: "trigger" }, { intensity: "balanced" }),
  profile("etched-neutral", { function: "neutral", material: "neutral", behavior: "static" }, { treatment: "grounded" }),
]);

const BUILTIN_MAP = new Map(BUILTIN_PROFILES.map((entry) => [entry.id, entry]));
const EXTENSIONS = new Map();
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);

export function normalizeProfile(value, { world = false } = {}) {
  if (!plain(value) || !isProfileId(value.id)) return null;
  if (world && !value.id.startsWith("world:")) return null;
  const name = String(value.name ?? "").trim().slice(0, 80);
  if (world && !name) return null;
  return Object.freeze({
    id: value.id,
    ...(world ? { name } : value.nameKey ? { nameKey: String(value.nameKey) } : { name }),
    semantics: normalizeSemantics(value.semantics),
    appearance: normalizeAppearance(value.appearance),
  });
}

export function normalizeWorldProfiles(value = {}) {
  const profiles = [];
  const seen = new Set();
  for (const raw of Array.isArray(value?.profiles) ? value.profiles : []) {
    const entry = normalizeProfile(raw, { world: true });
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id); profiles.push(entry);
  }
  return Object.freeze({ schema: 1, profiles: Object.freeze(profiles) });
}

export function profileById(id, worldProfiles = {}) {
  if (BUILTIN_MAP.has(id)) return BUILTIN_MAP.get(id);
  const world = normalizeWorldProfiles(worldProfiles).profiles.find((entry) => entry.id === id);
  if (world) return world;
  return EXTENSIONS.get(id) ?? null;
}

export function registerProfile(namespace, value) {
  const cleanNamespace = String(namespace ?? "").toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(cleanNamespace) || ["builtin", "world"].includes(cleanNamespace)) {
    throw new TypeError("Spellglass profile namespace is invalid");
  }
  const entry = normalizeProfile(value);
  if (!entry || !entry.id.startsWith(`${cleanNamespace}:`)) throw new TypeError("Profile id must use its registration namespace");
  EXTENSIONS.set(entry.id, entry);
  return entry;
}

export function unregisterProfiles(namespace) {
  const prefix = `${String(namespace ?? "").toLowerCase()}:`;
  let removed = 0;
  for (const id of [...EXTENSIONS.keys()]) if (id.startsWith(prefix)) { EXTENSIONS.delete(id); removed++; }
  return removed;
}

function mergeSemantics(base, overrides) {
  return normalizeSemantics({ ...base, ...(plain(overrides) ? overrides : {}) });
}

function mergeAppearance(base, overrides) {
  const raw = { ...(base ?? {}), ...(plain(overrides) ? overrides : {}) };
  if (base?.palette || overrides?.palette) raw.palette = { ...(base?.palette ?? {}), ...(overrides?.palette ?? {}) };
  return normalizeAppearance(raw);
}

/** Resolve native > overrides > profile > snapshot > live evidence > neutral. */
export function resolveProfile(source, options = {}) {
  let stored = null;
  const document = source?.document ?? source;
  try { stored = options.suiteId ? document?.getFlag?.(options.suiteId, "aoe.presentation") : null; } catch { /* inaccessible */ }
  const namespace = document?.flags?.[options.suiteId];
  const rawPresentation = options.presentation ?? source?.presentation ?? stored
    ?? namespace?.aoe?.presentation ?? namespace?.["aoe.presentation"];
  const presentation = normalizePresentation(rawPresentation);
  if (presentation.mode === "native") return Object.freeze({ native: true, presentation, reason: "region-opt-out" });

  const selected = presentation.mode === "profile" && presentation.profileId
    ? profileById(presentation.profileId, options.worldProfiles) : null;
  const live = classify(source, options.classification ?? {});
  let baseSemantics;
  let baseAppearance = normalizeAppearance();
  let confidence;
  let origin;
  if (selected) {
    baseSemantics = selected.semantics; baseAppearance = selected.appearance; confidence = "high"; origin = "profile";
  } else if (presentation.snapshot) {
    baseSemantics = presentation.snapshot.semantics; confidence = presentation.snapshot.confidence; origin = "snapshot";
  } else {
    baseSemantics = live.semantics; confidence = live.confidence; origin = live.needsClassification ? "fallback" : "evidence";
  }
  const semantics = mergeSemantics(baseSemantics, presentation.overrides.semantics);
  const appearance = mergeAppearance(baseAppearance, presentation.overrides.appearance);
  return Object.freeze({
    native: false,
    schema: PRESENTATION_SCHEMA,
    profileId: selected?.id ?? null,
    semantics,
    appearance,
    label: presentationLabel(presentation, options.inheritedLabel),
    labelMode: presentation.label.mode,
    confidence,
    needsClassification: origin === "fallback" && !Object.keys(presentation.overrides.semantics).length,
    origin,
    evidence: live.evidence,
    presentation,
  });
}

export function detachProfile(source, options = {}) {
  const resolved = resolveProfile(source, options);
  if (resolved.native) return normalizePresentation({ schema: PRESENTATION_SCHEMA, mode: "native" });
  return normalizePresentation({
    schema: PRESENTATION_SCHEMA,
    mode: "custom",
    overrides: { semantics: resolved.semantics, appearance: resolved.appearance },
    label: resolved.presentation.label,
  });
}
