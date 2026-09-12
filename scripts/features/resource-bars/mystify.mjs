/**
 * GLUniverse Suite — resource bars: whose name a label shows, and when.
 *
 * Two questions live here, and they are kept in one file because getting either
 * wrong leaks the same thing.
 *
 *   1. **May this client see this token's name at all?** Outside mystification
 *      that is Foundry's own Display Name answer, read off `token.nameplate.visible`
 *      exactly as `visibility.mjs` reads `bars.visible` — never recomputed.
 *   2. **Under PF2e, is the name the real one or a cipher?** A GM who hides a
 *      creature's name, or a party that has not studied it, must not have the
 *      prettier label undo that. A cipher leaks nothing a blank would not, which
 *      is the only standard a replacement for "no name" can be held to.
 *
 * ── Why a cipher and not nothing ──
 *
 * A hidden name used to be *no* label, which on a canvas where every other token
 * carries one reads as "this token is scenery". A run of glyphs says "there is a
 * creature here and you do not know what it is", which is the actual state of
 * the table. It is also why the cipher must carry **no information**: its length
 * and glyphs are seeded from the token id and nothing else. A cipher whose length
 * followed the real name would let a player count letters, and "a seven-glyph
 * creature beside the Goblin Warchanter" is one guess away from a name.
 *
 * ── The leak rules ──
 *
 *   - A player's decision for a hidden token carries `text: null`. The renderer
 *     cannot draw, rasterise or decode a string it was never given, which is a
 *     stronger guarantee than any number of "if hidden" checks further down.
 *   - The cipher is a pure function of the token id and a clock (`cipherGlyphs`
 *     takes no name, and `tools/resource-bar-check.mjs` pins its signature).
 *   - The decision is made in the `refreshToken` pass (host.applyVisibility) and
 *     re-made on the setting updates that change it, never from a value hook.
 *
 * Nothing in here may touch PIXI or the DOM: the check tool drives the gates with
 * stubs under plain Node, which is the only place the gate *order* can be proven.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { dexKey } from "../pf2e-creaturedex/identity.mjs";
import { PARTY_KEY } from "../pf2e-creaturedex/constants.mjs";
import { falseSections, knownSections } from "../pf2e-creaturedex/store.mjs";
import { canViewMode } from "./visibility.mjs";

/* ══════════════════════════════════════════════════════════════════════
   Scope
   ══════════════════════════════════════════════════════════════════════ */

/** The only system mystification applies under. */
export const MYSTIFY_SYSTEM = "pf2e";

/**
 * Actor types whose names can be a secret.
 *
 * These are PF2e's creatures and hazards — the things a Recall Knowledge check is
 * made against. A loot pile, a vehicle, a party or an army is not a mystery
 * anybody rolls to solve, and a cipher on a treasure chest is noise, so those
 * follow plain Display Name: hidden there means no label at all.
 */
export const MYSTIFY_TYPES = Object.freeze(["character", "npc", "familiar", "hazard"]);

/** PF2e's world setting: "Token settings determine name visibility". */
export const PF2E_NAME_SETTING = "metagame_tokenSetsNameVisibility";

/** The Creaturedex feature, and the world setting its knowledge lives in. */
export const DEX_FEATURE = "pf2e-creaturedex";
export const DEX_KNOWLEDGE_SETTING = "dex.knowledge";

/* ══════════════════════════════════════════════════════════════════════
   The cipher
   ══════════════════════════════════════════════════════════════════════ */

/**
 * The glyphs a cipher is built from.
 *
 * **No letters and no digits**, so there is nothing to read and nothing to
 * mistake for a partial name. About a third of every cipher is `?`, which is what
 * makes the run say "unknown" rather than "corrupted".
 *
 * Four characters are excluded on purpose, and each exclusion is a thing a player
 * would otherwise misread: `+ - / %` are the HP readout's and the floating
 * deltas' own vocabulary, so a cipher containing them sits next to a bar looking
 * like a number; `§` reads as an S.
 */
export const CIPHER_QUERY = "?";
export const CIPHER_MARKS = "!#*&~^=<>†‡¤◇◆▚▞░";
export const CIPHER_GLYPHS = CIPHER_QUERY + CIPHER_MARKS;

