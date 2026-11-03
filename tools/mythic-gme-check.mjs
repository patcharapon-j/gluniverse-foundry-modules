#!/usr/bin/env node
/**
 * Mythic GME: consistency check. Zero problems required.
 *
 * Everything here fails silently in Foundry: a Fate Chart cell one band off is
 * a plausible answer; a Random Event rule that misses 99 or counts 100 never
 * says so; a Chaos Factor that steps past 9 just keeps going; a runtime-built
 * i18n key with no entry prints the key; a `data-action` with no handler is a
 * button that does nothing; a setting read and never registered throws only
 * when that path runs; a whisper that includes the stream login is on the
 * recording.
 *
 *   node tools/mythic-gme-check.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEAT = "scripts/features/mythic-gme";
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);

const problems = [];
const fail = (msg) => problems.push(msg);
const ok = (cond, msg) => {
  if (!cond) fail(msg);
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const C = await mod(`${FEAT}/constants.mjs`);
const R = await mod(`${FEAT}/rules.mjs`);
const CAT = await mod(`${FEAT}/catalog.mjs`);
const O = await mod(`${FEAT}/oracle.mjs`);
const LI = await mod(`${FEAT}/lists.mjs`);
const M = await mod(`${FEAT}/model.mjs`);
const RE = await mod(`${FEAT}/render.mjs`);

/** An rng that hands back the given faces, each for a die of the given size. */
const scripted = (faces, sizes) => {
  let i = 0;
  return () => {
    const n = sizes[i] ?? 100;
    const f = faces[i++] ?? 1;
    return (f - 0.5) / n;
  };
};
const seeded = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/* ── 1. the Fate Chart, cell by cell ─────────────────────────────────────── */

// Mythic GME 2e, the "Yes" number of every cell, Chaos Factor 1..9 left to right.
const CHART = {
  certain: [50, 65, 75, 85, 90, 95, 99, 99, 99],
  "nearly-certain": [35, 50, 65, 75, 85, 90, 95, 99, 99],
  "very-likely": [25, 35, 50, 65, 75, 85, 90, 95, 99],
  likely: [15, 25, 35, 50, 65, 75, 85, 90, 95],
  "fifty-fifty": [10, 15, 25, 35, 50, 65, 75, 85, 90],
  unlikely: [5, 10, 15, 25, 35, 50, 65, 75, 85],
  "very-unlikely": [1, 5, 10, 15, 25, 35, 50, 65, 75],
  "nearly-impossible": [1, 1, 5, 10, 15, 25, 35, 50, 65],
  impossible: [1, 1, 1, 5, 10, 15, 25, 35, 50],
};
// The exceptional bands are a fifth of each side, as the book prints them:
// an Exceptional Yes of 0 and an Exceptional No of 101 are the book's "X".
const excYesOf = (yes) => Math.round(yes / 5);
const excNoOf = (yes) => 101 - Math.round((100 - yes) / 5);

eq(R.ODDS.map((o) => o.id), Object.keys(CHART).reverse(), "ODDS run Impossible to Certain");
for (const [odds, row] of Object.entries(CHART)) {
  row.forEach((yes, i) => {
    const cf = i + 1;
    const cell = R.fateCell(odds, cf);
    eq([cell.excYes, cell.yes, cell.excNo], [excYesOf(yes), yes, excNoOf(yes)], `Fate Chart ${odds} at Chaos ${cf}`);
    // Every face of the d100 reads the verdict the bands say.
    for (let roll = 1; roll <= 100; roll++) {
      const want = roll <= excYesOf(yes) ? "exceptional-yes" : roll <= yes ? "yes" : roll >= excNoOf(yes) ? "exceptional-no" : "no";
      if (R.verdictOf(roll, cell) !== want) {
        fail(`verdict ${odds} at Chaos ${cf}, d100 ${roll}: got ${R.verdictOf(roll, cell)}, want ${want}`);
        break;
      }
    }
  });
}
eq(R.fateCell("fifty-fifty", 5), { excYes: 10, yes: 50, excNo: 91 }, "50/50 at Chaos 5 is the centre");
ok(R.fateCell("bogus", 5).yes === 50, "an unknown odds id reads as 50/50");
ok(R.fateCell("likely", 0).yes === R.fateCell("likely", 1).yes && R.fateCell("likely", 99).yes === R.fateCell("likely", 9).yes, "fateCell clamps the Chaos Factor");

