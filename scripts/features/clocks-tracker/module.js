/** GLUniverse — Clocks & Tracker : module entry point. */

import { MODULE_ID, SETTINGS, STEPS, HOOKS } from "./const.js";
import { registerSettings } from "./settings.js";
import { Features } from "./features.js";
import { applyCalendar } from "./calendar/calendar.js";
import { TimeEngine } from "./engine.js";
import { GlctHud } from "./apps/hud.js";
import { TrackerHud } from "./apps/tracker-hud.js";
import { TrackerStore } from "./trackers/trackers.js";
import { TrackerSheet } from "./apps/tracker-sheet.js";
import { WeatherHud } from "./apps/weather-hud.js";
import { WeatherEngine } from "./weather/engine.js";
import { WeatherStore } from "./weather/weather-store.js";
import { SupportHud } from "./apps/support-hud.js";
import { SupportStore } from "./support/support-store.js";
import { DelvingStore } from "./delving/delving-store.js";
import { DiceSlot } from "./delving/dice-slot.js";

function setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
}

/**
 * Guarantee the weather stylesheet is linked. Foundry only reads `module.json`
 * (and so injects `styles[]` links) at server startup, so a world that booted
 * before weather.css was added to the manifest never links it — leaving the
 * weather editor/HUD completely unstyled until a full restart. Injecting it here
 * makes a plain page reload enough; it's a no-op once the manifest link exists.
 */