/** The GM's marker for "players see a cipher here". One of the cipher's own glyphs. */
export const GM_MARKER = "◇";

/** A cipher's length range. Seeded from the id; never from the name. */
export const CIPHER_LENGTH = Object.freeze({ min: 6, max: 9 });

/**
 * The standing flurry: how many glyphs re-roll per beat, and how far back the
 * pure glyph function searches for the beat that last touched a slot.
 */
export const FLURRY = Object.freeze({ min: 2, max: 3, lookback: 48 });

/** FNV-1a over a string, as an unsigned 32-bit integer. */
export function hashString(text) {
  const s = String(text ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Combine two integers into a well-mixed unsigned 32-bit hash. */
function mix(a, b) {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) >>> 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** The seed a token's cipher grows from. The id and nothing else. */
export function cipherSeed(tokenId) {
  return hashString(tokenId);
}

/** How many glyphs the cipher has. */
export function cipherLength(seed) {
  const span = CIPHER_LENGTH.max - CIPHER_LENGTH.min + 1;
  return CIPHER_LENGTH.min + (mix(seed, 0x1e) % span);
}

const MARKS = Array.from(CIPHER_MARKS);

/** One glyph for one slot under one salt: `?` a third of the time. */
function glyphAt(seed, slot, salt) {
  const h = mix(mix(seed, slot + 1), salt);
  return h % 3 === 0 ? CIPHER_QUERY : MARKS[(h >>> 2) % MARKS.length];
}

/** The slots re-rolled on flurry beat `epoch` (epoch ≥ 1). */
function rerolled(seed, epoch, len) {
  const base = mix(seed ^ 0x5a17, epoch);
  const want = Math.min(len, FLURRY.min + (base % (FLURRY.max - FLURRY.min + 1)));
  const out = [];
  for (let i = 0; out.length < want && i < 16; i++) {
    const slot = mix(base, i + 3) % len;
    if (!out.includes(slot)) out.push(slot);
  }
  return out;
}

/**
 * The cipher's glyphs at flurry beat `epoch`.
 *
 * Pure in (seed, epoch) — deliberately, and deliberately **without a name
 * parameter**. Every client derives the same run from the same id, a slot keeps
 * the glyph of the most recent beat that re-rolled it, and nothing about the
 * creature underneath can reach the result.
 */
export function cipherGlyphs(seed, epoch = 0) {
  const len = cipherLength(seed);
  const salt = new Array(len).fill(0);
  const set = new Array(len).fill(false);
  let left = len;
  for (let e = Math.floor(epoch); e >= 1 && e > epoch - FLURRY.lookback && left; e--) {
    for (const slot of rerolled(seed, e, len)) {
      if (set[slot]) continue;
      set[slot] = true;
      salt[slot] = e;
      left--;
    }
  }
  return salt.map((s, slot) => glyphAt(seed, slot, s));
}

/**
 * Which flurry beat a clock is on, with a per-token phase so a map full of
 * unknown creatures does not re-roll in unison.
 */
export function flurryEpoch(clockMs, seed, periodMs) {
  if (!(periodMs > 0) || !Number.isFinite(clockMs)) return 0;
  const phase = ((mix(seed, 0x77) % 1000) / 1000) * periodMs;
  return Math.max(0, Math.floor((clockMs + phase) / periodMs));
}

/** A glyph for a slot that is still decoding. Changes every scramble tick. */
export function scrambleGlyph(seed, slot, tick) {
  return glyphAt(seed ^ 0x3c6ef372, slot, Math.floor(tick) + 1);
}

/* ══════════════════════════════════════════════════════════════════════
   The decision
   ══════════════════════════════════════════════════════════════════════ */

const NONE = Object.freeze({
  reserve: false, present: false, text: null, cipher: false, dim: false, marker: false, mystified: false,
});

/**
 * Whether mystification applies to a token at all.
 *
 * System first, then type. Both are cheap and neither needs a probe, which is
 * why nothing about the name's visibility is consulted for a token this answers
 * "no" for — a dnd5e world never reads a PF2e setting and never asks the dex.
 */
export function mystifiable(facts, ctx) {
  return ctx.system === MYSTIFY_SYSTEM && MYSTIFY_TYPES.includes(facts.actorType);
}

/**
 * Whether a token can ever show a label, which is what reserves its row.
 *
 * Deliberately independent of hover, selection and sight. The row is reserved
 * whenever a label is *possible*, so the bar under it sits in the same place
 * whether or not the name is drawn this frame — a bar that dropped a row every
 * time a Hover-mode name appeared would be the jump Phase 1 removed, back.
 */
export function labelReserved(facts, ctx) {
  if (!ctx.namesOn) return false;
  if (!String(facts.name ?? "").trim()) return false;
  if (mystifiable(facts, ctx)) return true;
  return facts.displayName !== ctx.NONE;
}

/**
 * Whether players are kept from this creature's name. Either gate suffices.
 *
 * (a) PF2e's own switch, and the token's own answer under it.
 * (b) The Creaturedex, when it is running: nothing learned, no name.
 *
 * Probes are functions so the gates cost nothing for the tokens that never reach
 * them, and so the check tool can prove which ones were asked.
 */
export function hiddenFromPlayers(facts, ctx) {
  if (ctx.pf2eNamesGated() && !ctx.playersCanSeeName(facts)) return true;
  if (ctx.dexActive() && !ctx.dexKnows(facts)) return true;
  return false;
}

/**
 * The whole decision for one token on this client.
 *
 * Order, each step a gate the next cannot undo:
 *   1. names off, or no name → nothing (and no reserved row)
 *   2. not mystifiable → Foundry's Display Name answer, and only that
 *   3. mystifiable → real name or cipher from `hiddenFromPlayers`; the GM always
 *      reads the real one, dimmed and marked when players cannot
 *   4. mystifiable presence → with the bar when this client sees the bar,
 *      otherwise only while hovered (or Alt), and only in sight
 */
export function decideLabel(facts, ctx) {
  if (!labelReserved(facts, ctx)) return NONE;
  const name = String(facts.name).trim();

  if (!mystifiable(facts, ctx)) {
    return {
      reserve: true, present: !!facts.nameVisible, text: name,
      cipher: false, dim: false, marker: false, mystified: false,
    };
  }

  const hidden = hiddenFromPlayers(facts, ctx);
  /* The one line the leak rules rest on. A player's decision for a hidden
     creature never carries its name, so nothing downstream can draw it. */
  const text = hidden && !ctx.isGM ? null : name;
  const present = facts.barsVisible
    ? true
    : !!facts.inSight && (!!facts.hover || !!ctx.highlight);
  return {
    reserve: true, present, text, cipher: text === null,
    dim: hidden && !!ctx.isGM, marker: hidden && !!ctx.isGM, mystified: true,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   Foundry adapters — only ever called inside a running world
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Whether this client may see the token's name, by Foundry's own Display Name
 * rule.
 *
 * `token.nameplate.visible` is that answer — assigned in `Token#_refreshState` as
 * `!isSecret && _canViewMode(displayName)` — and it is *current* only once that
 * pass has run, which is why this is asked from the refreshToken pass and nowhere
 * else. The nameplate is suppressed with `renderable`, never `visible`, so this
 * property stays Foundry's to write.
 */
export function canViewName(token) {
  const doc = token?.document;
  if (!doc || doc.isSecret) return false;
  if (!token.visible && !token.controlled) return false;
  if (token.nameplate && typeof token.nameplate.visible === "boolean") return token.nameplate.visible;
  return canViewMode(token, doc.displayName);
}

/** The facts the decision reads, gathered from a live token. */
export function tokenFacts(token, { barsVisible = false } = {}) {
  const doc = token?.document;
  return {
    token,
    name: doc?.name ?? token?.name ?? "",
    displayName: doc?.displayName,
    actorType: token?.actor?.type ?? null,
    nameVisible: canViewName(token),
    barsVisible: !!barsVisible,
    inSight: !!token?.visible && !doc?.isSecret,
    hover: !!token?.hover,
  };
}

/** The layout-only facts: enough to know whether a row is reserved. */
export function reserveFacts(token) {
  const doc = token?.document;
  return { name: doc?.name ?? "", displayName: doc?.displayName, actorType: token?.actor?.type ?? null };
}

/** PF2e's name-visibility switch, from its runtime mirror where it has one. */
function pf2eNamesGated() {
  const mirror = game.pf2e?.settings?.tokens?.nameVisibility;
  if (typeof mirror === "boolean") return mirror;
  try { return !!game.settings.get(MYSTIFY_SYSTEM, PF2E_NAME_SETTING); } catch { return false; }
}

/** PF2e's own answer, with its documented fallback for a document that lacks it. */
function playersCanSeeName(facts) {
  const doc = facts.token?.document;
  if (typeof doc?.playersCanSeeName === "boolean") return doc.playersCanSeeName;
  const M = globalThis.CONST?.TOKEN_DISPLAY_MODES ?? {};
  return doc?.displayName === M.ALWAYS || doc?.displayName === M.HOVER
    || facts.token?.actor?.alliance === "party";
}

function dexActive() {
  try { return Suite.enabled(DEX_FEATURE); } catch { return false; }
}

/* ── The Creaturedex, read across a feature line ─────────────────────────
   `CreaturedexApp.mayView` is the authority on what a player knows, and it is
   used rather than restated. Its module is not imported statically: it
   destructures `foundry.applications.api` at module scope, which does not exist
   under the Node tooling that loads this file, and a static import would also
   make this feature's import graph depend on that one's. It is resolved once, on
   first use, and every label asks again when it lands.

   Until it has resolved the answer is "not known" — a cipher — because the only
   safe way to be wrong about a secret is towards keeping it. */

let dexApp = null;
let dexLoading = null;
const knowMemo = new Map();

function loadDex(onLoad) {
  if (dexApp || dexLoading) return;
  dexLoading = import("../pf2e-creaturedex/app.mjs")
    .then((mod) => {
      dexApp = mod?.CreaturedexApp ?? null;
      knowMemo.clear();
      onLoad?.();
    })
    .catch((error) => warn("resource-bars | could not load the Creaturedex for name knowledge", error));
}

/**
 * Whether the viewer knows this creature, by the dex.
 *
 * A player asks `mayView`, which is exactly the rule the dex window itself uses:
 * a character holding any true *or false* section counts, because a player told a
 * lie cannot see that it is one. The GM asks the same question of the whole
 * party — `mayView` answers "yes" for any GM — so the marker means "no party
 * character knows anything about this kind of creature".
 *
 * Memoised per creature kind until `invalidateKnowledge()`: `knownSections`
 * clones the whole dex on every call, and an Alt press re-decides every token.
 */
function dexKnows(facts, isGM, onLoad) {
  const actor = facts.token?.actor;
  if (!actor) return false;
  const key = dexKey(actor);
  if (!key) return false;
  const memo = (isGM ? "gm:" : "pl:") + key;
  if (knowMemo.has(memo)) return knowMemo.get(memo);
  let known;
  if (isGM) {
    known = knownSections(key, PARTY_KEY).length > 0 || falseSections(key, PARTY_KEY).length > 0;
  } else {
    if (!dexApp) { loadDex(onLoad); return false; }
    known = !!dexApp.mayView(actor);
  }
  knowMemo.set(memo, known);
  return known;
}

/** Forget every memoised knowledge answer. Called on the setting updates that change one. */
export function invalidateKnowledge() {
  knowMemo.clear();
}

/** The full setting keys whose updates change a label, as `updateSetting` reports them. */
export const LABEL_SETTING_KEYS = Object.freeze([
  SUITE_ID + "." + DEX_KNOWLEDGE_SETTING,
  MYSTIFY_SYSTEM + "." + PF2E_NAME_SETTING,
]);

/** The live context for `decideLabel` and `labelReserved`. */
export function labelContext({ namesOn = true, onKnowledge = null } = {}) {
  const isGM = !!game.user?.isGM;
  return {
    namesOn,
    isGM,
    system: game.system?.id ?? null,
    highlight: !!canvas?.tokens?.highlightObjects,
    NONE: globalThis.CONST?.TOKEN_DISPLAY_MODES?.NONE ?? 0,
    pf2eNamesGated,
    playersCanSeeName,
    dexActive,
    dexKnows: (facts) => dexKnows(facts, isGM, onKnowledge),
  };
}