/* ── 2. Random Events: doubles at or under the Chaos Factor ──────────────── */

for (let cf = 1; cf <= 9; cf++) {
  for (let roll = 1; roll <= 100; roll++) {
    const digit = Math.floor(roll / 10);
    const want = roll >= 11 && roll <= 99 && digit === roll % 10 && digit <= cf;
    if (R.triggersEvent(roll, cf) !== want) fail(`triggersEvent(${roll}, ${cf}) is ${!want}`);
    const r = R.rollFate("likely", cf, scripted([roll], [100]));
    if (r.roll !== roll || r.eventTriggered !== want) fail(`rollFate at d100 ${roll}, Chaos ${cf}: eventTriggered ${r.eventTriggered}`);
  }
}
ok(!R.triggersEvent(100, 9), "100 is not doubles");
ok(R.triggersEvent(99, 9) && !R.triggersEvent(99, 8), "99 triggers only at Chaos 9");
{
  // The pre-remake api shape survives.
  const r = R.rollFate("likely", 5, scripted([33], [100]));
  for (const k of ["oddsId", "cf", "roll", "key", "yes", "threshold", "eventTriggered"]) ok(k in r, `rollFate result keeps "${k}"`);
}
{
  // Auto events off: the event is flagged, not rolled; on: rolled, with its focus.
  const off = O.askFate({ oddsId: "likely", cf: 6, autoEvent: false, rng: scripted([22], [100]) });
  ok(off.eventPending && !off.event, "a triggered event with auto-roll off is flagged, not rolled");
  const on = O.askFate({ oddsId: "likely", cf: 6, autoEvent: true, rng: scripted([22, 30, 40], [100, 100, 100]) });
  ok(on.event?.focus?.key === "npc-action" && !on.eventPending, "a triggered event with auto-roll on is rolled");
  const none = O.askFate({ oddsId: "likely", cf: 1, autoEvent: true, rng: scripted([22], [100]) });
  ok(!none.event && !none.eventPending, "22 at Chaos 1 triggers nothing");
}

/* ── 3. the Chaos Factor ─────────────────────────────────────────────────── */

eq([C.CHAOS_MIN, C.CHAOS_MAX, C.CHAOS_DEFAULT], [1, 9, 5], "Chaos Factor bounds and default");
eq([-5, 0, 1, 4.6, 9, 10, NaN, "7", null, undefined].map(R.clampChaos), [1, 1, 1, 5, 9, 9, 5, 7, 1, 5], "clampChaos");
for (let cf = 1; cf <= 9; cf++) {
  eq(R.chaosAfterScene(cf, true), Math.max(1, cf - 1), `in control at Chaos ${cf}`);
  eq(R.chaosAfterScene(cf, false), Math.min(9, cf + 1), `out of control at Chaos ${cf}`);
  const e = O.chaosEntry(cf, false);
  ok(e.from === cf && e.to === Math.min(9, cf + 1), `chaosEntry out of control at ${cf}`);
}

/* ── 4. scenes ───────────────────────────────────────────────────────────── */

for (let cf = 1; cf <= 9; cf++) {
  for (let face = 1; face <= 10; face++) {
    const want = face > cf ? "expected" : face % 2 ? "altered" : "interrupted";
    const s = R.sceneCheck(cf, scripted([face], [10]));
    if (s.roll !== face || s.result !== want) fail(`sceneCheck d10 ${face} at Chaos ${cf}: ${s.result}, want ${want}`);
  }
}
{
  const altered = O.sceneEntry({ cf: 5, rng: scripted([3, 4], [10, 10]) });
  ok(altered.result === "altered" && altered.adjust?.adjustments?.[0] === "increase-activity" && !altered.event, "an altered scene rolls its adjustment");
  const interrupted = O.sceneEntry({ cf: 5, rng: scripted([2, 1, 1], [10, 100, 100]) });
  ok(interrupted.result === "interrupted" && interrupted.event?.focus?.key === "remote" && !interrupted.adjust, "an interrupted scene rolls a Random Event");
}
eq(R.SCENE_ADJUSTMENTS.map((a) => a.max), [1, 2, 3, 4, 5, 6, 10], "Scene Adjustment bands");
for (let first = 1; first <= 10; first++) {
  const a = R.rollSceneAdjustment(scripted([first, 9, 3, 10, 6], [10, 10, 10, 10, 10]));
  const want = first <= 6 ? [R.adjustmentFor(first).key] : ["reduce-activity", "add-object"];
  eq(a.adjustments, want, `Scene Adjustment from d10 ${first}`);
  ok(!a.adjustments.includes("two-adjustments"), "two-adjustments is never an answer");
}
{
  const stuck = R.rollSceneAdjustment(() => 0.95);
  ok(stuck.adjustments.length === 2, "a die that never lands under 7 still answers");
}

