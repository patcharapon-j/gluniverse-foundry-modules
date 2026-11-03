/**
 * Spellsprite — the reader. The impure half of the semantics: it turns what
 * PF2e posts to chat, and the conditions creatures carry, into FxSpecs with
 * positions, and hands them to the Director.
 *
 * Every client runs it and plays what ITS viewer may see. Nothing is sent over
 * a socket, nothing is written to a document.
 *
 * What PF2e 8.5.1 posts, and what each one becomes:
 *
 *   spell card     origin.type "spell" (+ castRank), casting.tradition;
 *                  context absent or type "spell-cast". No rolls, no target.
 *                  Attack spells wait for their roll; area spells for their
 *                  Region (flags.pf2e.messageId = the card) and their saves;
 *                  targeted save spells for their saves; the rest play now.
 *   attack-roll    origin weapon/melee = a Strike, origin spell = a spell
 *                  attack. Plays after Dice So Nice, with its degree.
 *   saving-throw   joins its cast by origin uuid (+ castRank) and gives that
 *                  target its outcome.
 *   skill-check    with an `action:<slug>` option: Demoralize, Trip, ...
 *   damage-roll    nothing, except a persistent-damage tick (origin.uuid is
 *                  the condition item).
 *   self-effect    the item named by context.item on the speaker's actor.
 *
 * Privacy is the message's: a card this viewer cannot read plays nothing, a
 * degree this viewer may not see plays "neutral", a token this viewer cannot
 * see is not drawn (and a GM-hidden one never on the stream login, which
 * holds GM rights and is watched by the players).
 */

import { SUITE_ID } from "../../core/const.mjs";
import { seesTruth } from "../pf2e-odds/view.mjs";
import { metagame, reachedPlayers } from "../pf2e-odds/observe.mjs";
import { seedOf } from "./core/rand.mjs";
import { LOOK_FLAG, SETTINGS, TIMING } from "./constants.mjs";
import { applyLook, mergeLooks } from "./looks.mjs";
import { describeCondition, describeItem, describeSkillAction, describeTick, outcomeFrom, slugOf } from "./semantics.mjs";

/* ── settings and viewer ───────────────────────────────────────────────── */

const setting = (key, fallback) => {
  try { const v = game.settings.get(SUITE_ID, key); return v ?? fallback; } catch { return fallback; }
};
const enabled = (key) => setting(key, true) !== false;

/** May this viewer read the message at all? pf2e-odds' landingOf gate, which
 *  itself answers only for check cards; a cast card or a tick has no roll. */
function canRead(message) {
  if (!message) return false;
  const truth = seesTruth();
  if (message.isContentVisible === false) return false;
  if (message.blind && !truth) return false;
  if (!truth && !reachedPlayers(message)) return false;
  if (!truth && game.user?.isGM && (message.whisper?.length ?? 0) > 0) return false;
  return true;
}

const degreeShown = () => seesTruth() || metagame("results");

/* ── tokens and positions ──────────────────────────────────────────────── */

const gridSize = () => canvas?.dimensions?.size ?? canvas?.grid?.size ?? 100;
const sceneId = () => canvas?.scene?.id ?? null;

function visibleToken(token) {
  if (!token || token.destroyed) return false;
  if (token.document?.parent?.id && token.document.parent.id !== sceneId()) return false;
  if (!token.isVisible) return false;
  return seesTruth() || !token.document?.hidden;
}

/** A Token placeable on the viewed scene from a uuid, a TokenDocument or an id. */
function tokenOf(ref) {
  if (!ref || !canvas?.ready) return null;
  try {
    let doc = ref;
    if (typeof ref === "string") doc = ref.includes(".") ? fromUuidSync(ref) : canvas.tokens?.get(ref)?.document;
    if (doc?.documentName === "Actor") doc = doc.token ?? doc.getActiveTokens?.(false, true)?.[0] ?? null;
    if (doc?.document) doc = doc.document;
    if (!doc || doc.documentName !== "Token") return null;
    if (doc.parent?.id !== sceneId()) return null;
    return canvas.tokens?.get(doc.id) ?? doc.object ?? null;
  } catch {
    return null;
  }
}

function speakerToken(message) {
  try {
    const doc = message.token ?? null;
    const t = tokenOf(doc);
    if (t) return t;
    const sp = message.speaker ?? {};
    if (sp.token && (!sp.scene || sp.scene === sceneId())) return canvas.tokens?.get(sp.token) ?? null;
  } catch { /* fall through */ }
  return null;
}

