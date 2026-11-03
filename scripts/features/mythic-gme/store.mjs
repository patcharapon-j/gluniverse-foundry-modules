/**
 * Mythic GME: the only reader and writer of the feature's settings.
 *
 * Every value comes back through a normalizer (`oracle.mjs` for the log,
 * `lists.mjs` for the lists and the panel's memory, `rules.mjs` for the Chaos
 * Factor), and every write is queued, so two quick clicks are two steps.
 *
 * Where things live, and why:
 *  - The Chaos Factor is a world setting. It is the one piece of oracle state
 *    the table shares, and only a GM can write it.
 *  - The log, the lists and the panel's memory are client settings. World
 *    settings reach every client, players included, and a list of threads and
 *    characters is the GM's prep. Keeping them in this browser keeps them off
 *    every player's machine.
 *  - The linked Actions Table 1 is a world setting holding a RollTable UUID.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { CHAOS_DEFAULT, LOG_MAX, SETTINGS } from "./constants.mjs";
import { columnFromResults } from "./catalog.mjs";
import { normalizeLists, normalizeUi } from "./lists.mjs";
import { normalizeLog } from "./oracle.mjs";
import { clampChaos } from "./rules.mjs";

function get(key, fallback) {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
}

const queue = (() => {
  let chain = Promise.resolve();
  return (fn) => (chain = chain.then(fn).catch((e) => warn("mythic-gme | a write failed", e)));
})();

/* ── Chaos Factor ────────────────────────────────────────────────────────── */

/** The value a queued write is heading to, so a second click steps from it. */
let chaosTarget = null;

export const canWriteWorld = () => !!game.user?.isGM;

export function getChaos() {
  return clampChaos(chaosTarget ?? get(SETTINGS.chaos, CHAOS_DEFAULT));
}

/** Set the Chaos Factor. A non-GM gets the current value back and writes nothing. */
export function setChaos(value) {
  if (!canWriteWorld()) return Promise.resolve(getChaos());
  const next = clampChaos(value);
  chaosTarget = next;
  const done = queue(async () => {
    if (clampChaos(get(SETTINGS.chaos, CHAOS_DEFAULT)) !== next) await game.settings.set(SUITE_ID, SETTINGS.chaos, next);
  }).then(() => {
    if (chaosTarget === next) chaosTarget = null;
    return getChaos();
  });
  return done;
}

export const adjustChaos = (delta) => setChaos(getChaos() + Math.sign(Number(delta) || 0));

/* ── the log ─────────────────────────────────────────────────────────────── */

let logCache = null;

export function readLog() {
  if (!logCache) logCache = normalizeLog(get(SETTINGS.log, []));
  return logCache;
}

function writeLog(next) {
  logCache = next.slice(0, LOG_MAX);
  const snapshot = logCache;
  return queue(() => game.settings.set(SUITE_ID, SETTINGS.log, snapshot));
}

export function pushLog(entry) {
  if (!entry) return Promise.resolve();
  return writeLog([entry, ...readLog()]);
}

export const clearLog = () => writeLog([]);

/* ── lists and the panel's memory ────────────────────────────────────────── */

let listsCache = null;

export function readLists() {
  if (!listsCache) listsCache = normalizeLists(get(SETTINGS.lists, {}));
  return listsCache;
}

/** Apply `fn(lists) → lists` and store the result. */
export function updateLists(fn) {
  listsCache = normalizeLists(fn(readLists()));
  const snapshot = listsCache;
  return queue(() => game.settings.set(SUITE_ID, SETTINGS.lists, snapshot));
}

export const readUi = () => normalizeUi(get(SETTINGS.ui, {}));

export function writeUi(patch) {
  const next = normalizeUi({ ...readUi(), ...patch });
  return queue(() => game.settings.set(SUITE_ID, SETTINGS.ui, next));
}

export const autoEvent = () => get(SETTINGS.autoEvent, true) !== false;

/* ── the linked Actions Table 1 ──────────────────────────────────────────── */

let tableMemo = { key: null, value: { linked: false, name: null, column: null } };

/** Strip markup off a v13 TableResult description. */
const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/**
 * The linked table, read into a column. Cached on the table's UUID and its
 * last modification, so an edit to the table is picked up on the next roll.
 */
export async function resolveActions1() {
  const uuid = String(get(SETTINGS.actions1, "") || "");
  if (!uuid) return (tableMemo = { key: null, value: { linked: false, name: null, column: null } }).value;
  const table = await fromUuid(uuid).catch(() => null);
  if (!table || table.documentName !== "RollTable") return { linked: false, name: null, column: null, broken: true };
  const key = `${uuid}|${table._stats?.modifiedTime ?? ""}|${table.results?.size ?? 0}`;
  if (tableMemo.key === key) return tableMemo.value;
  const results = [...(table.results ?? [])].map((r) => ({
    // v13 moved a text result's words to `name` / `description`; v12 had `text`.
    text: r.name || plain(r.description) || (r.text ?? ""),
    range: r.range,
  }));
  const column = columnFromResults(results);
  tableMemo = { key, value: { linked: !!column, name: table.name, column } };
  return tableMemo.value;
}

export function linkActions1(uuid) {
  if (!canWriteWorld()) return Promise.resolve();
  return queue(() => game.settings.set(SUITE_ID, SETTINGS.actions1, String(uuid ?? "")));
}