function ensureWeatherStyles() {
  if (document.querySelector('link[href*="styles/weather.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `modules/${MODULE_ID}/styles/weather.css`;
  document.head.appendChild(link);
}

/** Same guard for the support stylesheet (added to the manifest after weather). */
function ensureSupportStyles() {
  if (document.querySelector('link[href*="styles/support.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `modules/${MODULE_ID}/styles/support.css`;
  document.head.appendChild(link);
}

/** Same guard for the delving stylesheet (added to the manifest after support). */
function ensureDelvingStyles() {
  if (document.querySelector('link[href*="styles/delving.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `modules/${MODULE_ID}/styles/delving.css`;
  document.head.appendChild(link);
}

/** Same guard for the PC-sheet trackers stylesheet (latest manifest addition). */
function ensureSheetTrackerStyles() {
  if (document.querySelector('link[href*="styles/tracker-sheet.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `modules/${MODULE_ID}/styles/tracker-sheet.css`;
  document.head.appendChild(link);
}

Hooks.once("init", () => {
  registerSettings();
  ensureWeatherStyles();
  ensureSupportStyles();
  ensureDelvingStyles();
  ensureSheetTrackerStyles();
  // PF2e per-PC private trackers: wire the character-sheet tab (no-op off-PF2e).
  TrackerSheet.register();
  // Install the active calendar before GameTime is constructed.
  applyCalendar();
  registerKeybindings();

  // Public API for macros / other modules.
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { TimeEngine, GlctHud, TrackerHud, TrackerStore, TrackerSheet, WeatherEngine, WeatherStore, WeatherHud, SupportHud, SupportStore, DelvingStore, HOOKS };
});

Hooks.once("ready", async () => {
  // Wire GM-side pool-roll persistence *first*, before anything that awaits or
  // can throw (opening a HUD, the weather walk). Otherwise a hiccup earlier in
  // this hook could leave a GM without the handler while their own HUD still
  // works — which would stop players' pool rolls from updating the shared count.
  TrackerStore.registerHandlers();
  if (Features.on("timeHud")) await GlctHud.open();
  if (Features.on("trackers.dock") && !setting(SETTINGS.trackerHudHidden, false)) await TrackerHud.open();
  applySceneTint(TimeEngine.getState());

  // Seed/sync the weather walk once on load (GM only; no-op when disabled).
  if (game.user.isGM) await WeatherEngine.evaluate();
  // Note: the Hex Flower window is NOT auto-opened on launch — open it manually
  // from the scene controls / macro when you want it.

  // Mission Support: wire GM-side action persistence, then open the Comms-Coin
  // when the feature is on and not hidden on this client (the HUD self-hides for
  // players who shouldn't see it / when no support is active).
  SupportStore.registerHandlers();
  if (SupportStore.enabled && !setting(SETTINGS.supportHudHidden, false)) await SupportHud.open();
});

Hooks.on("updateWorldTime", () => {
  GlctHud.refreshState();
  applySceneTint(TimeEngine.getState());
  // Walk the weather flower as in-game time passes (primary GM only, guarded inside).
  WeatherEngine.evaluate();
});

// Tag our resource-pool roll messages so the chat card can take over the whole
// entry (the duplicate header is hidden; timestamp + delete control remain).
function tagPoolMessage(message, html) {
  const el = html instanceof HTMLElement ? html : html?.[0];
  if (!el) return;
  const flags = message?.flags?.[MODULE_ID];
  if (flags?.poolRoll) el.classList.add("glct-pool-msg");
  if (flags?.weatherCard) el.classList.add("glct-weather-msg");
  if (flags?.supportCard) el.classList.add("glct-support-msg");
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
Hooks.on("renderChatMessageHTML", tagPoolMessage);   // Foundry v13+
Hooks.on("renderChatMessage", tagPoolMessage);       // legacy fallback

// Combat awareness: reflect combat state on the HUD (no auto-advance — a combat
// round is far shorter than a stretch, so time only moves when the GM advances).
for (const hook of ["combatStart", "deleteCombat", "combatTurn", "combatRound"]) {
  Hooks.on(hook, () => GlctHud.refreshState());
}

// Support actions share a 1/round lock that only applies IN combat. Clear the
// "used" flag when the round advances or combat starts/ends — NOT on every turn,
// or it would degrade to 1/turn (GM-authoritative; no-op otherwise).
for (const hook of ["combatRound", "combatStart", "deleteCombat"]) {
  Hooks.on(hook, () => { if (game.user.isGM && SupportStore.enabled) SupportStore.resetRadio(); });
}
// Repaint the HUD on every client for any combat state change so the used badges
// and the GM clear button appear/disappear exactly as combat begins/ends.
for (const hook of ["combatStart", "deleteCombat", "combatRound", "combatTurn"]) {
  Hooks.on(hook, () => { if (SupportStore.enabled) SupportHud.refresh(); });
}

// v13+ scene controls: controls/tools are keyed objects; handlers use onChange.
Hooks.on("getSceneControlButtons", controls => {
  const group = controls.tokens ?? controls.notes ?? Object.values(controls)[0];
  if (!group?.tools) return;
  if (Features.on("timeHud")) {
    group.tools["glct-toggle"] = {
      name: "glct-toggle",
      title: "GLCT.keybindings.toggleHud",
      icon: "fa-solid fa-hourglass-half",
      button: true,
      onChange: () => toggleHud()
    };
  }
  if (Features.on("trackers.dock")) {
    group.tools["glct-tracker-toggle"] = {
      name: "glct-tracker-toggle",
      title: "GLCT.keybindings.toggleTracker",
      icon: "fa-solid fa-list-check",
      button: true,
      onChange: () => toggleTrackerHud()
    };
  }
  if (WeatherStore.enabled) {
    group.tools["glct-weather-toggle"] = {
      name: "glct-weather-toggle",
      title: "GLCT.keybindings.toggleWeather",
      icon: "fa-solid fa-cloud-bolt",
      button: true,
      onChange: () => WeatherHud.toggle()
    };
  }
  if (SupportStore.enabled) {
    group.tools["glct-support-toggle"] = {
      name: "glct-support-toggle",
      title: "GLCT.keybindings.toggleSupport",
      icon: "fa-solid fa-user-shield",
      button: true,
      onChange: () => toggleSupportHud()
    };
  }
  if (DelvingStore.enabled && game.user.isGM) {
    group.tools["glct-delving-toggle"] = {
      name: "glct-delving-toggle",
      title: "GLCT.keybindings.toggleDelving",
      icon: "fa-solid fa-dungeon",
      button: true,
      onChange: () => DelvingStore.setActive(!DelvingStore.active)
    };
  }
});

function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "toggleHud", {
    name: "GLCT.keybindings.toggleHud",
    editable: [{ key: "KeyT", modifiers: ["Alt"] }],
    onDown: () => { if (Features.on("timeHud")) toggleHud(); return true; },
    restricted: false
  });

  game.keybindings.register(MODULE_ID, "advanceStretch", {
    name: "GLCT.keybindings.advanceStretch",
    editable: [{ key: "BracketRight", modifiers: ["Alt"] }],
    onDown: () => { if (game.user.isGM && Features.on("timeHud.gmControls")) TimeEngine.advanceStep("stretch"); return true; },
    restricted: true
  });

  game.keybindings.register(MODULE_ID, "openCalendar", {
    name: "GLCT.keybindings.openCalendar",
    editable: [{ key: "KeyC", modifiers: ["Alt"] }],
    onDown: async () => { if (!Features.on("timeHud.calendar")) return true; const { CalendarView } = await import("./apps/calendar-view.js"); CalendarView.show(); return true; },
    restricted: false
  });

  game.keybindings.register(MODULE_ID, "toggleTracker", {
    name: "GLCT.keybindings.toggleTracker",
    editable: [{ key: "KeyR", modifiers: ["Alt"] }],
    onDown: () => { if (Features.on("trackers.dock")) toggleTrackerHud(); return true; },
    restricted: false
  });

  game.keybindings.register(MODULE_ID, "toggleWeather", {
    name: "GLCT.keybindings.toggleWeather",
    editable: [{ key: "KeyW", modifiers: ["Alt"] }],
    onDown: () => { if (WeatherStore.enabled) WeatherHud.toggle(); return true; },
    restricted: false
  });

  game.keybindings.register(MODULE_ID, "toggleSupport", {
    name: "GLCT.keybindings.toggleSupport",
    editable: [{ key: "KeyM", modifiers: ["Alt"] }],
    onDown: () => { if (SupportStore.enabled) toggleSupportHud(); return true; },
    restricted: false
  });

  game.keybindings.register(MODULE_ID, "toggleDelving", {
    name: "GLCT.keybindings.toggleDelving",
    editable: [{ key: "KeyG", modifiers: ["Alt"] }],
    onDown: () => { if (game.user.isGM && DelvingStore.enabled) DelvingStore.setActive(!DelvingStore.active); return true; },
    restricted: true
  });

  game.keybindings.register(MODULE_ID, "passTurn", {
    name: "GLCT.keybindings.passTurn",
    editable: [{ key: "Period", modifiers: ["Alt"] }],
    onDown: () => { if (game.user.isGM && DelvingStore.active) DelvingStore.advanceTurn(); return true; },
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

async function toggleSupportHud() {
  if (SupportHud.instance?.rendered) return SupportHud.instance._close();
  return SupportHud.open();
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
  overlay.style.background = `radial-gradient(120% 90% at 50% 0%, ${state.watch.glow}, transparent 70%)`;
}