/** A body in squares, or null when this viewer cannot see the token. */
function bodyOf(token) {
  if (!visibleToken(token)) return null;
  const g = gridSize();
  const c = token.center;
  const size = Math.max(0.5, Number(token.document?.width) || 1);
  return { id: token.id, x: c.x / g, y: c.y / g, size, h: 1.3 * size };
}

const isUndead = (actor) => {
  try {
    if (actor?.modeOfBeing === "undead") return true;
    return !!actor?.traits?.has?.("undead") || (actor?.system?.traits?.value ?? []).includes("undead");
  } catch { return false; }
};

/** The tokens a user has targeted on the viewed scene. */
function userTargets(user) {
  try { return [...(user?.targets ?? [])].filter((t) => t?.document?.parent?.id === sceneId()); } catch { return []; }
}

/* ── looks, stand-down, dice ───────────────────────────────────────────── */

const lookFlag = (doc) => {
  try { return doc?.flags?.[SUITE_ID]?.[LOOK_FLAG] ?? doc?.flags?.[SUITE_ID]?.fx?.look ?? null; } catch { return null; }
};

/** World default, the GM's rule for the slug, the actor's look, the item's look. */
function lookFor(slug, actor, item) {
  const rules = setting(SETTINGS.rules, {}) ?? {};
  const r = rules && typeof rules === "object" ? rules : {};
  return mergeLooks(r["*"], slug ? r[slug] : null, lookFlag(actor), lookFlag(item));
}

/**
 * Would Automated Animations play this item? Best effort, unverified against a
 * live AA install: an item switched off in AA plays ours, a customised one is
 * AA's, otherwise AA's global autorec entries are matched on the item's name.
 */
function aaPlays(item) {
  try {
    if (!game.modules?.get("autoanimations")?.active || !item) return false;
    const f = item.flags?.autoanimations ?? null;
    if (f?.isEnabled === false) return false;
    if (f?.isCustomized) return true;
    const entries = globalThis.AutomatedAnimations?.AutorecManager?.getAutorecEntries?.();
    if (!entries) return false;
    const name = String(item.name ?? "").toLowerCase();
    for (const list of Object.values(entries)) {
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        const label = String(e?.label ?? "").toLowerCase().trim();
        if (label && name.includes(label)) return true;
      }
    }
  } catch { /* fall through */ }
  return false;
}

const sleep = (s) => new Promise((resolve) => setTimeout(resolve, Math.max(0, s) * 1000));

/** Resolves once Dice So Nice has shown a message's roll (or after TIMING.diceWait). */
async function diceDone(message) {
  if (!message?.rolls?.length) return;
  const dsn = game.dice3d;
  if (!dsn || !game.modules?.get("dice-so-nice")?.active) return;
  try {
    if (typeof dsn.waitFor3DAnimationByMessageID === "function") {
      await Promise.race([dsn.waitFor3DAnimationByMessageID(message.id), sleep(TIMING.diceWait)]);
      return;
    }
  } catch { /* fall back to the hook */ }
  await new Promise((resolve) => {
    let id = null;
    const done = () => { clearTimeout(timer); if (id != null) Hooks.off("diceSoNiceRollComplete", id); resolve(); };
    id = Hooks.on("diceSoNiceRollComplete", (mid) => { if ((typeof mid === "string" ? mid : mid?.id) === message.id) done(); });
    const timer = setTimeout(done, TIMING.diceWait * 1000);
  });
}

/* ── spec assembly ─────────────────────────────────────────────────────── */

const ctxOf = (message) => message?.flags?.pf2e?.context ?? null;
const originOf = (message) => message?.flags?.pf2e?.origin ?? null;
const nowS = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000;

function itemOf(message) {
  try { return message.item ?? null; } catch { return null; }
}

/** Semantics + bodies + look → a spec the Director can play, or null. */
function finish(desc, { id, seedKey, caster = null, targets = [], area = null, outcome = "neutral", slug = null, actor = null, item = null }) {
  if (!desc || desc.silent) return null;
  const spec = {
    id, seed: seedOf(String(seedKey ?? id)),
    kind: desc.kind, func: desc.func, material: desc.material, accent: desc.accent ?? null,
    outcome, rank: desc.rank ?? 1, tradition: desc.tradition ?? null,
    weapon: desc.weapon ?? null, caster, targets, area, condition: desc.condition ?? null, look: null,
    craft: desc.craft ?? null,
    // the look axes (docs/SPELLSPRITE_LOOK.md)
    delivery: desc.delivery ?? null, motif: desc.motif ?? null, props: desc.props ?? [], flavor: desc.flavor ?? null,
  };
  if (!spec.caster && !spec.targets.length && !spec.area) return null;
  return applyLook(spec, lookFor(slug ?? desc.slug, actor, item));
}

