/**
 * Stage — finding a character and bringing them in.
 *
 * One statement of what a GM can search the cast by, how a world Actor becomes
 * a cast entry, and what "bring in" does, shared by the Director's search boxes
 * and the suite's quick palette. Every write goes through `store.mjs`.
 *
 * World Actors are offered only when they are not already cast (matched on the
 * actor UUID the entry was made from), so a search never adds anybody twice.
 * Foundry is reached only when a function is called: the check tools import
 * this folder under plain Node.
 */

import { foldText, matchScore } from "../../core/util.mjs";
import { DEFAULT_IMAGE, MAX_CALLS, MAX_ON_STAGE } from "./model.mjs";
import * as store from "./store.mjs";

/** World Actors offered per search. */
export const WORLD_LIMIT = 8;

function L(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

const DEFAULT_ARTS = () => new Set([DEFAULT_IMAGE, globalThis.CONST?.DEFAULT_TOKEN, "icons/svg/mystery-man.svg"].filter(Boolean));

/** The art to stand on stage: the actor's portrait, unless it is a placeholder. */
export function pickArt(actorImg, tokenImg) {
  const defaults = DEFAULT_ARTS();
  if (actorImg && !defaults.has(actorImg)) return actorImg;
  if (tokenImg && !defaults.has(tokenImg)) return tokenImg;
  return actorImg || tokenImg || DEFAULT_IMAGE;
}

/** The cast entry for an actor (and optionally the token it stood on). */
export function memberFromActor(actor, token = null) {
  const doc = token?.document ?? token ?? null;
  const uuid = doc && !doc.actorLink ? (doc.baseActor?.uuid ?? actor?.uuid) : actor?.uuid;
  return {
    name: doc?.name || actor?.name || L("GLSTAGE.director.cast.newName"),
    image: pickArt(actor?.img, doc?.texture?.src),
    actorUuid: uuid ?? null,
  };
}

/** Everything a cast entry is searched by. */
export const castHaystack = (m) => foldText([m?.name, m?.title].filter(Boolean).join(" "));

/** Cast entries matching `query`, best first (all of them, in cast order, for an empty query). */
export function searchCast(cast, query) {
  if (!foldText(query)) return cast.slice();
  return cast
    .map((m, i) => ({ m, i, s: matchScore(m.name, m.title, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.m);
}

/**
 * World Actors matching `query` that are not already cast, best first. Nothing
 * for an empty query: the world is a search, not a list.
 */
export function searchWorldActors(query, cast = store.readCast(), limit = WORLD_LIMIT) {
  if (!foldText(query)) return [];
  const known = new Set(cast.map((m) => m.actorUuid).filter(Boolean));
  const out = [];
  for (const actor of globalThis.game?.actors ?? []) {
    if (!actor?.uuid || known.has(actor.uuid)) continue;
    const s = matchScore(actor.name, actor.type, query);
    if (s > 0) out.push({ actor, s });
  }
  return out
    .sort((a, b) => b.s - a.s || String(a.actor.name).localeCompare(String(b.actor.name)))
    .slice(0, limit)
    .map((r) => r.actor);
}

/** The cast entry made from this actor, if any. */
export const castedFrom = (actor, cast = store.readCast()) => cast.find((m) => m.actorUuid && m.actorUuid === actor?.uuid) ?? null;

/** Add an actor to the cast (or find the entry already made from it). Resolves the cast id. */
export async function castActor(actor) {
  const existing = castedFrom(actor);
  if (existing) return existing.id;
  return store.upsertMember(memberFromActor(actor));
}

/**
 * Bring a cast entry on stage. Warns and resolves false when the stage is full.
 * `closeUp` also pushes in on them.
 */
export async function bringOn(id, { masked = false, closeUp = false } = {}) {
  const s = store.readState();
  if (s.on.length >= MAX_ON_STAGE && !s.on.some((m) => m.id === id)) {
    globalThis.ui?.notifications?.warn(L("GLSTAGE.director.stage.full", { max: MAX_ON_STAGE }));
    return false;
  }
  const ok = await store.enter(id, { masked });
  if (ok && closeUp) await store.closeUp(id, "push");
  return ok;
}

/** Open a call from a cast entry. Warns and resolves false when the comms are full. */
export async function callIn(id) {
  const c = store.readComms();
  if (c.calls.length >= MAX_CALLS && !c.calls.some((x) => x.castId === id)) {
    globalThis.ui?.notifications?.warn(L("GLSTAGE.director.comms.full", { max: MAX_CALLS }));
    return false;
  }
  return store.call(id);
}

/** Hang up every call a cast entry is on. */
export async function hangUpCast(id) {
  for (const c of store.readComms().calls.filter((x) => x.castId === id)) await store.hangUp(c.callId);
  return true;
}

/* ── the suite's quick palette (core/quick-palette.mjs) ─────────────── */

/** Cast rows the palette shows. */
const CAST_LIMIT = 10;

const act = (id, labelKey, icon, mod) => ({ id, label: L(labelKey), icon, mod });

function castItem(m, state, comms) {
  const mark = state.on.find((x) => x.id === m.id) ?? null;
  const call = comms.calls.some((c) => c.castId === m.id);
  const badge = [mark ? L("GLSTAGE.director.stage.onStage") : "", call ? L("GLSTAGE.director.comms.onCall") : ""].filter(Boolean).join(" · ");
  const callAct = call
    ? act("hangUp", "GLSTAGE.director.comms.hangUp", "fa-solid fa-phone-slash", "shift")
    : act("call", "GLSTAGE.director.comms.call", "fa-solid fa-phone", "shift");
  const actions = mark
    ? [
      act("exit", "GLSTAGE.director.stage.exit", "fa-solid fa-right-from-bracket", ""),
      act("closeUp", "GLSTAGE.director.stage.closePush", "fa-solid fa-magnifying-glass-plus", "ctrl"),
      callAct,
      act("mask", mark.masked ? "GLSTAGE.director.stage.reveal" : "GLSTAGE.director.stage.mask", mark.masked ? "fa-solid fa-eye" : "fa-solid fa-user-secret", "alt"),
    ]
    : [
      act("enter", "GLSTAGE.director.stage.enter", "fa-solid fa-right-to-bracket", ""),
      act("closeUp", "GLSTAGE.director.stage.closePush", "fa-solid fa-magnifying-glass-plus", "ctrl"),
      callAct,
      act("masked", "GLSTAGE.director.stage.enterMasked", "fa-solid fa-user-secret", "alt"),
    ];
  return {
    key: `stage:${m.id}`,
    title: m.name,
    sub: m.title,
    img: m.image || DEFAULT_IMAGE,
    badge: badge || null,
    actions,
    run(action) {
      switch (action) {
        case "enter": return bringOn(m.id);
        case "masked": return bringOn(m.id, { masked: true });
        case "closeUp": return bringOn(m.id, { closeUp: true });
        case "exit": return store.exit(m.id);
        case "mask": return store.setMasked(m.id, !mark?.masked);
        case "call": return callIn(m.id);
        case "hangUp": return hangUpCast(m.id);
        default: return null;
      }
    },
  };
}

function worldItem(actor) {
  const m = memberFromActor(actor);
  const typeLabel = globalThis.CONFIG?.Actor?.typeLabels?.[actor.type];
  const cast = async () => {
    const id = await castActor(actor);
    if (!id) throw new Error("the actor could not be cast");
    return id;
  };
  return {
    key: `world:${actor.uuid}`,
    title: m.name,
    sub: typeLabel ? L(typeLabel) : actor.type,
    img: m.image,
    actions: [
      act("enter", "GLSTAGE.search.worldEnter", "fa-solid fa-right-to-bracket", ""),
      act("closeUp", "GLSTAGE.director.stage.closePush", "fa-solid fa-magnifying-glass-plus", "ctrl"),
      act("call", "GLSTAGE.search.worldCall", "fa-solid fa-phone", "shift"),
      act("cast", "GLSTAGE.search.worldCast", "fa-solid fa-user-plus", "alt"),
    ],
    async run(action) {
      const id = await cast();
      if (action === "enter") return bringOn(id);
      if (action === "closeUp") return bringOn(id, { closeUp: true });
      if (action === "call") return callIn(id);
      return id;
    },
  };
}

const gm = () => !!globalThis.game?.user?.isGM;

/** Stage's two palette groups: the cast, and the world's Actors not cast yet. */
export const QUICK_PROVIDERS = Object.freeze([
  {
    id: "stage",
    order: 10,
    label: "GLSTAGE.search.group",
    icon: "fa-solid fa-masks-theater",
    available: gm,
    search(query) {
      const state = store.readState();
      const comms = store.readComms();
      return searchCast(store.readCast(), query).slice(0, CAST_LIMIT).map((m) => castItem(m, state, comms));
    },
  },
  {
    id: "stage-world",
    order: 20,
    label: "GLSTAGE.search.world",
    icon: "fa-solid fa-earth-americas",
    available: gm,
    search(query) { return searchWorldActors(query).map(worldItem); },
  },
]);
