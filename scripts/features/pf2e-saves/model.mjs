/**
 * Save Resolution — the session, and every rule about it that can be stated
 * without Foundry.
 *
 * The session (`sv.session`, a flag on its own chat card) reaches every client,
 * so it is written for the most restricted reader there is. It never carries a
 * degree, a total, a natural, a multiplier or a hit-point figure: a row knows
 * only WHICH message holds its save, and every viewer reads the result off that
 * message through the same gate PF2e's own card uses (pf2e-odds `landingOf`).
 * The undo record is ids and condition values, all of which are already on the
 * creature for anyone to see. `normalizeSession` is the only reader, so a field
 * that slipped into a write is dropped on the way back out rather than shown.
 *
 * Pure: no `game`, no DOM. tools/pf2e-saves-check.mjs drives every rule here.
 */

import { BASIC_MULT, DEGREES, IDENT, MAX_ROWS, MULTS, PLAIN_MULT, SAVES, UNDO_MS } from "./constants.mjs";

const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const id = (v) => (typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : null);
const uuid = (v) => (typeof v === "string" && /^[A-Za-z0-9._-]{1,400}$/.test(v) ? v : "");
const ids = (v, max = 50) => (Array.isArray(v) ? v.map(id).filter(Boolean).slice(0, max) : []);

/* ── multipliers ──────────────────────────────────────────────────────── */

export const defaultMult = (basic) => ({ ...(basic ? BASIC_MULT : PLAIN_MULT) });

/** The damage multiplier a degree carries under this config (an unknown degree carries none). */
export function multiplierFor(degree, config, basic = true) {
  const key = typeof degree === "number" ? DEGREES[degree] : degree;
  if (!DEGREES.includes(key)) return null;
  const m = config?.mult?.[key];
  return MULTS.includes(m) ? m : defaultMult(basic)[key];
}

/* ── effects by degree ────────────────────────────────────────────────── */

const LINK = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;
const EFFECT_SOURCE = /^Compendium\.pf2e\.(conditionitems|spell-effects|other-effects|bestiary-effects|equipment-effects)\.Item\./;

function effect(raw) {
  if (!raw || typeof raw !== "object") return null;
  const u = uuid(raw.uuid);
  if (!u) return null;
  const value = Number.isInteger(raw.value) && raw.value > 0 && raw.value < 100 ? raw.value : null;
  return { uuid: u, label: str(raw.label, 80), value };
}

/**
 * The condition and effect links in a spell's degree lines, per degree.
 *
 * PF2e writes the outcome block as `<strong>Critical Success</strong> …` lines,
 * each linking its conditions (`@UUID[Compendium.pf2e.conditionitems.Item.…]
 * {Frightened 1}`) and spell effects. A degree's text runs from its label to
 * the next degree label, a rule (`<hr`) or the next labelled paragraph (the
 * Heightened entries), so a link in a heightening is never taken for an outcome.
 *
 * @param {string} html  the spell's raw description (enrichers unexpanded)
 * @param {Record<string,string[]>} labels  degree key → the words that label it (English plus the client's own)
 */
export function parseDegreeEffects(html, labels) {
  const out = Object.fromEntries(DEGREES.map((k) => [k, []]));
  const text = String(html ?? "");
  const words = [];
  for (const key of DEGREES) for (const w of labels?.[key] ?? []) if (w) words.push({ key, w: String(w).trim().toLowerCase() });
  // Longest first, so "Critical Success" is never read as "Success".
  words.sort((a, b) => b.w.length - a.w.length);
  const marks = [];
  const STRONG = /<strong>\s*([^<]{1,40}?)\s*<\/strong>/gi;
  for (let m; (m = STRONG.exec(text)); ) {
    const inner = m[1].toLowerCase().replace(/[:.]\s*$/, "");
    const hit = words.find((x) => inner === x.w);
    marks.push({ at: m.index, end: m.index + m[0].length, key: hit?.key ?? null });
  }
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (!mark.key) continue;
    let stop = text.length;
    const next = marks.find((m, j) => j > i);
    if (next) stop = Math.min(stop, next.at);
    const hr = text.slice(mark.end).search(/<hr\b/i);
    if (hr >= 0) stop = Math.min(stop, mark.end + hr);
    const seen = new Set(out[mark.key].map((e) => e.uuid));
    for (const link of text.slice(mark.end, stop).matchAll(LINK)) {
      const u = link[1];
      if (!EFFECT_SOURCE.test(u) || seen.has(u)) continue;
      seen.add(u);
      const label = String(link[2] ?? "").trim() || u.split(".").pop();
      const value = label.match(/\s(\d{1,2})\s*$/);
      out[mark.key].push(effect({ uuid: u, label, value: value ? Number(value[1]) : null }));
    }
  }
  return out;
}

