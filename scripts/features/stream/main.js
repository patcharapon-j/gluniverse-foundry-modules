/**
 * GLUniverse Stream — feature lifecycle.
 *
 * The standalone module registered `Hooks.once("init")`, `Hooks.once("ready")`
 * and three top-level `Hooks.on(...)` calls at import time. In the suite that
 * is forbidden: a feature must do nothing at import but define, or a disabled
 * feature is merely idle rather than inert, and `core/scene-controls.mjs` says
 * so in as many words. Everything now hangs off the three exported phases.
 *
 *   `registerSettings`  always, even when disabled, so the toggle exists.
 *   `onInit`            only when enabled and available.
 *   `onReady`           likewise.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { CameraController } from "./camera/controller.js";
import { ChatOverlay } from "./chat-overlay.js";
import { FEATURE_ID, HOOKS, MODULE_ID, PREFIX } from "./constants.js";
import { addStreamSceneControl, configureDirectorApp, openDirectorApp, renderDirectorApp } from "./director-app.js";
import { installDirectorRelay } from "./director-auth.mjs";
import { DialogOverlay } from "./dialog-overlay.js";
import { registerMotionEngine } from "./motion/engine.js";
import { registerSettings as registerStreamSettings, sanitizeByKey } from "./settings.js";
import { registerSocket } from "./socket.js";
import { StreamMode } from "./stream-mode.js";
import { TokenTracking } from "./token-tracking.js";
import { UiDetector } from "./ui-detector.js";

const state = {};

/**
 * Registered unconditionally at init. The control panel is registered as a
 * settings **menu** as well as a scene-control tool: this feature's real
 * configuration is six structured Object settings, and an Object setting with
 * no menu in front of it is a config a GM can only reach from the console. The
 * Control Center surfaces the menu as an "Open editor" button.
 */
export function registerSettings() {
  registerStreamSettings();

  game.settings.registerMenu(SUITE_ID, `${PREFIX}controlRoom`, {
    name: "GLUNIVERSE_STREAM.menu.controlRoom.name",
    label: "GLUNIVERSE_STREAM.menu.controlRoom.label",
    hint: "GLUNIVERSE_STREAM.menu.controlRoom.hint",
    icon: "fas fa-broadcast-tower",
    type: StreamControlRoomShim,
    restricted: false
  });
}

/**
 * Foundry instantiates a menu's `type` and calls `render`. The panel is a
 * singleton owned by `director-app.js` — which also refuses to open for a
 * non-director — so the menu entry is a shim onto it rather than a second
 * application class that could drift from the first.
 */
class StreamControlRoomShim {
  render() {
    openDirectorApp();
  }
}

export function onInit() {
  registerMotionEngine();
  registerKeybindings();

  // Gate first, then join the suite's shared scene-control group.
  Hooks.on("getSceneControlButtons", (controls) => addStreamSceneControl(controls));
}

export async function onReady() {
  state.streamMode = new StreamMode();
  state.tokenTracking = new TokenTracking();
  state.camera = new CameraController(state.streamMode, state.tokenTracking);
  state.chatOverlay = new ChatOverlay(state.streamMode);
  state.dialogOverlay = new DialogOverlay(state.streamMode);
  state.uiDetector = new UiDetector(state.streamMode);

  configureDirectorApp(state);
  registerSocket(state);

  // GM side of the attested director channel. Installed on every client; it
  // no-ops off the responsible GM, so a world with several GMs still applies a
  // request exactly once.
  installDirectorRelay(sanitizeByKey);

  state.tokenTracking.registerHooks();
  state.camera.registerHooks();
  state.chatOverlay.registerHooks();
  state.dialogOverlay.registerHooks();
  state.uiDetector.registerHooks();

  Hooks.on(HOOKS.settingsChanged, (key) => {
    renderDirectorApp();
    if (!["streamUserId", "autoStartStreamUserIds"].includes(key)) return;
    if (state.streamMode?.isStreamUser) state.streamMode.promptIfNeeded();
    else state.streamMode?.deactivate({ notify: false });
  });
  Hooks.on(HOOKS.clientStatus, () => renderDirectorApp());
  Hooks.on(HOOKS.uiDetectedChanged, () => renderDirectorApp());

  Hooks.on("canvasReady", () => state.streamMode?.reportStatus());
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id === canvas?.scene?.id && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) renderDirectorApp();
  });

  await state.streamMode.promptIfNeeded();
}

/** The panic button for a capture login whose UI is hidden. Prefixed, like every
 *  other suite keybinding, and deliberately not GM-restricted. */
function registerKeybindings() {
  game.keybindings.register(MODULE_ID, `${PREFIX}emergencyRestore`, {
    name: "GLUNIVERSE_STREAM.keybindings.emergencyRestore.name",
    hint: "GLUNIVERSE_STREAM.keybindings.emergencyRestore.hint",
    editable: [{ key: "KeyS", modifiers: ["CONTROL", "ALT"] }],
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
    onDown: () => {
      state.streamMode?.toggleRestore();
      return true;
    }
  });
}

/** Exposed on the suite api so the children can reach the live overlay. */
export function getStreamState() {
  return state;
}

export { FEATURE_ID };
