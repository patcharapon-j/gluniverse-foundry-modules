/** GLUniverse — Clocks & Tracker : module entry point. */

import { MODULE_ID, SETTINGS, HOOKS } from "./const.js";
import { registerSettings } from "./settings.js";
import { Features } from "./features.js";
import { ensureSuiteGroup } from "../../core/scene-controls.mjs";

// Re-export the suite-facing settings registration so the adapter can wire it as
// `registerSettings()` (runs unconditionally at init so toggles/menus exist).
export { registerSettings };
import { applyCalendar } from "./calendar/calendar.js";
import { TimeEngine } from "./engine.js";
import { GlctHud } from "./apps/hud.js";
import { TrackerHud } from "./apps/tracker-hud.js";
import { TrackerStore } from "./trackers/trackers.js";
import { TrackerSheet } from "./apps/tracker-sheet.js";
import { WeatherHud } from "./apps/weather-hud.js";
import { WeatherEngine } from "./weather/engine.js";
import { WeatherStore } from "./weather/weather-store.js";
import { DelvingStore } from "./delving/delving-store.js";
import { DiceSlot } from "./delving/dice-slot.js";

function setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
}

/**
 * Guarantee a feature stylesheet is linked. The suite manifest only declares the
 * shared token sheet (`styles/gl-tokens.css`); this feature's own sheets live at
 * `modules/gluniverse-foundry-modules/styles/clocks-tracker-*.css` and are injected here so
 * a plain reload is enough. Each is a no-op once its link already exists.
 */
