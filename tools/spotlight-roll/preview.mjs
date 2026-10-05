/**
 * The Spotlight Roll preview driver.
 *
 * Drives the SHIPPED director, backdrop and overlay
 * (scripts/features/spotlight-roll/{director,backdrop,overlay/monolith}.mjs)
 * with the shipped lang file. Only the dice are a stand-in: three.js instead
 * of Dice So Nice, which cannot run outside Foundry.
 *
 * Seek, don't wait — the Browser pane throttles frames:
 *   window.__spotSeek(ms, stagger)  throw everything and freeze ms after the first throw
 *   window.__spotArrive(ms)         freeze the entrance
 *   window.__spotPlay()             run on
 *   URL: ?layout=&scenario=&dc=shown|hidden|never&fortune=&view=full|sealed
 *        &skin=&render=webgl|css&motion=&seek=&stagger=&arrive=&dock=0&reroll=1
 */
import { createTimeline, animate, stagger, eases, createTimer } from "/scripts/core/motion.mjs";
import { Director, ARRIVE_MS } from "/scripts/features/spotlight-roll/director.mjs";
import { Backdrop } from "/scripts/features/spotlight-roll/backdrop.mjs";
import overlay from "/scripts/features/spotlight-roll/overlay/monolith.mjs";
import { PreviewDice, SKINS } from "./die.mjs";
import { buildRequest, SCENARIOS, LAYOUTS, atMount, asSealed } from "./scenarios.mjs";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const state = {
  layout: params.get("layout") || "single",
  scenario: params.get("scenario") || "critSuccess",
  dc: params.get("dc") || "hidden",
  fortune: params.get("fortune") || "none",
  view: params.get("view") || "full",
  skin: params.get("skin") || "crystal",
  render: params.get("render") || "webgl",
  motion: Number(params.get("motion") || 1),
};

/* ── i18n from the shipped lang file; a missing key shows itself ── */
const LANG = await fetch("/lang/spotlight-roll.en.json").then((r) => r.json()).catch(() => ({}));
const flat = {};
(function walk(o, p) { for (const [k, v] of Object.entries(o)) typeof v === "object" ? walk(v, p + k + ".") : (flat[p + k] = v); })(LANG, "");
const missing = new Set();
const t = (k) => (k in flat ? flat[k] : (missing.add(k), `⟦${k}⟧`));
const f = (k, d) => t(k).replace(/\{(\w+)\}/g, (_, n) => d?.[n] ?? `{${n}}`);
const i18n = { t, f };

function showError(msg) { const el = $("#err"); el.hidden = false; el.textContent += msg + "\n"; }

/* ── the stage ── */
const root = $("#glsr");
const layers = { bg: $("#glsr .glsr-bg"), cssbg: $("#glsr .glsr-cssbg"), back: $("#glsr .glsr-back"), dice: $("#glsr .glsr-dice"), front: $("#glsr .glsr-front") };
const dice = new PreviewDice(layers.dice);
const backdrop = new Backdrop(layers.bg);
const t0 = performance.now();
await backdrop.compile(overlay.fragment);
if (!backdrop.ok) showError(`backdrop failed: ${backdrop.error ?? backdrop.report}`);
dice.warm();
$("#perf").textContent = `${backdrop.report} · ready ${Math.round(performance.now() - t0)}ms`;

function palette() {
  const probe = (name) => {
    const el = document.createElement("i"); el.style.color = `var(${name})`; root.append(el);
    const m = getComputedStyle(el).color.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255]; el.remove();
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  };
  return { accent: probe("--gl-accent"), gold: probe("--glsr-gold"), success: probe("--glsr-success"), fail: probe("--glsr-fail"), crimson: probe("--glsr-crimson") };
}

let director = null, full = null, frozenArrive = null;

async function request() {
  director?.destroy();
  dice.skin = state.skin;
  full = buildRequest({ layout: state.layout, scenario: state.scenario, dcMode: state.dc, fortune: state.fortune });
  for (const m of full.rolls) if (params.get("reroll") === "1") m.canReroll = m.degree != null;
  const mount = { ...full, rolls: full.rolls.map(atMount), defender: full.defender && { ...full.defender, dc: state.dc === "shown" ? full.defender.dc : null }, sharedDc: full.sharedDc && { ...full.sharedDc, value: state.dc === "shown" ? full.sharedDc.value : null } };
  director = new Director({
    root, layers, overlay, dice, backdrop: state.render === "webgl" ? backdrop : null, i18n, palette: palette(), motion: state.motion,
    onEnd: () => {},
  });
  await director.mount(mount, { anime: { createTimeline, animate, stagger, eases, createTimer } });
}

