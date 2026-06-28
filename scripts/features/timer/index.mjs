/**
 * GLUniverse Suite — Timer feature adapter.
 *
 * A GM-controlled, world-synced countdown shown top-center to everyone in the
 * suite's Etched Glass aesthetic, with a built escalating-urgency ramp. See the
 * sibling modules for the moving parts:
 *   state.mjs  — the one world-setting state blob + GM operations
 *   hud.mjs    — the shared self-ticking overlay (+ GM control strip)
 *   panel.mjs  — the GM create / exact-set window
 *   audio.mjs  — synthesized tick + alarm
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { FEATURE_ID, STATE_KEY, SOUND_KEY, DEFAULT_STATE, getState, isLive, remainingOf, TimerCtrl, COLD_BOOT_GAP_MS } from "./state.mjs";
import { TimerHUD } from "./hud.mjs";
import { TimerPanel } from "./panel.mjs";

const TOOL = "timer-open";

/** Toggle the GM control panel. */
function togglePanel() {
  if (!game.user.isGM) return;
  const existing = foundry.applications.instances.get("gltimer-panel");
  if (existing) existing.close();
  else new TimerPanel().render({ force: true });
}

Suite.register({
  id: FEATURE_ID,
  title: "GLTIMER.title",
  hint: "GLTIMER.hint",
  icon: "fa-solid fa-stopwatch",
  settingPrefix: "timer.",
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    // Functional state — hidden from every config surface (config:false, Object).
    game.settings.register(SUITE_ID, STATE_KEY, {
      scope: "world",
      config: false,
      type: Object,
      default: { ...DEFAULT_STATE },
      onChange: (value) => {
        if (TimerHUD.el) TimerHUD.onState({ ...DEFAULT_STATE, ...(value ?? {}) });
      },
    });

    // Per-client mute toggle — surfaces as a switch in the Control Center.
    game.settings.register(SUITE_ID, SOUND_KEY, {
      name: "GLTIMER.sound.name",
      hint: "GLTIMER.sound.hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
    });
  },

  onInit() {
    // Suite scene-control button (GM only) → toggles the create/edit panel.
    Hooks.on("getSceneControlButtons", (controls) => {
      if (!game.user.isGM) return;
      const group = ensureSuiteGroup(controls);
      if (!group) return;
      group.tools[TOOL] = {
        name: TOOL,
        title: "GLTIMER.control",
        icon: "fa-solid fa-stopwatch",
        order: Object.keys(group.tools).length,
        button: true,
        visible: true,
        onChange: () => togglePanel(),
      };
    });
    // Reliable click delivery for the button tool across v13/v14.
    Hooks.on("renderSceneControls", (_app, html) => {
      if (!game.user.isGM) return;
      bindSuiteToolClicks(html, { [TOOL]: togglePanel });
    });

    // World pause freezes the timer for everyone; the GM persists the freeze so
    // late joiners see the held value (clients also freeze instantly on their
    // own game.paused, independent of this write).
    Hooks.on("pauseGame", (paused) => {
      if (game.user.isGM) TimerCtrl.setWorldPaused(paused);
    });
  },

  onReady() {
    TimerHUD.mount();

    // Cold-boot reconciliation (GM only): if a running timer's last checkpoint is
    // older than a continuous reload would allow, the world wasn't running the
    // whole time — restore it PAUSED at its last value so it doesn't silently
    // drain through the downtime. A normal mid-session refresh resumes live.
    if (game.user.isGM) {
      const s = getState();
      if (isLive(s)) {
        const gap = Date.now() - (Number(s.anchor) || 0);
        if (gap > COLD_BOOT_GAP_MS) {
          TimerCtrl.restorePaused(); // hold at the last checkpointed remaining
        }
      }
    }
  },

  api: {
    start: (ms) => TimerCtrl.start(ms),
    clear: () => TimerCtrl.clear(),
    adjust: (ms) => TimerCtrl.adjust(ms),
    getState,
    getRemaining: () => remainingOf(getState()),
  },
});
