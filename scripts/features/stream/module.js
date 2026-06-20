import { FEATURE_ID, HOOK_NS, KEY, MODULE_ID } from "./constants.js";
import { featurePath } from "../../core/const.mjs";
import { CameraController } from "./camera-controller.js";
import { ChatOverlay } from "./chat-overlay.js";
import { addStreamSceneControl, configureDirectorApp, openDirectorApp, renderDirectorApp } from "./director-app.js";
import { DialogOverlay } from "./dialog-overlay.js";
import { registerSettings } from "./settings.js";
import { registerSocket } from "./socket.js";
import { StreamMode } from "./stream-mode.js";
import { TokenTracking } from "./token-tracking.js";
import { UiDetector } from "./ui-detector.js";

export { registerSettings };

// Shared service handles, populated in `onReady`. Methods on the exposed `api`
// resolve against this at call time so the reference handed to the suite stays
// stable even though the services are created lazily.
const state = {};

/**
 * Public API exposed at `game.modules.get(SUITE_ID).api.features.stream`. The old
 * standalone module had no API; these are convenience entry points for macros.
 */
export const api = {
  openDirector: () => openDirectorApp(),
  getStreamMode: () => state.streamMode ?? null,
  getCamera: () => state.camera ?? null
};

/** Formerly the standalone module's `init` hook body. Runs only when enabled. */
export function onInit() {
  registerKeybindings();
  foundry.applications.handlebars.loadTemplates([
    featurePath(FEATURE_ID, "templates/director.hbs"),
    featurePath(FEATURE_ID, "templates/start-prompt.hbs")
  ]);

  Hooks.on("getSceneControlButtons", controls => addStreamSceneControl(controls));
  Hooks.on("canvasReady", () => state.streamMode?.reportStatus());
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id === canvas?.scene?.id && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) renderDirectorApp();
  });
}

/** Formerly the standalone module's `ready` hook body. Runs only when enabled. */
export async function onReady() {
  state.streamMode = new StreamMode();
  state.tokenTracking = new TokenTracking();
  state.camera = new CameraController(state.streamMode, state.tokenTracking);
  state.chatOverlay = new ChatOverlay(state.streamMode);
  state.dialogOverlay = new DialogOverlay(state.streamMode);
  state.uiDetector = new UiDetector(state.streamMode);

  configureDirectorApp(state);
  registerSocket(state);
  state.tokenTracking.registerHooks();
  state.camera.registerHooks();
  state.chatOverlay.registerHooks();
  state.dialogOverlay.registerHooks();
  state.uiDetector.registerHooks();

  Hooks.on(`${HOOK_NS}.settingsChanged`, key => {
    renderDirectorApp();
    if (!["streamUserId", "autoStartStreamUserIds"].includes(key)) return;
    if (state.streamMode?.isStreamUser) state.streamMode.promptIfNeeded();
    else state.streamMode?.deactivate({ notify: false });
  });
  Hooks.on(`${HOOK_NS}.clientStatus`, () => renderDirectorApp());
  Hooks.on(`${HOOK_NS}.uiDetectedChanged`, () => renderDirectorApp());

  await state.streamMode.promptIfNeeded();
}

function registerKeybindings() {
  game.keybindings.register(MODULE_ID, KEY("emergencyRestore"), {
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