function play(spec, key, delay = 0) {
  if (!spec || !director) return null;
  try { return director.play(spec, { sceneId: sceneId(), delay, key }); } catch (e) { console.warn("Spellsprite | play failed", e); return null; }
}

/** The angle from one body to another, radians, canvas orientation (y down). */
const aim = (a, b) => (a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0);

/** A token's facing as an angle; Foundry's rotation 0 faces down. */
const facing = (token) => (((Number(token?.document?.rotation) || 0) + 90) * Math.PI) / 180;

/* ── regions ───────────────────────────────────────────────────────────── */

const DEG = Math.PI / 180;

/** A PF2e-placed Region's area, in squares. Rotation is read as degrees. */
function areaFromRegion(region, casterToken) {
  const g = gridSize();
  const shape = region?.shapes?.[0] ?? null;
  const rot = (Number(shape?.rotation) || 0) * DEG;
  const kind = region?.flags?.pf2e?.areaShape ?? shape?.type;
  if (!shape) return null;
  switch (shape.type) {
    case "circle":
      return { shape: kind === "emanation" ? "emanation" : "burst", x: shape.x / g, y: shape.y / g, r: (shape.radius ?? g) / g, dir: 0 };
    case "cone":
      return { shape: "cone", x: shape.x / g, y: shape.y / g, len: (shape.radius ?? g) / g, r: (shape.radius ?? g) / g, dir: rot };
    case "line":
      return { shape: "line", x: shape.x / g, y: shape.y / g, len: (shape.length ?? g) / g, width: Math.max(1, (shape.width ?? g) / g), dir: rot };
    case "rectangle": {
      const w = (shape.width ?? g) / g, h = (shape.height ?? g) / g;
      return { shape: "cube", x: shape.x / g + w / 2, y: shape.y / g + h / 2, r: Math.max(w, h) / 2, dir: rot };
    }
    case "emanation": {
      const b = shape.base ?? {};
      const c = casterToken?.center;
      const bw = Number(b.width) || 1;
      /* base width/height are grid units when small; x/y the token's top-left in px. */
      const cx = c ? c.x / g : (Number(b.x) || 0) / g + (bw < 20 ? bw / 2 : bw / g / 2);
      const cy = c ? c.y / g : (Number(b.y) || 0) / g + ((Number(b.height) || bw) < 20 ? (Number(b.height) || bw) / 2 : (Number(b.height) || bw) / g / 2);
      return { shape: "emanation", x: cx, y: cy, r: (shape.radius ?? g) / g + (bw < 20 ? bw : bw / g) / 2, dir: 0 };
    }
    default: {
      const bd = region.bounds ?? null;
      if (!bd) return null;
      return { shape: "burst", x: (bd.x + bd.width / 2) / g, y: (bd.y + bd.height / 2) / g, r: Math.min(bd.width, bd.height) / 2 / g, dir: 0 };
    }
  }
}

/** Is a point (squares) inside an area? Geometry only, for when the region cannot answer. */
function inArea(area, x, y) {
  const dx = x - area.x, dy = y - area.y;
  const d = Math.hypot(dx, dy);
  switch (area.shape) {
    case "cone": {
      if (d > (area.len ?? area.r ?? 1) + 0.25) return false;
      let a = Math.atan2(dy, dx) - (area.dir ?? 0);
      a = Math.atan2(Math.sin(a), Math.cos(a));
      return Math.abs(a) <= Math.PI / 4 + 0.05 || d < 0.5;
    }
    case "line": {
      const c = Math.cos(area.dir ?? 0), s = Math.sin(area.dir ?? 0);
      const along = dx * c + dy * s, across = -dx * s + dy * c;
      return along >= -0.25 && along <= (area.len ?? 1) + 0.25 && Math.abs(across) <= (area.width ?? 1) / 2 + 0.25;
    }
    case "cube": return Math.abs(dx) <= (area.r ?? 1) + 0.1 && Math.abs(dy) <= (area.r ?? 1) + 0.1;
    default: return d <= (area.r ?? 1) + 0.25;
  }
}

/** The visible tokens a region covers. */
function bodiesIn(region, area, exceptId = null) {
  const g = gridSize();
  const out = [];
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token.id === exceptId) continue;
    const b = bodyOf(token);
    if (!b) continue;
    let inside = null;
    try {
      const tree = region?.polygonTree ?? region?.object?.polygonTree ?? null;
      if (tree?.testPoint) inside = !!tree.testPoint({ x: b.x * g, y: b.y * g });
    } catch { inside = null; }
    if (inside == null && area) inside = inArea(area, b.x, b.y);
    if (inside) out.push(b);
  }
  return out;
}

