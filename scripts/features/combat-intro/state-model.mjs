/**
 * Combat Intro — the public state and the rules about who may see what.
 *
 * The state (`ci.state`, a flag on the Combat) reaches every client, so it is
 * written for the most restricted reader there is: it never carries a total, a
 * natural, a degree, an NPC's modifiers or a hidden creature. `normalizeState`
 * is total and is the only reader, so a field that slipped into a write is
 * dropped on the way back out rather than shown. Results ride the socket with
 * `recipients`, sealed for anyone `entitled` says no to.
 *
 * Pure: no `game`, no DOM. tools/combat-intro-check.mjs drives every rule here.
 */
import { PHASES, KINDS, OPS, SEVERITIES, SIDES, BOSS_TIERS } from "./constants.mjs";

const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v) => v === true;
const id = (v) => (typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : null);
const side = (v, pc) => (pc ? "party" : SIDES.includes(v) && v !== "party" ? v : "hostile");
const boss = (b) => (b && BOSS_TIERS.includes(b.tier) ? { tier: b.tier, turns: Math.max(1, Math.min(9, Math.trunc(num(b.turns, 1)))) } : null);

/* ── kinds and groups ─────────────────────────────────────────────────── */

/**
 * Two creatures share an NPC volley card when they are the same KIND: the
 * compendium entry they came from, else their normalised name and level. The
 * level is in the key so a hand-built elite never answers for the ordinary one.
 * (The Creaturedex keys creatures the same way.)
 */
export function kindKey({ sourceId = null, name = "", level = null } = {}) {
  if (typeof sourceId === "string" && sourceId) return `src:${sourceId}`;
  const slug = String(name).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return `name:${slug || "unknown"}:${level == null ? "x" : num(level)}`;
}

/**
 * The public slot for one combatant, or null when it must never appear.
 * @param {object} d  descriptor built by the Foundry glue:
 *   { combatantId, actorUuid, tokenUuid, hidden, tokenHidden, isPC, ownerId,
 *     appearanceUserId, name, img, maskedName, maskedImg, kind (kindKey input),
 *     statistic, locked, stats: [{slug,label,mod}], mods: [{slug,label,value,enabled}],
 *     side: friendly|neutral|hostile|secret (NPCs), boss: {tier, turns}|null }
 */
export function publicSlot(d) {
  if (!d || d.hidden || d.tokenHidden) return null;     // the GM rolls it silently
  const cid = id(d.combatantId);
  if (!cid) return null;
  const pc = !!d.isPC;
  const b = pc ? null : boss(d.boss);
  const sd = side(d.side, pc);
  return {
    id: cid,
    combatantId: cid,
    kind: pc ? "pc" : "npc",
    // A boss never shares a volley: it is the one creature the table must see alone.
    group: pc ? null : b ? `boss:${cid}` : `${sd}|${kindKey(d.kind ?? {})}`,
    side: sd,
    boss: b,
    actorUuid: str(d.actorUuid),
    tokenUuid: str(d.tokenUuid),
    // An NPC is shown exactly as the tracker shows it: cipher name, masked art.
    name: str(pc ? d.name : (d.maskedName ?? d.name), 80),
    img: str(pc ? d.img : (d.maskedImg ?? d.img), 400),
    ownerId: pc ? id(d.ownerId) : null,
    appearanceUserId: id(d.appearanceUserId),
    statistic: str(d.statistic, 40) || "perception",
    locked: bool(d.locked),
    // Only a PC's numbers are public: an NPC's modifiers would give its total away.
    stats: pc ? (d.stats ?? []).slice(0, 40).map((s) => ({ slug: str(s.slug, 40), label: str(s.label, 60), mod: num(s.mod) })) : [],
    mods: pc ? (d.mods ?? []).slice(0, 24).map((m) => ({ slug: str(m.slug, 60), label: str(m.label, 60), value: num(m.value), enabled: bool(m.enabled) })) : [],
    throw: null,
  };
}

/**
 * NPC slots folded into volley cards, in first-seen order.
 * @returns {Array<{group: string, name: string, img: string, side: string, boss: object|null, slotIds: string[]}>}
 */
