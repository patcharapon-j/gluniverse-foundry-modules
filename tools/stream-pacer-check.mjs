#!/usr/bin/env node
/**
 * GLUniverse Suite — Stream Pacer check.
 *
 *   node tools/stream-pacer-check.mjs
 *
 * Almost everything in Stream Pacer fails silently, and two parts of it fail on
 * somebody else's screen: a safety signal that reaches the capture login is on
 * the recording, and a call that never reaches a player who is away from the tab
 * is the exact problem the feature exists to solve. This drives the shipped
 * model and renderer under plain Node and reads the rest:
 *
 *   · The exemption form's four sites agree on each column (registration, save
 *     branch, form context, `name=`); the hint still says a safety exemption is
 *     for capture logins and that it removes a real person's means of signalling
 *     distress.
 *   · The whole safety tool is one object, `SafetyDesk`, constructed only inside
 *     `if (!isSafetySurfaceExempt)`. Without one, the snapshot says `show: false`,
 *     and this check proves that a `show: false` snapshot produces no safety
 *     lane, no check-in, no lamp, no light on any row, no safety cue and no red
 *     frame. Recipient lists are read live and leave exempt users out.
 *   · model.js, render.js and const.js are pure; band.js and hud.js reach no
 *     `game` (the preview page drives all five as shipped).
 *   · Every i18n key a lane, a HUD, a notification or a template can produce
 *     resolves, including the runtime-built families.
 *   · Every cue the model or controller can play has a file on disk.
 *   · The arrivals: a late join is quiet, a hand sounds once, a reconnect with a
 *     hand still up does not, a bars-exempt capture login still gets the Dire
 *     Peril splash, an answer counts as the call having arrived.
 *   · The Dire Peril splash: every stage beat shares --sp-peril-stage, which
 *     playPerilSplash writes from TIMING.perilStage and unmounts at; every class
 *     it draws is styled and every --sp-peril-* it reads is declared; it is set
 *     in --sp-font; its WebGL field is a Surfaces context bound to SHED_ORDER and
 *     built only for a client that can see the splash.
 *   · The stylesheet keeps the design system's rules: prefixed keyframes, no raw
 *     durations, no OS reduced-motion query, no `:root`, no white veils.
 *
 * What it cannot do is prove the rendered result or the socket round trip: the
 * preview (`node tools/pacer-preview.mjs`, served) shows the first, and only a
 * session with a second login shows the second.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const DIR = "scripts/features/stream-pacer";
const load = (f) => import(pathToFileURL(join(ROOT, DIR, f)).href);

const C = await load("const.js");
const M = await load("model.js");
const R = await load("render.js");

const SRC = Object.fromEntries(
  ["const.js", "model.js", "render.js", "band.js", "hud.js", "peril-field.js", "alerts.js", "safety.js", "settings.js", "module.js", "index.mjs"]
    .map((f) => [f, read(`${DIR}/${f}`)])
);
const FORM = read("templates/stream-pacer/exempt-users.hbs");
const PERIL_FORM = read("templates/stream-pacer/peril-text.hbs");
const CSS = read("styles/stream-pacer.css");
const LANG = JSON.parse(read("lang/stream-pacer.en.json"));

const problems = [];
const fail = (msg) => problems.push(msg);
let checks = 0;
const expect = (ok, msg) => { checks++; if (!ok) fail(msg); };

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`])\/\/.*$/gm, "$1");
const stripStrings = (src) => src.replace(/`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''");

function blockAfter(src, from) {
  const open = src.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return "";
}
function bodyOf(src, name) {
  const at = src.search(new RegExp(`(^|\\s)${name}\\s*\\(`, "m"));
  return at === -1 ? null : blockAfter(src, at);
}

const resolveKey = (key) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), LANG);
const localizes = (key) => typeof resolveKey(key) === "string";
/** Same rules as the preview: unknown placeholders survive, which this check also catches. */
const L = (key, data) => {
  const v = resolveKey(key);
  if (typeof v !== "string") return key;
  return data ? v.replace(/\{(\w+)\}/g, (_, k) => (k in data ? data[k] : `{${k}}`)) : v;
};

/* ── 1. The three exemption columns: four sites must agree ────────────── */

