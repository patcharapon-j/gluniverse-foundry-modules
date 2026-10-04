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
import { bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { CameraController } from "./camera/controller.js";
import { installPanGuard } from "./camera/pan-guard.js";
import { ChatOverlay } from "./chat-overlay.js";
import { openChatFilterApp, renderChatFilterApp } from "./chat-filter-app.js";
import { FEATURE_ID, HOOKS, MODULE_ID, PREFIX, isStreamSceneFlagChange } from "./constants.js";
import { CONTROL_ROOM_TOOL, addStreamSceneControl, configureDirectorApp, openDirectorApp, renderDirectorApp } from "./director-app.js";
import { installDirectorRelay } from "./director-auth.mjs";
import { DialogOverlay } from "./dialog-overlay.js";
import { registerMotionEngine } from "./motion/engine.js";
import { registerSettings as registerStreamSettings, sanitizeByKey } from "./settings.js";
import { forgetClientStatus, registerSocket } from "./socket.js";
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
    type: controlRoomShimClass(),
    restricted: false
  });

  // The chat filter gets its own entry as well as its Control Room button: "what reaches the stream" is
  // the question a GM opens settings to answer, and it should not be two windows deep.
  game.settings.registerMenu(SUITE_ID, `${PREFIX}chatFilterMenu`, {
    name: "GLUNIVERSE_STREAM.menu.chatFilter.name",
    label: "GLUNIVERSE_STREAM.menu.chatFilter.label",
    hint: "GLUNIVERSE_STREAM.menu.chatFilter.hint",
    icon: "fas fa-filter",
    type: shimClass("chatFilter", () => openChatFilterApp()),
    restricted: false
  });
}

let ControlRoomShim = null;
const shims = {};

/** The same shim as the Control Room's, onto another singleton window. */
function shimClass(id, open) {
  if (shims[id]) return shims[id];
  const { ApplicationV2 } = foundry.applications.api;
  shims[id] = class StreamMenuShim extends ApplicationV2 {
    render() {
      open();
      return this;
    }
  };
  return shims[id];
}

/**
 * Foundry instantiates a menu's `type` and calls `render`. The panel is a
 * singleton owned by `director-app.js` — which also refuses to open for a
 * non-director — so the menu entry is a shim onto it rather than a second
 * application class that could drift from the first.
 *
 * It has to be a real `ApplicationV2` subclass even though it renders nothing
 * of its own: `registerMenu` rejects a `type` that is neither that nor a
 * `FormApplication`, and the throw lands inside `Suite.registerAllSettings`,
 * which catches it. The feature's settings are all `config: false`, so the cost
 * of that swallowed throw was the Control Center drawing a Stream section with
 * no settings *and* no "Open Control Room" button — a feature that looks
 * installed and has no way in.
 *
 * Built in a memoised factory rather than at module scope, per the suite's
 * standing rule: `foundry.applications` does not exist under plain Node, where
 * the check tools import this feature's modules.
 */
function controlRoomShimClass() {
  if (ControlRoomShim) return ControlRoomShim;
  const { ApplicationV2 } = foundry.applications.api;
  ControlRoomShim = class StreamControlRoomShim extends ApplicationV2 {
    /** Never renders itself; it hands off to the singleton panel. */
    render() {
      openDirectorApp();
      return this;
    }
  };
  return ControlRoomShim;
}

export function onInit() {
  registerMotionEngine();
  registerKeybindings();

  // Gate first, then join the suite's shared scene-control group.
  Hooks.on("getSceneControlButtons", (controls) => addStreamSceneControl(controls));

  // A `button` scene-control tool resolves through `onChange`, which only fires
  // when the active tool *changes* — so the button sticks and every repeat click
  // is swallowed. For a director this is the whole feature: the Control Center
  // shows no editors to a non-GM, so the scene control is their only way in, and
  // it opened once per session at best. The shared helper binds the rendered
  // node, and `openDirectorApp` reuses its singleton, so a native `onChange`
  // firing as well never stacks a second window.
  Hooks.on("renderSceneControls", (_app, html) => {
    bindSuiteToolClicks(html, { [CONTROL_ROOM_TOOL]: () => openDirectorApp() });
  });
}

export async function onReady() {
  state.streamMode = new StreamMode();
  // Foundry's own auto-pans (to a controlled token that moves, to a chat bubble's speaker) would fight the
  // stream camera; they are refused while stream mode owns the shot.
  installPanGuard(state.streamMode);
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
    if (key === "chatFilter") renderChatFilterApp();
    // Appointing a director is a world setting, so it lands on the appointee's
    // client with nothing redrawn. Their scene controls were built while they
    // were not a director and stay that way until a reload, which reads as the
    // appointment not having worked. Same on the way back out.
    // `reset` is what makes SceneControls re-run getSceneControlButtons; a plain render reuses the
    // cached tool list, so the appointment would still need a reload.
    if (["trustedDirectorUserIds", "streamUserId"].includes(key)) ui.controls?.render({ reset: true });
    if (!["streamUserId", "autoStartStreamUserIds"].includes(key)) return;
    if (state.streamMode?.isStreamUser) state.streamMode.promptIfNeeded();
    else state.streamMode?.deactivate({ notify: false });
  });
  Hooks.on(HOOKS.clientStatus, () => renderDirectorApp());
  Hooks.on(HOOKS.uiDetectedChanged, () => renderDirectorApp());

  Hooks.on("canvasReady", () => state.streamMode?.reportStatus());
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id === canvas?.scene?.id && isStreamSceneFlagChange(changes)) renderDirectorApp();
  });
  // A capture login that drops would otherwise read "Active" in the panel, with Stop and Reframe live,
  // until something else happened to re-render it.
  Hooks.on("userConnected", (user, connected) => {
    if (!connected) forgetClientStatus(user.id);
    renderDirectorApp();
  });

  // Resizing the OBS source or going fullscreen after the stream started changes the frame the cards
  // are scaled to and the viewport the camera fitted. Settled once, after the resize stops.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!state.streamMode?.active) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      state.chatOverlay?.applySettings();
      state.camera?.scheduleReframe({ force: true });
    }, 150);
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
