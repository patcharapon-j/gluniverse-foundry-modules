/**
 * Save Resolution — the Foundry half.
 *
 * One flow for every save spell. The GM (the active GM's client, the
 * "conductor") is the only writer: it opens a session as a chat card carrying
 * the `sv.session` flag, files each saving throw and the damage roll against it
 * as they land in chat, and applies and reverts. Nobody else writes anything;
 * a caster's owner asks for a session over the socket, and a player rolls their
 * own creature's save through PF2e itself — from our row, our card, or PF2e's
 * own button on the spell card — which the conductor then recognises.
 *
 * What anyone sees of a result is read off the save's own message through the
 * gate PF2e's card uses (pf2e-odds `landingOf`); the session holds message ids,
 * never a degree or a total. See model.mjs and docs/PF2E_ODDS.md.
 */

import { SUITE_ID, err, warn } from "../../core/const.mjs";
import { emitSocket, onSocket } from "../../core/socket.mjs";
import { Suite } from "../../core/registry.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { pf2eCoverage } from "../pf2e-aoe/data.mjs";
import { landingOf, naturalOf } from "../pf2e-odds/landing.mjs";
import { seesTruth } from "../pf2e-odds/view.mjs";
import { DEGREES, FEATURE_ID, FLAG, MAX_ROWS, MSG, MULTS, SAVES, SCAN_MESSAGES, SETTINGS, SPELL_FLAG } from "./constants.mjs";
import {
  identFor, maskRow, mayRoll, mayWrite, membersOf, multiplierFor, newestFirst, normalizeConfig, normalizeSession,
  parseDegreeEffects, planCondition, planRevert, previewDamage, rowForSave, rowView, takesDamage, undoLive,
} from "./model.mjs";
import { sessionHTML } from "./render.mjs";
import { SavesPanel } from "./panel.mjs";

const T = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));

/* ══════════════════════════════════════════════════════════════════════
   Reading
   ══════════════════════════════════════════════════════════════════════ */

const isConductor = () => !!game.user?.isGM && game.users?.activeGM?.id === game.user.id;
const gmView = (user = game.user) => !!user?.isGM && seesTruth(user);

export const readSession = (message) => normalizeSession(message?.getFlag?.(SUITE_ID, FLAG));

/** Open sessions among the most recent messages, newest first, each with its card. */
function openSessions() {
  const list = game.messages?.contents ?? [];
  const out = [];
  for (let i = list.length - 1, n = 0; i >= 0 && n < SCAN_MESSAGES; i--, n++) {
    const s = readSession(list[i]);
    if (s && !s.closed) out.push(Object.assign(s, { _msg: list[i] }));
  }
  return newestFirst(out);
}

const sessionForCast = (castId) => openSessions().find((s) => s.castId === castId) ?? null;

function setting(key, fallback) {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
}

const tokenOf = (row) => (row?.tokenUuid ? fromUuidSync(row.tokenUuid) : null);
const actorOf = (row) => tokenOf(row)?.actor ?? (row?.actorUuid ? fromUuidSync(row.actorUuid) : null);
const owns = (user, row) => !!actorOf(row)?.testUserPermission?.(user, "OWNER");

/** The spell at its cast rank: the cast card's own item when it still exists. */
async function spellOf(s) {
  const cast = s.castId ? game.messages.get(s.castId) : null;
  return cast?.item ?? (s.spellUuid ? await fromUuid(s.spellUuid) : null);
}

/** The spell's own actor. PF2e resolves a card's item from its origin flag, not its speaker, so the two can disagree. */
function casterOf(s) {
  const cast = s.castId ? game.messages.get(s.castId) : null;
  return cast?.item?.actor ?? cast?.actor ?? (s.casterUuid ? fromUuidSync(s.casterUuid) : null);
}

/** Who a row's creature is right now, for a viewer who is not the truth (null: the token is gone). */
function liveOf(row) {
  const tok = tokenOf(row);
  if (!tok) return null;
  const actor = tok.actor;
  const named = !!actor?.hasPlayerOwner || (!tok.hidden && tok.playersCanSeeName !== false);
  return { hidden: !!tok.hidden, named, name: tok.name, img: tok.texture?.src ?? actor?.img ?? "" };
}

/* ══════════════════════════════════════════════════════════════════════
   What a viewer sees of a row's save
   ══════════════════════════════════════════════════════════════════════ */

/**
 * The result a viewer may read off a save's message, or null (not rolled, or
 * sealed for them). The truth reads it straight; a player who rolled it reads
 * their own card unless it was blind (Foundry hides a blind roll from its own
 * author); everyone else goes through PF2e's gate.
 */
function resultFor(rollId, user = game.user) {
  const m = rollId ? game.messages.get(rollId) : null;
  const roll = m?.rolls?.[0];
  if (!m || !roll) return null;
  if (seesTruth(user) || (!user.isGM && m.author?.id === user.id && !m.blind)) {
    const d = DEGREES.indexOf(m.flags?.pf2e?.context?.outcome ?? "");
    return { degree: d >= 0 ? d : null, face: naturalOf(roll), total: roll.total };
  }
  const landing = landingOf(m, user);
  if (!landing) return null;
  return { degree: landing.degree, face: landing.face, total: landing.face != null ? roll.total : null };
}

/** PF2e's own degree on the save, for the GM's apply. */
function degreeOf(rollId) {
  const d = DEGREES.indexOf(game.messages.get(rollId ?? "")?.flags?.pf2e?.context?.outcome ?? "");
  return d >= 0 ? d : null;
}

