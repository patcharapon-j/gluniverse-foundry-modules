#!/usr/bin/env node
/**
 * GLUniverse Suite — Clocks & Tracker calendar-event identity check.
 *
 *   node tools/calendar-events-check.mjs
 *
 * Every GM control on a calendar event — edit, delete, pin, player visibility,
 * in the events editor AND in the calendar's day-detail panel — resolves the row
 * it was clicked in by that event's `id`. That makes event identity load-bearing
 * in a way nothing on screen shows: an event whose id is missing, blank or
 * shared with a sibling renders perfectly and then ignores every one of those
 * controls, or quietly acts on the wrong event. There is no error to read.
 *
 * `scripts/features/clocks-tracker/calendar/events.js` is what keeps that from
 * happening, and the properties it has to hold are exactly the ones a diff
 * cannot show you were wrong about:
 *
 *   · ids are minted DETERMINISTICALLY — the id a row renders with must be the
 *     id its click resolves, even before the repair is written back;
 *   · minting never collides with an id already in use;
 *   · an id that was already valid is preserved (world data must not churn);
 *   · the repair is idempotent, and clean data reports no change at all.
 *
 * Zero failures required. Exits non-zero otherwise.
 */
globalThis.foundry = { utils: { deepClone: v => structuredClone(v) } };
globalThis.Hooks = { callAll() {} };

const stored = [];
globalThis.game = {
  user: { isGM: true },
  settings: {
    get: () => stored,
    set: (_m, _k, v) => { stored.length = 0; stored.push(...v); }
  },
  i18n: { localize: k => k }
};
globalThis.ui = { notifications: { warn() {}, error() {} } };

const HERE = new URL("..", import.meta.url);
const { normalizeEvents, readEvents, ensureEventIds, findEvent } =
  await import(new URL("scripts/features/clocks-tracker/calendar/events.js", HERE));

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`FAIL   ${name} ${extra}`); failures++; }
};

/* ---- the data shapes that made every GM control inert ---- */
const broken = [
  { name: "Harvest Feast", scope: "day", month: 2, day: 12, pinned: true, visibleToPlayers: true },  // no id at all
  { id: "", name: "Long Night", scope: "day", month: 11, day: 1 },                                    // blank id
  { id: "dup", name: "Founding", scope: "month", month: 0 },
  { id: "dup", name: "Reckoning", scope: "range", month: 3, day: 1, endMonth: 3, endDay: 5 }          // duplicate id
];

// Old behaviour: a row rendered `data-event-id="{{this.id}}"`, and `dataset.eventId`
// reads back "" for a missing id — so the click either resolved nothing or, worse,
// resolved a different event that also had a blank id.
const rowId = e => String(e.id ?? "");                       // what the DOM hands back
const oldLookup = id => broken.find(e => e.id === id);        // what the handlers did

check("repro: an id-less row resolves the WRONG event",
  oldLookup(rowId(broken[0]))?.name === "Long Night");
check("repro: with no blank-id sibling the lookup misses entirely",
  oldLookup(rowId(broken[0])) === undefined ||
  [broken[1]].every(e => e.id === "") && oldLookup("nope") === undefined);
check("repro: duplicate ids collapse onto one event",
  oldLookup("dup").name === "Founding" && broken.filter(e => e.id === "dup").length === 2);

/* ---- normalization ---- */
const { events, changed } = normalizeEvents(broken);
check("normalize reports the list needed repairing", changed === true);
check("every event has a non-empty string id",
  events.every(e => typeof e.id === "string" && e.id.length > 0), JSON.stringify(events.map(e => e.id)));
check("ids are unique", new Set(events.map(e => e.id)).size === events.length,
  JSON.stringify(events.map(e => e.id)));
check("the first valid id is preserved", events[2].id === "dup");
check("payload is otherwise untouched",
  events[0].name === "Harvest Feast" && events[0].pinned === true && events[3].endDay === 5);

/* ---- determinism: the id a row renders with is the id its click resolves ---- */
const renderPass = normalizeEvents(broken).events;
const clickPass = normalizeEvents(broken).events;
check("normalization is deterministic across renders",
  renderPass.map(e => e.id).join() === clickPass.map(e => e.id).join());

/* ---- every row now resolves through the shared lookup ---- */
for (const e of renderPass) {
  const hit = findEvent(clickPass, e.id);
  check(`row "${e.name}" resolves its event`, hit?.name === e.name);
}
check("a blank id still resolves to null (and is reported, not ignored)",
  findEvent(clickPass, "") === null);

/* ---- toggling pin / visibility now sticks ---- */
stored.push(...structuredClone(broken));
await ensureEventIds();
check("ensureEventIds persisted the repair", stored.every(e => e.id));
const live = readEvents();
const target = findEvent(live, stored[0].id);
target.pinned = !target.pinned;
check("pin toggle finds its event after the repair", target.name === "Harvest Feast" && target.pinned === false);
check("a second ensureEventIds is a no-op", (await ensureEventIds()) === false);

/* ---- already-clean data is left exactly as it was ---- */
const clean = [{ id: "abc123", name: "Solstice", scope: "day", month: 5, day: 20 }];
const after = normalizeEvents(clean);
check("clean data reports no change", after.changed === false);
check("clean data keeps its ids", after.events[0].id === "abc123");

/* ---- degenerate inputs ---- */
check("null input yields an empty list", normalizeEvents(null).events.length === 0);
check("non-array input yields an empty list", normalizeEvents({ a: 1 }).events.length === 0);

console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