/** A spell's area placed without a Region: on its first target, or from its caster. */
function areaFallback(desc, caster, casterToken, targets) {
  const a = desc.area;
  if (!a) return null;
  const first = targets[0] ?? null;
  if (a.shape === "emanation") return caster ? { ...a, x: caster.x, y: caster.y, r: (a.r ?? 1) + caster.size / 2, dir: 0 } : null;
  if (a.shape === "cone" || a.shape === "line") {
    if (caster) return { ...a, x: caster.x, y: caster.y, dir: first ? aim(caster, first) : facing(casterToken) };
    return first ? { ...a, shape: "burst", r: Math.max(1, (a.len ?? 2) / 3), x: first.x, y: first.y, dir: 0 } : null;
  }
  return first ? { ...a, x: first.x, y: first.y, dir: 0 } : null;
}

/* ── casts: the card, its region, its saves ───────────────────────────── */

let director = null;
/** castId → record */
const casts = new Map();
/** origin uuid → [castId] newest last */
const byOrigin = new Map();
/** messageId → region, for a region that arrived before its card */
const strayRegions = new Map();
const timers = new Set();

function later(seconds, fn) {
  const t = setTimeout(() => { timers.delete(t); fn(); }, Math.max(0, seconds) * 1000);
  timers.add(t);
  return t;
}

function forget(rec) {
  casts.delete(rec.id);
  const list = byOrigin.get(rec.uuid);
  if (list) { const i = list.indexOf(rec.id); if (i >= 0) list.splice(i, 1); if (!list.length) byOrigin.delete(rec.uuid); }
  if (rec.timer) { clearTimeout(rec.timer); timers.delete(rec.timer); }
}

function arm(rec, seconds) {
  if (rec.timer) { clearTimeout(rec.timer); timers.delete(rec.timer); }
  rec.timer = later(seconds, () => fire(rec));
}

function openCast(message, item, desc, casterToken) {
  const origin = originOf(message) ?? {};
  const rec = {
    id: message.id, uuid: origin.uuid ?? item?.uuid ?? null, rank: origin.castRank ?? null,
    at: nowS(), desc, item, actor: message.actor ?? item?.actor ?? null, slug: slugOf(item),
    casterToken, region: null, area: null, regionTargets: null,
    targets: userTargets(message.author ?? game.users?.get(message.user?.id ?? message.user)),
    saves: new Map(), timer: null, fired: false,
  };
  casts.set(rec.id, rec);
  if (rec.uuid) { const l = byOrigin.get(rec.uuid) ?? []; l.push(rec.id); byOrigin.set(rec.uuid, l); }
  return rec;
}

/** All targets have rolled: nothing left to wait for. */
function allSaved(rec) {
  const ids = rec.regionTargets ?? rec.targets.map((t) => t.id);
  return ids.length > 0 && ids.every((id) => rec.saves.has(id));
}

async function fire(rec) {
  if (rec.fired) return;
  rec.fired = true;
  forget(rec);
  if (nowS() - rec.at > TIMING.stale + TIMING.joinWindow) return;
  await Promise.all([...rec.saves.values()].map((s) => diceDone(s.message)));
  const casterToken = rec.casterToken;
  const caster = bodyOf(casterToken);
  const shown = degreeShown();
  const outcomeOf = (id) => {
    const s = rec.saves.get(id);
    if (!s || !shown || !canRead(s.message)) return "neutral";
    return outcomeFrom(ctxOf(s.message)?.outcome, "save");
  };
  let targets;
  let area = rec.area;
  if (rec.desc.kind === "area") {
    if (!area) {
      const seed = [...rec.targets, ...[...rec.saves.values()].map((s) => s.token)].map(bodyOf).filter(Boolean);
      area = areaFallback(rec.desc, caster, casterToken, dedupe(seed));
    }
    if (!area) return;
    if (rec.region) targets = bodiesIn(rec.region, area, rec.desc.area?.shape === "emanation" ? casterToken?.id : null);
    else targets = dedupe([...rec.targets, ...[...rec.saves.values()].map((s) => s.token)].map(bodyOf).filter(Boolean));
    /* A cone or line from a creature this viewer cannot see starts at nobody. */
    if (!caster && (area.shape === "cone" || area.shape === "line")) {
      const first = targets[0];
      if (!first) return;
      area = { ...area, shape: "burst", r: Math.max(1, (area.len ?? 2) / 3), x: first.x, y: first.y, dir: 0 };
    }
  } else {
    targets = dedupe([...rec.targets, ...[...rec.saves.values()].map((s) => s.token)].map(bodyOf).filter(Boolean));
  }
  targets = targets.map((t) => ({ ...t, outcome: outcomeOf(t.id) }));
  const primary = targets.find((t) => t.outcome !== "neutral")?.outcome ?? "neutral";
  const spec = finish(rec.desc, { id: `msg:${rec.id}`, seedKey: rec.id, caster, targets, area, outcome: primary, slug: rec.slug, actor: rec.actor, item: rec.item });
  play(spec, `msg:${rec.id}`);
}