/** The apply preview: the shared damage under this row's multiplier, through the creature's IWR. */
function previewFor(actor, damageMsg, mult) {
  const roll = damageMsg?.rolls?.[0];
  if (!actor || !roll) return null;
  const opts = new Set(damageMsg.flags?.pf2e?.context?.options ?? []);
  const iwrOn = game.pf2e?.settings?.iwr !== false;
  const { immunities = [], weaknesses = [], resistances = [] } = actor.attributes ?? {};
  const instances = (roll.instances ?? []).map((inst) => {
    const f = new Set([...(inst.formalDescription ?? []), ...opts]);
    const test = (x) => { try { return !!x.test(f); } catch { return false; } };
    const imm = iwrOn ? immunities.find((x) => x.type !== "critical-hits" && test(x)) : null;
    const weak = iwrOn ? weaknesses.filter(test).reduce((a, b) => (!a || b.value > a.value ? b : a), null) : null;
    const resVal = (x) => { try { return x.getDoubledValue?.(f) ?? x.value; } catch { return x.value; } };
    const res = iwrOn ? resistances.filter(test).reduce((a, b) => (!a || resVal(b) > resVal(a) ? b : a), null) : null;
    return {
      type: inst.type, total: inst.total, persistent: !!inst.persistent,
      immune: imm ? imm.label ?? imm.type : null,
      weakness: weak ? { label: weak.applicationLabel ?? weak.label ?? weak.type, value: weak.value } : null,
      resistance: res ? { label: res.applicationLabel ?? res.label ?? res.type, value: resVal(res) } : null,
    };
  });
  return previewDamage(instances, mult);
}

async function oddsFor(s, row, actor, spell, caster) {
  if (!actor || row.rollId || s.dc == null) return "";
  const odds = Suite.enabled?.("pf2e-odds") ? game.modules.get(SUITE_ID)?.api?.features?.["pf2e-odds"] : null;
  if (!odds?.saveOdds) return "";
  try {
    return (await odds.saveOdds({ saver: actor, save: s.save, dc: s.dc, origin: caster, item: spell })) ?? "";
  } catch { return ""; }
}

/**
 * The view both hosts draw. `overrides` are the panel's per-row multipliers
 * (GM-only, never written anywhere).
 */
export async function buildView(message, { compact = false, overrides = new Map(), configOpen = false, user = game.user } = {}) {
  const s = readSession(message);
  if (!s) return null;
  const truth = seesTruth(user);
  const gm = gmView(user);
  const spell = await spellOf(s);
  const caster = casterOf(s);
  const damageMsg = s.damageId ? game.messages.get(s.damageId) : null;
  const now = Date.now();
  const combatAlive = (cid) => !!game.combats?.get(cid);
  const rows = [];
  for (const row of s.rows) {
    const token = tokenOf(row);
    const actor = token?.actor ?? actorOf(row);
    const result = resultFor(row.rollId, user);
    const live = { name: token?.name ?? actor?.name ?? "", img: token?.texture?.src ?? actor?.img ?? "", result };
    if (!compact && !row.rollId && (gm || owns(user, row))) live.odds = await oddsFor(s, row, actor, spell, caster);
    if (gm && !compact && row.rollId && !row.applied && result?.degree != null) {
      live.mult = overrides.get(row.id) ?? multiplierFor(result.degree, s.config, s.basic);
      live.preview = damageMsg ? previewFor(actor, damageMsg, live.mult) : null;
      live.effects = s.config.effects[DEGREES[result.degree]] ?? [];
    }
    // Visibility is re-read live: a token hidden, or its name concealed, after the session opened.
    const view = rowView(truth ? row : maskRow(row, liveOf(row)), {
      truth, isGM: gm, live,
      canRoll: (gm || !user.isGM) && mayRoll(user, row, { owns }),
      undo: undoLive(row.applied, { now, combatAlive }),
    });
    if (view) {
      if (compact) Object.assign(view, { canApply: false, canRemove: false });
      rows.push(view);
    }
  }
  const saveLabel = T(`PF2E.Saves${s.save[0].toUpperCase()}${s.save.slice(1)}`);
  const dcShown = s.dc != null && (gm || !!caster?.hasPlayerOwner || !!game.pf2e?.settings?.metagame?.dcs);
  const saveLine = [
    s.basic ? T("GLSV.head.basic", { save: saveLabel }) : saveLabel,
    dcShown ? T("GLSV.head.dc", { dc: s.dc }) : null,
  ].filter(Boolean).join(" · ");
  const roll = damageMsg?.rolls?.[0];
  // A private cast's card is a sanitized public projection: no spell, no caster.
  const title = truth ? spell?.name || s.spellName : s.private ? T("GLSV.head.private") : s.spellName || spell?.name;
  return {
    title: title || "",
    img: truth ? s.spellImg || spell?.img || "" : s.spellImg,
    saveLine,
    isGM: gm,
    canOpen: gm || (!user.isGM && !!caster?.isOwner),
    compact,
    rows,
    blocked: s.blocked.map((b) => (truth ? b : maskRow(b, liveOf(b)))).filter((b) => truth || !b.hidden)
      .map((b) => ({ id: b.id, name: (truth ? tokenOf(b)?.name : null) || b.name, img: (truth ? tokenOf(b)?.texture?.src : null) || b.img })),
    config: gm ? s.config : null,
    configOpen,
    damage: gm && roll ? { total: String(roll.total), types: [...new Set((roll.instances ?? []).map((i) => i.typeLabel ?? i.type))].join(", "), formula: roll.formula ?? "" } : null,
    npcsToRoll: s.rows.filter((r) => r.kind === "npc" && !r.rollId).length,
    toApply: rows.filter((r) => r.canApply).length,
    toRevert: rows.filter((r) => r.canRevert).length,
    canRollDamage: gm && !!spell && !s.rows.some((r) => r.applied),
  };
}

/* ══════════════════════════════════════════════════════════════════════
   The conductor — the active GM's client, the only writer
   ══════════════════════════════════════════════════════════════════════ */

let queue = Promise.resolve();