export function npcGroups(slots) {
  const out = new Map();
  for (const s of slots ?? []) {
    if (s.kind !== "npc") continue;
    const g = out.get(s.group) ?? { group: s.group, name: s.name, img: s.img, side: s.side ?? "hostile", boss: s.boss ?? null, slotIds: [] };
    g.slotIds.push(s.id);
    out.set(s.group, g);
  }
  return [...out.values()];
}

/* ── the state ────────────────────────────────────────────────────────── */

const SLOT_KEYS = ["id", "combatantId", "kind", "group", "side", "boss", "actorUuid", "tokenUuid", "name", "img", "ownerId", "appearanceUserId", "statistic", "locked", "stats", "mods", "throw"];

function normalizeThrow(t) {
  if (!t || typeof t !== "object") return null;
  const at = num(t.at, NaN), seed = num(t.seed, NaN), seq = num(t.seq, NaN);
  return Number.isFinite(at) && Number.isFinite(seed) && Number.isFinite(seq) ? { at, seed, seq } : null;
}

function normalizeSlot(s) {
  if (!s || typeof s !== "object") return null;
  const sid = id(s.id);
  if (!sid || !KINDS.includes(s.kind)) return null;
  const pc = s.kind === "pc";
  const out = {
    id: sid,
    combatantId: id(s.combatantId) ?? sid,
    kind: s.kind,
    group: pc ? null : str(s.group, 200) || kindKey({ name: s.name }),
    side: side(s.side, pc),
    boss: pc ? null : boss(s.boss),
    actorUuid: str(s.actorUuid),
    tokenUuid: str(s.tokenUuid),
    name: str(s.name, 80),
    img: str(s.img, 400),
    ownerId: pc ? id(s.ownerId) : null,
    appearanceUserId: id(s.appearanceUserId),
    statistic: str(s.statistic, 40) || "perception",
    locked: bool(s.locked),
    stats: pc && Array.isArray(s.stats) ? s.stats.slice(0, 40).map((x) => ({ slug: str(x?.slug, 40), label: str(x?.label, 60), mod: num(x?.mod) })) : [],
    mods: pc && Array.isArray(s.mods) ? s.mods.slice(0, 24).map((m) => ({ slug: str(m?.slug, 60), label: str(m?.label, 60), value: num(m?.value), enabled: bool(m?.enabled) })) : [],
    throw: normalizeThrow(s.throw),
  };
  return Object.fromEntries(SLOT_KEYS.map((k) => [k, out[k]]));
}

/**
 * The only reader of `ci.state`. Total: anything missing, malformed or not on
 * the allow-list comes back absent or at its default, never as whatever a
 * write happened to leave there.
 * @returns {null | CiState}
 */
export function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const seqId = id(raw.id);
  if (!seqId || !PHASES.includes(raw.phase)) return null;
  const slots = (Array.isArray(raw.slots) ? raw.slots : []).map(normalizeSlot).filter(Boolean);
  const severity = SEVERITIES.includes(raw.intro?.threat?.severity) ? raw.intro.threat.severity : null;
  return {
    v: 1,
    id: seqId,
    combatId: id(raw.combatId),
    phase: raw.phase,
    at: num(raw.at),
    skin: str(raw.skin, 20) || "etched",
    intro: {
      title: str(raw.intro?.title, 120),
      threat: severity ? { severity, xp: num(raw.intro.threat.xp), budget: num(raw.intro.threat.budget) } : null,
      party: (raw.intro?.party ?? []).slice(0, 12).map(rosterItem),
      hostiles: (raw.intro?.hostiles ?? []).slice(0, 12).map(rosterItem),
    },
    slots,
    order: Array.isArray(raw.order) ? raw.order.map(id).filter(Boolean) : null,
    // Combatant ids in turn order (boss extra turns included) for the rail-card sort.
    // Ids only: each client's own rail decides what of each card it may show.
    rail: Array.isArray(raw.rail) ? raw.rail.slice(0, 200).map(id).filter(Boolean) : null,
    late: id(raw.late),
  };
}

/** One roster entry. A boss rides at the head of its side with its tier. */
function rosterItem(p) {
  return { name: str(p?.name, 80), img: str(p?.img, 400), count: Math.max(1, num(p?.count, 1)), side: SIDES.includes(p?.side) ? p.side : "hostile", boss: boss(p?.boss) };
}

/** Is `from → to` a legal step of the sequence? (The GM's writes go through this.) */
export function canAdvance(from, to) {
  const i = PHASES.indexOf(from), j = PHASES.indexOf(to);
  return i >= 0 && j === i + 1;
}

