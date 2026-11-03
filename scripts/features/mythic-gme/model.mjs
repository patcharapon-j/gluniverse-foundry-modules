/**
 * Mythic GME: what the panel and a chat card show.
 *
 * Pure. Text leaves this module as a ref: `{ k, d }` is an i18n key with its
 * data, `{ raw }` is a word from a table or a name the GM typed. `render.mjs`
 * resolves refs through the `t` it is handed; the check tool resolves every
 * key a model can produce against the language file, including the families
 * built at runtime (`GLMYTHIC.verdict.*`, `.odds.*`, `.focus.*`, `.scene.*`,
 * `.adjust.*`, `.category.*`, `.tab.*`, `.list.*`, `.meaning.table.*`).
 */

import { matchesQuery } from "../../core/util.mjs";
import { CHAOS_MAX, CHAOS_MIN, LIST_MAX, LISTS, TABS, WEIGHT_MAX } from "./constants.mjs";
import { CORE_MEANING, elementGroups } from "./catalog.mjs";
import { ODDS, fateCell } from "./rules.mjs";

export const T = (k, d) => (d ? { k, d } : { k });
export const RAW = (raw) => ({ raw: String(raw ?? "") });

/** A table name against the search box: every word, any case, any accent. */
export { matchesQuery };

/** How loud the Chaos Factor is: 1-3 calm, 4-6 steady, 7-9 wild. */
export const chaosTier = (cf) => (cf <= 3 ? "calm" : cf >= 7 ? "wild" : "steady");

const VERDICT_TONE = { "exceptional-yes": "exc-yes", yes: "yes", no: "no", "exceptional-no": "exc-no" };
const ICON = {
  fate: "fa-solid fa-scale-balanced",
  event: "fa-solid fa-bolt",
  meaning: "fa-solid fa-feather",
  element: "fa-solid fa-layer-group",
  scene: "fa-solid fa-clapperboard",
  adjust: "fa-solid fa-shuffle",
  chaos: "fa-solid fa-hurricane",
  list: "fa-solid fa-list-ul",
  legacy: "fa-solid fa-clock-rotate-left",
};

const meaningValue = (m) => RAW(m.words.join(" · "));
const rolls = (r) => (Array.isArray(r) ? r.join(" / ") : String(r));

/** The lines a Random Event adds under whatever triggered it. */
function eventLines(ev) {
  if (!ev) return [];
  const lines = [{ label: T("GLMYTHIC.event.label"), value: T(`GLMYTHIC.focus.${ev.focus.key}`), meta: T("GLMYTHIC.meta.d100", { roll: ev.focus.roll }), tone: "event" }];
  if (ev.meaning) {
    lines.push({
      label: T(`GLMYTHIC.meaning.table.${ev.meaning.table}`),
      value: meaningValue(ev.meaning),
      meta: RAW(rolls(ev.meaning.rolls)),
      tone: "word",
    });
  }
  if (ev.pick) {
    lines.push(
      ev.pick.empty
        ? { label: T(`GLMYTHIC.list.${ev.pick.list}`), value: T("GLMYTHIC.list.emptyPick"), meta: null, tone: "quiet" }
        : { label: T(`GLMYTHIC.list.${ev.pick.list}`), value: RAW(ev.pick.name), meta: T("GLMYTHIC.meta.pick", { roll: ev.pick.roll, of: ev.pick.of }), tone: "word" }
    );
  }
  return lines;
}

/**
 * One log entry as a card: `title` names the roll, `headline` is the answer,
 * `meta` the dice, `lines` anything the roll went on to roll.
 */