/* ── 5. Event Focus ──────────────────────────────────────────────────────── */

{
  const widths = R.EVENT_FOCUS.map((f, i) => f.max - (i ? R.EVENT_FOCUS[i - 1].max : 0));
  eq(widths, [5, 5, 10, 20, 5, 5, 5, 10, 5, 10, 5, 15], "Event Focus band widths");
  eq(R.EVENT_FOCUS.at(-1).max, 100, "Event Focus covers d100");
  for (const f of R.EVENT_FOCUS) {
    const wantList = /npc-(action|negative|positive)/.test(f.key) ? "characters" : /thread/.test(f.key) ? "threads" : undefined;
    ok(f.list === wantList, `Event Focus ${f.key} points at ${wantList ?? "no list"}`);
  }
}
{
  const lists = LI.normalizeLists({ threads: ["A thread"], characters: [] });
  const ev = O.randomEvent({ lists, rng: scripted([30, 1], [100, 100]) });
  ok(ev.pick?.empty && ev.pick.list === "characters", "an NPC focus on an empty list says the list is empty");
  const ev2 = O.randomEvent({ lists, rng: scripted([60, 1, 1], [100, 100, 1]) });
  ok(ev2.pick?.name === "A thread", "a thread focus picks from Threads");
  const ev3 = O.randomEvent({ lists, rng: scripted([90, 1], [100, 100]) });
  ok(ev3.pick === null, "a focus with no list picks nothing");
}

/* ── 6. the meaning tables ───────────────────────────────────────────────── */

const { MEANING, ELEMENTS } = await mod(`${FEAT}/data/tables.mjs`);
eq([CAT.ACTIONS_2[0], CAT.ACTIONS_2[99]], ["Advantage", "Wound"], "Actions Table 2 is the noun column");
eq([CAT.DESCRIPTIONS_1[0], CAT.DESCRIPTIONS_1[99]], ["Adventurously", "Yieldingly"], "Descriptions Table 1 is the adverb column");
eq([CAT.DESCRIPTIONS_2[0], CAT.DESCRIPTIONS_2[99]], ["Abnormal", "Young"], "Descriptions Table 2 is the adjective column");
{
  const loc = CAT.elementById("locations");
  ok(loc && loc.entries === MEANING.descriptor2 || (loc && JSON.stringify(loc.entries) === JSON.stringify(MEANING.descriptor2)), "Locations is the rescued descriptor2 column");
  ok(loc?.category === "locations", "Locations files under Locations");
  ok(!/catalog/.test("") && read(`${FEAT}/data/tables.mjs`).includes('"descriptor2"'), "the bundled data is untouched");
}
for (const t of [CAT.ACTIONS_2, CAT.DESCRIPTIONS_1, CAT.DESCRIPTIONS_2, ...CAT.ELEMENT_TABLES.map((e) => e.entries)]) {
  ok(t.length === 100 && t.every((w) => typeof w === "string" && w.trim()), "every meaning table has 100 rows of words");
}
{
  const ids = CAT.ELEMENT_TABLES.map((e) => e.id);
  ok(new Set(ids).size === ids.length, "elements table ids are unique");
  ok(ids.length === ELEMENTS.length + 1, "every bundled elements table is offered, plus Locations");
  for (const e of ELEMENTS) ok(e.category in CAT.CATEGORY_SLUGS, `elements category "${e.category}" has a slug`);
}
{
  const bare = CAT.rollMeaning("actions", { rng: scripted([7], [100]) });
  ok(bare.missing && bare.words.length === 1 && bare.words[0] === CAT.ACTIONS_2[6], "Actions without Table 1 reads Table 2 alone and says so");
  const col = Array.from({ length: 100 }, (_, i) => `v${i + 1}`);
  const pair = CAT.rollMeaning("actions", { rng: scripted([12, 7], [100, 100]), actions1: col });
  eq(pair.words, ["v7", CAT.ACTIONS_2[11]], "Actions with Table 1 is verb then noun");
  const desc = CAT.rollMeaning("descriptions", { rng: scripted([1, 100], [100, 100]) });
  eq(desc.words, [CAT.DESCRIPTIONS_1[0], CAT.DESCRIPTIONS_2[99]], "Descriptions is adverb then adjective");
  eq(CAT.rollElement("smells", scripted([3], [100]))?.word, CAT.elementById("smells").entries[2], "rollElement reads the row it rolled");
  ok(CAT.rollElement("nope") === null, "rollElement refuses an unknown id");
}
{
  const ranged = CAT.columnFromResults([{ text: "A", range: [1, 50] }, { text: "B", range: [51, 100] }]);
  ok(ranged?.length === 100 && ranged[0] === "A" && ranged[99] === "B", "a 1-100 RollTable fills its rows by range");
  const flat = CAT.columnFromResults([{ text: "A", range: [1, 1] }, { text: "B", range: [2, 2] }]);
  eq(flat, ["A", "B"], "a short RollTable is read as a flat list");
  ok(CAT.columnFromResults([]) === null && CAT.columnFromResults([{ text: "  " }]) === null, "an empty RollTable links nothing");
}

