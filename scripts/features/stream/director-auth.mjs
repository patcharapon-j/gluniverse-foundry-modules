/**
 * GLUniverse Stream — who may drive the shot, and how their writes get there.
 *
 * A GM may appoint trusted players as directors, so a co-host can run the
 * camera, chat and overlays from their own login. World settings and scene
 * flags are GM-only, so a director's change has to reach a GM somehow.
 *
 * The standalone module did that over its own socket: the director emitted
 * `{ userId, key, value }` and a GM's client wrote it. **That is not
 * authorisation.** Foundry's raw module sockets carry no server-attested
 * identity — `core/socket.mjs` says so in as many words, and the suite's own
 * dispatcher derives its `senderId` from a field the sender puts there. Any
 * player could forge a director message. The allowlist made it worse rather
 * than better: it included `trustedDirectorUserIds`, so one forged message
 * appointed the forger a permanent director.
 *
 * So a request travels on a channel Foundry's **server** polices instead. The
 * requester records it as a flag on *their own User document*; a GM sees
 * `updateUser` and performs the write. Foundry only lets a user write their own
 * User document, so the flag's owner is attested by the server rather than
 * claimed by the payload — every rule below is checked against `user`, the
 * document the change arrived on, and no id is ever read out of the request.
 *
 * Three kinds travel this way, with different rules, because they answer
 * different questions:
 *
 *   `setting`    a director changing the shot. Allow-listed keys only.
 *   `sceneFlag`  a director tracking a token. `trackedTokenIds` only.
 *   `autoStart`  the stream user remembering its own "always enter stream
 *                mode" answer. Authorised by *being* the configured stream
 *                user, which is not the same as being a director — the capture
 *                login usually directs nothing.
 *
 * Two settings never travel this path at all. `streamUserId` and
 * `trustedDirectorUserIds` decide *who the feature answers to*; that is world
 * administration, not directing, and keeping them GM-only closes the
 * escalation path independently of everything above.
 *
 * **Fail closed.** Whether a non-GM may flag their own User document is a
 * Foundry permission detail this code does not assume. The first delegated
 * write probes it; if Foundry refuses, delegation is reported unavailable and
 * the panel goes read-only for non-GMs. The failure mode is "trusted directors
 * do not work", never "trusted directors work insecurely".
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { FLAGS, PREFIX } from "./constants.js";

/** The flag a client writes on its own User document to request a write. */
export const REQUEST_FLAG = `${PREFIX}request`;

/**
 * Commands ride a *separate* flag from requests. They have a different consumer
 * — the stream client executes them, no GM involved — and sharing one flag
 * would mean a command and a setting change racing to overwrite each other,
 * with the GM's relay clearing whichever arrived second.
 */
export const COMMAND_FLAG = `${PREFIX}command`;

/** Settings a trusted director may change. See the header for the two absent. */
export const DELEGABLE_KEYS = Object.freeze(new Set([
  `${PREFIX}autoStartStreamUserIds`,
  `${PREFIX}cameraSettings`,
  `${PREFIX}chatSettings`,
  `${PREFIX}dialogSettings`,
  `${PREFIX}uiRules`,
]));

/** Scene flags a trusted director may set. */
export const DELEGABLE_SCENE_FLAGS = Object.freeze(new Set([FLAGS.trackedTokenIds]));

/** Set once Foundry refuses a self-flag write on this client. */
let delegationRefused = false;

/** True if this user is a GM, or a player the GM appointed as a director. */
export function isDirectorUser(user = game.user, trustedIds = null) {
  if (!user) return false;
  if (user.isGM) return true;
  const ids = trustedIds ?? readTrusted();
  return ids.includes(user.id);
}