/** The GM's answer for a spell (multipliers + effects per degree), normalised. */
export function normalizeConfig(raw, basic = true) {
  const mult = defaultMult(basic);
  for (const k of DEGREES) if (MULTS.includes(raw?.mult?.[k])) mult[k] = raw.mult[k];
  const effects = {};
  for (const k of DEGREES) effects[k] = (Array.isArray(raw?.effects?.[k]) ? raw.effects[k] : []).map(effect).filter(Boolean).slice(0, 12);
  return { mult, effects };
}

/* ── the apply preview ────────────────────────────────────────────────── */

/**
 * What a row is about to lose, for the GM to read before Apply: the shared
 * damage scaled by the row's multiplier, then each instance's immunity,
 * weakness and resistance, the way PF2e orders them — an immunity zeroes the
 * instance, the single highest applicable weakness adds, the single highest
 * applicable resistance subtracts (never below zero). Apply itself goes
 * through PF2e's own `applyDamage`, which is the number that counts; this is
 * the preview, and the glue has already asked each IWR's own `test()` which
 * instances it applies to.
 * @param {Array<{type, total, persistent?, immune?: string|null,
 *   weakness?: {label, value}|null, resistance?: {label, value}|null}>} instances
 * @param {number} mult
 */
export function previewDamage(instances, mult) {
  const notes = [];
  let raw = 0, final = 0, persistent = 0;
  for (const inst of instances ?? []) {
    if (inst?.persistent) { persistent += 1; continue; }
    const base = Math.max(0, Math.floor(num(inst?.total) * num(mult)));
    raw += base;
    if (!base) continue;
    if (inst.immune) { notes.push({ kind: "immune", label: str(inst.immune, 60), amount: base }); continue; }
    const weak = inst.weakness && num(inst.weakness.value) > 0 ? num(inst.weakness.value) : 0;
    if (weak) notes.push({ kind: "weak", label: str(inst.weakness.label, 60), amount: weak });
    const resist = inst.resistance && num(inst.resistance.value) > 0 ? Math.min(num(inst.resistance.value), base + weak) : 0;
    if (resist) notes.push({ kind: "resist", label: str(inst.resistance.label, 60), amount: resist });
    final += Math.max(0, base + weak - resist);
  }
  return { raw, final, notes, persistent };
}

/* ── area membership ──────────────────────────────────────────────────── */

const cellKey = (c) => `${c.i},${c.j}`;

/**
 * Who stands in the area: a token is inside when any cell it occupies is
 * covered, and Blocked when none is but one is cut off from the origin (no line
 * of effect). Offsets are Foundry's `{i, j}`, exactly as `pf2eCoverage` and
 * `getOccupiedGridSpaceOffsets` both return them.
 * @param {Array<{id: string, cells: Array<{i:number,j:number}>}>} tokens
 * @param {{covered: Array, blocked: Array}} coverage
 */
export function membersOf(tokens, coverage) {
  const covered = new Set((coverage?.covered ?? []).map(cellKey));
  const blocked = new Set((coverage?.blocked ?? []).map(cellKey));
  const inside = [], cut = [];
  for (const t of tokens ?? []) {
    const cells = (t?.cells ?? []).map(cellKey);
    if (cells.some((c) => covered.has(c))) inside.push(t.id);
    else if (cells.some((c) => blocked.has(c))) cut.push(t.id);
  }
  return { inside, blocked: cut };
}

/* ── the session ──────────────────────────────────────────────────────── */