/* ── 7. lists ────────────────────────────────────────────────────────────── */

{
  let l = LI.normalizeLists({ threads: [{ id: "x", name: "One" }, { id: "x", name: "Two" }, { name: "  " }, "Three"] });
  eq(l.threads.map((r) => r.id), ["x", "x-1", "threads-3"], "list ids are repaired deterministically");
  eq(LI.normalizeLists({ threads: [{ id: "x", name: "One" }, { id: "x", name: "Two" }, "Three"] }).threads.map((r) => r.id), ["x", "x-1", "threads-2"], "the same input mints the same ids");
  l = LI.addRow(l, "threads", "one", 5);
  ok(l.threads.length === 3 && l.threads[0].weight === 2, "adding a name already listed weighs it again");
  l = LI.stepWeight(LI.stepWeight(l, "threads", "x", 1), "threads", "x", 1);
  ok(l.threads[0].weight === 3, "weight caps at 3");
  const full = LI.normalizeLists({ characters: Array.from({ length: 40 }, (_, i) => `C${i}`) });
  ok(full.characters.length === C.LIST_MAX, "a list holds 25 rows");
  ok(LI.addRow(full, "characters", "One more").characters.length === C.LIST_MAX, "a full list refuses a row");
  eq(LI.normalizeUi({ tab: "nope", odds: "nope" }), { tab: "ask", odds: "fifty-fifty" }, "panel memory falls back to Ask and 50/50");
  // Weighted picks land on each row exactly as often as its weight.
  const rows = [{ id: "a", name: "A", weight: 1 }, { id: "b", name: "B", weight: 2 }];
  const hits = [1, 2, 3].map((f) => R.pickFromList(rows, scripted([f], [3])).name);
  eq(hits, ["A", "B", "B"], "pickFromList weights");
  ok(R.pickFromList([], Math.random) === null, "an empty list picks nothing");
}

/* ── 8. the log ──────────────────────────────────────────────────────────── */

