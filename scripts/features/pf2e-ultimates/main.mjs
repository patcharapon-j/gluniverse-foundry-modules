import { SUITE_ID } from "../../core/const.mjs";
import { decorateNpcSheet, injectItemUltimateToggle } from "./sheet-ui.mjs";
import {
  getUltimateState,
  getItemFunctions,
  hasUltimateItems,
  isCharged,
  isNpcActor,
  isReadyState,
  isUltimateItem,
  reconcileActorUltimateState,
  setCharge,
  setItemFunctions,
  setUltimateState,
  stepCharge,
  ultimateItems,
} from "./state.mjs";
import { UltimateTokenOverlay } from "./token-overlay.mjs";

let initialized = false;
let overlay = null;
const spendQueues = new Map();
const deletingParents = new Map();

const t = (key) => game.i18n.localize(key);

export function onInit() {
  if (initialized) return;
  initialized = true;

  Hooks.on("renderItemSheet", injectItemUltimateToggle);
  Hooks.on("renderActorSheet", decorateNpcSheet);
  Hooks.on("createChatMessage", onCreateChatMessage);
  Hooks.on("preDeleteItem", rememberDeletingParent);
  Hooks.on("deleteItem", onDeleteItem);
  Hooks.on("updateItem", onUpdateItem);
}

export function onReady() {
  overlay ??= new UltimateTokenOverlay();
  overlay.start();
}

export function refreshOverlay() {
  overlay?.refreshAll();
}

function rememberDeletingParent(item) {
  if (item?.uuid && isNpcActor(item.parent)) deletingParents.set(item.uuid, item.parent);
}

function onDeleteItem(item, _options, userId) {
  const actor = deletingParents.get(item?.uuid) ?? item?.parent ?? null;
  if (item?.uuid) deletingParents.delete(item.uuid);
  if (userId !== game.user?.id || !isNpcActor(actor) || !actor.isOwner) return;
  queueMicrotask(() => void reconcileActorUltimateState(actor));
}

function onUpdateItem(item, changed, _options, userId) {
  if (userId !== game.user?.id || !isNpcActor(item?.parent) || !item.parent.isOwner) return;
  const path = `flags.${SUITE_ID}.ult.isUltimate`;
  if (!foundry.utils.hasProperty(changed, path) && !foundry.utils.hasProperty(changed, `flags.${SUITE_ID}`)) return;
  void reconcileActorUltimateState(item.parent);
}

function onCreateChatMessage(message, _options, userId) {
  const item = resolveMessageItem(message);
  if (!isUltimateItem(item) || !isActivationMessage(message, item)) return;
  const actor = item.parent ?? message.actor ?? message.speakerActor;
  if (!isNpcActor(actor) || !hasUltimateItems(actor)) return;

  const state = getUltimateState(actor);
  const contextType = message.flags?.pf2e?.context?.type ?? null;
  const isDamageFollowup = contextType === "damage-roll";

  if (userId === game.user?.id && !isReadyState(state) && !isDamageFollowup) {
    ui.notifications?.warn(game.i18n.format("GLULT.Notify.UsedEarly", {
      item: item.name,
      value: state.value,
      max: state.max,
    }));
  } else if (userId === game.user?.id && isReadyState(state)) {
    ui.notifications?.info(game.i18n.format("GLULT.Notify.Spent", { item: item.name }));
  }

  if (!isResponsibleUpdater(userId, actor) || state.value <= 0) return;
  enqueueSpend(actor);
}

function resolveMessageItem(message) {
  try {
    const item = message?.item;
    if (item?.documentName === "Item") return item.original ?? item;
  } catch {
    /* Fall through to origin UUID resolution. */
  }
  const uuid = message?.flags?.pf2e?.origin?.uuid;
  if (!uuid || uuid.startsWith("Compendium.")) return null;
  try {
    const item = fromUuidSync(uuid);
    return item?.documentName === "Item" ? item.original ?? item : null;
  } catch {
    return null;
  }
}

function isActivationMessage(message, item) {
  const pf2e = message?.flags?.pf2e ?? {};
  const context = pf2e.context ?? {};
  if (context.isReroll || message?.isReroll) return false;
  if (["damage-taken", "self-effect-applied"].includes(context.type)) return false;
  if (pf2e.appliedDamage) return false;

  if (item.type === "melee") {
    return ["attack-roll", "damage-roll"].includes(context.type);
  }
  if (item.type === "spell") {
    return Boolean(pf2e.casting)
      || ["spell-cast", "attack-roll", "damage-roll"].includes(context.type)
      || Boolean(pf2e.origin?.uuid);
  }
  if (item.type === "action") {
    return context.type !== "damage-taken";
  }
  return false;
}

function isResponsibleUpdater(authorUserId, actor) {
  const activeGms = [...(game.users ?? [])]
    .filter((user) => user.active && user.isGM)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (activeGms.length) return game.user?.id === activeGms[0].id;
  return game.user?.id === authorUserId && actor?.isOwner === true;
}

function enqueueSpend(actor) {
  const key = actor.uuid;
  const previous = spendQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const current = getUltimateState(actor);
      if (current.value <= 0) return;
      await setUltimateState(actor, { ...current, value: 0 });
    })
    .catch((error) => console.error("GLUniverse Suite | PF2e Ultimates | Failed to spend charge", error))
    .finally(() => {
      if (spendQueues.get(key) === next) spendQueues.delete(key);
    });
  spendQueues.set(key, next);
}

export const api = {
  functions: getItemFunctions,
  getState: getUltimateState,
  hasUltimates: hasUltimateItems,
  isCharged,
  isUltimate: isUltimateItem,
  items: ultimateItems,
  setCharge,
  setFunctions: setItemFunctions,
  stepCharge,
};