function dedupe(bodies) {
  const seen = new Set();
  return bodies.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
}

/** The open cast a save belongs to. */
function castFor(origin) {
  const list = byOrigin.get(origin?.uuid);
  if (!list?.length) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const rec = casts.get(list[i]);
    if (!rec || rec.fired) continue;
    if (nowS() - rec.at > TIMING.joinWindow + TIMING.saveWait) continue;
    if (origin.castRank != null && rec.rank != null && Number(origin.castRank) !== Number(rec.rank)) continue;
    return rec;
  }
  return null;
}

/* ── message handlers ──────────────────────────────────────────────────── */

const ACTION_TYPES = new Set(["action", "feat", "consumable", "equipment"]);

function isCast(origin) {
  const opts = origin?.rollOptions ?? [];
  if (opts.includes?.("origin:action:slug:cast-a-spell")) return true;
  return false;
}

/** A spell, action or consumable card. */
function onCard(message, ctx, origin) {
  const item = itemOf(message);
  if (!item) return;
  const isSpell = origin?.type === "spell" || item.type === "spell";
  if (isSpell ? !enabled(SETTINGS.spells) : !enabled(SETTINGS.actions)) return;
  if (isSpell && !isCast(origin) && !message.flags?.pf2e?.casting?.embeddedSpell) return;
  if (!isSpell && !ACTION_TYPES.has(item.type)) return;
  if (enabled(SETTINGS.standDown) && aaPlays(item)) return;
  const casterToken = speakerToken(message);
  const firstTarget = userTargets(message.author)[0] ?? null;
  const desc = describeItem(item, {
    use: isSpell ? "cast" : "action",
    castRank: origin?.castRank, casting: message.flags?.pf2e?.casting ?? null,
    tradition: message.flags?.pf2e?.casting?.tradition ?? null,
    actorLevel: message.actor?.level ?? item.actor?.level,
    targetUndead: isUndead(firstTarget?.actor),
    hazard: message.actor?.type === "hazard",
  });
  if (!desc || desc.silent) return;
  if (desc.kind === "attack" && isSpell) return; // the attack roll plays it
  const rec = openCast(message, item, desc, casterToken);
  const stray = strayRegions.get(message.id);
  if (stray) { strayRegions.delete(message.id); attachRegion(rec, stray); return; }
  if (desc.kind === "area") {
    const save = !!(item.system?.defense?.save);
    /* An emanation needs no Region when this viewer can see where it starts. */
    const casterBody = bodyOf(casterToken);
    if (desc.area?.shape === "emanation" && casterBody) {
      rec.area = areaFallback(desc, casterBody, casterToken, []);
      const g = gridSize();
      rec.regionTargets = rec.area ? (canvas.tokens?.placeables ?? []).filter((t) => t.id !== casterToken.id && visibleToken(t) && inArea(rec.area, t.center.x / g, t.center.y / g)).map((t) => t.id) : null;
      rec.targets = (rec.regionTargets ?? []).map((id) => canvas.tokens.get(id)).filter(Boolean);
      arm(rec, save ? TIMING.saveWait : 0);
      return;
    }
    arm(rec, TIMING.joinWindow);
    return;
  }
  if (desc.kind === "save") {
    arm(rec, rec.targets.length ? TIMING.saveWait : TIMING.joinWindow);
    return;
  }
  arm(rec, 0);
}