const SETTINGS = SRC["settings.js"];
const COLUMNS = [
  { prefix: "bars", setting: "sp.exemptUsers", ctx: "isExempt", column: "ExemptBarsColumn" },
  { prefix: "peril", setting: "sp.perilExemptUsers", ctx: "isPerilExempt", column: "ExemptPerilColumn" },
  { prefix: "safety", setting: "sp.safetyExemptUsers", ctx: "isSafetyExempt", column: "ExemptSafetyColumn" }
];
const registrationOf = (key) => SETTINGS.indexOf(`register(MODULE_ID, '${key}'`);
const saveBody = bodyOf(stripComments(SETTINGS), "saveExemptUsers");
expect(!!saveBody, "settings.js: saveExemptUsers() not found.");
const formCtxBody = (() => {
  const at = SETTINGS.indexOf("class ExemptUsersConfig");
  return at === -1 ? null : bodyOf(stripComments(SETTINGS.slice(at)), "_prepareContext");
})();
expect(!!formCtxBody, "settings.js: ExemptUsersConfig._prepareContext() not found.");

for (const col of COLUMNS) {
  const reg = registrationOf(col.setting);
  expect(reg !== -1, `settings.js never registers '${col.setting}'.`);
  if (reg !== -1) {
    const block = blockAfter(SETTINGS, reg);
    for (const [label, re] of [["scope: 'world'", /scope:\s*'world'/], ["config: false", /config:\s*false/], ["type: Array", /type:\s*Array/], ["default: []", /default:\s*\[\s*\]/]]) {
      expect(re.test(block), `'${col.setting}' is not registered with ${label}.`);
    }
  }
  expect(saveBody?.includes(`startsWith('${col.prefix}-')`), `saveExemptUsers() has no "${col.prefix}-" branch, so that column submits and stores nothing.`);
  expect(saveBody?.includes(`'${col.setting}'`), `saveExemptUsers() never writes '${col.setting}'.`);
  expect(formCtxBody && new RegExp(`\\b${col.ctx}\\s*:`).test(formCtxBody), `ExemptUsersConfig._prepareContext() never emits "${col.ctx}", so that column always renders unticked.`);
  expect(FORM.includes(`name="${col.prefix}-{{id}}"`), `exempt-users.hbs has no <input name="${col.prefix}-{{id}}">.`);
  expect(new RegExp(`\\{\\{#if ${col.ctx}\\}\\}checked`).test(FORM), `exempt-users.hbs never checks "${col.ctx}", so an existing exemption un-ticks itself on save.`);
  expect(FORM.includes(`STREAM_PACER.Settings.${col.column}`), `exempt-users.hbs has no header cell for STREAM_PACER.Settings.${col.column}.`);
}
const declared = new Set(COLUMNS.map((c) => c.prefix));
for (const m of FORM.matchAll(/name="([a-z]+)-\{\{id\}\}"/g)) expect(declared.has(m[1]), `exempt-users.hbs offers a "${m[1]}-" column this check does not know about.`);
for (const m of (saveBody ?? "").matchAll(/startsWith\('([a-z]+)-'\)/g)) expect(declared.has(m[1]), `saveExemptUsers() reads a "${m[1]}-" prefix this check does not know about.`);

for (const key of ["Settings.ExemptUsersHint", "Settings.SafetyExemptUsersHint"]) {
  const t = resolveKey(`STREAM_PACER.${key}`);
  expect(typeof t === "string", `lang is missing STREAM_PACER.${key}.`);
  if (typeof t !== "string") continue;
  expect(/capture/i.test(t), `${key} no longer says the safety exemption is meant for capture logins.`);
  expect(/distress/i.test(t), `${key} no longer warns that exempting a real person removes their means of signalling distress.`);
}

/* ── 2. The safety gate ────────────────────────────────────────────────── */

const MODULE = stripComments(SRC["module.js"]);
const gates = [...MODULE.matchAll(/if\s*\(\s*!\s*isSafetySurfaceExempt\s*\)/g)].map((m) => blockAfter(MODULE, m.index));
expect(gates.length >= 1, "module.js has no `if (!isSafetySurfaceExempt)` gate.");
expect(/isSafetySurfaceExempt\s*=\s*captureLocalSafetyExemption\(\)/.test(MODULE), "module.js must take isSafetySurfaceExempt from captureLocalSafetyExemption().");
const desks = MODULE.split("new SafetyDesk(").length - 1;
expect(desks >= 1, "module.js never constructs a SafetyDesk: the safety tool is gone, or this check is stale.");
expect(gates.filter((g) => g.includes("new SafetyDesk(")).length === desks, `module.js constructs SafetyDesk ${desks}× but not every one is inside the gate.`);
for (const f of ["band.js", "hud.js", "render.js", "model.js", "alerts.js"]) {
  expect(!SRC[f].includes("new SafetyDesk("), `${f} constructs a SafetyDesk of its own, outside the gate.`);
}
expect(/safety:\s*this\.desk\s*\?\s*this\.desk\.snapshot\(\)\s*:\s*\{\s*show:\s*false\s*\}/.test(MODULE), "The snapshot must read `safety: this.desk ? this.desk.snapshot() : { show: false }` so a client without a desk shows nothing.");