const stamp = (e, n) => O.stamp(e, { now: 1_700_000_000_000 + n * 1000, rng: seeded(n + 1) });
const lists = LI.normalizeLists({ threads: ["Find the ferry"], characters: ["Vell"] });
const SAMPLE = [
  stamp(O.askFate({ oddsId: "likely", cf: 6, question: "Is it <b>locked</b>?", lists, rng: scripted([22, 30, 40, 1], [100, 100, 100, 1]) }), 1),
  stamp(O.askFate({ oddsId: "likely", cf: 6, autoEvent: false, rng: scripted([33], [100]) }), 2),
  stamp(O.askFate({ oddsId: "certain", cf: 9, rng: scripted([3], [100]) }), 3),
  stamp(O.askFate({ oddsId: "impossible", cf: 1, rng: scripted([100], [100]) }), 4),
  stamp(O.eventEntry({ lists, rng: scripted([60, 5, 1], [100, 100, 1]) }), 5),
  stamp(O.meaningEntry("actions", { rng: seeded(3) }), 6),
  stamp(O.meaningEntry("descriptions", { rng: seeded(4) }), 7),
  stamp(O.elementEntry("locations", seeded(5)), 8),
  stamp(O.sceneEntry({ cf: 9, rng: scripted([9, 8, 1, 2], [10, 10, 10, 10]) }), 9),
  stamp(O.sceneEntry({ cf: 9, lists, rng: scripted([4, 50, 3, 1], [10, 100, 100, 1]) }), 10),
  stamp(O.sceneEntry({ cf: 1, rng: scripted([9], [10]) }), 11),
  stamp(O.adjustEntry(scripted([7, 1, 6], [10, 10, 10])), 12),
  stamp(O.chaosEntry(9, false), 13),
  stamp(O.chaosEntry(4, true), 14),
  stamp(O.listEntry("characters", lists.characters, seeded(6)), 15),
  { label: "Fate · Likely", result: "Yes", meta: "d100 = 33 · CF 6", tone: "yes", subs: [{ label: "Random Event", result: "NPC Action", meta: "d100 = 27", tone: "event" }] },
];
const LOG = O.normalizeLog([...SAMPLE, null, 7, { kind: "fate", v: 2, roll: 500, key: "yes" }]);
eq(LOG.map((e) => e.kind), ["fate", "fate", "fate", "fate", "event", "meaning", "meaning", "element", "scene", "scene", "scene", "adjust", "chaos", "chaos", "list", "legacy"], "every kind survives normalizeLog; broken rows drop");
eq(O.normalizeLog(LOG), LOG, "normalizeLog is stable");
ok(new Set(LOG.map((e) => e.id)).size === LOG.length, "log ids are unique");
ok(O.normalizeLog(Array.from({ length: 80 }, () => SAMPLE[2])).length === C.LOG_MAX, "the log keeps 50");
ok(O.normalizeLog([SAMPLE[0], SAMPLE[0]]).map((e) => e.id).filter((v, i, a) => a.indexOf(v) === i).length === 2, "duplicate ids are separated");
for (const k of O.KINDS) ok(LOG.some((e) => e.kind === k), `the sample covers kind "${k}"`);
{
  // The same table rolled twice is two entries, each found by its own id
  // (the panel's post buttons resolve a card by id).
  const a = stamp(O.elementEntry("locations", scripted([1], [100])), 50);
  const b = stamp(O.elementEntry("locations", scripted([100], [100])), 51);
  const log = O.normalizeLog([b, a]);
  ok(a.id !== "locations" && a.id !== b.id, "an elements entry keeps its stamped id");
  eq(log.find((e) => e.id === a.id)?.word, CAT.elementById("locations").entries[0], "an older roll of a repeated table resolves to itself");
  ok(log[1]?.table === "locations", "an elements entry names its table separately");
}
{
  // An Actions read without Table 1 says so wherever it lands, chat included.
  const ev = stamp(O.eventEntry({ rng: scripted([90, 5], [100, 100]) }), 60);
  const fate = stamp(O.askFate({ oddsId: "likely", cf: 6, rng: scripted([22, 90, 5], [100, 100, 100]) }), 61);
  for (const e of [ev, fate]) {
    const v = M.entryView(O.normalizeEntry(e));
    ok(v.note?.k === "GLMYTHIC.meaning.missing", `a ${e.kind} with an Actions read lacking Table 1 carries the notice`);
    ok(RE.chatHTML(v, (k) => k).includes("GLMYTHIC.meaning.missing"), `the ${e.kind} chat card prints the notice`);
  }
  const linked = stamp(O.eventEntry({ rng: scripted([90, 5, 5], [100, 100, 3]), actions1: ["a", "b", "c"] }), 62);
  ok(!M.entryView(O.normalizeEntry(linked)).note, "a linked Table 1 carries no notice");
}

/* ── 9. i18n: every key any model can produce, and every literal ─────────── */