/** Every session write: re-read the flag, change it, write it back — one at a time. */
function mutate(messageId, fn) {
  queue = queue.then(async () => {
    const message = game.messages.get(messageId);
    const s = readSession(message);
    if (!s) return;
    const next = await fn(structuredClone(s));
    if (next) await message.update({ [`flags.${SUITE_ID}.${FLAG}`]: next });
  }).catch((e) => err("pf2e-saves: session write failed", e));
  return queue;
}

let ops = Promise.resolve();

/**
 * Apply and Revert, one whole operation at a time on the conductor: the fresh
 * read, every write to the creature and the undo record. Two overlapping clicks
 * (or two GMs) otherwise both see an unapplied row and both apply it.
 */
function serially(fn) {
  ops = ops.then(fn).catch((e) => err("pf2e-saves: apply/revert failed", e));
  return ops;
}

/** Run on the conductor: here if this client is it, else over the socket to it. */
function viaConductor(type, payload, run) {
  if (isConductor()) return run();
  const gm = game.users.activeGM;
  if (!gm) { ui.notifications?.warn(T("GLSV.warn.noGM")); return null; }
  emitSocket(FEATURE_ID, { type, ...payload }, { recipients: [gm.id] });
  return null;
}

/** One row, as everybody may read it: a creature players cannot name is stored without its name or art. */
function rowOf(tokenDoc, save) {
  const actor = tokenDoc?.actor;
  if (!actor?.saves?.[save]) return null;
  const pc = !!actor.hasPlayerOwner;
  const named = pc || (!tokenDoc.hidden && tokenDoc.playersCanSeeName !== false);
  return {
    id: tokenDoc.id,
    tokenUuid: tokenDoc.uuid,
    actorUuid: actor.uuid,
    kind: pc ? "pc" : "npc",
    name: named ? tokenDoc.name : "",
    img: named ? tokenDoc.texture?.src ?? actor.img : "",
    hidden: !!tokenDoc.hidden,
    rollId: null,
    applied: null,
  };
}

function cellsOf(tokenDoc) {
  try {
    const cells = tokenDoc.getOccupiedGridSpaceOffsets?.();
    if (cells?.length) return [...cells];
  } catch { /* fall through */ }
  try {
    const o = canvas.grid.getOffset(tokenDoc.object?.center ?? { x: tokenDoc.x, y: tokenDoc.y });
    return [o];
  } catch { return []; }
}

/** Area first (the cast's own Regions), else the requester's targets. */
function membersFor(castMsg, targetIds) {
  const scene = canvas?.scene;
  if (!scene) return { inside: [], blocked: [] };
  const regions = scene.regions?.filter((r) => r.flags?.pf2e?.messageId === castMsg.id) ?? [];
  if (regions.length) {
    const covered = [], blocked = [];
    for (const r of regions) {
      let cov = pf2eCoverage(r.object ?? r);
      if (!cov) {
        try { cov = { covered: [...(r.object?._getCoveredGridSpaceOffsets?.() ?? [])], blocked: [] }; } catch { cov = null; }
      }
      covered.push(...(cov?.covered ?? []));
      blocked.push(...(cov?.blocked ?? []));
    }
    const tokens = scene.tokens.filter((t) => t.actor).map((t) => ({ id: t.id, cells: cellsOf(t) }));
    return membersOf(tokens, { covered, blocked });
  }
  return { inside: (targetIds ?? []).filter((id) => scene.tokens.has(id)), blocked: [] };
}

function degreeLabels() {
  const english = { criticalFailure: "Critical Failure", failure: "Failure", success: "Success", criticalSuccess: "Critical Success" };
  return Object.fromEntries(DEGREES.map((k) => [k, [english[k], game.i18n.localize(`PF2E.Check.Result.Degree.Check.${k}`)]]));
}

function dcFromCard(castMsg) {
  try {
    const doc = new DOMParser().parseFromString(castMsg.content ?? "", "text/html");
    const dc = Number(doc.querySelector('[data-action="spell-save"][data-dc]')?.dataset.dc);
    return Number.isInteger(dc) ? dc : null;
  } catch { return null; }
}

async function openSession(castMsg, { targetIds = [] } = {}) {
  if (!isConductor()) return null;
  const existing = sessionForCast(castMsg.id);
  if (existing) return existing._msg;
  const spell = castMsg.item;
  const save = spell?.system?.defense?.save;
  if (!spell?.isOfType?.("spell") || !SAVES.includes(save?.statistic)) {
    ui.notifications?.warn(T("GLSV.warn.noSave"));
    return null;
  }
  const caster = spell.actor ?? castMsg.actor;
  const dc = dcFromCard(castMsg) ?? spell.spellcasting?.statistic?.withRollOptions?.({ item: spell })?.dc?.value ?? null;
  const basic = !!save.basic;
  const { inside, blocked } = membersFor(castMsg, targetIds);
  const scene = canvas.scene;
  const rows = inside.map((id) => rowOf(scene.tokens.get(id), save.statistic)).filter(Boolean).slice(0, MAX_ROWS);
  const cut = blocked.map((id) => rowOf(scene.tokens.get(id), save.statistic)).filter(Boolean);
  const base = spell.original ?? spell;
  const remembered = base.getFlag?.(SUITE_ID, SPELL_FLAG);
  const config = normalizeConfig(remembered ?? { effects: parseDegreeEffects(base._source?.system?.description?.value ?? spell.description ?? "", degreeLabels()) }, basic);
  // A private cast (whispered or blind) still needs a card the players can roll
  // from, so the card is a sanitized projection: it names no spell, carries no
  // art, and speaks as the GM rather than as the (possibly hidden) caster.
  const priv = (castMsg.whisper?.length ?? 0) > 0 || !!castMsg.blind;
  const state = {
    v: 1, id: foundry.utils.randomID(), castId: castMsg.id, spellUuid: spell.uuid, casterUuid: caster?.uuid ?? "",
    spellName: priv ? "" : spell.name, spellImg: priv ? "" : spell.img, save: save.statistic, dc, basic,
    rank: Number(castMsg.flags?.pf2e?.casting?.castRank ?? spell.rank) || null,
    rows, blocked: cut, damageId: null, config, combatId: game.combat?.id ?? null, at: Date.now(), closed: false,
    private: priv,
  };
  const ChatMessage = getDocumentClass("ChatMessage");
  const data = { speaker: priv ? ChatMessage.getSpeaker({ user: game.user }) : castMsg.speaker, content: `<div class="glsv-card-host"></div>` };
  foundry.utils.setProperty(data, `flags.${SUITE_ID}.${FLAG}`, state);
  const message = await ChatMessage.create(data);
  await reconcile(message);
  return message;
}

