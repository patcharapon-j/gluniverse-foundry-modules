/**
 * Mythic GME: the Threads and Characters lists, and the panel's own memory.
 *
 * Pure. Every write in the app goes `normalize → change → normalize`, so a
 * row always has an id its buttons can find it by, and two rows never share
 * one. Ids that have to be minted are deterministic (list and index), so the
 * id a row draws with is the id its click resolves, on every render.
 */

import { LISTS, LIST_MAX, TABS } from "./constants.mjs";
import { DEFAULT_ODDS, clampWeight, oddsById } from "./rules.mjs";

const cleanName = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

function normalizeRows(list, rows) {
  const out = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    if (out.length >= LIST_MAX) return;
    const name = cleanName(typeof r === "string" ? r : r?.name);
    if (!name) return;
    let id = typeof r?.id === "string" && r.id ? r.id.slice(0, 40) : `${list}-${i}`;
    if (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);
    out.push({ id, name, weight: clampWeight(r?.weight) });
  });
  return out;
}

export function normalizeLists(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(LISTS.map((l) => [l, normalizeRows(l, src[l])]));
}

const mint = (list, rows, now) => {
  let n = rows.length;
  let id = `${list}-${now.toString(36)}`;
  while (rows.some((r) => r.id === id)) id = `${list}-${now.toString(36)}-${++n}`;
  return id;
};

/** Add a row. A name already on the list gains weight instead of a second row. */
export function addRow(lists, list, name, now = Date.now()) {
  const all = normalizeLists(lists);
  const clean = cleanName(name);
  if (!LISTS.includes(list) || !clean) return all;
  const rows = all[list];
  const same = rows.find((r) => r.name.toLowerCase() === clean.toLowerCase());
  if (same) {
    same.weight = clampWeight(same.weight + 1);
    return all;
  }
  if (rows.length >= LIST_MAX) return all;
  rows.push({ id: mint(list, rows, now), name: clean, weight: 1 });
  return all;
}

export function removeRow(lists, list, id) {
  const all = normalizeLists(lists);
  if (LISTS.includes(list)) all[list] = all[list].filter((r) => r.id !== id);
  return all;
}

/** Step a row's weight by ±1, within 1..3. */
export function stepWeight(lists, list, id, delta) {
  const all = normalizeLists(lists);
  const row = LISTS.includes(list) ? all[list].find((r) => r.id === id) : null;
  if (row) row.weight = clampWeight(row.weight + Math.sign(Number(delta) || 0));
  return all;
}

/** The panel's remembered page and odds. */
export function normalizeUi(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    tab: TABS.includes(src.tab) ? src.tab : TABS[0],
    odds: oddsById(src.odds) ? src.odds : DEFAULT_ODDS,
  };
}
