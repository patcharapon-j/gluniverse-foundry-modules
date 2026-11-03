/**
 * Mythic GME: a roll, as a log entry.
 *
 * Pure. Each function here rolls through `rules.mjs` / `catalog.mjs` and
 * returns the entry the log stores. An entry holds the dice and the keys of
 * what they landed on, never localised text, so the log reads in whatever
 * language the GM's client is in and the chat card says exactly what the
 * panel said (both draw from `model.mjs`).
 *
 * Log entries written before the remake were finished English strings
 * (`{ label, result, meta, tone, subs }`). `normalizeEntry` keeps them as
 * `kind: "legacy"` and draws them as they were.
 */

import { LISTS, LOG_MAX } from "./constants.mjs";
import { CORE_MEANING, elementById, rollElement, rollMeaning } from "./catalog.mjs";
import {
  VERDICTS, chaosAfterScene, clampChaos, oddsById, pickFromList, rollEventFocus, rollFate,
  rollSceneAdjustment, sceneCheck, EVENT_FOCUS, SCENE_ADJUSTMENTS, DEFAULT_ODDS,
} from "./rules.mjs";

export const ENTRY_VERSION = 2;
export const KINDS = Object.freeze(["fate", "event", "meaning", "element", "scene", "adjust", "chaos", "list", "legacy"]);

const cleanQuestion = (q) => String(q ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * A Random Event: Event Focus, a meaning pair, and (when the focus is about a
 * thread or a character and that list has rows) the row it is about.
 */
export function randomEvent({ rng = Math.random, actions1 = null, lists = null } = {}) {
  const focus = rollEventFocus(rng);
  const meaning = rollMeaning("actions", { rng, actions1 });
  let pick = null;
  if (focus.list) {
    const hit = pickFromList(lists?.[focus.list], rng);
    pick = hit ? { list: focus.list, name: hit.name, roll: hit.roll, of: hit.of } : { list: focus.list, empty: true };
  }
  return { focus: { roll: focus.roll, key: focus.key }, meaning, pick };
}

export function askFate({ oddsId, cf, question = "", autoEvent = true, rng = Math.random, actions1 = null, lists = null } = {}) {
  const r = rollFate(oddsId, cf, rng);
  const entry = {
    kind: "fate",
    question: cleanQuestion(question),
    odds: r.oddsId,
    cf: r.cf,
    roll: r.roll,
    key: r.key,
    cell: r.threshold,
    event: null,
    eventPending: false,
  };
  if (r.eventTriggered) {
    if (autoEvent) entry.event = randomEvent({ rng, actions1, lists });
    else entry.eventPending = true;
  }
  return entry;
}

export function eventEntry(opts = {}) {
  return { kind: "event", ...randomEvent(opts) };
}

export function meaningEntry(table, { rng = Math.random, actions1 = null } = {}) {
  return { kind: "meaning", ...rollMeaning(CORE_MEANING.includes(table) ? table : "actions", { rng, actions1 }) };
}

export function elementEntry(id, rng = Math.random) {
  const r = rollElement(id, rng);
  return r ? { kind: "element", ...r } : null;
}

/** Test the expected scene. An altered scene rolls its adjustment, an interrupted one its event. */
export function sceneEntry({ cf, rng = Math.random, actions1 = null, lists = null } = {}) {
  const s = sceneCheck(cf, rng);
  const entry = { kind: "scene", roll: s.roll, cf: s.cf, result: s.result, adjust: null, event: null };
  if (s.result === "altered") entry.adjust = rollSceneAdjustment(rng);
  if (s.result === "interrupted") entry.event = randomEvent({ rng, actions1, lists });
  return entry;
}

/** A Scene Adjustment on its own, for a scene the GM already knows is altered. */
export function adjustEntry(rng = Math.random) {
  const a = rollSceneAdjustment(rng);
  return { kind: "adjust", rolls: a.rolls, adjustments: a.adjustments };
}

/** The end of a scene: the Chaos Factor before and after. */
export function chaosEntry(cf, inControl) {
  const from = clampChaos(cf);
  return { kind: "chaos", from, to: chaosAfterScene(from, inControl), inControl: !!inControl };
}

export function listEntry(list, entries, rng = Math.random) {
  if (!LISTS.includes(list)) return null;
  const hit = pickFromList(entries, rng);
  return hit ? { kind: "list", list, name: hit.name, roll: hit.roll, of: hit.of } : null;
}

/** Give an entry its id and time. */
export function stamp(entry, { now = Date.now(), rng = Math.random } = {}) {
  if (!entry) return null;
  const id = `m${now.toString(36)}${Math.floor(rng() * 1e6).toString(36)}`;
  return { v: ENTRY_VERSION, id, at: now, ...entry };
}

/* ── reading the log back ────────────────────────────────────────────────── */

const int = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const str = (v, max = 120) => (typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max));
const ints = (a, lo, hi) => (Array.isArray(a) ? a.map((x) => int(x, lo, hi)).filter((x) => x != null) : []);
const FOCUS_KEYS = EVENT_FOCUS.map((f) => f.key);
const ADJUST_KEYS = SCENE_ADJUSTMENTS.map((a) => a.key);

