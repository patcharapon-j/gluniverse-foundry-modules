import { MODULE_ID, registerSettings } from './settings.js';
import { PacerManager } from './PacerManager.js';
import { SocketHandler } from './socket-handler.js';
import { PacerHUD } from './PacerHUD.js';
import { PacerOverlay } from './PacerOverlay.js';
import { AudioManager } from './AudioManager.js';
import { HandRaiseSidebar } from './HandRaiseSidebar.js';
import { PerilOverlay } from './PerilOverlay.js';
import { ThemeManager } from './ThemeManager.js';

let pacerHUD = null;
let pacerOverlay = null;
let audioManager = null;
let handRaiseSidebar = null;
let perilOverlay = null;
let isReady = false;
let isFirstCanvas = true;

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing Stream Pacer`);
  registerSettings();
});

Hooks.once('ready', async () => {
  console.log(`${MODULE_ID} | Stream Pacer Ready`);
  isReady = true;

  // Apply the fixed Arcane Glass palette before any UI renders.
  ThemeManager.initialize();

  // Two independent exemptions: the general pacer UI (bars/signals) and the
  // Dire Peril splash. A user can be hidden from one while still seeing the
  // other — e.g. a streaming overlay that shows only the Dire Peril reveal.
  const exemptUsers = game.settings.get(MODULE_ID, 'exemptUsers');
  const isExempt = exemptUsers.includes(game.user.id);
  const perilExemptUsers = game.settings.get(MODULE_ID, 'perilExemptUsers');
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
    theme: ThemeManager
  };

  // Late-join: if peril is already active, show the indicator only (no replay).
  if (!isPerilExempt && PacerManager.getState().direPerilActive) {
    perilOverlay.showIndicatorOnly();
  }
});

// Handle scene changes - reset states if setting enabled
Hooks.on('canvasReady', () => {
  // Skip if game not ready yet or if this is the first canvas load
  if (!isReady) return;
  if (isFirstCanvas) {
    isFirstCanvas = false;
    return;
  }

  if (game.settings.get(MODULE_ID, 'resetOnSceneChange')) {
    if (game.user.isGM) {
      PacerManager.resetAll();
    }
  }
});