/**
 * File anything already in chat for a session's cast (a save from PF2e's own
 * button, the damage), in the order it landed. Run when a session opens, when
 * its panel is opened, and when a conductor starts: saves made while no
 * conductor was connected were never seen.
 */
async function reconcile(sessionMsg) {
  if (!isConductor()) return;
  const s = readSession(sessionMsg);
  if (!s) return;
  const cast = s.castId ? game.messages.get(s.castId) : null;
  const since = cast?.timestamp ?? s.at;
  for (const m of game.messages.contents) if (m.timestamp >= since && m.id !== sessionMsg.id) await observe(m);
}

/** A save or a damage roll landed: file it against the newest open session it belongs to. */
async function observe(message) {
  if (!isConductor()) return;
  const ctx = message?.flags?.pf2e?.context;
  if (!ctx || (ctx.type !== "saving-throw" && ctx.type !== "damage-roll")) return;
  const originUuid = message.flags?.pf2e?.origin?.uuid ?? null;
  const sessions = openSessions();
  if (ctx.type === "damage-roll") {
    const DamageRoll = CONFIG.Dice?.rolls?.find((R) => R.name === "DamageRoll");
    if (!DamageRoll || !(message.rolls?.[0] instanceof DamageRoll)) return;
    const s = sessions.find((x) => takesDamage(x, { type: ctx.type, originUuid }));
    if (!s || s.damageId === message.id) return;
    // A flag is anybody's to write: only the GM or the caster's own owner rolls the spell's damage.
    const author = message.author;
    if (!author?.isGM && !casterOf(s)?.testUserPermission?.(author, "OWNER")) return;
    await mutate(s._msg.id, (st) => (takesDamage(st, { type: ctx.type, originUuid }) ? { ...st, damageId: message.id } : null));
    return;
  }
  const save = {
    type: ctx.type, statistic: message.flags?.pf2e?.modifierName ?? null, identifier: ctx.identifier ?? null,
    originUuid, tokenId: ctx.token ?? null, actorId: ctx.actor ?? null,
  };
  const actorIdOf = (row) => actorOf(row)?.id ?? null;
  for (const s of sessions) {
    const row = rowForSave(s, save, actorIdOf);
    if (!row) continue;
    if (row.rollId === message.id) return;
    // A filed save is never replaced by an older one; an applied row keeps its
    // save until that card is gone (a reroll's replacement is filed then, so a
    // Revert leaves the row ready to apply again).
    const current = row.rollId ? game.messages.get(row.rollId) : null;
    if (current && (row.applied || current.timestamp > message.timestamp)) return;
    // A player may only file a save for a creature they own.
    const author = message.author;
    if (!author?.isGM && !owns(author, row)) return;
    await mutate(s._msg.id, (st) => {
      const r = st.rows.find((x) => x.id === row.id);
      if (!r || (r.applied && r.rollId && game.messages.has(r.rollId))) return null;
      r.rollId = message.id;
      return st;
    });
    return;
  }
}

/** A filed message went away: its row is unrolled (a hero-point reroll files its new card next). */
async function forgetMessage(message) {
  if (!isConductor()) return;
  for (const s of openSessions()) {
    const hit = s.damageId === message.id || s.rows.some((r) => r.rollId === message.id);
    if (!hit) continue;
    await mutate(s._msg.id, (st) => {
      if (st.damageId === message.id) st.damageId = null;
      // Applied rows too: the undo record stands on its own, and a dangling id would block the row forever.
      for (const r of st.rows) if (r.rollId === message.id) r.rollId = null;
      return st;
    });
  }
}

/* ── apply and revert ──────────────────────────────────────────────── */

/**
 * The caster's ephemeral effects on its target for `damage-received` — PF2e's
 * `extractEphemeralEffects`, which is module-private, restated. A conditional
 * weakness or resistance the caster grants against its own damage lives here.
 */
async function targetEffects(origin, target, item, options) {
  if (!origin || !target) return [];
  const domains = ["damage-received"];
  const test = [...options, origin.getRollOptions(domains), target.getSelfRollOptions("target")].flat();
  const resolvables = item ? (item.isOfType?.("spell") ? { spell: item } : { weapon: item }) : {};
  const fns = domains.flatMap((d) => origin.synthetics?.ephemeralEffects?.[d]?.target ?? []);
  const made = (await Promise.all(fns.map((fn) => fn({ test, resolvables })))).filter(Boolean);
  for (const e of made) {
    if (e.type !== "effect") continue;
    e.system.context = {
      origin: { actor: origin.uuid, token: null, item: null, spellcasting: null, rollOptions: [] },
      target: { actor: target.uuid, token: null },
      roll: null,
    };
    e.system.duration = { value: -1, unit: "unlimited", expiry: null, sustained: false };
  }
  return made;
}

