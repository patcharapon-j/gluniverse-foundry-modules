import { SUITE_ID } from "../../core/const.mjs";
import { clamp, hex6, toInt } from "../../core/util.mjs";
import {
  ACTOR_DISPLAY_MODES,
  ALLEGIANCES,
  COMPLEXITY_TIERS,
  COUNTER_MODES,
  DEFAULT_CHARGES,
  DEFAULT_COLOR,
  DEFAULT_ICON,
  DISPLAY_MODES,
  ELIGIBLE_ITEM_TYPES,
  FLAG_ITEM_FUNCTIONS,
  FLAG_ACTOR_STATE,
  FLAG_ITEM_ULTIMATE,
  FUNCTION_ORDER,
  MAX_CHARGES,
  MIN_CHARGES,
  READY_MODES,
  SETTINGS,
} from "./constants.mjs";

export function isNpcActor(actor) {
  return actor?.documentName === "Actor" && actor.type === "npc" && game.system?.id === "pf2e";
}

export function isEligibleItem(item) {
  return item?.documentName === "Item"
    && ELIGIBLE_ITEM_TYPES.has(item.type)
    && isNpcActor(item.parent);
}

export function isUltimateItem(item) {
  return getItemFunctions(item).includes("ultimate");
}

export function getItemFunctions(item) {
  if (!isEligibleItem(item)) return [];
  const raw = item.getFlag(SUITE_ID, FLAG_ITEM_FUNCTIONS);
  const selected = new Set(Array.isArray(raw) ? raw : []);
  if (item.getFlag(SUITE_ID, FLAG_ITEM_ULTIMATE) === true) selected.add("ultimate");
  return FUNCTION_ORDER.filter((role) => selected.has(role));
}

export async function setItemFunctions(item, functions, options = {}) {
  if (!isEligibleItem(item)) return [];
  const selected = new Set(Array.isArray(functions) ? functions : []);
  const normalized = FUNCTION_ORDER.filter((role) => selected.has(role));
  await item.update({
    [`flags.${SUITE_ID}.${FLAG_ITEM_FUNCTIONS}`]: normalized,
    [`flags.${SUITE_ID}.${FLAG_ITEM_ULTIMATE}`]: normalized.includes("ultimate"),
  }, options);
  return normalized;
}

export function ultimateItems(actor) {
  if (!isNpcActor(actor)) return [];
  return [...(actor.items ?? [])].filter(isUltimateItem);
}

export function hasUltimateItems(actor) {
  return ultimateItems(actor).length > 0;
}

export function sanitizeIcon(value) {
  const tokens = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter((token) => /^fa(?:-[a-z0-9]+)+$/i.test(token))
    .slice(0, 5);
  const hasStyle = tokens.some((token) => /^fa-(solid|regular|brands|duotone|light|thin|sharp(?:-[a-z]+)?)$/i.test(token));
  const hasGlyph = tokens.some((token) => token.startsWith("fa-") && !/^fa-(solid|regular|brands|duotone|light|thin|sharp(?:-[a-z]+)?|fw|spin|pulse)$/i.test(token));
  if (hasGlyph && !hasStyle) return ["fa-solid", ...tokens].join(" ");
  return hasStyle && hasGlyph ? tokens.join(" ") : DEFAULT_ICON;
}

const FA_STYLE_DIRS = Object.freeze({ "fa-solid": "solid", "fa-regular": "regular", "fa-brands": "brands" });

/**
 * CDN URL for the icon's SVG in the Font Awesome free set. Lets users pick
 * any FA icon, including ones missing from the Foundry-bundled FA build.
 * Returns null for icons with no free-set equivalent (e.g. pro-only styles).
 */