export function entryView(e) {
  const v = { id: e.id, kind: e.kind, icon: ICON[e.kind] ?? ICON.legacy, tone: "neutral", title: null, headline: null, question: null, meta: [], lines: [], note: null };
  switch (e.kind) {
    case "fate":
      v.tone = VERDICT_TONE[e.key];
      v.title = T(`GLMYTHIC.odds.${e.odds}`);
      v.headline = T(`GLMYTHIC.verdict.${e.key}`);
      v.question = e.question ? RAW(e.question) : null;
      v.meta = [T("GLMYTHIC.meta.d100", { roll: e.roll }), T("GLMYTHIC.meta.cf", { cf: e.cf })];
      if (e.cell) v.meta.push(T("GLMYTHIC.meta.chance", { yes: e.cell[1] }));
      v.lines = eventLines(e.event);
      if (e.eventPending) v.lines.push({ label: T("GLMYTHIC.event.label"), value: T("GLMYTHIC.event.pending"), meta: null, tone: "event" });
      if (e.event || e.eventPending) v.flag = T("GLMYTHIC.event.flag");
      break;
    case "event": {
      v.tone = "event";
      v.title = T("GLMYTHIC.event.label");
      v.headline = T(`GLMYTHIC.focus.${e.focus.key}`);
      v.meta = [T("GLMYTHIC.meta.d100", { roll: e.focus.roll })];
      v.lines = eventLines(e).slice(1);
      break;
    }
    case "meaning":
      v.title = T(`GLMYTHIC.meaning.table.${e.table}`);
      v.headline = meaningValue(e);
      v.meta = [T("GLMYTHIC.meta.d100", { roll: rolls(e.rolls) })];
      if (e.missing) v.note = T("GLMYTHIC.meaning.missing");
      break;
    case "element":
      v.title = RAW(e.name);
      v.headline = RAW(e.word);
      v.meta = [T("GLMYTHIC.meta.d100", { roll: e.roll })];
      break;
    case "scene":
      v.tone = e.result;
      v.title = T("GLMYTHIC.scene.check");
      v.headline = T(`GLMYTHIC.scene.result.${e.result}`);
      v.meta = [T("GLMYTHIC.meta.d10", { roll: e.roll }), T("GLMYTHIC.meta.cf", { cf: e.cf })];
      if (e.adjust) {
        for (const key of e.adjust.adjustments) v.lines.push({ label: T("GLMYTHIC.adjust.label"), value: T(`GLMYTHIC.adjust.${key}`), meta: null, tone: "word" });
      }
      v.lines.push(...eventLines(e.event));
      break;
    case "adjust":
      v.tone = "altered";
      v.title = T("GLMYTHIC.adjust.title");
      v.headline = T(`GLMYTHIC.adjust.${e.adjustments[0]}`);
      v.meta = [T("GLMYTHIC.meta.d10", { roll: rolls(e.rolls) })];
      for (const key of e.adjustments.slice(1)) v.lines.push({ label: T("GLMYTHIC.adjust.also"), value: T(`GLMYTHIC.adjust.${key}`), meta: null, tone: "word" });
      break;
    case "chaos":
      v.tone = e.to > e.from ? "rise" : e.to < e.from ? "fall" : "neutral";
      v.title = T("GLMYTHIC.scene.end");
      v.headline = T("GLMYTHIC.chaos.moved", { from: e.from, to: e.to });
      v.meta = [T(e.inControl ? "GLMYTHIC.scene.inControl" : "GLMYTHIC.scene.outOfControl")];
      if (e.from === e.to) v.note = T(e.inControl ? "GLMYTHIC.chaos.floor" : "GLMYTHIC.chaos.ceiling");
      break;
    case "list":
      v.title = T(`GLMYTHIC.list.${e.list}`);
      v.headline = RAW(e.name);
      v.meta = [T("GLMYTHIC.meta.pick", { roll: e.roll, of: e.of })];
      break;
    default:
      // A pre-remake entry: finished strings, drawn as they were.
      v.tone = "legacy";
      v.title = RAW(e.label);
      v.headline = RAW(e.result);
      v.meta = e.meta ? [RAW(e.meta)] : [];
      v.lines = (e.subs ?? []).map((s) => ({ label: RAW(s.label), value: RAW(s.result), meta: s.meta ? RAW(s.meta) : null, tone: "word" }));
  }
  return v;
}

/**
 * The whole panel.
 *
 * state: { chaos, ui: { tab, odds }, log, lists, question, query, autoEvent,
 *          actions1: { linked, name }, fresh, writable }
 */
export function panelModel(state) {
  const cf = Math.min(CHAOS_MAX, Math.max(CHAOS_MIN, Number(state.chaos) || CHAOS_MIN));
  const tab = TABS.includes(state.ui?.tab) ? state.ui.tab : TABS[0];
  const log = Array.isArray(state.log) ? state.log : [];
  const views = log.map(entryView);
  const query = String(state.query ?? "");
  const lists = state.lists ?? {};

  return {
    tab,
    writable: state.writable !== false,
    chaos: {
      value: cf,
      tier: chaosTier(cf),
      pips: Array.from({ length: CHAOS_MAX }, (_, i) => ({ n: i + 1, on: i + 1 <= cf })),
      canDown: cf > CHAOS_MIN,
      canUp: cf < CHAOS_MAX,
    },
    tabs: TABS.map((id) => ({ id, label: T(`GLMYTHIC.tab.${id}`), active: id === tab })),
    ask: {
      question: String(state.question ?? ""),
      autoEvent: state.autoEvent !== false,
      odds: ODDS.map((o) => {
        const c = fateCell(o.id, cf);
        return { id: o.id, label: T(`GLMYTHIC.odds.${o.id}`), yes: c.yes, excYes: c.excYes, excNo: c.excNo, active: o.id === state.ui?.odds };
      }),
    },
    scene: {
      cf,
      // Chance the expected scene is not what happens: d10 at or under the Chaos Factor.
      change: cf * 10,
    },
    meaning: {
      core: CORE_MEANING.map((id) => ({
        id,
        label: T(`GLMYTHIC.meaning.table.${id}`),
        note: id === "actions" && !state.actions1?.linked ? T("GLMYTHIC.meaning.missingShort") : null,
      })),
      actions1: { linked: !!state.actions1?.linked, name: state.actions1?.name ? RAW(state.actions1.name) : null },
      query,
      groups: elementGroups().map((g) => {
        const tables = g.tables.map((t) => ({ ...t, hidden: !matchesQuery(t.name, query) }));
        return { category: g.category, label: T(`GLMYTHIC.category.${g.category}`), tables, hidden: tables.every((t) => t.hidden) };
      }),
    },
    lists: LISTS.map((id) => {
      const rows = Array.isArray(lists[id]) ? lists[id] : [];
      return {
        id,
        label: T(`GLMYTHIC.list.${id}`),
        rows: rows.map((r) => ({ id: r.id, name: RAW(r.name), weight: r.weight, pips: Array.from({ length: WEIGHT_MAX }, (_, i) => i < r.weight) })),
        count: rows.length,
        max: LIST_MAX,
        full: rows.length >= LIST_MAX,
      };
    }),
    log: {
      hero: views[0] ?? null,
      rest: views.slice(1),
      count: views.length,
      fresh: state.fresh && views[0]?.id === state.fresh ? state.fresh : null,
    },
  };
}
