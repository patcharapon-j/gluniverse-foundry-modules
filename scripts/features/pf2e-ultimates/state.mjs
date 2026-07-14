import { SUITE_ID } from "../../core/const.mjs";
import { clamp, hex6, toInt } from "../../core/util.mjs";
import {
  ALLEGIANCES,
  COMPLEXITY_TIERS,
  DEFAULT_CHARGES,
  DEFAULT_COLOR,
  DEFAULT_ICON,
  ELIGIBLE_ITEM_TYPES,
  FLAG_ITEM_FUNCTIONS,
  FLAG_ACTOR_STATE,
  FLAG_ITEM_ULTIMATE,
  FUNCTION_ORDER,
  MAX_CHARGES,
  MIN_CHARGES,
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
  return hasStyle && hasGlyph ? tokens.join(" ") : DEFAULT_ICON;
}

export function normalizeUltimateState(raw = {}) {
  const max = clamp(toInt(raw?.max, DEFAULT_CHARGES), MIN_CHARGES, MAX_CHARGES);
  return {
    value: clamp(toInt(raw?.value, 0), 0, max),
    max,
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

export function isCharged(actor) {
  const state = getUltimateState(actor);
  return hasUltimateItems(actor) && state.value >= state.max;
}
