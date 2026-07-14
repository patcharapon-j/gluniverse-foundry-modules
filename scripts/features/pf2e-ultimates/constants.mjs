export const FEATURE_ID = "pf2e-ultimates";
export const FLAG_ITEM_ULTIMATE = "ult.isUltimate";
export const FLAG_ITEM_FUNCTIONS = "ult.functions";
export const FLAG_ACTOR_STATE = "ult.state";

export const DEFAULT_COLOR = "#5eeaff";
export const DEFAULT_ICON = "fa-solid fa-star";
export const DEFAULT_CHARGES = 3;
export const MIN_CHARGES = 1;
export const MAX_CHARGES = 12;

export const ELIGIBLE_ITEM_TYPES = new Set(["action", "melee", "spell"]);

export const FUNCTION_ORDER = ["signature", "trigger", "engine", "ultimate"];
export const ABILITY_FUNCTIONS = Object.freeze({
  signature: { icon: "fa-solid fa-swords", label: "GLULT.Function.Signature" },
  trigger: { icon: "fa-solid fa-bolt", label: "GLULT.Function.Trigger" },
  engine: { icon: "fa-solid fa-gears", label: "GLULT.Function.Engine" },
  ultimate: { icon: DEFAULT_ICON, label: "GLULT.Function.Ultimate" },
});

export const COMPLEXITY_TIERS = new Set(["background", "standard", "elite", "boss"]);
export const ALLEGIANCES = new Set(["enemy", "ally"]);

export const ICON_SUGGESTIONS = [
  "fa-solid fa-star",
  "fa-solid fa-bolt",
  "fa-solid fa-burst",
  "fa-solid fa-fire-flame-curved",
  "fa-solid fa-wand-sparkles",
  "fa-solid fa-gem",
  "fa-solid fa-eye",
  "fa-solid fa-crown",
  "fa-solid fa-skull",
  "fa-solid fa-dragon",
  "fa-solid fa-meteor",
  "fa-solid fa-sun",
  "fa-solid fa-moon",
  "fa-solid fa-hurricane",
  "fa-solid fa-circle-radiation",
  "fa-solid fa-hand-sparkles",
];
