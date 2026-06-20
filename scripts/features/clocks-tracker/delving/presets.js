/**
 * Delving presets — shipped delving-resource definitions plus the small "look"
 * library the editor offers when adding a stage.
 *
 * A delving RESOURCE is an ordered list of STAGES. Each stage owns its own dice
 * pool ({size, count, discard}, behaving exactly like the tracker's Resource
 * Pool) and a visual EFFECT spec (the same {archetype, intensity, tintParticle,
 * tintGlow, drift, ominous} shape the weather hexes use, so it feeds the shared
 * EffectField diorama directly). As a stage's pool empties the resource shifts to
 * the NEXT stage and refills to that stage's count; the final stage clamps at 0
 * and persists (the worst state). Two resources ship: classic Torches (light
 * dwindling) and Corruption (taint rising).
 *
 * Everything here is plain data so it round-trips through the editor's JSON I/O.
 */

/** A stage effect spec (matches weather hex.effect so EffectField can render it). */
function fx(archetype, tintParticle, tintGlow, { intensity = 0.5, drift = "rise", ominous = false } = {}) {
  return { archetype, intensity, tintParticle, tintGlow, drift, ominous };
}

/** A single stage: a named dice pool + the look its current state paints on the HUD. */
function stage(name, { size = 6, count = 6, discard = 2, effect } = {}) {
  return { name, size, count, discard, effect };
}

/**
 * Suggested "looks" for the editor's quick-pick when authoring a stage — a
 * curated subset of the shared effect archetypes with sensible default tints.
 * The GM can still pick any archetype + recolour freely afterwards.
 */
export const STAGE_LOOKS = {
  torchlight: { label: "Torchlight", effect: fx("embers", "#ff9a3c", "#ffd27a", { intensity: 0.5, drift: "rise" }) },
  guttering:  { label: "Guttering",  effect: fx("embers", "#d8632a", "#ff9a3c", { intensity: 0.42, drift: "rise" }) },
  gloom:      { label: "Gloom",      effect: fx("shadow", "#2a2330", "#0d0b12", { intensity: 0.55, drift: "still", ominous: true }) },
  darkness:   { label: "Darkness",   effect: fx("void",   "#1a1626", "#000000", { intensity: 0.8, drift: "still", ominous: true }) },
  clean:      { label: "Untainted",  effect: fx("motes",  "#bfe6c0", "#6fae73", { intensity: 0.3, drift: "rise" }) },
  spores:     { label: "Spores",     effect: fx("spores", "#9be15d", "#2f6b1f", { intensity: 0.55, drift: "rise" }) },
  miasma:     { label: "Miasma",     effect: fx("miasma", "#8fae5d", "#3a4a1f", { intensity: 0.7, drift: "left", ominous: true }) },
  corruption: { label: "Corruption", effect: fx("creep",  "#a04bd6", "#3a0f4a", { intensity: 0.75, drift: "rise", ominous: true }) },
  static:     { label: "Signal Loss",effect: fx("static", "#cfe8ff", "#5f7f9f", { intensity: 0.6, drift: "still", ominous: true }) },
  flood:      { label: "Rising Water", effect: fx("ripples", "#5aa0e6", "#1a4a6e", { intensity: 0.6, drift: "rise" }) },
  depths:     { label: "The Depths", effect: fx("bubbles", "#7fd0e6", "#1a3a4e", { intensity: 0.55, drift: "rise" }) }
};

export const STAGE_LOOK_LIST = Object.entries(STAGE_LOOKS).map(([key, l]) => ({ key, label: l.label }));

/** Classic fantasy: a torch losing its light over four stages. */
export function buildTorches() {
  return {
    id: foundry.utils.randomID(12),
    name: "Torches",
    icon: "fa-solid fa-fire",
    endName: "Pitch Black",
    visibleToPlayers: true,
    stageIndex: 0,
    current: 6,
    stages: [
      stage("Lit",        { size: 6, count: 6, discard: 2, effect: STAGE_LOOKS.torchlight.effect }),
      stage("Guttering",  { size: 6, count: 5, discard: 2, effect: STAGE_LOOKS.guttering.effect }),
      stage("Smothered",  { size: 6, count: 4, discard: 3, effect: STAGE_LOOKS.gloom.effect }),
      stage("Darkness",   { size: 6, count: 4, discard: 3, effect: STAGE_LOOKS.darkness.effect })
    ]
  };
}

/** A creeping corruption / taint that worsens as the dice burn down. */
export function buildCorruption() {
  return {
    id: foundry.utils.randomID(12),
    name: "Corruption",
    icon: "fa-solid fa-skull",
    endName: "Beyond Saving",
    visibleToPlayers: true,
    stageIndex: 0,
    current: 6,
    stages: [
      stage("Untainted", { size: 8, count: 6, discard: 2, effect: STAGE_LOOKS.clean.effect }),
      stage("Tainted",   { size: 8, count: 5, discard: 2, effect: STAGE_LOOKS.spores.effect }),
      stage("Corrupted", { size: 8, count: 4, discard: 3, effect: STAGE_LOOKS.miasma.effect }),
      stage("Consumed",  { size: 8, count: 4, discard: 3, effect: STAGE_LOOKS.corruption.effect })
    ]
  };
}

/** A blank resource the GM can flesh out (used by the editor's "Add resource"). */
export function makeResource(name = "Resource") {
  return {
    id: foundry.utils.randomID(12),
    name,
    icon: "fa-solid fa-hourglass-half",
    endName: "",
    visibleToPlayers: true,
    stageIndex: 0,
    current: 6,
    stages: [
      stage("Stage 1", { size: 6, count: 6, discard: 2, effect: STAGE_LOOKS.torchlight.effect }),
      stage("Stage 2", { size: 6, count: 4, discard: 3, effect: STAGE_LOOKS.gloom.effect })
    ]
  };
}

/** A fresh blank stage for the editor's "Add stage". */
export function makeStage(name = "Stage") {
  return stage(name, { size: 6, count: 6, discard: 2, effect: foundry.utils.deepClone(STAGE_LOOKS.gloom.effect) });
}

/** Resource presets offered in the editor + the settings menu. */
export const DELVING_PRESETS = {
  torches: buildTorches,
  corruption: buildCorruption
};

export const DEFAULT_DELVING_PRESET = "torches";

/** The full default delving config — disabled, parked, with the Torches resource. */
export function makeDefaultDelving() {
  const torches = buildTorches();
  return {
    schemaVersion: 1,
    active: false,                       // live delving display on/off (GM flips mid-session)
    turn: { unit: "stretch", count: 1, label: "Turn" },
    weatherEveryTurns: 0,                // 0 = never auto-roll weather on a turn
    featuredId: torches.id,              // which resource drives the HUD atmosphere
    // live "delve session" counters (persist across on/off toggles; cleared by reset)
    turnsElapsed: 0,
    turnsSinceWeather: 0,
    history: [],                         // turn snapshots, for rewind
    resources: [torches]
  };
}
