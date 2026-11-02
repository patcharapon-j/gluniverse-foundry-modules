/**
 * Creaturedexing — what each surface shows, decided once, as plain data.
 *
 * Pure: no `game`, no i18n, no DOM. The window, the Falsify dialog and the
 * preview page all build from these functions, so the preview cannot flatter a
 * copy nobody ships and the check tool can ask the questions that fail
 * silently: does a player's view carry any trace of a lie, does a sealed
 * section carry any trace of its shape.
 *
 * Two viewer rules shape everything here.
 *
 * **A lie is held knowledge to its holder.** A player's model has no `false`
 * state anywhere: a lie is `known`, counts toward "learned", lights its pip and
 * completes the entry, exactly as the truth would. Only a GM's model says
 * `false`. Completion a player sees is therefore *apparent* completion; the GM
 * sees the true answer beside it.
 *
 * **A sealed section is a name and nothing else.** Its model carries no rows,
 * no count, no snapshot. "This creature has three resistances" is knowledge.
 */

import { foldText } from "../../core/util.mjs";
import { PARTY_KEY, sectionKeys } from "./constants.mjs";
import { falseIn, knownIn, metaIn, subjectsIn, truthIn } from "./ledger.mjs";
import { isComplete } from "./rules.mjs";

/** Case- and accent-insensitive, for the shelf filter (the window and the model agree). */
export const matchesQuery = (name, query) => {
  const q = foldText(query);
  return !q || foldText(name).includes(q);
};

const kindOf = (meta) => (meta?.kind === "hazard" ? "hazard" : "creature");

/** Sections in printed order, limited to the ones this subject has. */
const orderOf = (meta) => sectionKeys(kindOf(meta)).filter((k) => (meta?.available ?? []).includes(k));

/**
 * Who the window is reading for.
 *
 * A GM reads for Everyone (the union, `PARTY_KEY`) or for one character. A
 * player reads for one of their own characters, never for the party key: the
 * union is what Party Knowledge gives them, and it is a read rule, not a pick.
 */
export function resolveOwner({ isGM, party, characters = [], ownerId = null }) {
  const pool = characters.filter((c) => c?.id);
  if (isGM) {
    // The GM's pick is who a WRITE lands on, so Party Knowledge never widens it.
    const one = ownerId && ownerId !== PARTY_KEY ? pool.find((c) => c.id === ownerId) : null;
    return { everyone: !one, owner: one ?? null, readKey: one ? one.id : PARTY_KEY };
  }
  const one = pool.find((c) => c.id === ownerId) ?? pool[0] ?? null;
  return { everyone: false, owner: one, readKey: one?.id ?? null };
}

/** What one read holds about one subject, split by viewer. */
function holding(data, key, meta, readKey, party) {
  const order = orderOf(meta);
  const known = readKey ? knownIn(data, key, readKey, party).filter((k) => order.includes(k)) : [];
  const lies = readKey ? falseIn(data, key, readKey, party).filter((l) => order.includes(l.section)) : [];
  const lieKeys = lies.map((l) => l.section);
  const held = order.filter((k) => known.includes(k) || lieKeys.includes(k));
  return {
    order,
    known,
    lies,
    lieKeys,
    held,
    trueComplete: isComplete(known, order),
    apparentComplete: isComplete(held, order),
  };
}

const stateFor = (key, h, isGM) => {
  if (h.known.includes(key)) return "known";
  if (h.lieKeys.includes(key)) return isGM ? "false" : "known";
  return "sealed";
};

/**
 * The dex window.
 *
 * `pending` is a GM-only creature nobody has learned anything about yet, as
 * `{ key, meta }` read off the live actor. `live` is GM-only too: what the live
 * creature says about itself (`deferredCount`), which the store never keeps.
 * `fresh` names sections that became held since the window last drew this
 * subject, so they can unseal on screen instead of simply appearing.
 */