function normalizeRecord(r) {
  if (!r || typeof r !== "object") return null;
  const at = num(r.at, NaN);
  if (!Number.isFinite(at)) return null;
  return {
    at,
    combatId: id(r.combatId),
    takenId: id(r.takenId),
    created: ids(r.created, 24),
    changed: (Array.isArray(r.changed) ? r.changed : []).slice(0, 24)
      .map((c) => (id(c?.id) && Number.isInteger(c?.from) ? { id: c.id, from: c.from } : null)).filter(Boolean),
  };
}

const KINDS = ["pc", "npc"];

/** One creature, as everybody may read it. The name is the PUBLIC one (masked for a creature players cannot name). */
export function normalizeRow(r) {
  if (!r || typeof r !== "object") return null;
  const rid = id(r.id);
  if (!rid || !KINDS.includes(r.kind)) return null;
  return {
    id: rid,
    tokenUuid: uuid(r.tokenUuid),
    actorUuid: uuid(r.actorUuid),
    kind: r.kind,
    name: str(r.name, 80),
    img: str(r.img, 400),
    hidden: r.hidden === true,
    rollId: id(r.rollId),
    applied: normalizeRecord(r.applied),
  };
}

/**
 * The only reader of `sv.session`. Total: anything missing, malformed or not on
 * the allow-list comes back absent or at its default.
 */
export function normalizeSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const sid = id(raw.id);
  if (!sid || !SAVES.includes(raw.save)) return null;
  const basic = raw.basic === true;
  const rows = [];
  const seen = new Set();
  for (const r of Array.isArray(raw.rows) ? raw.rows : []) {
    const row = normalizeRow(r);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
    if (rows.length >= MAX_ROWS) break;
  }
  const blocked = (Array.isArray(raw.blocked) ? raw.blocked : []).map(normalizeRow).filter((b) => b && !seen.has(b.id)).slice(0, MAX_ROWS)
    .map((b) => ({ ...b, rollId: null, applied: null }));
  return {
    v: 1,
    id: sid,
    castId: id(raw.castId),
    spellUuid: uuid(raw.spellUuid),
    casterUuid: uuid(raw.casterUuid),
    spellName: str(raw.spellName, 120),
    spellImg: str(raw.spellImg, 400),
    save: raw.save,
    dc: Number.isInteger(raw.dc) && raw.dc > 0 && raw.dc < 100 ? raw.dc : null,
    basic,
    rank: Number.isInteger(raw.rank) && raw.rank >= 0 && raw.rank <= 10 ? raw.rank : null,
    rows,
    blocked,
    damageId: id(raw.damageId),
    config: normalizeConfig(raw.config, basic),
    combatId: id(raw.combatId),
    at: num(raw.at),
    closed: raw.closed === true,
  };
}

/* ── matching what lands in chat ──────────────────────────────────────── */

/** The identifier a row's own roll carries. */
export const identFor = (sessionId, rowId) => `${IDENT}:${sessionId}:${rowId}`;

/**
 * Which row a saving throw belongs to, or null.
 *
 * A save is ours when it is the session's save AND either carries our own
 * identifier or was rolled against the session's spell — which is what PF2e's
 * own button on the spell card does (`flags.pf2e.origin.uuid`), so a player who
 * clicks that button resolves their row exactly as one who clicks ours.
 * @param {object} session  normalised
 * @param {{type, statistic, identifier, originUuid, tokenId, actorId}} save
 * @param {(row) => string|null} actorIdOf  a row's actor id (for a roll with no token)
 */
export function rowForSave(session, save, actorIdOf = () => null) {
  if (!session || session.closed || !save || save.type !== "saving-throw" || save.statistic !== session.save) return null;
  const ident = typeof save.identifier === "string" ? save.identifier : "";
  const prefix = `${IDENT}:${session.id}:`;
  if (ident.startsWith(prefix)) {
    const row = session.rows.find((r) => r.id === ident.slice(prefix.length));
    return row ?? null;
  }
  if (ident.startsWith(`${IDENT}:`)) return null;            // another session's roll
  if (!session.spellUuid || save.originUuid !== session.spellUuid) return null;
  if (save.tokenId) {
    const row = session.rows.find((r) => r.id === save.tokenId);
    if (row) return row;
  }
  if (!save.actorId) return null;
  const byActor = session.rows.filter((r) => actorIdOf(r) === save.actorId);
  return byActor.length === 1 ? byActor[0] : null;          // two of one actor: no guessing
}