function attachRegion(rec, region) {
  rec.region = region;
  rec.area = areaFromRegion(region, rec.casterToken) ?? rec.area;
  if (rec.area && rec.desc.area?.shape && rec.area.shape !== rec.desc.area.shape && rec.desc.area.shape !== "burst") {
    rec.area = { ...rec.area, shape: rec.desc.area.shape };
  }
  /* Hidden creatures still roll saves; only the ones this viewer sees are waited on. */
  rec.regionTargets = rec.area
    ? bodiesIn(region, rec.area, rec.desc.area?.shape === "emanation" ? rec.casterToken?.id : null).map((b) => b.id)
    : null;
  const save = !!(rec.item?.system?.defense?.save);
  if (!save) { arm(rec, 0); return; }
  if (allSaved(rec)) { arm(rec, 0); return; }
  arm(rec, TIMING.saveWait);
}

function onSave(message, ctx, origin) {
  const rec = castFor(origin);
  if (!rec) return;
  const token = tokenOf(ctx?.target?.token) ?? speakerToken(message);
  if (!token) return;
  rec.saves.set(token.id, { token, message });
  if (rec.desc.kind === "save" && !rec.targets.length) {
    arm(rec, TIMING.saveWait); // no targets picked: gather the savers as they roll
    return;
  }
  if (rec.desc.kind === "area" && !rec.region && !rec.regionTargets) return; // the region sets the clock
  if (allSaved(rec)) arm(rec, 0);
}

/** An NPC strike's linked weapon (PF2e and SF2e keep it under their own flag scope). */
function linkedWeapon(item) {
  try {
    if (item?.type !== "melee") return null;
    const own = item.linkedWeapon;
    if (own) return own;
    const id = item.flags?.[game.system.id]?.linkedWeapon ?? item.flags?.pf2e?.linkedWeapon;
    return id ? item.actor?.items?.get(id) ?? null : null;
  } catch { return null; }
}

/** Whether the attacker has a powered swing toggled on (PF2e: `actor.rollOptions.damage`). */
function poweredSwing(actor) {
  try {
    const on = actor?.rollOptions?.damage ?? {};
    return !!(on["vicious-swing"] || on["power-attack"]);
  } catch { return false; }
}

async function onAttack(message, ctx, origin) {
  const isSpell = origin?.type === "spell";
  if (isSpell ? !enabled(SETTINGS.spells) : !enabled(SETTINGS.strikes)) return;
  const item = itemOf(message);
  if (!item) return;
  if (enabled(SETTINGS.standDown) && aaPlays(item)) return;
  const received = nowS();
  const casterToken = speakerToken(message) ?? tokenOf(ctx?.origin?.token);
  const targetToken = tokenOf(ctx?.target?.token);
  const domains = ctx?.domains ?? [];
  const options = ctx?.options ?? [];
  const ranged = domains.includes?.("ranged-attack-roll") || options.includes?.("item:ranged");
  const desc = isSpell
    ? describeItem(item, { use: "cast", castRank: origin?.castRank, tradition: message.flags?.pf2e?.casting?.tradition ?? null, actorLevel: message.actor?.level, targetUndead: isUndead(targetToken?.actor) })
    : describeItem(item, { use: "strike", ranged, actorLevel: message.actor?.level, weapon: linkedWeapon(item) });
  if (!desc || desc.silent) return;
  await diceDone(message);
  if (nowS() - received > TIMING.stale) return;
  const caster = bodyOf(casterToken);
  const target = bodyOf(targetToken);
  const outcome = degreeShown() ? outcomeFrom(ctx?.outcome, "attack") : "neutral";
  const targets = target ? [{ ...target, outcome }] : [];
  let area = null;
  if (desc.area && target) area = { ...desc.area, x: target.x, y: target.y, dir: aim(caster, target) };
  // Vicious Swing (Power Attack before the remaster) is a damage-domain toggle,
  // so the attack roll never carries it: read the toggle off the attacker.
  const power = !isSpell && desc.weapon && !desc.weapon.ranged && poweredSwing(message.actor);
  if (power) {
    desc.weapon = { ...desc.weapon, power: true };
    desc.props = [...new Set([...(desc.props ?? []), "power"])].sort();
  }
  const spec = finish({ ...desc, kind: isSpell ? "attack" : "strike" }, {
    id: `msg:${message.id}`, seedKey: message.id, caster, targets, area, outcome,
    slug: slugOf(item), actor: message.actor, item,
  });
  play(spec, `msg:${message.id}`);
}

