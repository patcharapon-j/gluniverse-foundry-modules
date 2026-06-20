import { FEATURE_ID, FLAGS, HOOK_NS, KEY, MODULE_ID, SOCKET_TYPES, STREAM_COMMANDS } from "./constants.js";
import { getSetting, isConfiguredStreamUser, isDirectorUser, sanitizeSetting } from "./settings.js";
import { emitSocket, onSocket } from "../../core/socket.mjs";

let services = {};
const clientStatusByUser = new Map();
const DIRECTOR_SETTING_KEYS = new Set(["streamUserId", "autoStartStreamUserIds", "trustedDirectorUserIds", "cameraSettings", "chatSettings", "dialogSettings", "uiRules", "hudSettings"]);

export function registerSocket(nextServices) {
  services = nextServices;
  onSocket(FEATURE_ID, handleSocketMessage);
}

export function emitClientStatus(status) {
  const payload = { userId: game.user.id, timestamp: Date.now(), ...status };
  clientStatusByUser.set(game.user.id, payload);
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.clientStatus, userId: game.user.id, payload });
  Hooks.callAll(`${HOOK_NS}.clientStatus`, payload);
}

export function getStreamClientStatus() {
  const streamUserId = game.settings.get(MODULE_ID, KEY("streamUserId"));
  return streamUserId ? clientStatusByUser.get(streamUserId) : undefined;
}

export function requestStreamClientStatus() {
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.requestClientStatus, userId: game.user.id });
  if (isConfiguredStreamUser()) services.streamMode?.reportStatus();
}

export function sendStreamCommand(command, payload = {}) {
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.command, userId: game.user.id, command, payload });
  if (isConfiguredStreamUser()) handleStreamCommand(command, payload);
}

export function requestSettingSet(key, value) {
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.requestSettingSet, userId: game.user.id, key, value });
}

export function requestSceneFlagSet(sceneId, flagKey, value) {
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.requestSceneFlagSet, userId: game.user.id, sceneId, flagKey, value });
}

export async function requestAutoStartSet(enabled) {
  if (game.user?.isGM) return setAutoStartForUser(game.user.id, enabled);
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.requestAutoStartSet, userId: game.user.id, enabled: Boolean(enabled) });
}

/**
 * Broadcast the GM-computed Party HUD state to the stream client. Only the
 * responsible GM emits (avoids multi-GM double-emit); if this client is itself
 * the stream user (solo GM streamer) the state is applied locally too, since
 * Foundry's socket never echoes to the sender.
 */
export function emitHudState(state) {
  if (!isResponsibleGM()) return;
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.hudState, userId: game.user.id, state });
  if (isConfiguredStreamUser()) services.partyHud?.applyState(state);
}

/** Stream client asks the GM for the current Party HUD state (e.g. on load). */
export function requestHudState() {
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.requestHudState, userId: game.user.id });
}

export async function setSceneFlag(scene, flagKey, value) {
  if (!scene || ![FLAGS.trackedTokenIds, FLAGS.sceneCameraOverride].includes(flagKey)) return;
  if (game.user?.isGM) return scene.setFlag(MODULE_ID, flagKey, value);
  requestSceneFlagSet(scene.id, flagKey, value);
}

async function handleSocketMessage(message) {
  if (!message || message.userId === game.user?.id) return;

  if (message.type === SOCKET_TYPES.clientStatus) {
    clientStatusByUser.set(message.userId, message.payload);
    Hooks.callAll(`${HOOK_NS}.clientStatus`, message.payload);
    return;
  }

  if (message.type === SOCKET_TYPES.requestClientStatus) {
    if (isConfiguredStreamUser()) services.streamMode?.reportStatus();
    return;
  }

  if (message.type === SOCKET_TYPES.command) {
    if (!isConfiguredStreamUser()) return;
    if (!isDirectorUser(game.users?.get(message.userId))) return;
    await handleStreamCommand(message.command, message.payload ?? {});
    return;
  }

  if (message.type === SOCKET_TYPES.requestSettingSet) {
    if (!isResponsibleGM() || !isDirectorUser(game.users?.get(message.userId))) return;
    if (!DIRECTOR_SETTING_KEYS.has(message.key)) return;
    await game.settings.set(MODULE_ID, KEY(message.key), sanitizeSetting(message.key, message.value));
    return;
  }

  if (message.type === SOCKET_TYPES.requestSceneFlagSet) {
    if (!isResponsibleGM() || !isDirectorUser(game.users?.get(message.userId))) return;
    const scene = game.scenes?.get(message.sceneId);
    if (scene && [FLAGS.trackedTokenIds, FLAGS.sceneCameraOverride].includes(message.flagKey)) await scene.setFlag(MODULE_ID, message.flagKey, message.value);
    return;
  }

  if (message.type === SOCKET_TYPES.hudState) {
    if (!isConfiguredStreamUser()) return;
    if (!game.users?.get(message.userId)?.isGM) return;
    services.partyHud?.applyState(message.state);
    return;
  }

  if (message.type === SOCKET_TYPES.requestHudState) {
    if (isResponsibleGM()) services.hudController?.broadcast();
    return;
  }

  if (message.type === SOCKET_TYPES.requestAutoStartSet) {
    if (!isResponsibleGM()) return;
    if (getSetting("streamUserId") !== message.userId) return;
    await setAutoStartForUser(message.userId, Boolean(message.enabled));
  }
}

async function handleStreamCommand(command, payload) {
  switch (command) {
    case STREAM_COMMANDS.start:
      await services.streamMode?.requestStart({ source: "director" });
      break;
    case STREAM_COMMANDS.stop:
      services.streamMode?.deactivate({ notify: true, source: "director" });
      break;
    case STREAM_COMMANDS.toggleRestore:
      services.streamMode?.toggleRestore();
      break;
    case STREAM_COMMANDS.reframe:
      services.streamMode?.reportStatus();
      if (!services.streamMode?.active) break;
      await services.camera?.reframe(payload ?? {});
      services.streamMode?.reportStatus();
      break;
  }
}

function isResponsibleGM() {
  if (!game.user?.isGM) return false;
  const activeGMs = game.users?.filter(user => user.active && user.isGM).sort((a, b) => a.id.localeCompare(b.id)) ?? [];
  return activeGMs[0]?.id === game.user.id;
}

async function setAutoStartForUser(userId, enabled) {
  const ids = new Set(getSetting("autoStartStreamUserIds") ?? []);
  if (enabled) ids.add(userId);
  else ids.delete(userId);
  await game.settings.set(MODULE_ID, KEY("autoStartStreamUserIds"), Array.from(ids));
}