/** Is this damage roll the session's? Only while nothing has been applied from an earlier one. */
export function takesDamage(session, damage) {
  if (!session || session.closed || !damage || damage.type !== "damage-roll") return false;
  if (!session.spellUuid || damage.originUuid !== session.spellUuid) return false;
  return !session.rows.some((r) => r.applied);
}

/** Newest open session first: a spell cast twice resolves its latest cast. */
export function newestFirst(sessions) {
  return [...(sessions ?? [])].filter((s) => s && !s.closed).sort((a, b) => b.at - a.at);
}

/* ── undo ─────────────────────────────────────────────────────────────── */

/**
 * What applying one condition does to a creature, decided before anything is
 * written. Conditions never stack: a creature already frightened 2 told
 * "frightened 1" is unchanged, told "frightened 3" is raised (and the old value
 * recorded for Revert), and a condition it lacks is created (its id recorded).
 * @param {{id: string, value: number|null}|null} existing  the unlocked condition of that slug, if any
 * @param {{value: number|null}} effect
 * @returns {{op: "create"} | {op: "raise", id: string, from: number, to: number} | {op: "none"}}
 */
export function planCondition(existing, effect) {
  if (!existing) return { op: "create" };
  const cur = existing.value, next = effect?.value ?? null;
  if (next != null && Number.isInteger(cur) && next > cur) return { op: "raise", id: existing.id, from: cur, to: next };
  return { op: "none" };
}

/**
 * What a Revert does, given which items the creature still has: delete what
 * the Apply created, put raised values back. An item already gone (the
 * condition ran out, a player removed it) is left alone, never re-created.
 * @param {object} record  a normalised undo record
 * @param {(id: string) => boolean} has
 */
export function planRevert(record, has = () => true) {
  if (!record) return { undoDamage: null, remove: [], restore: [] };
  return {
    undoDamage: record.takenId ?? null,
    remove: record.created.filter((i) => has(i)),
    restore: record.changed.filter((c) => has(c.id)).map((c) => ({ id: c.id, value: c.from })),
  };
}

/**
 * Is a Revert still live? Until the encounter it was applied in ends; outside
 * one, for ten minutes.
 */
export function undoLive(record, { now, combatAlive = () => false } = {}) {
  if (!record) return false;
  if (record.combatId) return !!combatAlive(record.combatId);
  return Number.isFinite(now) && now - record.at < UNDO_MS;
}

/* ── who may do what, and what they see ───────────────────────────────── */

/** Only a GM writes a session, applies or reverts. */
export const mayWrite = (user) => !!user?.isGM;

/** A row may be rolled by its creature's owner (a GM always), once. */
export function mayRoll(user, row, { owns = () => false } = {}) {
  if (!user || !row || row.rollId || row.applied) return false;
  if (user.isGM) return true;
  return row.kind === "pc" && !!owns(user, row);
}

/**
 * One row as a viewer may see it. `live` comes from the glue and is already
 * gated: `result` is what that viewer may read off the save's own message
 * (null for a sealed one), `name` the creature's real name (used only for the
 * truth), `preview`/`effects` the GM's apply preview.
 * @returns {null | object}  null when this viewer may not see the row at all
 */
export function rowView(row, { truth = false, isGM = false, live = {}, canRoll = false, undo = false } = {}) {
  if (!row) return null;
  if (row.hidden && !truth) return null;
  const rolled = !!row.rollId;
  const r = live.result ?? null;
  return {
    id: row.id,
    kind: row.kind,
    name: (truth ? live.name : null) || row.name || "",
    img: (truth ? live.img : null) || row.img || "",
    hidden: row.hidden,
    state: row.applied ? "applied" : rolled ? (r && r.degree != null ? "rolled" : "sealed") : "waiting",
    degree: r?.degree ?? null,
    face: r?.face ?? null,
    total: r?.total ?? null,
    odds: rolled ? "" : live.odds ?? "",
    canRoll,
    canApply: isGM && truth && rolled && !row.applied && live.result?.degree != null,
    canRevert: isGM && !!row.applied && undo,
    canRemove: isGM && !row.applied,
    preview: isGM && truth ? live.preview ?? null : null,
    effects: isGM && truth ? live.effects ?? [] : [],
    mult: isGM && truth ? live.mult ?? null : null,
  };
}
