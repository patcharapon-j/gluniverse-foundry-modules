/**
 * GLUniverse Suite — Mobile feature adapter.
 *
 * Phone-player mode: when a touch device with a phone-sized viewport connects
 * (or the client forces it on), the desktop chrome is replaced with a tabbed
 * app shell (Canvas | Chat | Character | Suite) and every window renders
 * full-screen. The client's canvas quality settings are left alone. Desktop
 * clients are untouched — everything is gated on activation and all CSS is
 * scoped under `body.gl-mobile`.
 *
 *   detect.mjs   — heuristic + client override → mobileActive()
 *   shell.mjs    — tab bar, suite panel, chat send button, combat banner
 *   windows.mjs  — full-screen treatment for every rendered Application
 *   perf.mjs     — canvas freeze on hidden tabs (+ legacy clamp cleanup)
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { FEATURE_ID, KEY_MODE, KEY_PERF_BACKUP, mobileActive, touchCapable } from "./detect.mjs";
import { Shell } from "./shell.mjs";
import { initWindowManager } from "./windows.mjs";
import { restorePerfProfile, setCanvasFrozen } from "./perf.mjs";

Suite.register({
  id: FEATURE_ID,
  title: "GLMOB.title",
  hint: "GLMOB.hint",
  icon: "fa-solid fa-mobile-screen-button",
  settingPrefix: "mob.",
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    game.settings.register(SUITE_ID, KEY_MODE, {
      name: "GLMOB.mode.name",
      hint: "GLMOB.mode.hint",
      scope: "client",
      config: true,
      type: String,
      choices: {
        auto: "GLMOB.mode.auto",
        on: "GLMOB.mode.on",
        off: "GLMOB.mode.off",
      },
      default: "auto",
      requiresReload: true,
    });

    // Legacy stash from the removed performance clamp; kept so affected
    // clients get their canvas settings restored once (see perf.mjs).
    game.settings.register(SUITE_ID, KEY_PERF_BACKUP, {
      scope: "client",
      config: false,
      type: Object,
      default: {},
    });
  },

  onInit() {
    // Undo the legacy performance clamp on any client that still carries it.
    Hooks.once("ready", () => restorePerfProfile());

    // Way back IN: once a player exits to the desktop layout there is no mobile
    // UI left to re-enter from, so touch-capable desktop-layout players get a
    // suite scene-control button that flips the mode back on.
    const TOOL = "mobile-mode";
    const enterMobile = async () => {
      await game.settings.set(SUITE_ID, KEY_MODE, "on");
      foundry.utils.debouncedReload();
    };
    const showEntryTool = () => !game.user.isGM && !mobileActive() && touchCapable();
    Hooks.on("getSceneControlButtons", (controls) => {
      if (!showEntryTool()) return;
      const group = ensureSuiteGroup(controls);
      if (!group) return;
      group.tools[TOOL] = {
        name: TOOL,
        title: "GLMOB.enterMobile",
        icon: "fa-solid fa-mobile-screen-button",
        order: Object.keys(group.tools).length,
        button: true,
        visible: true,
        onChange: () => enterMobile(),
      };
    });
    // Reliable click delivery for the button tool across v13/v14.
    Hooks.on("renderSceneControls", (_app, html) => {
      if (!showEntryTool()) return;
      bindSuiteToolClicks(html, { [TOOL]: enterMobile });
    });

    if (!mobileActive()) return;
    // Mark the body as early as possible so first paint is already mobile.
    document.body.classList.add("gl-mobile");
    initWindowManager();
  },

  onReady() {
    if (!mobileActive()) return;
    Shell.mount();
    // Resume rendering defensively whenever a canvas swap happens on this tab.
    Hooks.on("canvasReady", () => setCanvasFrozen(Shell.active !== "canvas"));
  },

  api: null,
});