/** PF2e's own damage path (applyDamageFromMessage), for one creature at one multiplier. */
async function applyDamageTo(actor, tokenDoc, damageMsg, mult) {
  const roll = damageMsg?.rolls?.[0];
  if (!roll || !(mult > 0)) return null;
  const damage = mult === 1 ? roll : roll.alter(mult, 0);
  const opts = [...(damageMsg.flags?.pf2e?.context?.options ?? [])];
  const originOpts = opts.filter((o) => o.startsWith("self:")).map((o) => o.replace(/^self\b/, "origin"));
  const origin = damageMsg.actor;
  const item = damageMsg.item;
  const itemOpts = item?.isOfType?.("affliction", "condition", "effect") ? item.getRollOptions("item") : [];
  if (actor.alliance && origin) opts.push(`origin:${actor.alliance === origin.alliance ? "ally" : "enemy"}`);
  if (!opts.some((o) => o.startsWith("target"))) opts.push(...actor.getSelfRollOptions("target"));
  const ephemeral = await targetEffects(origin, actor, item, opts);
  const clone = actor.getContextualClone?.(originOpts, ephemeral) ?? actor;
  const rollOptions = new Set([...opts.filter((o) => !/^(?:self|target)(?::|$)/.test(o)), ...itemOpts, ...originOpts, ...clone.getSelfRollOptions()]);
  // The damage-taken card is the one this call creates — by identity, never by
  // time: an application that changes nothing posts none, and an earlier card
  // against the same creature must not be mistaken for it.
  const before = new Set(game.messages.keys());
  await clone.applyDamage({ damage, token: tokenDoc, item, skipIWR: false, rollOptions, shieldBlockRequest: false, outcome: damageMsg.flags?.pf2e?.context?.outcome ?? null });
  const taken = game.messages.contents.findLast((m) => !before.has(m.id) && m.flags?.pf2e?.appliedDamage?.uuid === actor.uuid);
  return taken?.id ?? null;
}

/** One effect from the degree's list. Conditions take the higher value (they never stack). */
async function applyEffect(actor, effect, record, ctx) {
  const item = await fromUuid(effect.uuid);
  if (!item) return;
  if (item.type === "condition") {
    const slug = item.slug;
    const existing = actor.itemTypes?.condition?.find((c) => c.slug === slug && !c.isLocked);
    const plan = planCondition(existing ? { id: existing.id, value: existing.value } : null, effect);
    if (plan.op === "raise") {
      record.changed.push({ id: plan.id, from: plan.from });
      await game.pf2e.ConditionManager.updateConditionValue(plan.id, actor, plan.to);
    }
    if (plan.op !== "create") return;
    const made = await actor.increaseCondition(slug, effect.value != null ? { value: effect.value } : {});
    if (made?.id) record.created.push(made.id);
    return;
  }
  if (item.type !== "effect") return;
  if (actor.itemTypes?.effect?.some((e) => e.sourceId === effect.uuid)) return;
  const data = item.toObject();
  foundry.utils.setProperty(data, "_stats.compendiumSource", effect.uuid);
  foundry.utils.setProperty(data, "system.context", {
    origin: { actor: ctx.caster?.uuid ?? null, token: null, item: ctx.spell?.uuid ?? null, spellcasting: null, rollOptions: [] },
    target: { actor: actor.uuid, token: ctx.tokenDoc?.uuid ?? null },
    roll: ctx.roll ? { total: ctx.roll.total, degreeOfSuccess: ctx.degree } : null,
  });
  const [made] = await actor.createEmbeddedDocuments("Item", [data]);
  if (made?.id) record.created.push(made.id);
}

/** A GM's Apply: run on the conductor, whose single queue makes it one operation. */
function requestApply(messageId, rowIds, overrides = new Map()) {
  if (!mayWrite(game.user) || !gmView()) return null;
  const ids = rowIds.filter((x) => typeof x === "string");
  return viaConductor(MSG.apply, { messageId, rowIds: ids, overrides: [...overrides] }, () => serially(() => applyRows(messageId, ids, overrides)));
}

function requestRevert(messageId, rowIds) {
  if (!mayWrite(game.user) || !gmView()) return null;
  const ids = rowIds.filter((x) => typeof x === "string");
  return viaConductor(MSG.revert, { messageId, rowIds: ids }, () => serially(() => revertRows(messageId, ids)));
}

/** Conductor only, inside `serially`: each row is re-read fresh before anything touches its creature. */
async function applyRows(messageId, rowIds, overrides = new Map()) {
  if (!isConductor()) return;
  const message = game.messages.get(messageId);
  let s = readSession(message);
  if (!s) return;
  const damageMsg = s.damageId ? game.messages.get(s.damageId) : null;
  const spell = await spellOf(s);
  const caster = casterOf(s);
  for (const rid of rowIds) {
    s = readSession(message);
    const row = s?.rows.find((r) => r.id === rid);
    if (!row || !row.rollId || row.applied) continue;
    const degree = degreeOf(row.rollId);
    const tokenDoc = tokenOf(row);
    const actor = tokenDoc?.actor ?? actorOf(row);
    if (degree == null || !actor) continue;
    const mult = overrides.get(rid) ?? multiplierFor(degree, s.config, s.basic);
    const record = { at: Date.now(), combatId: game.combat?.id ?? null, takenId: null, created: [], changed: [] };
    try {
      if (damageMsg) record.takenId = await applyDamageTo(actor, tokenDoc, damageMsg, mult);
      const roll = game.messages.get(row.rollId)?.rolls?.[0];
      for (const e of s.config.effects[DEGREES[degree]] ?? []) await applyEffect(actor, e, record, { caster, spell, tokenDoc, roll, degree });
    } catch (e) {
      err(`pf2e-saves: applying to ${actor.name} failed`, e);
    }
    // Recorded even when part of it failed: what did land can still be reverted.
    await mutate(messageId, (st) => {
      const r = st.rows.find((x) => x.id === rid);
      if (!r || r.applied) return null;
      r.applied = record;
      return st;
    });
  }
}