export function dexModel({
  data = {},
  isGM = false,
  party = true,
  characters = [],
  ownerId = null,
  subject = null,
  pending = null,
  query = "",
  live = null,
  fresh = [],
  entering = false,
} = {}) {
  const who = resolveOwner({ isGM, party, characters, ownerId });
  const { readKey, everyone, owner } = who;

  const ownerRows = isGM
    ? [{ id: PARTY_KEY, everyone: true, on: everyone }, ...characters.map((c) => ({ id: c.id, name: c.name, on: !everyone && c.id === owner?.id }))]
    : party
      ? []
      : characters.map((c) => ({ id: c.id, name: c.name, on: c.id === owner?.id }));

  const metaFor = (key) => metaIn(data, key) ?? (pending && pending.key === key ? pending.meta : null);

  const keys = new Set(subjectsIn(data));
  if (isGM && pending?.key) keys.add(pending.key);

  const entries = [];
  for (const key of keys) {
    const meta = metaFor(key);
    if (!meta) continue;
    const h = holding(data, key, meta, readKey, party);
    // A player's shelf holds only what their read holds something about.
    if (!isGM && !h.held.length) continue;
    entries.push({
      key,
      name: String(meta.name ?? ""),
      img: String(meta.img ?? ""),
      kind: kindOf(meta),
      pips: h.order.map((s) => ({ key: s, state: stateFor(s, h, isGM) })),
      count: isGM ? h.known.length : h.held.length,
      total: h.order.length,
      complete: isGM ? h.trueComplete : h.apparentComplete,
      believed: isGM && h.apparentComplete && !h.trueComplete,
      hidden: !matchesQuery(meta.name, query),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  let selected = entries.find((e) => e.key === subject) ?? entries.find((e) => !e.hidden) ?? entries[0] ?? null;
  for (const e of entries) e.on = e === selected;

  const detail = selected && readKey ? detailModel({ data, key: selected.key, meta: metaFor(selected.key), readKey, party, isGM, everyone, live, fresh }) : null;

  return {
    isGM,
    party,
    everyone,
    readKey,
    ownerName: owner?.name ?? "",
    owners: ownerRows,
    showOwners: ownerRows.length > 1,
    shelf: {
      entries,
      empty: !entries.length,
      noMatch: entries.length > 0 && entries.every((e) => e.hidden),
      query: String(query ?? ""),
      // A short shelf is read at a glance; a filter there is chrome.
      searchable: entries.length > 6 || !!String(query ?? "").trim(),
    },
    subject: selected?.key ?? null,
    detail,
    entering: !!entering,
  };
}

function detailModel({ data, key, meta, readKey, party, isGM, everyone, live, fresh }) {
  const h = holding(data, key, meta, readKey, party);
  const freshSet = new Set(fresh ?? []);
  const sections = h.order.map((section, i) => {
    const isKnown = h.known.includes(section);
    const lie = h.lies.find((l) => l.section === section) ?? null;
    const state = stateFor(section, h, isGM);
    return {
      key: section,
      index: i,
      state,
      isLie: isGM && !isKnown && !!lie,
      // The snapshot to draw. A sealed section has none, by construction.
      snapshot: isKnown ? truthIn(data, key, section) : lie ? lie.snapshot : null,
      fresh: state !== "sealed" && freshSet.has(section),
      canReveal: isGM && !isKnown,
      canFalsify: isGM && !isKnown && !lie,
      canClear: isGM && (isKnown || !!lie),
    };
  });

  // Held-back abilities print only on a TRUE completion of this read. A
  // player who completed the entry with a lie inside it gets the same window
  // a creature with no held-back abilities draws, so nothing tells them which.
  const deferred = h.trueComplete && Array.isArray(meta?.deferred) ? meta.deferred : [];

  const notes = [];
  if (isGM && everyone) notes.push({ tone: "steel", key: "GLDEX.app.everyoneNote" });
  if (h.trueComplete || (!isGM && h.apparentComplete)) notes.push({ tone: "paper", key: "GLDEX.app.completeNote" });
  if (isGM && h.apparentComplete && !h.trueComplete) notes.push({ tone: "lie", key: "GLDEX.app.believedNote", sections: h.lieKeys });
  if (isGM && !h.trueComplete && Number(live?.deferredCount) > 0) notes.push({ tone: "steel", key: "GLDEX.app.deferred" });

  return {
    key,
    name: String(meta?.name ?? ""),
    img: String(meta?.img ?? ""),
    kind: kindOf(meta),
    count: isGM ? h.known.length : h.held.length,
    lies: isGM ? h.lieKeys.length : 0,
    total: h.order.length,
    complete: isGM ? h.trueComplete : h.apparentComplete,
    believed: isGM && h.apparentComplete && !h.trueComplete,
    sections,
    deferred,
    notes,
    canRefresh: isGM,
    canForget: isGM,
  };
}

/* ── the Falsify dialog ─────────────────────────────────────────────────── */

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * The lie being authored, row by row against the truth.
 *
 * Every row either side carries is offered: a borrowed section can lack a row
 * the truth has (the lie then omits it, which is itself a claim), and the GM
 * can fill it back in. A row left empty is dropped when the lie is sent, so an
 * empty value never prints as "none".
 */
export function falsifyModel({ ctx = {}, mode = "borrow", candidates = [], sourceId = null, draft = null, truth = null, iwr = false } = {}) {
  const truthRows = new Map((truth?.rows ?? []).map((r) => [r.key, norm(r.value)]));
  const draftRows = new Map((draft?.rows ?? []).map((r) => [r.key, norm(r.value)]));
  const keys = [...new Set([...(draft?.rows ?? []).map((r) => r.key), ...truthRows.keys()])];
  const rows = draft
    ? keys.map((key) => {
        const value = draftRows.get(key) ?? "";
        const was = truthRows.get(key) ?? "";
        return { key, value, truth: was, hasTruth: truthRows.has(key), changed: value !== was };
      })
    : [];
  const melee = draft?.strikes?.melee?.length ?? 0;
  const ranged = draft?.strikes?.ranged?.length ?? 0;
  const extras = [];
  if (melee + ranged) extras.push({ key: "GLDEX.falsify.extraStrikes", n: melee + ranged });
  if (draft?.spells?.length) extras.push({ key: "GLDEX.falsify.extraSpells", n: draft.spells.length });
  if (draft?.abilities?.length) extras.push({ key: "GLDEX.falsify.extraAbilities", n: draft.abilities.length });
  return {
    section: ctx.section ?? null,
    subjectName: String(ctx.name ?? ""),
    toName: String(ctx.toName ?? ""),
    mode: mode === "doctor" ? "doctor" : "borrow",
    candidates: candidates.map((c) => ({ ...c, selected: c.id === sourceId })),
    hasTruth: !!truth,
    iwr: !!iwr,
    ready: !!draft,
    rows,
    changed: rows.filter((r) => r.changed).length,
    extras,
  };
}

/** Read a draft back with the GM's edits, dropping rows left empty. */
export function harvestDraft(draft, edits = {}) {
  if (!draft) return null;
  const out = JSON.parse(JSON.stringify(draft));
  const seen = new Set((out.rows ?? []).map((r) => r.key));
  out.rows = (out.rows ?? []).map((r) => (r.key in edits ? { ...r, value: norm(edits[r.key]) } : { ...r, value: norm(r.value) }));
  for (const [key, value] of Object.entries(edits)) if (!seen.has(key)) out.rows.push({ key, value: norm(value) });
  out.rows = out.rows.filter((r) => r.value !== "");
  return out;
}

/* ── the reveal notice ──────────────────────────────────────────────────── */

/**
 * The chat line a reveal posts, and who may read it.
 *
 * A true reveal and a lie post the SAME notice: a lie that arrived silently
 * while truths arrived announced would be a lie the player can see. `whisper`
 * is null when the whole table shares the knowledge (Party Knowledge on, or a
 * reveal to everyone) and otherwise names the users who own the characters
 * told, plus the GMs, so another player does not read a name they never
 * learned.
 */
export function noticeModel({ section, subjectName, owners = [], everyone = false, party = false, complete = false, users = [] }) {
  const toAll = everyone || party;
  const ownerIds = new Set(owners.map((o) => o.id));
  const whisper = toAll
    ? null
    : [...new Set(users.filter((u) => u.isGM || (u.owns ?? []).some((id) => ownerIds.has(id))).map((u) => u.id))];
  return {
    section,
    subjectName: String(subjectName ?? ""),
    who: toAll ? null : owners.map((o) => o.name).filter(Boolean),
    complete: !!complete,
    whisper,
  };
}
