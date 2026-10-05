/**
 * PREVIEW ONLY — sample requests for the preview page. Each is a resolved
 * roll, so every degree and every optional beat can be called up on demand.
 */
import { degreeOf, DEGREES } from "/scripts/features/spotlight-roll/timeline.mjs";

const portrait = (bg, fg, accent) =>
  "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">` +
    `<defs><radialGradient id="g" cx="0.55" cy="0.3" r="0.9"><stop offset="0" stop-color="${accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${bg}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fg}"/><stop offset="1" stop-color="${bg}"/></linearGradient></defs>` +
    `<rect width="300" height="400" fill="${bg}"/><rect width="300" height="400" fill="url(#g)"/>` +
    `<path d="M150 70c38 0 62 30 62 70 0 26-10 46-24 60l6 22c48 12 86 52 96 110v68H10v-68c10-58 48-98 96-110l6-22c-14-14-24-34-24-60 0-40 24-70 62-70z" fill="url(#b)"/>` +
    `<path d="M104 124c10-40 36-58 64-54 30 4 48 28 48 62-14-20-40-30-64-26-20 3-36 10-48 18z" fill="${bg}" opacity="0.55"/>` +
    `<path d="M70 290l80 40 80-40" stroke="${accent}" stroke-width="5" fill="none" opacity="0.8"/></svg>`
  );

export const ACTORS = {
  seri: { name: "Seri Valen", title: "Level 7 · Fighter", img: portrait("#0e1622", "#5d86b3", "#9fd0ff") },
  brakka: { name: "Brakka Ironhide", title: "Level 7 · Barbarian", img: portrait("#1a120e", "#b3815d", "#ffc59f") },
  ilsa: { name: "Ilsa of the Veil", title: "Level 7 · Witch", img: portrait("#150f1f", "#8a6ab3", "#d9b8ff") },
  quill: { name: "Quill", title: "Level 7 · Rogue", img: portrait("#0f1a16", "#5db38f", "#a9ffd9") },
  morrow: { name: "Brother Morrow", title: "Level 7 · Cleric", img: portrait("#1c1a10", "#b3a25d", "#fff0a9") },
  teska: { name: "Teska Rhul", title: "Level 7 · Ranger", img: portrait("#10161c", "#5d8fb3", "#a9dcff") },
  knight: { name: "Hollow Knight", title: "Creature 8", img: portrait("#1c0f12", "#8a3a46", "#ff8a9a") },
};

const MODS = () => [
  { label: "Expert", value: 4, kind: "proficiency", enabled: true },
  { label: "Level", value: 7, kind: "proficiency", enabled: true },
  { label: "Strength", value: 4, kind: "ability", enabled: true },
  { label: "Handwraps", value: 1, kind: "item", enabled: true },
  { label: "Frightened 1", value: -1, kind: "status", enabled: true },
  { label: "Aid", value: 2, kind: "circumstance", enabled: true, optional: true },
];

// Total modifier with every chip on: +17.
export const SCENARIOS = {
  critSuccess: { label: "Crit success · nat 20", natural: 20, dc: 32 },
  critBy10: { label: "Crit success · beat by 10", natural: 18, dc: 25 },
  success: { label: "Success · by one", natural: 15, dc: 32 },
  failure: { label: "Failure · one short", natural: 14, dc: 32 },
  critFailure: { label: "Crit failure · nat 1", natural: 1, dc: 24 },
  critFailBy10: { label: "Crit failure · missed by 10", natural: 3, dc: 31 },
  noDc: { label: "No DC · total only", natural: 12, dc: null },
  formula: { label: "Formula · 2d6+3 vs DC 10", formula: "2d6+3", dice: [{ faces: 6, value: 4 }, { faces: 6, value: 5 }], dc: 10 },
};

export const DEGREE_LABEL = ["Critical Failure", "Failure", "Success", "Critical Success"];

/**
 * Build the model a direction is handed. `natural` for a fortune pair is the
 * kept die; the dropped one is chosen so the keep is legal.
 */
export function buildModel({ scenario = "critSuccess", actor = "seri", dcMode = "hidden", fortune = "none", mods = null, natural: nat = null, dc: dcOverride, check = "Athletics" } = {}) {
  const base = SCENARIOS[scenario] ?? SCENARIOS.critSuccess;
  const sc = { ...base, ...(nat != null ? { natural: nat } : {}), ...(dcOverride !== undefined ? { dc: dcOverride } : {}) };
  const isFormula = !!sc.formula;
  const list = mods ?? (isFormula ? [{ slug: "formula", label: "+3", value: 3, kind: "untyped", enabled: true }] : MODS());
  const modTotal = list.filter((m) => m.enabled).reduce((a, m) => a + m.value, 0);
  const natural = isFormula ? null : sc.natural;
  const diceSum = isFormula ? sc.dice.reduce((a, d) => a + d.value, 0) : natural;
  const total = diceSum + modTotal;
  const dcValue = sc.dc;
  const mode = dcValue == null ? "none" : dcMode;
  const degree = degreeOf(total, dcValue, natural);
  let dropped = null;
  if (fortune === "fortune") dropped = Math.max(1, Math.min(natural - 1 - 3, 9)) || 1;
  if (fortune === "misfortune") dropped = Math.min(20, Math.max(natural + 4, 12));
  if (fortune === "fortune" && natural <= 1) dropped = 1;
  if (fortune === "misfortune" && natural >= 20) dropped = 20;
  return {
    actor: ACTORS[actor] ?? ACTORS.seri,
    request: { title: check === "Athletics" ? "Force the portcullis" : "Hold the line", check, kind: check.endsWith("save") ? "Saving throw" : "Skill check", traits: ["Exploration"] },
    dc: { value: mode === "never" ? null : dcValue, mode },
    mods: list,
    modTotal,
    formula: isFormula ? sc.formula : null,
    diceSpec: isFormula ? sc.dice.map((d) => d.faces) : fortune === "none" ? [20] : [20, 20],
    sealed: false,
    canReroll: !isFormula && fortune === "none" && degree != null && degree < 2,
    roll: {
      natural, total, dropped, fortune: isFormula || fortune === "none" ? null : fortune,
      dice: isFormula ? sc.dice : [{ faces: 20, value: natural }, ...(fortune === "none" ? [] : [{ faces: 20, value: dropped }])],
    },
    degree,
    degreeKey: degree == null ? null : DEGREES[degree],
    degreeLabel: degree == null ? null : DEGREE_LABEL[degree],
    crit: degree === 0 || degree === 3,
  };
}

/* ── multi-roll requests ─────────────────────────────────────────────── */

export const LAYOUTS = {
  single: "Single",
  group3: "Group · 3",
  group6: "Group · 6",
  opposed: "Opposed",
};

// Group rolls share one DC (28) and land on every degree between them.
const GROUP = [
  { actor: "seri", natural: 20 },     // 37 → crit success (nat 20 bump)
  { actor: "brakka", natural: 6 },    // 23 → failure
  { actor: "ilsa", natural: 13 },     // 30 → success
  { actor: "quill", natural: 1 },     // 18 → crit failure (nat 1)
  { actor: "morrow", natural: 11 },   // 28 → success, exactly
  { actor: "teska", natural: 10 },    // 27 → failure, one short
];

/**
 * The whole request a direction is handed: every roll in it, plus who stands
 * opposite in an opposed check. `rolls[0]` is also `ctx.model` for a
 * single-roll direction.
 */
export function buildRequest({ layout = "single", scenario = "critSuccess", dcMode = "hidden", fortune = "none" } = {}) {
  if (layout === "group3" || layout === "group6") {
    const n = layout === "group3" ? 3 : 6;
    const rolls = GROUP.slice(0, n).map((g) => buildModel({ scenario, actor: g.actor, natural: g.natural, dc: 28, dcMode, fortune }));
    return { layout: "group", rolls, defender: null, sharedDc: { value: 28, mode: dcMode } };
  }
  if (layout === "opposed") {
    const roll = buildModel({ scenario, dcMode, fortune });
    return {
      layout: "opposed",
      rolls: [roll],
      defender: { actor: ACTORS.knight, statistic: "Fortitude DC", dc: roll.dc.value },
      sharedDc: null,
    };
  }
  return { layout: "single", rolls: [buildModel({ scenario, dcMode, fortune })], defender: null, sharedDc: null };
}

/**
 * What a screen knows at MOUNT, before the throw: the result fields are
 * stripped, and a hidden DC is unknown. The full model arrives at throw time.
 */
export function atMount(model) {
  return {
    ...model,
    dc: { ...model.dc, value: model.dc.mode === "shown" ? model.dc.value : null },
    roll: { fortune: model.roll.fortune, natural: null, total: null, dropped: null, dice: [] },
    degree: null, degreeKey: null, crit: false, canReroll: false,
  };
}

/** The same roll as a screen that may not see it receives it. */
export function asSealed(model) {
  return {
    ...atMount(model),
    sealed: true,
    dc: { ...model.dc, value: null },
  };
}
