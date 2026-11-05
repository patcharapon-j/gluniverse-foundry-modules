#!/usr/bin/env node
/**
 * Stream view — a browser-backed look at what the capture login shows and at the room that drives it.
 *
 * Three views, all built on what ships:
 *
 *   view=overlay  a 16:9 capture frame over a stand-in map, with the overlay root, two card stacks (one
 *                 top-left, one bottom-right, so the mirrored slide and the stack spacing can be judged)
 *                 and a cloned chat card. The cards are the shipped `RollCard` and `StatusCard`, the
 *                 overlay's scale is computed the way `ChatOverlay#applySettings` computes it, and the
 *                 stylesheets are the shipped ones.
 *   view=room     the Control Room: the shipped `templates/stream/director.hbs` rendered with Handlebars,
 *                 every string through the shipped lang files, with the contributed sections (roll cards,
 *                 targeting lines) rendered from their own shipped templates onto their tabs. The on-air
 *                 state comes from the shipped `room-model.mjs`.
 *   view=filter   the Chat Filter page, from the shipped template and the shipped filter tables.
 *
 * URL parameters:
 *   view=overlay|room|filter       default overlay
 *   still                          overlay: settled cards, no entrance
 *   exit                           overlay: after the cards land, the oldest of each stack leaves
 *   scale=<n>                      overlay: the Control Room's card size (default 0.5, the shipped default)
 *   tab=shot|overlay|screen|access room: the tab to open on
 *   state=live|exposed|idle|unknown|offline|unset   room: the on-air state (default live)
 *   readonly                       room: a director whose edits cannot be saved
 *   rev=before                     room and filter: origin/main's template and stylesheet, for a
 *                                  before/after pair (written by `--before`, see below)
 *
 * Foundry's own stylesheet is not on this page, so a control the skin does not restyle shows the
 * browser's default rather than Foundry's. Everything under the stream's roots is restyled.
 *
 * Serve it; a file:// page does not run its module script:
 *
 *   node tools/stream-preview.mjs [--before] && node tools/preview-server.mjs 8979
 *   → http://localhost:8979/.preview/stream.html?view=room&tab=overlay
 *
 * `--before` also writes origin/main's director template, roll-card section and stream.css under
 * .preview/stream-before/ (read with `git show`), which is what `rev=before` loads.
 *
 * `document.body.dataset.done` is set once the page has finished drawing.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/stream.html");

if (process.argv.includes("--before")) {
  const dir = join(ROOT, ".preview/stream-before");
  mkdirSync(dir, { recursive: true });
  for (const [path, name] of [
    ["templates/stream/director.hbs", "director.hbs"],
    ["templates/stream/chat-filter.hbs", "chat-filter.hbs"],
    ["templates/stream-cards/section.hbs", "cards-section.hbs"],
    ["styles/stream.css", "stream.css"]
  ]) {
    const body = execFileSync("git", ["show", "origin/main:" + path], { cwd: ROOT, encoding: "utf8" });
    writeFileSync(join(dir, name), body);
  }
  console.log("wrote origin/main's room under " + dir);
}

const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Stream view preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" id="stream-css" href="/styles/stream.css">
<link rel="stylesheet" href="/styles/stream-cards.css">
<link rel="stylesheet" href="/styles/stream-cards-daggerheart.css">
<link rel="stylesheet" href="/styles/stream-targets.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/handlebars.js/4.7.8/handlebars.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.4.2/pixi.min.js"></script>
<style>
  /* Page chrome only: none of this ships. */
  html, body { margin: 0; }
  body { min-height: 100vh; background: #2a2d33; color: #ddd; font: 13px/1.4 system-ui, sans-serif; }
  /* The capture frame: what OBS records. A drawn map stands in for the canvas. */
  .pv-frame {
    position: relative; overflow: hidden; width: 100vw; height: 100vh;
    background:
      radial-gradient(40% 38% at 30% 62%, rgb(110 84 50 / .55), transparent 70%),
      radial-gradient(50% 45% at 72% 30%, #3a5230, transparent 75%),
      repeating-linear-gradient(0deg, rgb(0 0 0 / .14) 0 1px, transparent 1px 64px),
      repeating-linear-gradient(90deg, rgb(0 0 0 / .14) 0 1px, transparent 1px 64px),
      radial-gradient(90% 80% at 50% 50%, #2c3a24, #121710);
  }
  .pv-frame .pv-token { position: absolute; width: 58px; height: 58px; border-radius: 50%; box-shadow: 0 0 0 3px rgb(0 0 0 / .45); background-size: cover; }
  .pv-frame .gluniverse-stream-overlay-root { position: absolute; }
  /* A stand-in for Foundry's own chat message inside the cloned-card wrapper. */
  .pv-msg { padding: 8px 10px 10px; background: #1a1b23; color: #d6d8e0; font: 13px/1.4 "Segoe UI", sans-serif; }
  .pv-msg header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .pv-msg header b { color: #fff; }
  .pv-msg header time { margin-left: auto; font-size: 11px; color: #7d8292; }
  .pv-msg .dice { margin-top: 6px; padding: 6px; text-align: center; font-size: 20px; font-weight: 700; background: #23242e; border: 1px solid #34374a; border-radius: 3px; }
  /* A Foundry window, released from the canvas: only the frame Foundry draws around an application. */
  .pv-desk { display: flex; gap: 28px; align-items: flex-start; padding: 28px; flex-wrap: wrap; }
  .pv-desk .application { position: relative; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgb(0 0 0 / .5); overflow: hidden; }
  .pv-desk .window-header { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; font: 600 13px/1 system-ui, sans-serif; }
  .pv-desk .window-header .window-title { flex: 1; }
  .pv-desk .window-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .pv-desk .window-content > form, .pv-desk .window-content > div { flex: 1 1 auto; min-height: 0; }
  .pv-cap { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #9aa; margin: 0 0 8px; }
</style></head>
<body>
<script type="module">
import { RollCard } from "/scripts/features/stream-cards/cards/roll-card.js";
import { StatusCard } from "/scripts/features/stream-cards/cards/status-card.js";
import { onAirState, OUT_OF_COMBAT_MODES, TAB_ICONS } from "/scripts/features/stream/room-model.mjs";
import { PANEL_TABS } from "/scripts/features/stream/extensions.mjs";
import { CHAT_LIMITS } from "/scripts/features/stream/chat-settings.mjs";
import { CAMERA_MODES, CHAT_POSITIONS, DEFAULT_CAMERA_SETTINGS, DEFAULT_CHAT_SETTINGS, CARD_SCALE_RANGE, SCENE_VIEW_MODES, DEFAULT_TARGETING_SETTINGS } from "/scripts/features/stream/constants.js";
import { CHAT_FILTER_AUTHORS, CHAT_FILTER_GROUPS, CHAT_FILTER_DETAILS, DEFAULT_CHAT_FILTER, rowAppliesTo } from "/scripts/features/stream/chat-filter.mjs";

const qs = new URLSearchParams(location.search);
const view = qs.get("view") || "overlay";
const before = qs.get("rev") === "before";
if (before) document.getElementById("stream-css").href = "/.preview/stream-before/stream.css";

const lang = Object.assign({},
  await (await fetch("/lang/stream.en.json")).json(),
  await (await fetch("/lang/stream-cards.en.json")).json(),
  await (await fetch("/lang/stream-targets.en.json")).json(),
  await (await fetch("/lang/en.json")).json().catch(() => ({})));
const localize = (key) => (key in lang ? lang[key] : key);
const text = async (path) => (await fetch(path)).text();

/* Portraits are drawn here, never shipped art. */
const portrait = (a, b, skin, hair) => "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs>' +
  '<rect width="200" height="200" fill="url(#g)"/><path d="M40 200c4-46 30-70 60-70s56 24 60 70z" fill="' + skin + '" opacity=".9"/>' +
  '<ellipse cx="100" cy="84" rx="34" ry="40" fill="' + skin + '"/>' +
  '<path d="M64 80c0-30 18-46 38-46s36 16 36 44c-8-14-22-20-36-20s-28 8-38 22z" fill="' + hair + '"/></svg>');
const ART = {
  seri: portrait("#3b5b8c", "#141c2c", "#e2b48f", "#2a1a12"),
  bram: portrait("#7a3d2a", "#1f120d", "#c08a65", "#5a3a1c"),
  jo: portrait("#2d6b5f", "#0e1f1c", "#d9a785", "#c9c1b0"),
  ogre: portrait("#4a5a2a", "#151a0c", "#8f9a5a", "#2a2e18")
};

if (view === "overlay") await overlay();
else if (view === "room") await room();
else if (view === "filter") await filter();
document.body.dataset.done = "";

/* ── the overlay ── */
async function overlay() {
  const still = qs.has("still");
  const scale = Number(qs.get("scale")) || DEFAULT_CHAT_SETTINGS.cardScale;
  const frame = document.createElement("div");
  frame.className = "pv-frame";
  for (const [left, top, img] of [["38%", "52%", ART.seri], ["46%", "58%", ART.bram], ["61%", "40%", ART.ogre], ["44%", "44%", ART.jo]]) {
    const token = document.createElement("div");
    token.className = "pv-token";
    token.style.left = left; token.style.top = top; token.style.backgroundImage = "url('" + img + "')";
    frame.append(token);
  }
  const root = document.createElement("div");
  root.className = "gluniverse-stream-overlay-root";
  // The same scale ChatOverlay#applySettings writes: the stream's width against the 1920px frame.
  root.style.setProperty("--glus-rc-scale", String((innerWidth / 1920) * scale));
  const stack = (position) => {
    const el = document.createElement("section");
    el.className = "gluniverse-stream-chat-root position-" + position;
    el.dataset.side = position.endsWith("right") ? "right" : "left";
    root.append(el);
    return el;
  };
  const left = stack("top-left");
  const right = stack("bottom-right");
  frame.append(root);
  document.body.append(frame);

  const pc = (name, player, img) => ({ actor: { name, isNpc: false, img, imgKind: "portrait", focus: null }, player: { name: player } });
  const base = { originKey: null, isReroll: false, visibility: "public", target: null, action: null, roll: null, spell: null, damage: null, text: null, fx: null };
  const check = (who, action, roll, extra = {}) => ({ ...base, ...who, kind: "check", action: { label: null, labelKey: null, sub: null, map: 0, ...action }, roll, ...extra });
  const SERI = pc("Seri Valen", "Mint", ART.seri);
  const BRAM = pc("Bram Holt", "Tee", ART.bram);
  const JO = pc("Jo", "Jo", ART.jo);
  const OGRE = { actor: { name: "Ogre Warrior", isNpc: true, img: ART.ogre, imgKind: "portrait", focus: null }, player: null };

  const LEFT = [
    { model: check(SERI, { label: "Strike: Longsword" }, { natural: 20, total: 31, dc: 17, dcVisible: true, degree: 3 }, { target: { name: "Ogre Warrior" }, fx: "gold" }),
      damage: { total: 22, crit: true, parts: [{ type: "slashing", amount: 18 }, { type: "fire", amount: 4 }] } },
    { status: { key: "ogre", actor: OGRE.actor, changes: [
      { id: "b", slug: "off-guard", name: "Off-Guard", kind: "condition", img: null, value: null, direction: "gained", eased: false },
      { id: "c", slug: "frightened", name: "Frightened", kind: "condition", img: null, value: 2, direction: "gained", eased: false }] } },
    { model: check(JO, { label: "Athletics", sub: "Grapple" }, { natural: 14, total: 23, dc: 19, dcVisible: true, degree: 2 }, { target: { name: "Ogre Warrior" } }) }
  ];
  const RIGHT = [
    { model: check(OGRE, { label: "Strike: Ogre Hook" }, { natural: 1, total: 9, dc: null, dcVisible: false, degree: 0 }, { target: { name: "Bram Holt" }, fx: "red" }) },
    { model: check(BRAM, { label: "Reflex Save", sub: "Fireball" }, { natural: 6, total: 15, dc: 21, dcVisible: true, degree: 1 }) },
    { cloned: true }
  ];

  const mount = (rootEl, list, offset) => Promise.all(list.map((spec, i) => new Promise((done) => {
    const make = () => {
      if (spec.cloned) {
        const card = document.createElement("div");
        card.className = "gluniverse-stream-chat-card chat-popout";
        card.innerHTML = '<div class="pv-msg"><header><b>Bram Holt</b><time>now</time></header>Perception check<div class="dice">17</div></div>';
        rootEl.append(card);
        return { element: card, exit: async () => card.remove() };
      }
      const card = spec.status ? new StatusCard(spec.status, { label: () => null }) : new RollCard(spec.model, { label: () => null });
      rootEl.append(card.element);
      return card;
    };
    const run = async () => {
      const card = make();
      if (!card.enter) return done(card);
      if (still) {
        if (card.setPending) {
          card.setPending(false);
          const total = card.element.querySelector(".glus-rc-total");
          if (total) total.textContent = card.headlineValue();
          if (spec.model.fx) card.climax();
          if (spec.damage) {
            await card.addDamage(spec.damage);
            const t = card.element.querySelector(".glus-rc-damage-total");
            if (t) t.textContent = spec.damage.total;
          }
        }
        return done(card);
      }
      await card.enter();
      if (spec.damage) await card.addDamage(spec.damage);
      done(card);
    };
    if (still) run(); else setTimeout(run, offset + i * 360);
  })));
  const [l, r] = await Promise.all([mount(left, LEFT, 200), mount(right, RIGHT, 500)]);
  if (qs.has("exit")) await Promise.all([l[0].exit(), r[0].exit()]);
}

/* ── the Control Room ── */
function registerHelpers() {
  Handlebars.registerHelper("localize", (key) => localize(key));
}

function windowFrame(title, icon, width, height, classes) {
  const app = document.createElement("form");
  app.className = "application " + classes;
  app.style.width = width + "px";
  app.style.height = height + "px";
  app.innerHTML = '<header class="window-header"><i class="' + icon + '"></i><span class="window-title">' + title + '</span><i class="fas fa-times"></i></header><section class="window-content"></section>';
  return app;
}

async function room() {
  registerHelpers();
  const tab = PANEL_TABS.includes(qs.get("tab")) ? qs.get("tab") : "shot";
  const stateName = qs.get("state") || "live";
  const readOnly = qs.has("readonly");
  const t = (key) => localize("GLUNIVERSE_STREAM.room." + key);
  const status = {
    live: { active: true, restoreVisible: false }, exposed: { active: true, restoreVisible: true },
    idle: { active: false }, unknown: null, offline: null, unset: null
  }[stateName] ?? null;
  const streamUserId = stateName === "unset" ? "" : "u-stream";
  const connected = !["offline", "unset"].includes(stateName);
  const state = onAirState({ streamUserId, connected, status });
  const live = Boolean(status?.active);
  const camera = { ...DEFAULT_CAMERA_SETTINGS, combatMode: CAMERA_MODES.spotlight };
  const chat = { ...DEFAULT_CHAT_SETTINGS };
  const users = [
    { id: "u-gm", name: "Gamemaster", active: true, isGM: true },
    { id: "u-stream", name: "Stream", active: connected, isGM: false },
    { id: "u-mint", name: "Mint", active: true, isGM: false, trusted: true },
    { id: "u-tee", name: "Tee", active: false, isGM: false }
  ].map((u) => ({ ...u, selected: u.id === streamUserId ? "selected" : "", checked: u.trusted ? "checked" : "" }));
  const optionsFor = (labels, selected) => Object.entries(labels).map(([value, label]) => ({ value, label, selected: value === selected ? "selected" : "" }));
  const modeLabel = (mode) => t("mode." + mode);
  const modeOptions = (modes, selected) => optionsFor(Object.fromEntries(modes.map((m) => [m, modeLabel(m)])), selected);
  const tokenRows = [
    { id: "a", name: "Seri Valen", actor: "Seri Valen", tracked: true, hidden: false, visibleHere: true, defeated: false, inCombat: true },
    { id: "b", name: "Bram Holt", actor: "Bram Holt", tracked: false, hidden: false, visibleHere: true, defeated: false, inCombat: true },
    { id: "c", name: "Ogre Warrior", actor: "Ogre Warrior", tracked: false, hidden: true, visibleHere: true, defeated: false, inCombat: true },
    { id: "d", name: "Goblin Scout", actor: "Goblin Scout", tracked: false, hidden: false, visibleHere: false, defeated: true, inCombat: false }
  ];
  const detectedUi = [
    { ruleId: "r1", title: "Dice Tray", appClass: "DiceTrayApp", selector: "#dice-tray", source: "Detected", state: "Blocked", zIndex: "" },
    { ruleId: "r2", title: "Combat Carousel", appClass: "CombatCarousel", selector: "#combat-carousel", source: "Detected", state: "Allowed", zIndex: 80 }
  ];

  if (before) return roomBefore({ camera, chat, users, tokenRows, detectedUi, status, connected, stateName });

  const cardsSection = Handlebars.compile(await text("/templates/stream-cards/section.hbs"))({
    defaultRollArt: { src: "worlds/campaign/art/gm-roll.webp", focus: null },
    status: { enabled: true, valueChanges: true, removals: false, lifetimeFactor: 0.6 },
    statusLifetime: { min: 0.25, max: 1, step: 0.05, percent: 60 },
    statusCards: true,
    canEdit: !readOnly
  });
  const targetsSection = Handlebars.compile(await text("/templates/stream-targets/section.hbs"))({
    targeting: { ...DEFAULT_TARGETING_SETTINGS }, showVisibility: true, canEdit: !readOnly,
    visibilityOptions: [{ value: "everyone", label: "Everyone", selected: "selected" }, { value: "gmAndStream", label: "GM and stream" }]
  });
  // A gmOnly section a non-GM sees sits in a disabled fieldset, as renderPanelSectionsByTab wraps it.
  const gmOnly = (html) => readOnly ? '<fieldset class="gluniverse-stream-controls" disabled>' + html + "</fieldset>" : html;

  const context = {
    onAir: {
      state, label: t("state." + state), live, uiShowing: Boolean(live && status?.restoreVisible),
      login: streamUserId ? "Stream · " + t(connected ? "access.connected" : "access.offline") : t("access.noLogin")
    },
    status: {
      connected, restoreDisabled: live ? "" : "disabled", reframeDisabled: live ? "" : "disabled",
      autoStartEnabled: false, autoStartCanEnable: Boolean(streamUserId),
      scene: "The Sunken Archive", mode: modeLabel(CAMERA_MODES.spotlight), combat: t("combat.running")
    },
    tab: { active: tab, ...Object.fromEntries(PANEL_TABS.map((id) => [id, id === tab])) },
    tabs: PANEL_TABS.map((id) => ({ id, label: t("tabs." + id), icon: TAB_ICONS[id], active: id === tab })),
    labels: { connected: t("access.connected"), gm: t("access.gm") },
    chatLimits: CHAT_LIMITS,
    users, camera, chat, spotlightSelected: true,
    chatFilterSummary: "Players 19 of 23 · GM 15 of 23",
    cardScale: { ...CARD_SCALE_RANGE, percent: Math.round(chat.cardScale * 100) },
    dialog: { lifetimeMs: 10000 },
    sections: { shot: "", overlay: gmOnly(targetsSection) + gmOnly(cardsSection), screen: "", access: "" },
    canEdit: !readOnly, canEditAdmin: !readOnly, readOnly,
    readOnlyMessage: localize("GLUNIVERSE_STREAM.notifications.readOnlyNoGm"),
    tokenRows, detectedUi,
    selectorRules: [{ id: "s1", selector: ".pf2e-hud", action: "block" }],
    outOfCombatModeOptions: modeOptions(OUT_OF_COMBAT_MODES, camera.outOfCombatMode),
    combatModeOptions: modeOptions(Object.values(CAMERA_MODES), camera.combatMode),
    sceneViewOptions: optionsFor(Object.fromEntries(Object.values(SCENE_VIEW_MODES).map((v) => [v, t("view." + v)])), camera.sceneViewMode),
    chatPositionOptions: optionsFor(Object.fromEntries(CHAT_POSITIONS.map((p) => [p, t("corner." + p)])), chat.position)
  };
  const body = Handlebars.compile(await text("/templates/stream/director.hbs"))(context);
  const desk = document.createElement("div");
  desk.className = "pv-desk";
  const app = windowFrame(localize("GLUNIVERSE_STREAM.controls.director"), "fas fa-broadcast-tower", 680, 720, "gluniverse-stream-director");
  app.querySelector(".window-content").innerHTML = body;
  desk.append(app);
  document.body.append(desk);
  // The tab bar works here as it does in the room: in place, no render.
  app.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="room-tab"]');
    if (!button) return;
    for (const b of app.querySelectorAll(".gluniverse-stream-tab")) b.setAttribute("aria-selected", String(b === button));
    for (const p of app.querySelectorAll(".gluniverse-stream-tabpanel")) p.hidden = p.dataset.tab !== button.dataset.tab;
  });
}

/* origin/main's room, from its own template and its own context names. */
async function roomBefore({ camera, chat, users, tokenRows, detectedUi, status, connected, stateName }) {
  const cardsSection = Handlebars.compile(await text("/.preview/stream-before/cards-section.hbs"))({
    defaultRollArt: { src: "worlds/campaign/art/gm-roll.webp", focus: null },
    status: { enabled: true, valueChanges: true, removals: false, lifetimeFactor: 0.6 },
    statusLifetime: { min: 0.25, max: 1, step: 0.05, percent: 60 }, statusCards: true, canEdit: true
  });
  const targetsSection = Handlebars.compile(await text("/templates/stream-targets/section.hbs"))({
    targeting: { ...DEFAULT_TARGETING_SETTINGS }, showVisibility: true, canEdit: true,
    visibilityOptions: [{ value: "everyone", label: "Everyone", selected: "selected" }]
  });
  const optionsFor = (labels, selected) => Object.entries(labels).map(([value, label]) => ({ value, label, selected: value === selected ? "selected" : "" }));
  const context = {
    status: {
      stream: status ? (status.active ? "Active" : "Inactive") : "No report yet",
      restore: status ? (status.restoreVisible ? "Temporarily visible" : "Hidden") : "No report yet",
      connected, stopDisabled: status?.active ? "" : "disabled", restoreDisabled: status?.active ? "" : "disabled",
      reframeDisabled: status?.active ? "" : "disabled", autoStart: "Disabled", autoStartEnabled: false, autoStartCanEnable: true,
      scene: "The Sunken Archive", mode: "Spotlight active token", combat: "Yes"
    },
    users, camera, spotlightSelected: true, chat,
    chatFilterSummary: "Players 19 of 23 · GM 15 of 23",
    cardScale: { ...CARD_SCALE_RANGE, percent: Math.round(chat.cardScale * 100) },
    dialog: { lifetimeMs: 10000 }, extraSections: targetsSection + cardsSection,
    canEdit: true, canEditAdmin: true, readOnly: false, tokenRows, detectedUi, selectorRules: [{ id: "s1", selector: ".pf2e-hud", action: "block" }],
    outOfCombatModeOptions: optionsFor({ manual: "Manual/free camera", scene: "Scene/full background", trackedToken: "Tracked token(s)", party: "Party only (visible PCs)" }, camera.outOfCombatMode),
    combatModeOptions: optionsFor({ manual: "Manual/free camera", scene: "Scene/full background", combatants: "Visible combatants", spotlight: "Spotlight active token" }, camera.combatMode),
    sceneViewOptions: optionsFor({ fitBackground: "Fit background", fillBackground: "Fill background" }, camera.sceneViewMode),
    chatPositionOptions: optionsFor({ "top-left": "Top Left", "top-right": "Top Right", "bottom-left": "Bottom Left", "bottom-right": "Bottom Right" }, chat.position)
  };
  const body = Handlebars.compile(await text("/.preview/stream-before/director.hbs"))(context);
  const desk = document.createElement("div");
  desk.className = "pv-desk";
  const app = windowFrame("GLUniverse Stream Control Room", "fas fa-video", 720, 760, "gluniverse-stream-director");
  app.querySelector(".window-content").innerHTML = body;
  desk.append(app);
  document.body.append(desk);
}

/* ── the Chat Filter page ── */
async function filter() {
  registerHelpers();
  const L = (key) => "GLUNIVERSE_STREAM.chatFilter." + key;
  const system = "pf2e";
  const authorLabel = Object.fromEntries(CHAT_FILTER_AUTHORS.map((a) => [a, localize(L("columns." + a))]));
  const f = DEFAULT_CHAT_FILTER;
  const groups = CHAT_FILTER_GROUPS.map((group) => ({
    id: group.id, label: localize(L("group." + group.id + ".name")), hint: localize(L("group." + group.id + ".hint")),
    rows: group.rows.filter((row) => rowAppliesTo(row, system)).map((row) => ({
      id: row.id, label: localize(L("row." + row.id + ".name")), hint: localize(L("row." + row.id + ".hint")),
      cells: CHAT_FILTER_AUTHORS.map((author) => ({ author, authorLabel: authorLabel[author], name: "rows." + row.id + "." + author, checked: Boolean(f.rows[row.id]?.[author]) }))
    }))
  })).filter((g) => g.rows.length);
  const details = CHAT_FILTER_DETAILS.map((detail) => ({
    id: detail.id, label: localize(L("detail." + detail.id + ".name")), hint: localize(L("detail." + detail.id + ".hint")),
    cells: CHAT_FILTER_AUTHORS.map((author) => (detail.authors.includes(author)
      ? { author, authorLabel: authorLabel[author], name: "details." + detail.id + "." + author, checked: Boolean(f.details[detail.id]?.[author]), applies: true }
      : { author, applies: false }))
  }));
  const tpl = before ? "/.preview/stream-before/chat-filter.hbs" : "/templates/stream/chat-filter.hbs";
  const body = Handlebars.compile(await text(tpl))({
    groups, details, rollCards: true, canEdit: true, readOnly: false, summary: "Players 19 of 23 · GM 15 of 23",
    authors: CHAT_FILTER_AUTHORS.map((author) => ({ author, label: authorLabel[author] }))
  });
  const desk = document.createElement("div");
  desk.className = "pv-desk";
  const app = windowFrame(localize("GLUNIVERSE_STREAM.chatFilter.title"), "fas fa-filter", 640, 720, "gluniverse-stream-director gluniverse-stream-filter");
  app.querySelector(".window-content").innerHTML = body;
  desk.append(app);
  document.body.append(desk);
}
</script>
</body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log("wrote " + OUT);