async function revertRows(messageId, rowIds) {
  if (!isConductor()) return;
  const message = game.messages.get(messageId);
  if (!readSession(message)) return;
  const now = Date.now();
  const combatAlive = (cid) => !!game.combats?.get(cid);
  let expired = 0;
  for (const rid of rowIds) {
    const row = readSession(message)?.rows.find((r) => r.id === rid);
    const rec = row?.applied;
    if (!rec) continue;
    if (!undoLive(rec, { now, combatAlive })) { expired += 1; continue; }
    const actor = actorOf(row);
    const plan = planRevert(rec, (id) => !!actor?.items?.has(id));
    try {
      const taken = plan.undoDamage ? game.messages.get(plan.undoDamage) : null;
      const applied = taken?.flags?.pf2e?.appliedDamage;
      // PF2e's own undo button may have been used already; it marks the card.
      if (applied && !applied.isReverted) {
        await (fromUuidSync(applied.uuid) ?? actor)?.undoDamage(applied);
        await taken.update({ "flags.pf2e.appliedDamage.isReverted": true });
      }
      if (actor && plan.remove.length) await actor.deleteEmbeddedDocuments("Item", plan.remove);
      for (const r of plan.restore) await game.pf2e.ConditionManager.updateConditionValue(r.id, actor, r.value);
    } catch (e) {
      err(`pf2e-saves: reverting ${actor?.name ?? rid} failed`, e);
      continue;
    }
    await mutate(messageId, (st) => {
      const r = st.rows.find((x) => x.id === rid);
      if (!r?.applied) return null;
      r.applied = null;
      return st;
    });
  }
  if (expired) ui.notifications?.warn(T("GLSV.warn.expired"));
}

/* ── rolling ───────────────────────────────────────────────────────── */

/** Roll one row's save through PF2e itself: its dialog, its card, the spell's own roll options. */
async function rollRow(messageId, rowId, { quiet = false } = {}) {
  const s = readSession(game.messages.get(messageId));
  const row = s?.rows.find((r) => r.id === rowId);
  if (!row || !mayRoll(game.user, row, { owns })) return;
  const tokenDoc = tokenOf(row);
  const actor = tokenDoc?.actor ?? actorOf(row);
  const statistic = actor?.saves?.[s.save];
  if (!statistic) return;
  const spell = await spellOf(s);
  await statistic.check.roll({
    dc: s.dc != null ? { value: s.dc } : undefined,
    item: spell ?? undefined,
    origin: casterOf(s) ?? undefined,
    token: tokenDoc ?? undefined,
    identifier: identFor(s.id, row.id),
    ...(quiet ? { skipDialog: true } : {}),
  });
}

async function rollNpcs(messageId) {
  if (!gmView()) return;
  const s = readSession(game.messages.get(messageId));
  for (const row of s?.rows ?? []) {
    if (row.kind === "npc" && !row.rollId) {
      try { await rollRow(messageId, row.id, { quiet: true }); } catch (e) { warn("pf2e-saves: NPC save failed", e); }
    }
  }
}

async function rollDamage(messageId) {
  if (!gmView()) return;
  const s = readSession(game.messages.get(messageId));
  if (!s || s.rows.some((r) => r.applied)) return;
  const spell = await spellOf(s);
  if (!spell?.rollDamage) { ui.notifications?.warn(T("GLSV.warn.noSpell")); return; }
  // PF2e reads only modifier keys and an optional card off the event; a bare click is the plain roll.
  await spell.rollDamage(new MouseEvent("click"));
}

/* ── editing the session (GM) ──────────────────────────────────────── */

const editRows = (messageId, fn) => (gmView() ? mutate(messageId, fn) : null);

function removeRow(messageId, rowId) {
  return editRows(messageId, (st) => {
    const r = st.rows.find((x) => x.id === rowId);
    if (!r || r.applied) return null;
    st.rows = st.rows.filter((x) => x.id !== rowId);
    return st;
  });
}

function unblock(messageId, rowId) {
  return editRows(messageId, (st) => {
    const b = st.blocked.find((x) => x.id === rowId);
    if (!b || st.rows.length >= MAX_ROWS) return null;
    st.blocked = st.blocked.filter((x) => x.id !== rowId);
    st.rows.push({ ...b, rollId: null, applied: null });
    return st;
  });
}

function addTargets(messageId) {
  return editRows(messageId, (st) => {
    let added = 0;
    for (const t of game.user.targets ?? []) {
      const doc = t.document ?? t;
      if (st.rows.some((r) => r.id === doc.id) || st.rows.length >= MAX_ROWS) continue;
      const row = rowOf(doc, st.save);
      if (!row) continue;
      st.rows.push(row);
      st.blocked = st.blocked.filter((b) => b.id !== doc.id);
      added += 1;
    }
    if (!added) ui.notifications?.info(T("GLSV.warn.noTargets"));
    return added ? st : null;
  });
}

/** The GM's effects-by-degree answer: written to the session and remembered on the spell. */
async function setConfig(messageId, fn) {
  if (!gmView()) return;
  let config = null;
  await mutate(messageId, (st) => {
    const next = fn(structuredClone(st.config));
    if (!next) return null;
    st.config = normalizeConfig(next, st.basic);
    config = st.config;
    return st;
  });
  const s = readSession(game.messages.get(messageId));
  if (!config || !s) return;
  const spell = await spellOf(s);
  const base = spell?.original ?? spell;
  try { await base?.setFlag?.(SUITE_ID, SPELL_FLAG, config); } catch (e) { warn("pf2e-saves: could not remember the effects on the spell", e); }
}