async function onSkillAction(message, ctx) {
  if (!enabled(SETTINGS.actions)) return;
  const options = ctx?.options ?? [];
  const opt = options.find?.((o) => /^action:[a-z0-9-]+$/.test(o));
  if (!opt) return;
  const slug = opt.slice("action:".length);
  if (slug === "strike" || slug === "cast-a-spell") return;
  const desc = describeSkillAction(slug, ctx?.traits ?? []);
  if (!desc || desc.silent) return;
  const received = nowS();
  await diceDone(message);
  if (nowS() - received > TIMING.stale) return;
  const caster = bodyOf(speakerToken(message));
  const target = bodyOf(tokenOf(ctx?.target?.token));
  const outcome = degreeShown() && desc.mode === "attack" ? outcomeFrom(ctx?.outcome, "attack") : "neutral";
  const spec = finish(desc, {
    id: `msg:${message.id}`, seedKey: message.id, caster,
    targets: target && desc.kind !== "self" ? [{ ...target, outcome }] : [],
    outcome, slug, actor: message.actor,
  });
  play(spec, `msg:${message.id}`);
}

async function onTick(message, origin) {
  if (!enabled(SETTINGS.conditions)) return;
  let cond = null;
  try { cond = origin?.uuid ? fromUuidSync(origin.uuid) : null; } catch { cond = null; }
  if (!cond || cond.type !== "condition" || (cond.slug ?? cond.system?.slug) !== "persistent-damage") return;
  const received = nowS();
  await diceDone(message);
  if (nowS() - received > TIMING.stale) return;
  const body = bodyOf(speakerToken(message) ?? tokenOf(cond.actor));
  if (!body) return;
  const desc = describeTick(cond.system?.persistent?.damageType, {});
  const spec = finish(desc, { id: `msg:${message.id}`, seedKey: message.id, targets: [{ ...body, outcome: "neutral" }], slug: "persistent-damage", actor: cond.actor });
  play(spec, `msg:${message.id}`);
}

function onSelfEffect(message, ctx) {
  if (!enabled(SETTINGS.actions)) return;
  const actor = message.actor;
  const item = itemOf(message) ?? actor?.items?.get?.(ctx?.item) ?? null;
  if (!item) return;
  if (enabled(SETTINGS.standDown) && aaPlays(item)) return;
  const desc = describeItem(item, { use: "action", actorLevel: actor?.level });
  if (!desc || desc.silent) return;
  const caster = bodyOf(speakerToken(message));
  const spec = finish({ ...desc, kind: "self" }, { id: `msg:${message.id}`, seedKey: message.id, caster, slug: slugOf(item), actor, item });
  play(spec, `msg:${message.id}`);
}

function onMessage(message) {
  try {
    if (!canvas?.ready || !director) return;
    if (!canRead(message)) return;
    const ctx = ctxOf(message);
    const origin = originOf(message);
    const type = ctx?.type ?? null;
    if (type === "attack-roll") {
      if (["weapon", "melee", "spell"].includes(origin?.type)) void onAttack(message, ctx, origin);
      return;
    }
    if (type === "saving-throw") { if (origin?.uuid) onSave(message, ctx, origin); return; }
    if (type === "skill-check" || type === "perception-check") { void onSkillAction(message, ctx); return; }
    if (type === "self-effect") { onSelfEffect(message, ctx); return; }
    if (type === "damage-roll") { if (!ctx?.origin && origin?.uuid && !origin.type) void onTick(message, origin); return; }
    if (!ctx && origin?.uuid && !origin.type && message.rolls?.length) { void onTick(message, origin); return; }
    if (type === null || type === "spell-cast") {
      if (origin?.type && origin.type !== "weapon" && origin.type !== "melee") onCard(message, ctx, origin);
    }
  } catch (e) {
    console.warn("Spellsprite | could not read a chat message", e);
  }
}

/* A Region's own visibility (hidden from players) is the region's; PF2e-placed
   areas are visible to everyone who could read the card. */
function onRegion(region) {
  try {
    const mid = region?.flags?.pf2e?.messageId;
    if (!mid || region.parent?.id !== sceneId()) return;
    const rec = casts.get(mid);
    if (rec && !rec.fired) { attachRegion(rec, region); return; }
    strayRegions.set(mid, region);
    later(TIMING.joinWindow, () => strayRegions.delete(mid));
  } catch (e) {
    console.warn("Spellsprite | could not read a region", e);
  }
}

/* ── condition loops ───────────────────────────────────────────────────── */

/** Loop keys this reader started. */
const active = new Set();
let reconcileTimer = null;

