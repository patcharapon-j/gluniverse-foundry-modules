// Stream Pacer — feature entry point (ported into GLUniverse Suite).
//
// All former top-level Foundry hook registrations have been removed. The suite
// registry drives three exported lifecycle functions instead:
//   - registerSettings()  (re-exported from ./settings.js)
//   - onInit()            (the old `init` hook body)
//   - onReady()           (the old `ready` hook body, + socket wiring)
// Nothing runs at import time except definitions.

import { MODULE_ID, registerSettings, captureLocalSafetyExemption } from './settings.js';
import { PacerManager } from './PacerManager.js';
import { SocketHandler } from './socket-handler.js';
import { PacerHUD } from './PacerHUD.js';
import { PacerOverlay } from './PacerOverlay.js';
import { AudioManager } from './AudioManager.js';
import { HandRaiseSidebar } from './HandRaiseSidebar.js';
import { PerilOverlay } from './PerilOverlay.js';
import { CampfireOverlay } from './CampfireOverlay.js';
import { SafetyLightPanel } from './SafetyLightPanel.js';
import { SafetyRequestOverlay } from './SafetyRequestOverlay.js';
import { SafetyAlertOverlay } from './SafetyAlertOverlay.js';
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
let safetyLightPanel = null;
let safetyRequestOverlay = null;
let safetyAlertOverlay = null;
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

  // Never leave players staring at a safety ask nobody can answer. When the
  // last GM drops, close the request locally — the players' own lights are
  // untouched, since those are their standing signal, not a reply to the ask.
  Hooks.on('updateUser', (user, changes) => {
    if (!user.isGM || changes.active !== false) return;
    const hasActiveGM = game.users.some(candidate => candidate.isGM && candidate.active);
    if (!hasActiveGM) PacerManager.receiveSafetyRequestStop();
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

  // Three independent exemptions: the general pacer UI (bars/signals), the
  // Dire Peril splash, and the whole traffic-light safety tool. A user can be
  // hidden from one while still seeing the others — e.g. a streaming overlay
  // that shows only the Dire Peril reveal. All three are read ONCE, here: they
  // decide whether a surface is ever constructed, so they share one boundary —
  // a change applies on that client's next reload.
  const exemptUsers = game.settings.get(MODULE_ID, 'sp.exemptUsers');
  const isExempt = exemptUsers.includes(game.user.id);
  const perilExemptUsers = game.settings.get(MODULE_ID, 'sp.perilExemptUsers');
  const isPerilExempt = perilExemptUsers.includes(game.user.id);
  // Snapshot kept inside settings.js so PacerHUD and PacerManager read the same
  // value without importing this module (which would be circular).
  const isSafetySurfaceExempt = captureLocalSafetyExemption();

  // Initialize the socket handler (always needed for state sync)
  SocketHandler.initialize();

  // Initialize the pacer manager
  PacerManager.initialize();

  // Safety lights are live state, never persisted. When the sole GM reloads,
  // close any request orphaned by the old client and ask the table to
  // re-announce their lights so the board rebuilds itself.
  const hasOtherActiveGM = game.users.some(user => user.isGM && user.active && user.id !== game.user.id);
  if (game.user.isGM && !hasOtherActiveGM) {
    SocketHandler.emitSafetyRequestStop();
    SocketHandler.emitSafetyLightRequest();
  }

  // Independent of the normal HUD exemption: a safety ask reaches every active
  // player who is not explicitly safety-exempt, even when their pacing bars are
  // intentionally hidden — the banner grows its own lamps when there is no HUD
  // light to point at. The safety exemption is the one thing that stops it,
  // because a capture login must never put the table's private safety signals on
  // the recording. Gated by not constructing it: nothing then toggles the
  // `body.sp-safety-request` class (itself a tell that a check-in is running),
  // and no fallback lamp cluster is ever grown.
  if (!isSafetySurfaceExempt) {
    safetyRequestOverlay = new SafetyRequestOverlay();
    safetyRequestOverlay.initialize();
  }

  // Only initialize the general pacer UI if not exempt from the bars
  if (!isExempt) {
    // Create and render the HUD
    pacerHUD = new PacerHUD();
    pacerHUD.render(true);

    // The player's traffic light: its own small fixture docked to the HUD's
    // flank, so it never has to share the panel's layout. Needs both
    // exemptions to be clear — the panel is docked to the bars, and it is
    // itself a safety surface.
    if (!isSafetySurfaceExempt) {
      safetyLightPanel = new SafetyLightPanel();
      safetyLightPanel.initialize();
    }

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

    // A raised safety light must never be lost in the canvas: the alert layer
    // keeps it on screen, and an escalation also rings. Both are suppressed for
    // a safety-exempt client — the capture login is sometimes given GM rights,
    // and the escalated viewport treatment and the tone would otherwise land in
    // the video and audio capture. Gating the subscription rather than the
    // AudioManager leaves the hand-raise chime untouched, and means the cue is
    // owned by this world-scoped list instead of the client-scoped
    // `sp.safetyAudioEnabled` — which would need someone to sign in as the
    // puppet to tick it.
    if (!isSafetySurfaceExempt) {
      safetyAlertOverlay = new SafetyAlertOverlay();
      safetyAlertOverlay.initialize();

      PacerManager.onSafetyLight(({ status, escalated }) => {
        if (escalated) audioManager.playSafetyChime(status);
      });
    }
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
    safetyLight: safetyLightPanel,
    safetyRequest: safetyRequestOverlay,
    safetyAlert: safetyAlertOverlay,
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