/** Ask for a condition and its value; resolves to an effect entry or null. */
async function pickCondition() {
  const types = CONFIG.PF2E?.conditionTypes ?? {};
  const options = Object.entries(types)
    .map(([slug, label]) => ({ slug, label: game.i18n.localize(label) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((o) => `<option value="${o.slug}">${escapeHTML(o.label)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const picked = await DialogV2.prompt({
    window: { title: T("GLSV.config.add") },
    content: `<div class="glsv-pick gl-type"><select name="slug">${options}</select><input type="number" name="value" min="1" max="9" placeholder="${escapeHTML(T("GLSV.config.value"))}"></div>`,
    ok: { callback: (_e, button) => ({ slug: button.form.elements.slug.value, value: Number(button.form.elements.value.value) || null }) },
    rejectClose: false,
  });
  if (!picked?.slug) return null;
  // The canonical document, not getCondition()'s clone: a clone has no _id, so its uuid ends in "null".
  const cond = game.pf2e?.ConditionManager?.conditions?.get(picked.slug);
  if (!cond?.uuid?.startsWith("Compendium.")) return null;
  const valued = typeof cond.system?.value?.value === "number";
  const value = valued ? picked.value ?? 1 : null;
  return { uuid: cond.uuid, label: value ? `${cond.name} ${value}` : cond.name, value };
}

/* ══════════════════════════════════════════════════════════════════════
   Entry points: the spell card's button, the session card, the socket
   ══════════════════════════════════════════════════════════════════════ */

function requestOpen(castMsg) {
  const existing = sessionForCast(castMsg.id);
  if (existing) return openPanel(existing._msg.id);
  const targets = [...(game.user.targets ?? [])].map((t) => t.document?.id ?? t.id).filter(Boolean);
  if (isConductor()) return openSession(castMsg, { targetIds: targets }).then((m) => m && openPanel(m.id));
  const gm = game.users.activeGM;
  if (!gm) { ui.notifications?.warn(T("GLSV.warn.noGM")); return null; }
  emitSocket(FEATURE_ID, { type: MSG.open, castId: castMsg.id, targets }, { recipients: [gm.id] });
  return null;
}

export function openPanel(messageId) {
  // Opening a session is also when the conductor catches it up on anything it missed.
  if (isConductor()) reconcile(game.messages.get(messageId)).catch((e) => err("pf2e-saves: catch-up failed", e));
  const Panel = SavesPanel();
  const id = `glsv-panel-${messageId}`;
  const open = foundry.applications.instances.get(id);
  if (open) return open.bringToFront?.() ?? open.render({ force: true });
  return new Panel({ id, messageId }).render({ force: true });
}

/** Every action either host can fire. The panel adds its own overrides. */
export const actions = {
  roll: (mid, rid) => rollRow(mid, rid),
  apply: (mid, rid, o) => requestApply(mid, [rid], o),
  applyAll: (mid, _r, o) => {
    const s = readSession(game.messages.get(mid));
    return requestApply(mid, (s?.rows ?? []).filter((r) => r.rollId && !r.applied).map((r) => r.id), o);
  },
  revert: (mid, rid) => requestRevert(mid, [rid]),
  revertAll: (mid) => {
    const s = readSession(game.messages.get(mid));
    return requestRevert(mid, (s?.rows ?? []).filter((r) => r.applied).map((r) => r.id));
  },
  remove: (mid, rid) => removeRow(mid, rid),
  unblock: (mid, rid) => unblock(mid, rid),
  addTargets: (mid) => addTargets(mid),
  rollNpcs: (mid) => rollNpcs(mid),
  rollDamage: (mid) => rollDamage(mid),
  rerollDamage: (mid) => rollDamage(mid),
  openPanel: (mid) => openPanel(mid),
  effectAdd: async (mid, _r, _o, el) => {
    const degree = el?.dataset?.degree;
    if (!DEGREES.includes(degree)) return;
    const effect = await pickCondition();
    if (effect) await setConfig(mid, (c) => { c.effects[degree].push(effect); return c; });
  },
  effectRemove: (mid, _r, _o, el) => {
    const { degree, index } = el?.dataset ?? {};
    if (!DEGREES.includes(degree)) return null;
    return setConfig(mid, (c) => { c.effects[degree].splice(Number(index), 1); return c; });
  },
};

/** Value edits (selects and number fields) — `data-change` on the element. */
export const changes = {
  configMult: (mid, el) => setConfig(mid, (c) => { c.mult[el.dataset.degree] = Number(el.value); return c; }),
  effectValue: (mid, el) => setConfig(mid, (c) => {
    const e = c.effects[el.dataset.degree]?.[Number(el.dataset.index)];
    if (!e) return null;
    const v = Math.max(1, Math.min(9, Math.trunc(Number(el.value)) || 1));
    e.value = v;
    e.label = e.label.replace(/\s\d{1,2}\s*$/, "") + ` ${v}`;
    return c;
  }),
};

/* ── the session card ──────────────────────────────────────────────── */

async function renderCard(message, root) {
  const host = root.querySelector(".glsv-card-host");
  if (!host) return;
  // Foundry fires the render hook on a DETACHED element and inserts it after,
  // so this renders into the host as it is; only a newer render of the same host wins.
  const gen = (host._glsvGen ?? 0) + 1;
  host._glsvGen = gen;
  const view = await buildView(message, { compact: true });
  if (!view || host._glsvGen !== gen) return;
  host.innerHTML = sessionHTML(view, { t: T });
  host.classList.add("gl-type");
  if (host._glsvWired) return;
  host._glsvWired = true;
  host.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (!el || !host.contains(el)) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve(fn(message.id, el.dataset.row ?? null, new Map(), el)).catch((e) => err("pf2e-saves: card action failed", e));
  });
}

/** The "Resolve saves" button beside PF2e's own save button on a spell card. */
function decorateCast(message, root) {
  if (!setting(SETTINGS.cardButton, true)) return;
  const btn = root.querySelector('button[data-action="spell-save"]');
  if (!btn || root.querySelector(".glsv-open-btn")) return;
  const user = game.user;
  if (!(gmView(user) || (!user.isGM && (message.item?.actor ?? message.actor)?.isOwner))) return;
  const open = document.createElement("button");
  open.type = "button";
  open.className = "glsv-open-btn";
  open.innerHTML = `<i class="fa-solid fa-list-check"></i> ${T("GLSV.card.resolve")}`;
  open.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve(requestOpen(message)).catch((e) => err("pf2e-saves: could not open a session", e));
  });
  btn.after(open);
}

function onRenderMessage(message, html) {
  try {
    const root = html?.[0] ?? html;
    if (!(root instanceof HTMLElement)) return;
    if (readSession(message)) renderCard(message, root).catch((e) => warn("pf2e-saves: card render failed", e));
    else if (message.flags?.pf2e?.casting || message.flags?.pf2e?.context?.type === "spell-cast") decorateCast(message, root);
  } catch { /* never break the chat log */ }
}

/** Re-render the cards and panels of every session that has this token in it. */
function rerenderForToken(tokenDoc) {
  for (const s of openSessions()) {
    if (![...s.rows, ...s.blocked].some((r) => r.tokenUuid === tokenDoc.uuid)) continue;
    ui.chat?.updateMessage?.(s._msg);
    foundry.applications.instances.get(`glsv-panel-${s._msg.id}`)?.render();
  }
}

/** Re-render the cards and panels that read a message that just changed. */
function rerenderSessions(changed) {
  for (const s of openSessions()) {
    const touches = !changed || s._msg.id === changed.id || s.damageId === changed.id || s.rows.some((r) => r.rollId === changed.id);
    if (!touches) continue;
    if (changed && s._msg.id !== changed.id) ui.chat?.updateMessage?.(s._msg);
    foundry.applications.instances.get(`glsv-panel-${s._msg.id}`)?.render();
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Lifecycle
   ══════════════════════════════════════════════════════════════════════ */

export function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.autoOpen, {
    name: "GLSV.settings.autoOpen.name", hint: "GLSV.settings.autoOpen.hint",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(SUITE_ID, SETTINGS.cardButton, {
    name: "GLSV.settings.cardButton.name", hint: "GLSV.settings.cardButton.hint",
    scope: "world", config: true, type: Boolean, default: true,
  });
}

export function onInit() {
  Hooks.on("renderChatMessageHTML", onRenderMessage);
}

export function onReady() {
  onSocket(FEATURE_ID, async (payload, _claimed, meta) => {
    if (!isConductor() || !meta?.attested) return;
    const user = game.users.get(meta.attested);
    if (!user) return;
    const ids = (list) => (Array.isArray(list) ? list : []).filter((id) => typeof id === "string").slice(0, MAX_ROWS);
    if (payload?.type === MSG.apply || payload?.type === MSG.revert) {
      // Apply and Revert are the truth's: a GM who is not the stream login.
      if (!user.isGM || !seesTruth(user)) return;
      const messageId = String(payload.messageId ?? "");
      if (!readSession(game.messages.get(messageId))) return;
      if (payload.type === MSG.revert) return serially(() => revertRows(messageId, ids(payload.rowIds)));
      const overrides = new Map((Array.isArray(payload.overrides) ? payload.overrides : [])
        .filter((p) => Array.isArray(p) && typeof p[0] === "string" && MULTS.includes(p[1])));
      return serially(() => applyRows(messageId, ids(payload.rowIds), overrides));
    }
    if (payload?.type !== MSG.open) return;
    const castMsg = game.messages.get(String(payload.castId ?? ""));
    if (!castMsg) return;
    // Only the GM or the caster's owner may open a session for a cast. The
    // caster is the SPELL's actor — PF2e resolves the card's item from its
    // origin flag, not its speaker — and the two must agree.
    if (!user.isGM) {
      const owner = castMsg.item?.actor;
      if (!owner?.testUserPermission?.(user, "OWNER")) return;
      if (castMsg.actor && castMsg.actor.uuid !== owner.uuid) return;
    }
    await openSession(castMsg, { targetIds: ids(payload.targets) });
  });

  // Saves made while no conductor was connected were never filed.
  if (isConductor()) {
    (async () => { for (const s of openSessions()) await reconcile(s._msg); })()
      .catch((e) => err("pf2e-saves: catch-up failed", e));
  }

  Hooks.on("createChatMessage", (message) => {
    const s = readSession(message);
    if (s) {
      const user = game.user;
      const runs = gmView(user) || (!user.isGM && !!fromUuidSync(s.casterUuid)?.isOwner);
      if (runs && setting(SETTINGS.autoOpen, true) && (message.isAuthor || !gmView(user))) openPanel(message.id);
      return;
    }
    observe(message).catch((e) => err("pf2e-saves: could not file a roll", e));
    rerenderSessions(message);
  });
  Hooks.on("updateChatMessage", (message) => rerenderSessions(message));
  // A token hidden, or its name concealed, after its session opened.
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (!("hidden" in changes) && !("name" in changes) && !("displayName" in changes) && !changes.texture && !changes.flags) return;
    rerenderForToken(tokenDoc);
  });
  Hooks.on("deleteChatMessage", (message) => {
    forgetMessage(message).catch((e) => err("pf2e-saves: could not unfile a roll", e));
    foundry.applications.instances.get(`glsv-panel-${message.id}`)?.close();
  });
}

export const api = {
  /** Open a session for a cast card (GM, or the caster's owner through the GM). */
  resolve: (castMessage) => (castMessage ? requestOpen(castMessage) : null),
  openPanel,
  sessions: () => openSessions().map((s) => ({ messageId: s._msg.id, spell: s.spellName, rows: s.rows.length })),
};