function throwRoll(i, at = performance.now(), seed) {
  if (!director || director.rolls[i]?.throwAt != null) return;
  const m = full.rolls[i];
  director.throw(i, state.view === "sealed" ? asSealed(m) : m, { at, seed: seed ?? Math.floor(Math.random() * 1e9) });
}
const throwNext = () => { const i = director?.pending()[0]; if (i != null) throwRoll(i); };

root.addEventListener("click", (e) => {
  if (!director) return;
  const host = e.target.closest("[data-roll]");
  const i = Number(host?.dataset.roll ?? 0);
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "throw") { director.charge(i); setTimeout(() => throwRoll(i), 300); }
  if (action === "reroll") {
    const r = director.rolls[i];
    const m = { ...full.rolls[i], canReroll: false };
    const nat = Math.min(20, (m.roll.natural ?? 10) + 6);
    m.roll = { ...m.roll, natural: nat, total: nat + m.modTotal, dice: [{ faces: 20, value: nat }] };
    director.throw(i, m, { seed: 99 });
  }
});

function tick() {
  requestAnimationFrame(tick);
  if (!director) return;
  if (frozenArrive != null) director.frozen = { arrive: frozenArrive, ms: 0 };
  director.frame({ width: innerWidth, height: innerHeight, dpr: Math.min(2, devicePixelRatio || 1) });
  if (missing.size && !$("#err").dataset.i18n) { $("#err").dataset.i18n = "1"; showError(`missing i18n: ${[...missing].join(", ")}`); }
}

/* ── dock ── */
function dock() {
  const d = $("#dock");
  const sel = (key, opts, label) => {
    const s = document.createElement("select");
    for (const [v, txt] of opts) { const o = new Option(txt, v); o.selected = String(state[key]) === String(v); s.add(o); }
    s.onchange = () => { state[key] = key === "motion" ? Number(s.value) : s.value; syncUrl(); frozenArrive = null; request(); };
    const l = document.createElement("label"); l.append(label + " ", s); return l;
  };
  const btn = (txt, fn) => { const b = document.createElement("button"); b.textContent = txt; b.onclick = fn; return b; };
  d.append(
    sel("layout", Object.entries(LAYOUTS), "Layout"),
    sel("scenario", Object.entries(SCENARIOS).map(([k, v]) => [k, v.label]), "Roll"),
    sel("dc", [["shown", "shown"], ["hidden", "hidden"], ["never", "never"]], "DC"),
    sel("fortune", [["none", "single"], ["fortune", "fortune"], ["misfortune", "misfortune"]], "Dice"),
    sel("view", [["full", "entitled"], ["sealed", "sealed (blind)"]], "View"),
    sel("skin", Object.entries(SKINS).map(([k, v]) => [k, v.label]), "Skin"),
    sel("render", [["webgl", "WebGL"], ["css", "CSS only"]], "FX"),
    sel("motion", [["0.75", "snappy"], ["1", "default"], ["1.3", "cinematic"]], "Motion"),
    btn("Request", () => { frozenArrive = null; request(); }),
    btn("Throw ␣", () => { director?.play(); throwNext(); }),
    btn("Throw rest", () => { director?.play(); for (const i of director?.pending() ?? []) throwRoll(i); }),
    btn("Dismiss", () => director?.dismiss()),
    btn("Hide dock", () => d.classList.add("hidden")));
  addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); if (director?.pending().length) throwNext(); else request(); }
    if (e.key === "h") d.classList.toggle("hidden");
    if (e.key === "Escape") director?.dismiss();
  });
}
function syncUrl() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) p.set(k, v);
  history.replaceState(null, "", "?" + p);
}

window.__spotSeek = (ms, stag = 0) => {
  frozenArrive = null;
  const now = performance.now();
  director.armedAt ??= director.requestAt;
  for (const r of director.rolls) throwRoll(r.i, now, 1307);
  director.focus = 0;
  director.seek(ms, director.rolls.map((r) => r.i * stag));
};
window.__spotArrive = (ms) => { frozenArrive = ms; };
window.__spotPlay = () => { frozenArrive = null; director?.play(); };

dock();
if (params.get("dock") === "0") $("#dock").classList.add("hidden");
await request();
if (params.has("arrive")) window.__spotArrive(Number(params.get("arrive")));
if (params.has("seek")) window.__spotSeek(Number(params.get("seek")), Number(params.get("stagger") || 0));
requestAnimationFrame(tick);