function readTrusted() {
  try {
    const v = game.settings.get(SUITE_ID, `${PREFIX}trustedDirectorUserIds`);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function configuredStreamUserId() {
  try {
    return game.settings.get(SUITE_ID, `${PREFIX}streamUserId`) || "";
  } catch {
    return "";
  }
}

/**
 * True when a non-GM director can actually get a write through: they are a
 * director, a GM is connected to perform it, and Foundry has not refused the
 * channel. GMs always return true — they write directly.
 */
export function canDelegate() {
  if (game.user?.isGM) return true;
  if (delegationRefused) return false;
  if (!isDirectorUser()) return false;
  return game.users?.some((u) => u.isGM && u.active) ?? false;
}

/** Has Foundry refused the attested channel on this client? */
export function delegationUnavailable() {
  return delegationRefused;
}

/** Record a request on this user's own document, or report it refused. */
async function fileRequest(request) {
  try {
    await game.user.setFlag(SUITE_ID, REQUEST_FLAG, { ...request, at: Date.now() });
    return true;
  } catch (error) {
    delegationRefused = true;
    warn("Stream: delegated writes are unavailable on this world; the panel is read-only for non-GMs.", error);
    return false;
  }
}

/**
 * Ask for a world setting to be written. A GM writes it directly.
 *
 * Returns true if the write happened or was queued, false if refused — callers
 * re-read the stored value either way, so a refusal shows the unchanged setting
 * rather than an optimistic edit that never landed.
 */
export async function requestWrite(key, value) {
  if (game.user?.isGM) {
    await game.settings.set(SUITE_ID, key, value);
    return true;
  }
  if (!DELEGABLE_KEYS.has(key)) return false;
  if (!isDirectorUser()) return false;
  return fileRequest({ kind: "setting", key, value });
}

/** Ask for a scene flag to be set (tracked tokens). */
export async function requestSceneFlag(sceneId, flagKey, value) {
  if (!DELEGABLE_SCENE_FLAGS.has(flagKey)) return false;
  if (game.user?.isGM) {
    const scene = game.scenes?.get(sceneId);
    if (!scene) return false;
    await scene.setFlag(SUITE_ID, flagKey, value);
    return true;
  }
  if (!isDirectorUser()) return false;
  return fileRequest({ kind: "sceneFlag", sceneId, flagKey, value });
}

/**
 * The stream user remembering its own "always enter stream mode" answer.
 * Authorised by being that user — a capture login is rarely a director.
 */
export async function requestAutoStart(enabled) {
  if (game.user?.isGM) {
    await writeAutoStart(game.user.id, enabled);
    return true;
  }
  if (configuredStreamUserId() !== game.user?.id) return false;
  return fileRequest({ kind: "autoStart", enabled: Boolean(enabled) });
}

async function writeAutoStart(userId, enabled) {
  const key = `${PREFIX}autoStartStreamUserIds`;
  const ids = new Set(game.settings.get(SUITE_ID, key) ?? []);
  if (enabled) ids.add(userId);
  else ids.delete(userId);
  await game.settings.set(SUITE_ID, key, Array.from(ids));
}

/**
 * Send a command to the stream client (start, stop, restore UI, reframe).
 *
 * This is the other half of what the standalone module sent over its socket,
 * and it was spoofable in the same way: the stream client checked
 * `isDirectorUser(game.users.get(message.userId))` against an id the sender
 * supplied, so anyone could stop the stream or restore its UI mid-broadcast.
 * A command is a flag on the sender's own User document for the same reason a
 * setting request is — the stream client reads the author off the document.
 *
 * A flag write per command is heavier than a socket emit. Commands are button
 * presses, so that is affordable; correctness is not.
 */
export async function requestCommand(command, payload = {}) {
  if (!isDirectorUser()) return false;
  try {
    await game.user.setFlag(SUITE_ID, COMMAND_FLAG, { command, payload, at: Date.now() });
    return true;
  } catch (error) {
    warn("Stream: could not send a director command.", error);
    return false;
  }
}

/**
 * Stream-client side of the command channel. `handler(command, payload)` runs
 * only for a command whose *document author* is a director.
 */
export function installCommandListener(handler) {
  Hooks.on("updateUser", async (user, changes) => {
    const message = changes?.flags?.[SUITE_ID]?.[COMMAND_FLAG];
    if (!message || typeof message !== "object") return;
    if (!isDirectorUser(user)) return;
    try {
      await handler(message.command, message.payload ?? {});
    } catch (error) {
      warn(`Stream: director command "${message.command}" failed.`, error);
    }
  });
}

/**
 * GM side of the channel. One GM performs the write — the same lowest-active-GM
 * election the rest of the suite uses — so a request is not written once per
 * connected GM.
 *
 * `sanitize(key, value)` is injected rather than imported, to keep this module
 * free of a cycle back through settings.
 */
export function installDirectorRelay(sanitize) {
  Hooks.on("updateUser", async (user, changes) => {
    if (!game.user?.isGM) return;
    if (game.users?.activeGM !== game.user) return;

    const request = changes?.flags?.[SUITE_ID]?.[REQUEST_FLAG];
    if (!request || typeof request !== "object") return;

    // `user` is the document the flag lives on, so this *is* the author. No id
    // is read out of the request itself.
    try {
      await applyRequest(user, request, sanitize);
    } catch (error) {
      warn(`Stream: could not apply a "${request.kind}" request.`, error);
    } finally {
      // Clear it so a reconnect, or an identical next request, is still
      // delivered as a change.
      try {
        await user.unsetFlag(SUITE_ID, REQUEST_FLAG);
      } catch {
        /* the request was applied; a stale flag is harmless */
      }
    }
  });
}

async function applyRequest(user, request, sanitize) {
  switch (request.kind) {
    case "setting": {
      if (user.isGM) return; // a GM writes directly; nothing should arrive here
      if (!isDirectorUser(user)) return;
      if (!DELEGABLE_KEYS.has(request.key)) return;
      await game.settings.set(SUITE_ID, request.key, sanitize(request.key, request.value));
      return;
    }
    case "sceneFlag": {
      if (!isDirectorUser(user)) return;
      if (!DELEGABLE_SCENE_FLAGS.has(request.flagKey)) return;
      const scene = game.scenes?.get(request.sceneId);
      if (!scene) return;
      await scene.setFlag(SUITE_ID, request.flagKey, request.value);
      return;
    }
    case "autoStart": {
      // Not a director check: the stream user speaks for its own auto-start.
      if (configuredStreamUserId() !== user.id) return;
      await writeAutoStart(user.id, Boolean(request.enabled));
      return;
    }
    default:
  }
}