// liveness: per-user questions are read per call; the local one is a snapshot
const liveBody = bodyOf(stripComments(SETTINGS), "export function isSafetyExempt");
expect(liveBody?.includes("game.settings.get"), "isSafetyExempt() must read the setting on each call, or a GM connected before the list changed keeps sending lights to a capture login.");
expect(/export function captureLocalSafetyExemption/.test(SETTINGS) && /export function isLocallySafetyExempt/.test(SETTINGS), "settings.js must export captureLocalSafetyExemption() and isLocallySafetyExempt().");

// recipients: safety messages go only to non-exempt users, read live
const safeGMs = bodyOf(MODULE, "function safeGMs");
expect(safeGMs?.includes("isSafetyExempt("), "safeGMs() must leave safety-exempt GMs out of every light's recipients.");
const gateSrc = gates.join("\n");
expect(/playerRecipients:[^\n]*isSafetyExempt\(/.test(gateSrc), "playerRecipients must leave safety-exempt players out of a check-in.");
expect(/gmRecipients:\s*\(\)\s*=>\s*safeGMs\(\)/.test(gateSrc), "gmRecipients must be safeGMs(), read per message.");
const SAFETY = stripComments(SRC["safety.js"]);
for (const name of ["announce", "startAsk", "endAsk", "replyHello"]) {
  const b = bodyOf(SAFETY, name);
  expect(b && /this\.o\.emit\([^)]*,\s*(to|\[|\[userId\])/.test(b), `SafetyDesk.${name}() must emit with an explicit recipient list.`);
}
expect(/this\.o\.isExempt\(sender\)/.test(SAFETY), "SafetyDesk.receive() must refuse a light from a safety-exempt sender.");

// reaching a player who is not looking: a hidden tab gets no animation frames,
// and joining or leaving raises userConnected, never updateUser
const refreshBody = bodyOf(MODULE, "refresh") ?? "";
expect(/requestAnimationFrame/.test(refreshBody) && /setTimeout/.test(refreshBody), "refresh() must not wait on requestAnimationFrame alone: a backgrounded tab never gets one, so its arrivals (the sound, the title flash, the notification) wait until the player comes back.");
expect(/Hooks\.on\('userConnected'/.test(MODULE), "module.js must listen to userConnected: a GM joining or the last GM leaving is not an updateUser change.");
expect(!/'active' in changes/.test(MODULE), "module.js reads `active` off an updateUser diff, which never carries it.");

/* ── 3. Purity ─────────────────────────────────────────────────────────── */

const WORLD = /\b(game|canvas|foundry|Hooks)\b|\bui\./;
for (const f of ["const.js", "model.js", "render.js"]) {
  const code = stripStrings(stripComments(SRC[f]));
  expect(!WORLD.test(code), `${f} reaches the world (${code.match(WORLD)?.[0]}); it must stay pure so the check and the preview drive it as shipped.`);
  expect(!/\bdocument\b|\bwindow\b/.test(code), `${f} touches the DOM; markup leaves render.js as a string.`);
}
for (const f of ["band.js", "hud.js", "peril-field.js"]) {
  const code = stripStrings(stripComments(SRC[f]));
  expect(!/\b(game|canvas|Hooks)\b|\bui\./.test(code), `${f} reaches the world; the preview page drives it as shipped.`);
  expect(!/duration:\s*\d/.test(code), `${f} has a literal duration; every one comes from MOTION/TIMING through motionDuration().`);
}
expect(!/\bgame\b|\bHooks\b/.test(stripStrings(stripComments(SRC["index.mjs"])).replace(/onInit[\s\S]*$/, "")), "index.mjs must not touch the world at import time.");

/* ── 4. Fixtures, driven through the shipped model ─────────────────────── */

const T0 = 10_000_000;
const people = [
  { id: "gm", name: "Gem", isGM: true, active: true, color: "#ffffff" },
  { id: "a", name: "Ash", active: true, color: "#3fb8a9" },
  { id: "b", name: "Bea", active: true, color: "#4f8df0" },
  { id: "c", name: "Cy", active: true, color: "#f2b53a" },
  { id: "d", name: "Dee", active: false, color: "#b06cff" },
  { id: "cap", name: "Capture", active: true, color: "#888888", exempt: { bars: true, peril: false, safety: true } }
];
const snap = (o = {}) => M.normalizeSnapshot({
  now: T0, me: { id: "gm", isGM: true }, spotlight: { marks: { a: 2, b: 0, c: 4 } }, presence: {},
  safety: { show: true, lights: {} },
  ...o,
  users: people.map((u) => ({ ...u, pacer: o.flags?.[u.id] ?? null }))
});
const hand = (at) => ({ status: "hand", at });
const hold = (at) => ({ status: "hold", at });

const FIXTURES = {
  gmEverything: snap({
    flags: { a: hand(T0 - 5000), b: hand(T0 - 3000), c: hold(T0 - 1000) },
    call: { id: "cd", kind: "countdown", at: T0 - 50000, ends: T0 + 8000 },
    mood: { id: "pr", kind: "peril", at: T0 - 1000 },
    presence: { b: "away", c: "idle" },
    safety: { show: true, lights: { a: { light: "red" }, b: { light: "yellow" } }, ask: { id: "k1", at: T0 } }
  }),
  gmExpired: snap({ call: { id: "cd2", kind: "countdown", at: T0 - 60000, ends: T0 - 1 } }),
  gmWrapNamed: snap({ call: { id: "w", kind: "wrap", at: T0, targets: ["a"] }, mood: { id: "cf", kind: "campfire", at: T0 } }),
  gmReadyAll: snap({
    call: { id: "r", kind: "ready", at: T0 },
    flags: Object.fromEntries(["a", "b", "c"].map((id) => [id, { status: "engaged", answer: { call: "r", value: "ready" } }]))
  }),
  gmReadySome: snap({ call: { id: "r", kind: "ready", at: T0 }, flags: { a: { answer: { call: "r", value: "wait" } } } }),
  gmHolds: snap({ flags: { c: hold(T0) } }),
  gmSafetyAcked: snap({ safety: { show: true, lights: { a: { light: "yellow" } }, seen: "a:yellow" } }),
  playerTargeted: snap({ me: { id: "a", isGM: false }, flags: { a: hand(T0) }, call: { id: "w", kind: "wrap", at: T0, targets: ["a"] }, safety: { show: true, ask: { id: "k", at: T0 }, mine: "yellow" } }),
  playerHold: snap({ me: { id: "b", isGM: false }, flags: { b: hold(T0) }, call: { id: "r", kind: "ready", at: T0 }, mood: { id: "cf", kind: "campfire", at: T0 } }),
  playerBystander: snap({ me: { id: "b", isGM: false }, call: { id: "cd", kind: "countdown", at: T0, ends: T0 + 60000, targets: ["a"] }, mood: { id: "pr", kind: "peril", at: T0 } }),
  capture: snap({ me: { id: "cap", isGM: false }, call: { id: "w", kind: "wrap", at: T0 }, mood: { id: "pr", kind: "peril", at: T0 }, safety: { show: false } })
};

const allLanes = Object.values(FIXTURES).flatMap((s) => M.lanes(s));
const allHuds = Object.values(FIXTURES).map((s) => M.hudModel(s, { desktop: "off" }));

// normalizeSnapshot is idempotent: lanes() normalizes again on every call
for (const [name, s] of Object.entries(FIXTURES)) {
  expect(JSON.stringify(M.normalizeSnapshot(s)) === JSON.stringify(s), `normalizeSnapshot is not idempotent on fixture "${name}".`);
}

// lane order
for (const [name, s] of Object.entries(FIXTURES)) {
  const order = M.lanes(s).map((l) => C.LANE_ORDER.indexOf(l.kind));
  expect(order.every((v, i) => v >= 0 && (i === 0 || v >= order[i - 1])), `fixture "${name}": lanes out of LANE_ORDER (${M.lanes(s).map((l) => l.kind).join(", ")}).`);
  const keys = M.lanes(s).map((l) => l.key);
  expect(new Set(keys).size === keys.length, `fixture "${name}": two lanes share a key, so the band would keep one and drop the other.`);
}

// the capture login: bars-exempt draws nothing, and no safety at all
expect(M.lanes(FIXTURES.capture).length === 0, "A bars-exempt viewer must get no lanes.");

/* ── 5. safety.show = false is silent everywhere ───────────────────────── */

const unsafe = (s) => M.normalizeSnapshot({ ...s, safety: { show: false, lights: s.safety.lights, ask: s.safety.ask, mine: s.safety.mine } });
for (const [name, s] of Object.entries(FIXTURES)) {
  const off = unsafe(s);
  const lanes = M.lanes(off);
  expect(!lanes.some((l) => l.kind === "safety" || l.kind === "checkin"), `fixture "${name}": a client with no safety desk still gets a safety or check-in lane.`);
  expect(!lanes.some((l) => l.actions.some((a) => a.light || a.id === "safety-seen" || a.id === "end-ask")), `fixture "${name}": a client with no safety desk still gets a safety control.`);
  const hud = M.hudModel(off);
  expect(!hud.showSafety, `fixture "${name}": hudModel says showSafety with no desk.`);
  expect(!(hud.rows ?? []).some((r) => r.light), `fixture "${name}": a HUD row carries a safety light with no desk.`);
  const html = R.hudHTML(hud, L);
  expect(!/sp-lamp|sp-light-|data-sp-action="(ask|end-ask|light)"/.test(html), `fixture "${name}": the HUD markup draws a lamp, a light or a check-in control with no desk.`);
  const arr = M.arrivals(null, off, new Set());
  const arr2 = M.arrivals(M.normalizeSnapshot({ ...off, safety: { show: false } }), off, new Set());
  for (const a of [arr, arr2]) {
    expect(!a.sounds.some((c) => c === "red" || c === "yellow" || c === "checkin"), `fixture "${name}": a safety cue plays with no desk.`);
  }
}
expect(SRC["band.js"].includes("l.kind === 'safety' && l.tone === 'red' && l.urgent"), "band.js must raise the red frame only from a safety lane, which only a desk can produce.");

// the GM's board ignores exempt users, and the check-in roster does not count them
const exemptLight = snap({ safety: { show: true, lights: { cap: { light: "red" } }, ask: { id: "k", at: T0 } } });
expect(!M.raisedLights(exemptLight).length, "raisedLights() counts a safety-exempt user's light.");
expect(!M.checkinRoster(exemptLight).rows.some((r) => r.user.id === "cap"), "checkinRoster() counts a safety-exempt user, so no check-in can ever complete.");
expect(!M.checkinRoster(exemptLight).rows.some((r) => r.user.id === "d"), "checkinRoster() counts an offline user.");

/* ── 6. Every i18n key resolves, including the runtime-built ones ──────── */

const used = new Set();
const walkRef = (ref) => { if (ref && typeof ref === "object" && "k" in ref) used.add(ref.k); };
for (const l of allLanes) {
  [l.label, l.title, l.count, ...l.ticker].forEach(walkRef);
  for (const a of l.actions) used.add(a.k);
  for (const p of l.people) used.add(`STREAM_PACER.State.${p.state}`);
  if (l.kind === "call") used.add(`STREAM_PACER.Band.Call.${l.call}`);
}
for (const s of Object.values(FIXTURES)) {
  for (const p of [null, M.normalizeSnapshot({ ...s, users: s.users.map((u) => ({ ...u, pacer: null })), call: null, mood: null, safety: { ...s.safety, ask: null, lights: {} } })]) {
    for (const n of M.arrivals(p, s, new Set()).notify) walkRef(n);
  }
}
// the families built at runtime, enumerated from the constants that build them
for (const v of Object.values(C.REACH)) used.add(`STREAM_PACER.State.${v}`);
for (const v of Object.values(C.PRESENCE)) used.add(`STREAM_PACER.State.${v}`);
for (const v of ["ready", "wait", "hand", "hold", "pending", "offline", ...Object.values(C.LIGHT)]) used.add(`STREAM_PACER.State.${v}`);
for (const v of Object.values(C.LIGHT)) { used.add(`STREAM_PACER.Light.${v}`); used.add(`STREAM_PACER.Band.SafetyLight.${v}`); }
for (const v of Object.values(C.STATUS)) used.add(`STREAM_PACER.Status.${v}`);
for (const v of Object.values(C.CALL)) { used.add(`STREAM_PACER.Band.Call.${v}`); used.add(`STREAM_PACER.Notify.${v}`); }
for (const v of Object.values(C.MOOD)) used.add(`STREAM_PACER.Notify.${v}`);
for (const v of ["checkin", "hand", "yellow", "red", "timeup", "nudge", "Body"]) used.add(`STREAM_PACER.Notify.${v}`);
// every literal key in the feature's code and templates
for (const [f, src] of Object.entries(SRC)) {
  for (const m of src.matchAll(/['"`](STREAM_PACER\.[A-Za-z0-9_.]+)['"`]/g)) used.add(m[1]);
  for (const m of src.matchAll(/P \+ '([A-Za-z0-9_.]+)'/g)) used.add(`STREAM_PACER.${m[1]}`);
  void f;
}
for (const src of [FORM, PERIL_FORM]) for (const m of src.matchAll(/localize\s+['"]([\w.]+)['"]/g)) used.add(m[1]);
for (const key of used) {
  if (key.endsWith(".")) continue; // a prefix, completed at runtime and enumerated above
  expect(localizes(key), `"${key}" does not resolve in lang/stream-pacer.en.json; the screen would print the raw key.`);
}
// a placeholder that stayed a placeholder: the data and the string disagree
for (const l of allLanes) {
  for (const ref of [l.label, l.title, l.count, ...l.ticker]) {
    const t = R.text(ref, L);
    expect(!/\{\w+\}/.test(t), `"${ref?.k}" renders with an unfilled placeholder: "${t}".`);
  }
  for (const a of l.actions) expect(!/\{\w+\}/.test(L(a.k, a.d)), `action "${a.k}" renders with an unfilled placeholder.`);
}
for (const hud of allHuds) expect(!/\{\w+\}/.test(R.hudHTML(hud, L)), "the HUD renders an unfilled placeholder.");

/* ── 7. Sounds ─────────────────────────────────────────────────────────── */

// alerts.js plays featurePath(FEATURE_ID, `assets/${file}`), i.e. assets/<feature>/<file>
expect(/featurePath\(FEATURE_ID, `assets\/\$\{SOUNDS\[cue\]\}`\)/.test(SRC["alerts.js"]), "alerts.js no longer resolves a cue as featurePath(FEATURE_ID, `assets/${SOUNDS[cue]}`); update the path rule here.");
for (const [cue, file] of Object.entries(C.SOUNDS)) {
  expect(existsSync(join(ROOT, "assets", C.FEATURE_ID, file)), `cue "${cue}" points at assets/${C.FEATURE_ID}/${file}, which is not on disk.`);
}
const playable = new Set();
for (const s of Object.values(FIXTURES)) for (const c of M.arrivals(null, s, new Set()).sounds) playable.add(c);
for (const v of [...Object.values(C.CALL), ...Object.values(C.MOOD), "checkin", "hand", "allready", "yellow", "red"]) playable.add(v);
for (const m of SRC["module.js"].matchAll(/(?:playCue\(|cue:\s*)'([a-z]+)'/g)) playable.add(m[1]);
for (const c of playable) expect(c in C.SOUNDS, `cue "${c}" can be played but SOUNDS has no file for it, so it plays nothing.`);

/* ── 8. Arrivals ───────────────────────────────────────────────────────── */

{
  const late = snap({ me: { id: "a", isGM: false }, call: { id: "w", kind: "wrap", at: T0 - C.TIMING.lateQuiet - 5000 } });
  expect(!M.arrivals(null, late, new Set()).sounds.length, "A player joining after a call is old still hears it as if it just happened.");
  const fresh = snap({ me: { id: "a", isGM: false }, call: { id: "w", kind: "wrap", at: T0 - 1000 } });
  const f = M.arrivals(null, fresh, new Set());
  expect(f.sounds.includes("wrap") && f.notify.length, "A targeted player does not hear (or get notified of) a fresh wrap-up.");
  expect(!M.arrivals(fresh, fresh, new Set(f.ids)).sounds.length, "A call already heard plays again.");
  const other = snap({ me: { id: "b", isGM: false }, call: { id: "w", kind: "wrap", at: T0, targets: ["a"] } });
  expect(!M.arrivals(null, other, new Set()).sounds.includes("wrap"), "A wrap-up aimed at someone else plays on a bystander's screen.");

  const cap = snap({ me: { id: "cap", isGM: false }, mood: { id: "pr", kind: "peril", at: T0 } });
  expect(M.arrivals(null, cap, new Set()).perilSplash, "A bars-exempt but not peril-exempt login (the stream) must still get the Dire Peril splash.");
  const perilExempt = M.normalizeSnapshot({ ...cap, users: cap.users.map((u) => (u.id === "cap" ? { ...u, exempt: { ...u.exempt, peril: true } } : u)) });
  expect(!M.arrivals(null, perilExempt, new Set()).perilSplash, "A peril-exempt login still gets the splash.");

  const before = snap({ flags: { a: hand(T0 - 9000) } });
  const after = snap({ flags: { a: hand(T0 - 9000), b: hand(T0) } });
  const h = M.arrivals(before, after, new Set());
  expect(h.sounds.filter((c) => c === "hand").length === 1, "One new hand must sound exactly once for the GM.");
  expect(!M.arrivals(after, after, new Set()).sounds.includes("hand"), "A hand already up sounds again on the next redraw.");
  const away = M.normalizeSnapshot({ ...after, users: after.users.map((u) => (u.id === "b" ? { ...u, active: false } : u)) });
  expect(!M.arrivals(away, after, new Set()).sounds.includes("hand"), "A player reconnecting with a hand still up sounds as a new hand.");
  expect(!M.handQueue(away).some((u) => u.id === "b"), "An offline player's hand is still in the queue for the GM to call on.");

  const lit = M.arrivals(snap(), snap({ safety: { show: true, lights: { a: { light: "red" } } } }), new Set());
  expect(lit.sounds.includes("red"), "A red light going up does not sound for the GM.");
  expect(!M.arrivals(snap({ safety: { show: true, lights: { a: { light: "red" } } } }), snap({ safety: { show: true, lights: { a: { light: "yellow" } } } }), new Set()).sounds.length, "A light coming down sounds as if it went up.");

  const answered = snap({ call: { id: "r", kind: "ready", at: T0 }, flags: { a: { answer: { call: "r", value: "wait" } } } });
  expect(M.reachOf(answered, answered.users.find((u) => u.id === "a")) === C.REACH.ACK, "An answer to the ready check does not count as the call having arrived, so Nudge pokes someone who already answered.");
  expect(!M.unseenTargets(answered).some((u) => u.id === "a"), "unseenTargets() includes a player who answered.");
}

/* ── 9. Escaping ──────────────────────────────────────────────────────── */

{
  const evil = '<img src=x onerror=alert(1)>';
  const s = snap({ users: undefined });
  const hostile = M.normalizeSnapshot({ ...s, users: s.users.map((u) => (u.id === "a" ? { ...u, name: evil } : u)), text: { perilTag: evil, perilSubtitle: evil } });
  const withAll = M.normalizeSnapshot({ ...hostile, users: hostile.users.map((u) => (u.id === "a" ? { ...u, pacer: { status: "hand", at: T0, seen: null, answer: null } } : u)), mood: { id: "pr", kind: "peril", at: T0 } });
  const html = M.lanes(withAll).map((l) => R.laneInnerHTML(l, L, T0)).join("") + R.hudHTML(M.hudModel(withAll), L)
    + R.perilStageHTML({ dire: evil, peril: evil, tag: evil, subtitle: evil, runTop: evil, runBottom: evil });
  expect(!html.includes("<img"), "A player name or the GM's Dire Peril text reaches the markup unescaped.");
}

/* ── 9b. The Dire Peril splash ────────────────────────────────────────── */

// The splash is CSS keyframes laid out as shares of one length. That length is
// written by band.js from TIMING.perilStage, and the same call unmounts the
// stage at it; a keyframe that reads --gl-drift (or any other length) directly
// drifts away from the unmount the moment either one changes.
{
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const stageRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.sp-peril\b(?!-gl)/.test(m[1]));
  const splash = playBody();
  function playBody() {
    // the body, not the destructured parameter object before it
    const at = SRC["band.js"].indexOf("export function playPerilSplash");
    return at === -1 ? "" : blockAfter(SRC["band.js"], SRC["band.js"].indexOf(") {", at) + 1);
  }
  expect(splash !== "", "band.js no longer exports playPerilSplash; module.js and the preview call it.");
  expect(/setProperty\('--sp-peril-stage'/.test(splash) && /TIMING\.perilStage/.test(splash), "playPerilSplash must write --sp-peril-stage from TIMING.perilStage: it is the one length every keyframe of the stage is a share of.");
  expect(/TIMING\.perilFade/.test(splash) && /\.call\(finish,\s*stage\)/.test(splash), "the stage must fade over TIMING.perilFade and unmount at the stage length, on the same timeline.");
  expect(C.TIMING.perilStage > C.TIMING.perilFade && C.TIMING.perilFade > 0, "TIMING.perilFade must be a positive share of TIMING.perilStage.");
  expect(!/addEventListener\(\s*['"]click/.test(splash), "the splash takes a click; it is pointer-events: none so the table keeps playing under it.");
  expect(/--sp-peril-len:\s*var\(--sp-peril-stage/.test(css), "the stage's length must read --sp-peril-stage (with a token fallback).");
  for (const m of stageRules) {
    for (const a of m[2].matchAll(/animation\s*:\s*([^;]+);/g)) {
      expect(!/--gl-drift/.test(a[1]), `"${m[1].trim()}" times a stage beat on --gl-drift; use --sp-peril-len, the length band.js unmounts at.`);
    }
    for (const f of m[2].matchAll(/font-family\s*:\s*([^;]+);/g)) {
      expect(f[1].trim() === "var(--sp-font)", `"${m[1].trim()}" sets font-family ${f[1].trim()}; the splash is set in --sp-font.`);
    }
  }
  expect(!/--gl-(display|tech)\b/.test(css), "the stylesheet reads --gl-display or --gl-tech; the whole skin is set in --sp-font.");
  // every class the markup draws has a rule, and every --sp-peril-* read is declared
  const html = R.perilStageHTML({ dire: "Dire", peril: "Peril", tag: "t", subtitle: "s", runTop: "a", runBottom: "b" });
  for (const cls of new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)))) {
    expect(new RegExp(`\\.${cls}(?![\\w-])`).test(css), `the splash draws .${cls}, which no rule in stream-pacer.css styles.`);
  }
  expect((html.match(/class="sp-pk-pf"/g) ?? []).length === 9 && (html.match(/class="sp-pk-l"/g) ?? []).length === 9, "the montage and the title must carry one span per letter of the two words.");
  for (const m of css.matchAll(/var\((--sp-peril-[\w-]+)/g)) {
    if (m[1] === "--sp-peril-stage") continue; // written by band.js, read with a fallback
    expect(new RegExp(`${m[1]}\\s*:`).test(css), `${m[1]} is read and never declared; it resolves to nothing.`);
  }
  // the field: a registered, shed-able surface the frame budget can take away
  const field = stripComments(SRC["peril-field.js"]);
  expect(/Surfaces\.register\(/.test(field) && /\.use\(\)/.test(field) && /\.touch\(\)/.test(field), "peril-field.js must register its context with Surfaces and mark it used while it draws.");
  expect(/Budget\.ladder\([^)]*SHED_ORDER\)/.test(field) && /allows\('perilField'\)/.test(field) && C.SHED_ORDER.includes("perilField"), "the field must be bound to Budget.ladder(SHED_ORDER) and ask it before it plays.");
  const loop = field.slice(field.indexOf("_loop() {"), field.indexOf("stop() {"));
  expect(/if \(!this\.allowed\)\s*\{\s*this\.stop\(\)/.test(loop), "the field's loop must ask the ladder every frame and stop when shed; asked only in play(), the load the splash itself causes can never shed it.");
  for (const u of field.matchAll(/uniform\s+\w+\s+(u_\w+)/g)) expect(new RegExp(`'${u[1]}'`).test(field), `the field's shader declares ${u[1]} and the renderer never looks it up; it holds the driver's initial value.`);
  // a client that may never see the splash never builds the field
  const fieldBody = bodyOf(MODULE, "_field") ?? "";
  expect(/isPerilSurfaceExempt/.test(fieldBody) && /sp\.perilWebGLEnabled/.test(fieldBody), "module.js must build the field only for a client that can see the splash and wants the field.");
  checks++;
}

/* ── 10. The stylesheet ───────────────────────────────────────────────── */

{
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) expect(m[1].startsWith("sp-"), `@keyframes ${m[1]} is not prefixed sp-; keyframe names are global.`);
  for (const m of css.matchAll(/(transition|animation)[\w-]*\s*:\s*([^;]+);/g)) {
    // a var() fallback or a var() scaled in calc() is a token, not a literal
    const v = m[2].replace(/var\([^()]*\)/g, "VAR");
    expect(!/(^|[\s,(])\d*\.?\d+m?s\b/.test(v), `stylesheet has a raw duration: "${m[0].trim()}". Use the --gl-d-* tokens.`);
    expect(!/cubic-bezier|(?<![-\w])ease(-in|-out|-in-out)?\b|steps\(/.test(v), `stylesheet has a raw easing: "${m[0].trim()}". Use --gl-ease*.`);
  }
  expect(!/prefers-reduced-motion/.test(css), "stylesheet queries prefers-reduced-motion; the suite does not honour the OS setting.");
  expect(!/@font-face|@import/.test(css), "stylesheet declares a font or imports a sheet.");
  expect(!/(^|[\s,}]):root\b/.test(css), "stylesheet writes :root; the skin is scoped to its own roots (ADR 0003).");
  expect(!/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(css), "stylesheet uses a raw white veil; use rgb(var(--gl-tint-light) / x).");
  expect(!/backdrop-filter:\s*blur\(\d/.test(css), "a backdrop blur is not written against --gl-glass-k.");
  for (const m of css.matchAll(/--gl-[\w-]+\s*:/g)) fail(`stylesheet declares ${m[0]} — foundation tokens live only in gl-tokens.css.`);
  checks++;
}

/* ── Report ───────────────────────────────────────────────────────────── */

console.log(`stream-pacer-check: ${checks} checks, ${Object.keys(FIXTURES).length} fixtures, ${allLanes.length} lanes, ${used.size} i18n keys`);
if (problems.length) {
  for (const p of problems) console.log(`FAIL  ${p}`);
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("OK");
