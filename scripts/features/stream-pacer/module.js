// Stream Pacer — feature entry point (ported into GLUniverse Suite).
//
// All former top-level Foundry hook registrations have been removed. The suite
// registry drives three exported lifecycle functions instead:
//   - registerSettings()  (re-exported from ./settings.js)
//   - onInit()            (the old `init` hook body)
//   - onReady()           (the old `ready` hook body, + socket wiring)
// Nothing runs at import time except definitions.

import { MODULE_ID, registerSettings } from './settings.js';
import { PacerManager } from './PacerManager.js';
import { SocketHandler } from './socket-handler.js';
import { PacerHUD } from './PacerHUD.js';
import { PacerOverlay } from './PacerOverlay.js';
import { AudioManager } from './AudioManager.js';
import { HandRaiseSidebar } from './HandRaiseSidebar.js';
import { PerilOverlay } from './PerilOverlay.js';
import { CampfireOverlay } from './CampfireOverlay.js';
import { ThemeManager } from './ThemeManager.js';

export { registerSettings };

/**
 * Guarantee the feature stylesheet is linked. The suite manifest only declares
 * the shared token sheet (`styles/gl-tokens.css`); this feature's own sheet
 * lives at `modules/gluniverse-foundry-modules/styles/stream-pacer.css` and is injected
 * here so a plain reload is enough. No-op once the link already exists.
 */
function ensureFeatureStyle() {
  const href = `modules/${MODULE_ID}/styles/stream-pacer.css`;
  if (document.querySelector('link[href*="styles/stream-pacer.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

let pacerHUD = null;
let pacerOverlay = null;
let audioManager = null;
let handRaiseSidebar = null;
let perilOverlay = null;
let campfireOverlay = null;
let isReady = false;
let isFirstCanvas = true;

/** Everything from the old `init` hook. */
export function onInit() {
  console.log(`${MODULE_ID} | Initializing Stream Pacer`);

  // Handle scene changes — reset states if the setting is enabled.
  Hooks.on('canvasReady', () => {
    // Skip if game not ready yet or if this is the first canvas load
    if (!isReady) return;
    if (isFirstCanvas) {
      isFirstCanvas = false;
      return;
    }

    if (game.settings.get(MODULE_ID, 'sp.resetOnSceneChange')) {
      if (game.user.isGM) {
        PacerManager.resetAll();
      }
    }
  });
}

/** Everything from the old `ready` hook (+ socket wiring). */
export function onReady() {
  console.log(`${MODULE_ID} | Stream Pacer Ready`);
  isReady = true;

  // Ensure the feature stylesheet is linked (manifest only ships gl-tokens.css).
  ensureFeatureStyle();

  // Apply the fixed Arcane Glass palette before any UI renders.
  ThemeManager.initialize();

  // Two independent exemptions: the general pacer UI (bars/signals) and the
  // Dire Peril splash. A user can be hidden from one while still seeing the
  // other — e.g. a streaming overlay that shows only the Dire Peril reveal.
  const exemptUsers = game.settings.get(MODULE_ID, 'sp.exemptUsers');
  const isExempt = exemptUsers.includes(game.user.id);
  const perilExemptUsers = game.settings.get(MODULE_ID, 'sp.perilExemptUsers');
  const isPerilExempt = perilExemptUsers.includes(game.user.id);

  // Initialize the socket handler (always needed for state sync)
  SocketHandler.initialize();

  // Initialize the pacer manager
  PacerManager.initialize();

  // Only initialize the general pacer UI if not exempt from the bars
  if (!isExempt) {
    // Create and render the HUD
    pacerHUD = new PacerHUD();
    pacerHUD.render(true);

    // Initialize overlay for signals
    pacerOverlay = new PacerOverlay();
    pacerOverlay.initialize();

    // Campfire Scene reveal + indicator. Shares the general-bars exemption: a
    // streaming overlay hidden from the pacer UI also stays clear of this splash.
    campfireOverlay = new CampfireOverlay();
    campfireOverlay.initialize();
  }

  // The Dire Peril splash is gated by its own exemption list
  if (!isPerilExempt) {
    perilOverlay = new PerilOverlay();
    perilOverlay.initialize();
  }

  // Initialize GM-only components
  if (game.user.isGM) {
    // Audio manager for hand-raise notifications
    audioManager = new AudioManager();

    // Subscribe to hand raise events for audio cue
    PacerManager.onHandRaise((userId) => {
      audioManager.playHandRaiseChime(userId);
    });

    // Hand raise sidebar (GM-only prominent notification)
    handRaiseSidebar = new HandRaiseSidebar();
    handRaiseSidebar.initialize();
  }

  // Expose global API
  game.streamPacer = {
    manager: PacerManager,
    socket: SocketHandler,
    hud: pacerHUD,
    overlay: pacerOverlay,
    audio: audioManager,
    handSidebar: handRaiseSidebar,
    peril: perilOverlay,
    campfire: campfireOverlay,
    theme: ThemeManager
  };

  // Late-join: if peril is already active, show the indicator only (no replay).
  if (!isPerilExempt && PacerManager.getState().direPerilActive) {
    perilOverlay.showIndicatorOnly();
  }

  // Late-join: same for an in-progress Campfire Scene.
  if (!isExempt && PacerManager.getState().campfireActive) {
    campfireOverlay.showIndicatorOnly();
  }
}