/* ── results and audiences ─────────────────────────────────────────────── */

/**
 * May this user see this slot's total before the sort? GMs always; anyone for a
 * PC (the table watches each other roll); nobody else for an NPC.
 */
export function entitled(user, slot) {
  if (!user || !slot) return false;
  if (user.isGM) return true;
  return slot.kind === "pc";
}

/** May this user act (pick, toggle, throw) on this slot? GMs always; else the PC's owner. */
export function mayAct(user, slot, { owns = () => false } = {}) {
  if (!user || !slot) return false;
  if (user.isGM) return true;
  if (slot.kind !== "pc") return false;
  return slot.ownerId === user.id || !!owns(user, slot);
}

/** A result for one slot, as it may travel. A sealed one carries only its clock. */
export function sealResult(full) {
  return { seqId: full.seqId, slotId: full.slotId, seq: full.seq, at: full.at, seed: full.seed, sealed: true };
}

export function normalizeResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const seqId = id(raw.seqId), slotId = id(raw.slotId);
  const at = num(raw.at, NaN), seed = num(raw.seed, NaN), seq = num(raw.seq, NaN);
  if (!seqId || !slotId || !Number.isFinite(at) || !Number.isFinite(seed) || !Number.isFinite(seq)) return null;
  if (raw.sealed === true) return { seqId, slotId, seq, at, seed, sealed: true };
  const natural = num(raw.natural, NaN), total = num(raw.total, NaN);
  if (!Number.isFinite(total)) return null;
  return {
    seqId, slotId, seq, at, seed, sealed: false,
    natural: Number.isInteger(natural) && natural >= 1 && natural <= 20 ? natural : null,
    total,
    statistic: str(raw.statistic, 40),
    statLabel: str(raw.statLabel, 60),
    mods: Array.isArray(raw.mods) ? raw.mods.slice(0, 24).map((m) => ({ slug: str(m?.slug, 60), label: str(m?.label, 60), value: num(m?.value), enabled: bool(m?.enabled) })) : [],
  };
}

/** Validate a client's intent shape. The GM still checks `mayAct` against the attested sender. */
export function normalizeIntent(raw) {
  if (!raw || typeof raw !== "object" || !OPS.includes(raw.op)) return null;
  const seqId = id(raw.seqId), slotId = id(raw.slotId);
  if (!seqId || !slotId) return null;
  if (raw.op === "stat") return { op: "stat", seqId, slotId, statistic: str(raw.statistic, 40) };
  if (raw.op === "toggle") return { op: "toggle", seqId, slotId, slug: str(raw.slug, 60), on: bool(raw.on) };
  return { op: "throw", seqId, slotId };
}

/* ── the sort ──────────────────────────────────────────────────────────── */

/**
 * The order the sort plays, read back from Foundry AFTER the batch write.
 * `combat.turns` is PF2e's own sort, so its tie-break and any extra boss turns
 * decide; this never computes an order of its own. Extra turns and hidden
 * combatants have no slot and draw no card.
 * @param {Array<{id: string}>} turns
 * @param {Array<{combatantId: string, id: string}>} slots
 */
export function orderFrom(turns, slots) {
  const byCombatant = new Map((slots ?? []).map((s) => [s.combatantId, s]));
  const seen = new Set();
  const out = [];
  for (const c of turns ?? []) {
    const s = byCombatant.get(c?.id);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s.id);
  }
  return out;
}

/**
 * The values to commit, one entry per rolled combatant, in the shape PF2e's
 * `setMultipleInitiatives` takes.
 * @param {Map<string, {total:number, statistic:string}>} results  slotId → GM-side result
 * @param {Array} slots
 * @param {Array<{combatantId:string,total:number,statistic:string}>} hidden  silently rolled hidden combatants
 */
export function commitEntries(results, slots, hidden = []) {
  const out = [];
  for (const s of slots ?? []) {
    const r = results.get(s.id);
    if (r && Number.isFinite(r.total)) out.push({ id: s.combatantId, value: r.total, statistic: r.statistic || s.statistic || "perception" });
  }
  for (const h of hidden) if (Number.isFinite(h?.total)) out.push({ id: h.combatantId, value: h.total, statistic: h.statistic || "perception" });
  return out;
}
