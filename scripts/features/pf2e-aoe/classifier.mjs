/** Deterministic evidence aggregation for Spellglass semantics. */

import { collectEvidence } from "./evidence.mjs";
import {
  AUDIENCES, BEHAVIORS, EVIDENCE_VERSION, FUNCTIONS, GEOMETRIES, MATERIALS,
  SENSES, SOURCES, normalizeSemantics,
} from "./schema.mjs";

const ORDER = Object.freeze({
  function: new Map(FUNCTIONS.map((value, index) => [value, index])),
  material: new Map(MATERIALS.map((value, index) => [value, index])),
  behavior: new Map(BEHAVIORS.map((value, index) => [value, index])),
  audience: new Map(AUDIENCES.map((value, index) => [value, index])),
  source: new Map(SOURCES.map((value, index) => [value, index])),
  geometry: new Map(GEOMETRIES.map((value, index) => [value, index])),
  sense: new Map(SENSES.map((value, index) => [value, index])),
});
const SOURCE_PRIORITY = Object.freeze({
  explicit: 0, curated: 1, damage: 2, aura: 3, "region-behavior": 4, trait: 5, structure: 6, fallback: 7,
});
const AMBIGUOUS_FUNCTIONS = Object.freeze([
  new Set(["support", "protect"]), new Set(["hinder", "control"]),
  new Set(["terrain", "control"]), new Set(["summon", "control"]),
  new Set(["detect", "harm"]), new Set(["conceal", "control"]),
]);

function stableEvidence(records) {
  return [...records].sort((a, b) =>
    (SOURCE_PRIORITY[a.source] ?? 99) - (SOURCE_PRIORITY[b.source] ?? 99)
    || (ORDER[a.axis]?.get(a.value) ?? 999) - (ORDER[b.axis]?.get(b.value) ?? 999)
    || b.weight - a.weight
    || String(a.reason).localeCompare(String(b.reason)));
}

function ranked(records, axis) {
  const scores = new Map();
  for (const record of records) {
    if (record.axis !== axis || !ORDER[axis]?.has(record.value) || !Number.isFinite(record.weight)) continue;
    scores.set(record.value, (scores.get(record.value) ?? 0) + Math.max(0, record.weight));
  }
  return [...scores.entries()].map(([value, score]) => ({ value, score }))
    .sort((a, b) => b.score - a.score || ORDER[axis].get(a.value) - ORDER[axis].get(b.value));
}

function confidenceFor(primary, secondary, records, axis) {
  if (!primary) return "low";
  const margin = primary.score - (secondary?.score ?? 0);
  const hasExplicit = records.some((record) => record.axis === axis && record.value === primary.value && record.source === "explicit");
  const hasCurated = records.some((record) => record.axis === axis && record.value === primary.value && record.source === "curated");
  if (hasExplicit || hasCurated || (primary.score >= 70 && margin >= 18)) return "high";
  if (primary.score >= 42 && margin >= 8) return "medium";
  return "low";
}

function isAmbiguousPair(a, b) {
  if (!a || !b) return false;
  return AMBIGUOUS_FUNCTIONS.some((pair) => pair.has(a.value) && pair.has(b.value));
}

function resolveModifier(records, axis, fallback) {
  return ranked(records, axis)[0]?.value ?? fallback;
}

/** Aggregate already-collected evidence. Useful for deterministic contract tests and integrations. */
export function aggregateEvidence(input = []) {
  const evidence = stableEvidence(input.filter((record) => record && typeof record === "object"));
  const functionRank = ranked(evidence, "function");
  const materialRank = ranked(evidence, "material");
  const behaviorRank = ranked(evidence, "behavior");
  const primaryFunction = functionRank[0] ?? null;
  const secondaryFunction = functionRank[1] ?? null;
  const primaryMaterial = materialRank[0] ?? null;
  const accentMaterial = materialRank[1] ?? null;
  let functionConfidence = confidenceFor(primaryFunction, secondaryFunction, evidence, "function");
  const rawMaterialConfidence = confidenceFor(primaryMaterial, accentMaterial, evidence, "material");
  const behaviorConfidence = confidenceFor(behaviorRank[0], behaviorRank[1], evidence, "behavior");
  if (isAmbiguousPair(primaryFunction, secondaryFunction)
    && primaryFunction.score - secondaryFunction.score < 18
    && !evidence.some((record) => record.axis === "function" && ["explicit", "curated"].includes(record.source))) {
    functionConfidence = "low";
  }

  /* A strongly identified neutral-material function (for example structured
     difficult terrain) is useful classification, not an unknown effect. */
  const materialConfidence = primaryMaterial
    ? rawMaterialConfidence
    : functionConfidence === "low" ? "low" : "medium";

  const confidence = [functionConfidence, materialConfidence].includes("low")
    ? "low" : [functionConfidence, materialConfidence, behaviorConfidence].includes("medium") ? "medium" : "high";
  const senses = ranked(evidence, "sense").map(({ value }) => value);
  const candidate = normalizeSemantics({
    function: primaryFunction?.value,
    secondaryFunction: secondaryFunction?.score >= Math.max(42, (primaryFunction?.score ?? 0) * 0.55)
      ? secondaryFunction.value : null,
    material: primaryMaterial?.value,
    accent: accentMaterial?.score >= Math.max(42, (primaryMaterial?.score ?? 0) * 0.55)
      ? accentMaterial.value : null,
    behavior: behaviorRank[0]?.value ?? "static",
    audience: resolveModifier(evidence, "audience", "unknown"),
    senses,
    source: resolveModifier(evidence, "source", "unknown"),
    geometry: resolveModifier(evidence, "geometry", "unknown"),
  });
  const semantics = confidence === "low"
    ? normalizeSemantics({ ...candidate, function: "neutral", secondaryFunction: null, material: "neutral", accent: null, behavior: "static" })
    : candidate;
  return Object.freeze({
    semantics,
    candidate,
    confidence,
    needsClassification: confidence === "low",
    axisConfidence: Object.freeze({ function: functionConfidence, material: materialConfidence, behavior: behaviorConfidence }),
    evidenceVersion: EVIDENCE_VERSION,
    evidence: Object.freeze(evidence),
    scores: Object.freeze({
      function: Object.freeze(functionRank), material: Object.freeze(materialRank), behavior: Object.freeze(behaviorRank),
    }),
  });
}

export function classify(source, options = {}) {
  return aggregateEvidence(collectEvidence(source, options));
}