function normalizeMeaning(m) {
  if (!m || typeof m !== "object") return null;
  const words = Array.isArray(m.words) ? m.words.map((w) => str(w, 60)).filter(Boolean).slice(0, 2) : [];
  if (!words.length) return null;
  return { table: CORE_MEANING.includes(m.table) ? m.table : "actions", rolls: ints(m.rolls, 1, 100).slice(0, 2), words, missing: !!m.missing };
}

function normalizeEvent(e) {
  if (!e || typeof e !== "object") return null;
  const key = FOCUS_KEYS.includes(e.focus?.key) ? e.focus.key : null;
  if (!key) return null;
  const out = { focus: { roll: int(e.focus.roll, 1, 100) ?? 1, key }, meaning: normalizeMeaning(e.meaning), pick: null };
  if (e.pick && LISTS.includes(e.pick.list)) {
    out.pick = e.pick.empty
      ? { list: e.pick.list, empty: true }
      : { list: e.pick.list, name: str(e.pick.name, 80), roll: int(e.pick.roll, 1, 999) ?? 1, of: int(e.pick.of, 1, 999) ?? 1 };
  }
  return out;
}

/**
 * One stored entry, made safe to draw. Unknown or broken entries come back
 * null and are dropped, so a hand-edited or half-written log never breaks the
 * panel.
 */
export function normalizeEntry(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id.slice(0, 40) : `legacy-${index}`;
  const at = Number.isFinite(raw.at) ? raw.at : 0;
  const base = { v: ENTRY_VERSION, id, at };

  if (raw.v !== ENTRY_VERSION || !KINDS.includes(raw.kind) || raw.kind === "legacy") {
    // Before the remake: finished strings. Kept, never re-derived.
    if (typeof raw.result !== "string" && typeof raw.label !== "string") return null;
    const subs = Array.isArray(raw.subs)
      ? raw.subs.slice(0, 4).map((s) => ({ label: str(s?.label, 60), result: str(s?.result, 120), meta: str(s?.meta, 60), tone: str(s?.tone, 20) }))
      : [];
    return { ...base, kind: "legacy", label: str(raw.label, 80), result: str(raw.result, 160), meta: str(raw.meta, 80), tone: str(raw.tone, 20) || "neutral", subs };
  }

  switch (raw.kind) {
    case "fate": {
      const roll = int(raw.roll, 1, 100);
      if (roll == null || !VERDICTS.includes(raw.key)) return null;
      const cell = ints(raw.cell, 0, 101);
      return {
        ...base,
        kind: "fate",
        question: cleanQuestion(raw.question),
        odds: oddsById(raw.odds) ? raw.odds : DEFAULT_ODDS,
        cf: clampChaos(raw.cf),
        roll,
        key: raw.key,
        cell: cell.length === 3 ? cell : null,
        event: normalizeEvent(raw.event),
        eventPending: !!raw.eventPending,
      };
    }
    case "event": {
      const ev = normalizeEvent(raw);
      return ev ? { ...base, kind: "event", ...ev } : null;
    }
    case "meaning": {
      const m = normalizeMeaning(raw);
      return m ? { ...base, kind: "meaning", ...m } : null;
    }
    case "element": {
      const roll = int(raw.roll, 1, 100);
      if (roll == null || !raw.word) return null;
      return { ...base, kind: "element", id: str(raw.id, 60), name: str(raw.name || elementById(raw.id)?.name, 80), roll, word: str(raw.word, 80) };
    }
    case "scene": {
      const roll = int(raw.roll, 1, 10);
      if (roll == null || !["expected", "altered", "interrupted"].includes(raw.result)) return null;
      const adjust = raw.adjust && Array.isArray(raw.adjust.adjustments)
        ? { rolls: ints(raw.adjust.rolls, 1, 10), adjustments: raw.adjust.adjustments.filter((k) => ADJUST_KEYS.includes(k) && k !== "two-adjustments").slice(0, 2), double: !!raw.adjust.double }
        : null;
      return { ...base, kind: "scene", roll, cf: clampChaos(raw.cf), result: raw.result, adjust, event: normalizeEvent(raw.event) };
    }
    case "adjust": {
      const adjustments = (Array.isArray(raw.adjustments) ? raw.adjustments : []).filter((k) => ADJUST_KEYS.includes(k) && k !== "two-adjustments").slice(0, 2);
      return adjustments.length ? { ...base, kind: "adjust", rolls: ints(raw.rolls, 1, 10), adjustments } : null;
    }
    case "chaos":
      return { ...base, kind: "chaos", from: clampChaos(raw.from), to: clampChaos(raw.to), inControl: !!raw.inControl };
    case "list": {
      if (!LISTS.includes(raw.list) || !raw.name) return null;
      return { ...base, kind: "list", list: raw.list, name: str(raw.name, 80), roll: int(raw.roll, 1, 999) ?? 1, of: int(raw.of, 1, 999) ?? 1 };
    }
    default:
      return null;
  }
}

/** The stored log, made safe: newest first, at most LOG_MAX, ids unique. */
export function normalizeLog(raw) {
  const out = [];
  const seen = new Set();
  (Array.isArray(raw) ? raw : []).forEach((r, i) => {
    const e = normalizeEntry(r, i);
    if (!e) return;
    if (seen.has(e.id)) e.id = `${e.id}-${i}`;
    seen.add(e.id);
    out.push(e);
  });
  return out.slice(0, LOG_MAX);
}