export function iconCdnUrl(value) {
  const tokens = sanitizeIcon(value).split(" ");
  const styleDir = FA_STYLE_DIRS[tokens.find((token) => FA_STYLE_DIRS[token])] ?? "solid";
  const glyph = tokens.find((token) => token.startsWith("fa-")
    && !/^fa-(solid|regular|brands|duotone|light|thin|sharp(?:-[a-z]+)?|fw|spin|pulse)$/i.test(token));
  if (!glyph) return null;
  return `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/svgs/${styleDir}/${glyph.slice(3).toLowerCase()}.svg`;
}

export function normalizeUltimateState(raw = {}) {
  const max = clamp(toInt(raw?.max, DEFAULT_CHARGES), MIN_CHARGES, MAX_CHARGES);
  return {
    value: clamp(toInt(raw?.value, 0), 0, max),
    max,
    readyMode: READY_MODES.has(raw?.readyMode) ? raw.readyMode : "full",
    readyThreshold: clamp(toInt(raw?.readyThreshold, max), 1, max),
    displayMode: ACTOR_DISPLAY_MODES.has(raw?.displayMode) ? raw.displayMode : "default",
    counterMode: COUNTER_MODES.has(raw?.counterMode) ? raw.counterMode : "default",
    color: hex6(raw?.color, DEFAULT_COLOR).toLowerCase(),
    icon: sanitizeIcon(raw?.icon),
    resourceName: cleanText(raw?.resourceName, 48),
    tier: COMPLEXITY_TIERS.has(raw?.tier) ? raw.tier : "elite",
    allegiance: ALLEGIANCES.has(raw?.allegiance) ? raw.allegiance : "enemy",
    combatPromise: cleanText(raw?.combatPromise, 280),
    gainRule: cleanText(raw?.gainRule, 280),
    cashOut: cleanText(raw?.cashOut, 280),
    tell: cleanText(raw?.tell, 280),
    threat: cleanText(raw?.threat, 280),
    counterplay: cleanText(raw?.counterplay, 560),
  };
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function getUltimateState(actor) {
  if (!isNpcActor(actor)) return normalizeUltimateState();
  return normalizeUltimateState(actor.getFlag(SUITE_ID, FLAG_ACTOR_STATE) ?? {});
}

export async function setUltimateState(actor, next, options = {}) {
  if (!isNpcActor(actor)) return null;
  const state = normalizeUltimateState(next);
  await actor.update({ [`flags.${SUITE_ID}.${FLAG_ACTOR_STATE}`]: state }, options);
  return state;
}

export async function setCharge(actor, value) {
  const state = getUltimateState(actor);
  return setUltimateState(actor, { ...state, value });
}

export async function stepCharge(actor, delta) {
  const state = getUltimateState(actor);
  return setUltimateState(actor, { ...state, value: state.value + toInt(delta, 0) }, { render: false });
}

export async function reconcileActorUltimateState(actor) {
  if (!isNpcActor(actor) || hasUltimateItems(actor)) return;
  const state = getUltimateState(actor);
  if (state.value !== 0) await setUltimateState(actor, { ...state, value: 0 });
}

/** Whether a normalized state satisfies its Ultimate readiness condition. */
export function isReadyState(state) {
  if (state.readyMode === "atLeast") return state.value >= state.readyThreshold;
  if (state.readyMode === "exactly") return state.value === state.readyThreshold;
  return state.value >= state.max;
}

export function isCharged(actor) {
  return hasUltimateItems(actor) && isReadyState(getUltimateState(actor));
}

function worldSetting(key) {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return undefined;
  }
}

/** Resolve the charged-indicator style: actor override, else module setting. */
export function getDisplayMode(actor) {
  const state = getUltimateState(actor);
  if (state.displayMode !== "default") return state.displayMode;
  const configured = worldSetting(SETTINGS.displayMode);
  return DISPLAY_MODES.has(configured) ? configured : "icon";
}

/** Resolve whether the numeric resource counter shows on this actor's tokens. */
export function shouldShowCounter(actor) {
  const state = getUltimateState(actor);
  if (state.counterMode === "show") return true;
  if (state.counterMode === "hide") return false;
  return worldSetting(SETTINGS.counterDefault) === true;
}