/** The conditions to draw on an actor: { key-slug → { slug, value, damageType } }. */
function conditionsOf(actor) {
  const out = new Map();
  let list = [];
  try { list = actor?.itemTypes?.condition ?? actor?.items?.filter?.((i) => i.type === "condition") ?? []; } catch { list = []; }
  for (const c of list) {
    if (c?.active === false) continue;
    const parentId = c.system?.references?.parent?.id;
    if (parentId && actor.items?.get?.(parentId)?.type === "condition") continue; // granted by another condition
    const slug = c.slug ?? c.system?.slug;
    if (!slug) continue;
    if (slug === "persistent-damage") {
      const t = c.system?.persistent?.damageType ?? "untyped";
      out.set(`persistent-damage-${t}`, { slug, value: null, damageType: t });
      continue;
    }
    const value = Number(c.value ?? c.system?.value?.value) || null;
    const prev = out.get(slug);
    if (!prev || (value ?? 0) > (prev.value ?? 0)) out.set(slug, { slug, value, damageType: null });
  }
  return out;
}

function reconcile() {
  reconcileTimer = null;
  if (!director) return;
  const want = new Map();
  /** Tokens still on the board that this viewer can no longer see: their loops vanish, never fade. */
  const unseen = new Set();
  if (canvas?.ready && enabled(SETTINGS.conditions)) {
    for (const token of canvas.tokens?.placeables ?? []) {
      const body = bodyOf(token);
      if (!body && token?.id) unseen.add(token.id);
      if (!body || !token.actor) continue;
      for (const [keySlug, c] of conditionsOf(token.actor)) {
        const desc = describeCondition(c.slug, { value: c.value, damageType: c.damageType });
        if (!desc || desc.silent) continue;
        const key = `cond:${token.id}:${keySlug}`;
        const spec = finish(desc, { id: key, seedKey: key, targets: [{ ...body, outcome: "neutral" }], slug: c.slug, actor: token.actor });
        if (spec) want.set(key, spec);
      }
    }
  }
  for (const id of unseen) { try { director.dropLoops(`cond:${id}:`); } catch { /* gone */ } }
  for (const key of [...active]) {
    if (want.has(key)) continue;
    try { director.stopLoop(key); } catch { /* gone */ }
    active.delete(key);
  }
  const sid = sceneId();
  for (const [key, spec] of want) {
    try { if (director.startLoop(key, spec, { sceneId: sid })) active.add(key); } catch (e) { console.warn("Spellsprite | loop failed", e); }
  }
}

function scheduleReconcile(delay = 0.1) {
  if (reconcileTimer) return;
  reconcileTimer = setTimeout(reconcile, delay * 1000);
}

/** Drop every condition loop and draw the scene's conditions afresh. */
export function primeScene(dir = director) {
  if (dir) director = dir;
  if (!director) return;
  try { director.stopLoops("cond:"); } catch { /* none */ }
  active.clear();
  if (reconcileTimer) { clearTimeout(reconcileTimer); reconcileTimer = null; }
  reconcile();
}

/* ── wiring ────────────────────────────────────────────────────────────── */

const isCondition = (item) => item?.type === "condition";
const OUR_SETTINGS = new Set(Object.values(SETTINGS).map((k) => `${SUITE_ID}.${k}`));

/**
 * Register the reader's hooks. Call from onReady once the canvas exists.
 * @param {import("./director.mjs").Director} dir
 * @returns {() => void} unwire
 */
export function wireReader(dir) {
  director = dir;
  const hooks = [];
  const on = (event, fn) => hooks.push([event, Hooks.on(event, fn)]);

  on("createChatMessage", (message) => onMessage(message));
  on("createRegion", (region) => onRegion(region));

  on("createItem", (item) => { if (isCondition(item)) scheduleReconcile(); });
  on("updateItem", (item) => { if (isCondition(item)) scheduleReconcile(); });
  on("deleteItem", (item) => { if (isCondition(item)) scheduleReconcile(); });
  on("createToken", () => scheduleReconcile());
  on("updateToken", (_doc, changes) => {
    if (!changes) return;
    if ("hidden" in changes || "actorId" in changes || "actorLink" in changes || "width" in changes || "delta" in changes) scheduleReconcile();
  });
  on("deleteToken", () => scheduleReconcile());
  on("sightRefresh", () => scheduleReconcile(0.25));
  on("canvasReady", () => primeScene());
  on("updateSetting", (s) => { if (OUR_SETTINGS.has(s?.key)) scheduleReconcile(); });

  if (canvas?.ready) primeScene();

  return () => {
    for (const [event, id] of hooks) Hooks.off(event, id);
    hooks.length = 0;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (reconcileTimer) { clearTimeout(reconcileTimer); reconcileTimer = null; }
    casts.clear(); byOrigin.clear(); strayRegions.clear();
    try { director?.stopLoops("cond:"); } catch { /* none */ }
    active.clear();
    director = null;
  };
}