const LANG = JSON.parse(read("lang/mythic-gme.en.json"));
const has = (key) => typeof key.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), LANG) === "string";
const t = (k, d) => {
  if (!has(k)) fail(`missing i18n key ${k}`);
  return d ? `${k}${JSON.stringify(d)}` : k;
};
const refs = new Set();
const walk = (v) => {
  if (!v || typeof v !== "object") return;
  if (typeof v.k === "string") refs.add(v.k);
  for (const x of Object.values(v)) walk(x);
};
const states = [];
for (let cf = 1; cf <= 9; cf++) {
  for (const tab of C.TABS) {
    states.push({ chaos: cf, ui: { tab, odds: "likely" }, log: LOG, lists, actions1: { linked: cf % 2 === 0, name: "T1" }, query: cf > 5 ? "zzz" : "" });
  }
}
states.push({ chaos: 5, ui: {}, log: [], lists: LI.normalizeLists({}) });
// Every entry once as the newest, which is the only place notes and flags draw.
LOG.forEach((e, i) => states.push({ chaos: 5, ui: { tab: "ask" }, log: [e, ...LOG.filter((_, j) => j !== i)], lists, fresh: e.id }));
for (const s of states) {
  const m = M.panelModel(s);
  walk(m);
  RE.panelHTML(m, t);
}
for (const e of LOG) RE.chatHTML(M.entryView(e), t);
for (const k of refs) ok(has(k), `model ref ${k} resolves`);
// The families built at runtime, member by member.
const families = {
  "GLMYTHIC.verdict": R.VERDICTS,
  "GLMYTHIC.odds": R.ODDS.map((o) => o.id),
  "GLMYTHIC.focus": R.EVENT_FOCUS.map((f) => f.key),
  "GLMYTHIC.scene.result": ["expected", "altered", "interrupted"],
  "GLMYTHIC.adjust": R.SCENE_ADJUSTMENTS.map((a) => a.key),
  "GLMYTHIC.category": [...new Set(Object.values(CAT.CATEGORY_SLUGS))],
  "GLMYTHIC.tab": C.TABS,
  "GLMYTHIC.list": C.LISTS,
  "GLMYTHIC.list.add": C.LISTS,
  "GLMYTHIC.list.empty": C.LISTS,
  "GLMYTHIC.meaning.table": CAT.CORE_MEANING,
  "GLMYTHIC.cf.tier": ["calm", "steady", "wild"],
};
for (const [fam, members] of Object.entries(families)) for (const m of members) ok(has(`${fam}.${m}`), `i18n family ${fam}.${m}`);
const SOURCES = ["app.mjs", "chat.mjs", "main.mjs", "index.mjs", "model.mjs", "render.mjs"].map((f) => [f, read(`${FEAT}/${f}`)]);
for (const [f, src] of SOURCES) {
  for (const [, key] of src.matchAll(/["'`](GLMYTHIC\.[A-Za-z0-9.-]+[A-Za-z0-9])["'`]/g)) ok(has(key), `${f}: literal key ${key}`);
  for (const [, fam] of src.matchAll(/`(GLMYTHIC\.[A-Za-z0-9.-]+)\.\$\{/g)) ok(fam in families, `${f}: runtime family ${fam} is pinned here`);
}

/* ── 10. settings: read vs registered ────────────────────────────────────── */

const MAIN = read(`${FEAT}/main.mjs`);
const registered = new Map();
for (const [, name, body] of MAIN.matchAll(/game\.settings\.register\(SUITE_ID, SETTINGS\.(\w+), \{([\s\S]*?)\n  \}\);/g)) {
  registered.set(name, /scope: "(\w+)"/.exec(body)?.[1]);
}
for (const [name, key] of Object.entries(C.SETTINGS)) {
  ok(key.startsWith("mythic."), `setting ${key} carries the mythic. prefix`);
  ok(registered.has(name), `setting ${key} is registered`);
}
for (const name of registered.keys()) ok(name in C.SETTINGS, `registered SETTINGS.${name} is a known key`);
for (const name of ["log", "lists", "ui", "panelPos"]) ok(registered.get(name) === "client", `${C.SETTINGS[name]} stays in this browser (client scope)`);
for (const name of ["chaos", "autoEvent", "actions1"]) ok(registered.get(name) === "world", `${C.SETTINGS[name]} is world scope`);
eq(
  Object.values(C.SETTINGS).filter((k) => ["mythic.chaos", "mythic.log", "mythic.panelPos", "mythic.autoEvent"].includes(k)).length,
  4,
  "the pre-remake keys are unchanged"
);
for (const f of ["app.mjs", "chat.mjs", "main.mjs", "index.mjs", "session.mjs", "store.mjs"]) {
  const src = read(`${FEAT}/${f}`);
  for (const [, name] of src.matchAll(/SETTINGS\.(\w+)/g)) ok(name in C.SETTINGS, `${f}: SETTINGS.${name} exists`);
  ok(!/game\.settings\.(get|set)\(\s*SUITE_ID\s*,\s*["'`]/.test(src), `${f}: no setting key written as a literal`);
  if (f !== "store.mjs" && f !== "main.mjs" && f !== "app.mjs") ok(!/game\.settings\.set/.test(src), `${f}: writes settings only through store.mjs`);
}
ok(!/game\.settings\.set\(SUITE_ID, SETTINGS\.(?!panelPos)/.test(read(`${FEAT}/app.mjs`)), "app.mjs writes no setting but its own position");
ok(read("module.json").includes('"styles/mythic-gme.css"') && read("module.json").includes('"lang/mythic-gme.en.json"'), "module.json ships the sheet and the language file");

/* ── 11. every data-action has a handler, and the other way round ────────── */

const RENDER = read(`${FEAT}/render.mjs`);
const APP = read(`${FEAT}/app.mjs`);
const drawn = new Set([...RENDER.matchAll(/data-action="(\w+)"/g)].map((m) => m[1]));
const actionsBlock = /actions:\s*\{([\s\S]*?)\n    \},/.exec(APP)?.[1] ?? "";
const handled = new Map([...actionsBlock.matchAll(/(\w+):\s*MythicPanel\.prototype\.(\w+)/g)].map((m) => [m[1], m[2]]));
for (const a of drawn) ok(handled.has(a), `data-action "${a}" has a handler`);
for (const [a, fn] of handled) {
  ok(drawn.has(a), `action "${a}" is drawn somewhere`);
  ok(new RegExp(`\\n  (async )?${fn}\\(`).test(APP), `handler ${fn} is defined`);
}
{
  // Every action the markup carries lands in the rendered panel.
  const html = RE.panelHTML(M.panelModel(states[3]), t);
  for (const a of drawn) ok(html.includes(`data-action="${a}"`) || ["unlinkActions"].includes(a), `rendered panel draws data-action "${a}"`);
}

/* ── 12. purity and privacy ──────────────────────────────────────────────── */

const PURE = ["constants.mjs", "rules.mjs", "catalog.mjs", "oracle.mjs", "lists.mjs", "model.mjs", "render.mjs"];
for (const f of PURE) {
  const src = read(`${FEAT}/${f}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const [, from] of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    ok(from.startsWith("./") || from === "../../core/util.mjs", `${f} imports only pure modules (${from})`);
  }
  ok(!/(?<![.\w$])(game|foundry|canvas|Hooks|ui|document|window|ChatMessage)\s*[.?[]/.test(src), `${f} reaches no world or DOM`);
}
for (const f of ["store.mjs", "session.mjs", "chat.mjs", "main.mjs", "index.mjs"]) {
  ok(!/^const\s+\{[^}]*\}\s*=\s*foundry\./m.test(read(`${FEAT}/${f}`)), `${f} reads foundry only at call time`);
}
for (const f of ["index.mjs", "main.mjs"]) ok(!/import\s+[^;]*from\s+["']\.\/app\.mjs["']/.test(read(`${FEAT}/${f}`)), `${f} loads app.mjs lazily`);
{
  const all = ["app.mjs", "chat.mjs", "main.mjs", "index.mjs", "session.mjs", "store.mjs", ...PURE].map((f) => read(`${FEAT}/${f}`)).join("\n");
  ok(!/game\.socket|emitSocket|onSocket/.test(all), "Mythic GME opens no socket: rolls never leave this client");
  ok((all.match(/ChatMessage\.create/g) ?? []).length === 1 && read(`${FEAT}/chat.mjs`).includes("ChatMessage.create"), "chat.mjs is the only road to chat");
  const CHAT = read(`${FEAT}/chat.mjs`);
  ok(/isConfiguredStreamUser/.test(CHAT) && /!isStreamLogin\(u\)/.test(CHAT), "a GM whisper leaves the stream login off");
  ok(/if \(audience !== "table"\) data\.whisper = whisperRecipients\(\)/.test(CHAT), "anything but an explicit table post is a whisper");
  ok(/if \(!entry \|\| !game\.user\.isGM\) return null/.test(CHAT), "only a GM posts a card");
  ok(/static open\(\)\s*\{\s*if \(!game\.user\.isGM\) return null;/.test(APP), "the panel opens for a GM only");
  ok(/if \(!canWriteWorld\(\)\) return Promise\.resolve\(getChaos\(\)\)/.test(read(`${FEAT}/store.mjs`)), "a player's setChaos writes nothing");
}
{
  // Words from tables and names the GM typed are escaped on the way into markup.
  const evil = '<img src=x onerror="alert(1)">';
  const l = LI.normalizeLists({ characters: [evil] });
  const e = stamp(O.listEntry("characters", l.characters, seeded(1)), 99);
  const q = stamp(O.askFate({ oddsId: "likely", cf: 5, question: evil, rng: scripted([50], [100]) }), 98);
  const html = RE.panelHTML(M.panelModel({ chaos: 5, ui: { tab: "lists" }, log: [e, q], lists: l }), t) + RE.chatHTML(M.entryView(e), t) + RE.chatHTML(M.entryView(q), t);
  ok(!html.includes("<img"), "list names and questions are escaped");
}

/* ── 13. the stylesheet ──────────────────────────────────────────────────── */

const CSS = read("styles/mythic-gme.css");
const TOKENS = read("styles/gl-tokens.css");
const cssBody = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
ok(!/:root/.test(cssBody), "the sheet writes nothing on :root");
ok(!/^\s*--gl-[\w-]+\s*:/m.test(cssBody), "the sheet declares no foundation --gl-* token");
ok(!/@font-face|@import/.test(cssBody), "no @font-face or @import");
ok(!/prefers-reduced-motion/.test(cssBody), "no OS reduced-motion query");
ok(!/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(cssBody), "no raw white veil");
ok(!/backdrop-filter/.test(cssBody) || /blur\(calc\([^)]*--gl-glass-k|blur\(var\(--gl-blur/.test(cssBody), "any backdrop blur follows the glass tier");
for (const [, name] of cssBody.matchAll(/@keyframes\s+([\w-]+)/g)) ok(name.startsWith("gmyth-"), `keyframes ${name} is prefixed gmyth-`);
for (const [, name] of cssBody.matchAll(/animation(?:-name)?:\s*([\w-]+)/g)) ok(name.startsWith("gmyth-") || name === "none", `animation ${name} is one of the feature's`);
for (const m of cssBody.matchAll(/(?:transition|animation)[\w-]*\s*:([^;]+);/g)) {
  const value = m[1].replace(/var\(--[\w-]+\)/g, "");
  ok(!/\b\d+(\.\d+)?m?s\b/.test(value), `raw duration in "${m[0].trim().slice(0, 60)}"`);
  ok(!/cubic-bezier|steps\(|\bease(-in|-out|-in-out)?\b|\blinear\b/.test(value), `raw easing in "${m[0].trim().slice(0, 60)}"`);
}
for (const [, tok] of cssBody.matchAll(/var\((--gl-[\w-]+)/g)) ok(new RegExp(`${tok}\\s*:`).test(TOKENS), `${tok} is a real token`);
const declared = new Set([...cssBody.matchAll(/(--gmyth-[\w-]+)\s*:/g)].map((m) => m[1]));
for (const [, tok] of cssBody.matchAll(/var\((--gmyth-[\w-]+)/g)) ok(declared.has(tok), `${tok} is declared`);
{
  // Every rule sits under one of the feature's roots.
  const selectors = cssBody.replace(/@keyframes[\s\S]*?\n\}/g, "").match(/[^{}]+(?=\{)/g) ?? [];
  for (const sel of selectors) {
    for (const part of sel.split(/,(?![^(]*\))/)) {
      const s = part.trim();
      if (!s) continue;
      ok(/^(:is\(\.gmyth|\.gmyth-|\.application\.gmyth|#gmyth-panel|:where\(\.gmyth)/.test(s), `selector under a feature root: ${s}`);
    }
  }
}
{
  // Classes the markup draws are styled; classes the sheet styles are drawn.
  const html = states.map((s) => RE.panelHTML(M.panelModel(s), t)).join("") + LOG.map((e) => RE.chatHTML(M.entryView(e), t)).join("");
  const drawnClasses = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith("gmyth-")));
  const styled = new Set([...cssBody.matchAll(/\.(gmyth-[\w-]+)/g)].map((m) => m[1]));
  const app = new Set(["gmyth-panel"]);
  for (const c of drawnClasses) ok(styled.has(c) || ["gmyth-sr"].includes(c), `class ${c} is styled`);
  for (const c of styled) ok(drawnClasses.has(c) || app.has(c), `styled class ${c} is drawn`);
}

/* ── done ───────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.log(`mythic-gme-check: ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log("mythic-gme-check: 0 problems");