function ensureFeatureStyle(file) {
  const href = `modules/${MODULE_ID}/styles/clocks-tracker-${file}.css`;
  if (document.querySelector(`link[href*="styles/clocks-tracker-${file}.css"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function ensureHudStyles() { ensureFeatureStyle("hud"); }
function ensureWeatherStyles() { ensureFeatureStyle("weather"); }
function ensureDelvingStyles() { ensureFeatureStyle("delving"); }
function ensureSheetTrackerStyles() { ensureFeatureStyle("tracker-sheet"); }

/* ---------------------------------------------------------------------------
 * Lifecycle.
 *
 * This file backs TWO independently switchable suite features: the time engine
 * (`clocks-tracker` — calendar, time HUD, scene tint) and Resource Trackers
 * (`clocks-trackers` — the dock and the PF2e sheet tab). Either can run with
 * the other switched off, so each has its own pair of lifecycle functions and
 * the pieces they SHARE — the scene-control group, the chat tagging, the
 * keybindings — are wired once by whichever of the two initialises first.
 *
 * Weather and Delving are not in that position: a delve is drawn inside the
 * time HUD and a weather walk is stepped by the engine's `updateWorldTime`
 * hook, so both still declare `requiresFeature: "clocks-tracker"` and ride the
 * engine's half below.
 *
 * Settings registration is NOT done here — the adapter wires `registerSettings`
 * separately so toggles/menus exist even when both features are off. Nothing
 * runs at import time.
 * ------------------------------------------------------------------------ */

/** Wired exactly once, by whichever half initialises first. */
let sharedWired = false;
function wireShared() {
  if (sharedWired) return;
  sharedWired = true;
  // `game.keybindings.register` throws on a duplicate key and the scene-control
  // hook would do its work twice, so both halves route through this latch. Each
  // individual tool and binding is gated on its own feature when it fires, which
  // is what lets one registration serve either half.
  registerKeybindings();
  Hooks.on("renderChatMessageHTML", tagPoolMessage);   // Foundry v13+
  Hooks.on("renderChatMessage", tagPoolMessage);       // legacy fallback
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
}

/** Init lifecycle for the TIME ENGINE (only when `clocks-tracker` is enabled). */
export function onInit() {
  ensureHudStyles();
  ensureWeatherStyles();
  ensureDelvingStyles();
  // Install the active calendar before GameTime is constructed.
  applyCalendar();
  wireShared();
  registerRuntimeHooks();

  return getApi();
}

/** Ready lifecycle for the TIME ENGINE (only when `clocks-tracker` is enabled). */
export async function onReady() {
  if (Features.on("timeHud") && (game.user.isGM || setting(SETTINGS.hudVisibleToPlayers, true))) await GlctHud.open();
  applySceneTint(TimeEngine.getState());

  // Seed/sync the weather walk once on load (GM only; no-op when disabled).
  if (game.user.isGM) await WeatherEngine.evaluate();
  // Note: the Hex Flower window is NOT auto-opened on launch — open it manually
  // from the scene controls / macro when you want it.
}

/**
 * Init lifecycle for RESOURCE TRACKERS (only when `clocks-trackers` is enabled).
 * The dock wears the same stylesheet as the time HUD, so it ensures that sheet
 * itself rather than relying on the engine having been here first.
 */
export function onTrackersInit() {
  ensureHudStyles();
  ensureSheetTrackerStyles();
  // PF2e per-PC private trackers: wire the character-sheet tab (no-op off-PF2e).
  TrackerSheet.register();
  wireShared();

  return getTrackersApi();
}

/** Ready lifecycle for RESOURCE TRACKERS (only when `clocks-trackers` is enabled). */
export async function onTrackersReady() {
  // Wire GM-side pool-roll persistence *first*, before anything that awaits or
  // can throw (opening the dock). Otherwise a hiccup later in this function
  // could leave a GM without the handler while their own dock still works —
  // which would stop players' pool rolls from updating the shared count.
  TrackerStore.registerHandlers();
  if (Features.on("trackers.dock") && !setting(SETTINGS.trackerHudHidden, false)) await TrackerHud.open();
}

/** The time engine's public API (game.modules…api.features["clocks-tracker"]). */
export function getApi() {
  return { TimeEngine, GlctHud, TrackerHud, TrackerStore, TrackerSheet, WeatherEngine, WeatherStore, WeatherHud, DelvingStore, HOOKS };
}

/**
 * Resource Trackers' own public API (…api.features["clocks-trackers"]), so a
 * macro that only wants the dock still has a published entry point in a world
 * where the time engine is switched off and `getApi()` above never ran.
 */
export function getTrackersApi() {
  return { TrackerStore, TrackerHud, TrackerSheet, HOOKS };
}

/**
 * Register the TIME ENGINE's runtime Foundry hooks. Called from its onInit so
 * they only attach when it is enabled — nothing is registered at import time.
 * The hooks both halves share are in `wireShared()` above instead.
 */
function registerRuntimeHooks() {
  Hooks.on("updateWorldTime", () => {
    GlctHud.refreshState();
    applySceneTint(TimeEngine.getState());
    // Walk the weather flower as in-game time passes (primary GM only, guarded inside).
    WeatherEngine.evaluate();
  });

  // No combat hooks here on purpose. These once called GlctHud.refreshState() on
  // combatStart/deleteCombat/combatTurn/combatRound to "reflect combat state on
  // the HUD", but nothing ever read it: TimeEngine computes state.inCombat and no
  // template, stylesheet or painter consumes it. What the hooks did do was run a
  // full _paint() — forced layout, 42 SVG rect writes, chip rebuild — on the same
  // frame as the combat tracker's own turn-change work, which is exactly the
  // frame that has none to spare. If a combat indicator is wanted later, give the
  // HUD a setCombat(bool) that toggles one class and nothing else.
}

// Tag our resource-pool roll messages so the chat card can take over the whole
// entry (the duplicate header is hidden; timestamp + delete control remain).
function tagPoolMessage(message, html) {
  const el = html instanceof HTMLElement ? html : html?.[0];
  if (!el) return;
  const flags = message?.flags?.[MODULE_ID]?.ct;
  if (flags?.poolRoll) el.classList.add("glct-pool-msg");
  if (flags?.weatherCard) el.classList.add("glct-weather-msg");
  if (flags?.delvingCard) { el.classList.add("glct-delve-msg"); mountDelveTumble(message, el); }
}

/**
 * Play the in-card slot-machine reveal for the featured resource's roll, then —
 * once it finalises — release the HUD's held pool readout so the bar only catches
 * up to the new state AFTER the player has watched the dice resolve.
 *
 * Only the card carrying the featured resource drives this (it's marked with
 * `data-glct-featured`), and only on the fresh post — scrollback re-renders just
 * show the baked static result and never re-settle the HUD.
 */
function mountDelveTumble(message, el) {
  const card = el.querySelector(".glct-delvecard[data-glct-featured]");
  if (!card) return;                                   // not the featured card
  const fresh = (Date.now() - (message.timestamp ?? 0)) < 8000;
  if (!fresh) return;                                  // scrollback never animates
  const seq = DelvingStore.data.lastRoll?.seq ?? null;
  const settle = () => GlctHud.settleDelveRoll(seq);

  const host = card.querySelector(".glct-cc-dice[data-tumble]");
  if (host && !host.dataset.tumbled) {
    const faces = String(host.dataset.faces ?? "").split(",").map(Number).filter(Number.isFinite);
    if (faces.length) {
      const opts = {
        faces,
        size: Number(host.dataset.size) || 6,
        discard: Number(host.dataset.discard) || 0,
        tint: host.dataset.tint || "#ff9a3c"
      };
      const inst = DiceSlot.mount(host, opts, settle);
      if (inst) return;                                // settle fires when it ends
    }
  }
  // featured card but nothing to animate (e.g. the pool was empty) — sync now
  settle();
}
// v13+ scene controls: controls/tools are keyed objects; handlers use onChange.
//
// Every branch asks `Features.on(...)`, never a store's own `enabled` getter.
// Those getters read their world setting directly, and this hook is registered
// by whichever half initialises — so in a world running Resource Trackers with
// the time engine off, `WeatherStore.enabled` is still true and would put a
// weather button on the scene controls for a feature that is not running. The
// button looks completely ordinary and opens a Hex Flower nothing is stepping.
function onGetSceneControlButtons(controls) {
  // Suite tools live under the suite's own top-level group; `ensureSuiteGroup` is
  // called inside each enabled-branch so the group only appears when a tool does.
  if (Features.on("timeHud")) {
    ensureSuiteGroup(controls).tools["glct-toggle"] = {
      name: "glct-toggle",
      title: "GLCT.keybindings.toggleHud",
      icon: "fa-solid fa-hourglass-half",
      button: true,
      onChange: () => toggleHud()
    };
  }
  if (Features.on("trackers.dock")) {
    ensureSuiteGroup(controls).tools["glct-tracker-toggle"] = {
      name: "glct-tracker-toggle",
      title: "GLCT.keybindings.toggleTracker",
      icon: "fa-solid fa-list-check",
      button: true,
      onChange: () => toggleTrackerHud()
    };
  }
  if (Features.on("weather")) {
    ensureSuiteGroup(controls).tools["glct-weather-toggle"] = {
      name: "glct-weather-toggle",
      title: "GLCT.keybindings.toggleWeather",
      icon: "fa-solid fa-cloud-bolt",
      button: true,
      onChange: () => WeatherHud.toggle()
    };
  }
  if (Features.on("delving") && game.user.isGM) {
    ensureSuiteGroup(controls).tools["glct-delving-toggle"] = {
      name: "glct-delving-toggle",
      title: "GLCT.keybindings.toggleDelving",
      icon: "fa-solid fa-dungeon",
      button: true,
      onChange: () => DelvingStore.setActive(!DelvingStore.active)
    };
  }
}

function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "ct.toggleHud", {
    name: "GLCT.keybindings.toggleHud",
    editable: [{ key: "KeyT", modifiers: ["Alt"] }],
    onDown: () => { if (Features.on("timeHud")) toggleHud(); return true; },
    restricted: false
  });

  game.keybindings.register(MODULE_ID, "ct.advanceStretch", {
    name: "GLCT.keybindings.advanceStretch",
    editable: [{ key: "BracketRight", modifiers: ["Alt"] }],
    onDown: () => { if (game.user.isGM && Features.on("timeHud.gmControls")) TimeEngine.advanceStep("stretch"); return true; },
    restricted: true
  });

  game.keybindings.register(MODULE_ID, "ct.openCalendar", {
    name: "GLCT.keybindings.openCalendar",
    editable: [{ key: "KeyC", modifiers: ["Alt"] }],
    onDown: async () => { if (!Features.on("timeHud.calendar")) return true; const { CalendarView } = await import("./apps/calendar-view.js"); CalendarView.show(); return true; },
    restricted: false
  });

  game.keybindings.register(MODULE_ID, "ct.toggleTracker", {
    name: "GLCT.keybindings.toggleTracker",
    editable: [{ key: "KeyR", modifiers: ["Alt"] }],
    onDown: () => { if (Features.on("trackers.dock")) toggleTrackerHud(); return true; },
    restricted: false
  });

  game.keybindings.register(MODULE_ID, "ct.toggleWeather", {
    name: "GLCT.keybindings.toggleWeather",
    editable: [{ key: "KeyW", modifiers: ["Alt"] }],
    onDown: () => { if (Features.on("weather")) WeatherHud.toggle(); return true; },
    restricted: false
  });

  game.keybindings.register(MODULE_ID, "ct.toggleDelving", {
    name: "GLCT.keybindings.toggleDelving",
    editable: [{ key: "KeyG", modifiers: ["Alt"] }],
    onDown: () => { if (game.user.isGM && Features.on("delving")) DelvingStore.setActive(!DelvingStore.active); return true; },
    restricted: true
  });

  game.keybindings.register(MODULE_ID, "ct.passTurn", {
    name: "GLCT.keybindings.passTurn",
    editable: [{ key: "Period", modifiers: ["Alt"] }],
    onDown: () => { if (game.user.isGM && Features.on("delving") && DelvingStore.active) DelvingStore.advanceTurn(); return true; },
    restricted: true
  });
}

async function toggleHud() {
  if (!GlctHud.instance?.rendered) { await GlctHud.open(); return; }
  await GlctHud.instance.close();
}

async function toggleTrackerHud() {
  const open = TrackerHud.instance?.rendered;
  if (!open) { await TrackerHud.open(); }
  else { await TrackerHud.instance.close(); }
  try { await game.settings.set(MODULE_ID, SETTINGS.trackerHudHidden, !!open); } catch { /* ignore */ }
}

/** Subtle full-board tint matching the current watch (opt-in). */
function applySceneTint(state) {
  const enabled = Features.on("timeHud.sceneTint");
  let overlay = document.getElementById("glct-scene-tint");
  if (!enabled) { overlay?.remove(); return; }
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "glct-scene-tint";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", pointerEvents: "none", zIndex: "1",
      mixBlendMode: "soft-light", transition: "background 1.4s ease", opacity: "0.5"
    });
    (document.getElementById("board") ?? document.body).after(overlay);
  }
  // Writing the same value back still invalidates style on a full-viewport
  // soft-light layer, and this runs on every updateWorldTime — which in PF2e is
  // every combat round. The tint only moves when the watch glow does, so the
  // last applied value is cached on the element (its lifetime is exactly the
  // cache's valid lifetime: the overlay is removed when the feature is off).
  if (overlay.dataset.glctGlow === state.watch.glow) return;
  overlay.dataset.glctGlow = state.watch.glow;
  overlay.style.background = `radial-gradient(120% 90% at 50% 0%, ${state.watch.glow}, transparent 70%)`;
}
