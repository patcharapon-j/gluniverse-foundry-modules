/**
 * GLUniverse Stream — client status broadcast.
 *
 * What is left here after the merge is only the part that carries no authority:
 * the stream client telling the control panel that it is running, what scene it
 * is on and how it is framed, and the panel asking it to say so again.
 *
 * Everything that *changed* something used to live here too — setting writes,
 * scene flags, auto-start, and the start/stop/restore/reframe commands — routed
 * over the module's own raw socket channel and authorised against a `userId`
 * the sender put in the payload. All of it moved to `director-auth.mjs`, which
 * carries requests on User documents where Foundry's server attests the author.
 * See that module's header.
 *
 * Two things follow from that:
 *
 *   - This module no longer opens a raw Foundry socket of its own. The suite multiplexes one
 *     channel and tags payloads by feature; a second raw `.on()` handler on
 *     `module.gluniverse-foundry-modules` is exactly what `core/socket.mjs`
 *     exists to prevent.
 *   - A status report is still unauthenticated, and deliberately so. It is a
 *     claim about the sender's own screen with nothing behind it — the worst a
 *     forged one can do is put a wrong line in the control panel's status
 *     readout. Nothing reads it to decide whether an action is permitted.
 */

import { onSocket, emitSocket } from "../../core/socket.mjs";
import { FEATURE_ID, HOOKS, MODULE_ID, SOCKET_TYPES, STREAM_COMMANDS } from "./constants.js";
import { installCommandListener } from "./director-auth.mjs";
import { getSetting, isConfiguredStreamUser } from "./settings.js";

let services = {};
const clientStatusByUser = new Map();

/** Wire the feature's socket handler and the attested command channel. */
export function registerSocket(nextServices) {
  services = nextServices;

  onSocket(FEATURE_ID, (payload, senderId) => {
    if (!payload || senderId === game.user?.id) return;

    if (payload.type === SOCKET_TYPES.clientStatus) {
      // `senderId` is the claimed sender and is not attested. It is used as a
      // map key for a status readout and for nothing else.
      if (!senderId) return;
      clientStatusByUser.set(senderId, payload.payload);
      Hooks.callAll(HOOKS.clientStatus, payload.payload);
      return;
    }

    if (payload.type === SOCKET_TYPES.requestClientStatus) {
      if (isConfiguredStreamUser()) services.streamMode?.reportStatus();
    }
  });

  // Only the stream client acts on commands, but the listener is installed
  // unconditionally: which user is the stream user can change while connected.
  installCommandListener(async (command, payload) => {
    if (!isConfiguredStreamUser()) return;
    await handleStreamCommand(command, payload);
  });
}

export function emitClientStatus(status) {
  const payload = { timestamp: Date.now(), ...status };
  clientStatusByUser.set(game.user.id, payload);
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.clientStatus, payload });
  Hooks.callAll(HOOKS.clientStatus, payload);
}

export function getStreamClientStatus() {
  const streamUserId = getSetting("streamUserId");
  return streamUserId ? clientStatusByUser.get(streamUserId) : undefined;
}

export function requestStreamClientStatus() {
  emitSocket(FEATURE_ID, { type: SOCKET_TYPES.requestClientStatus });
  if (isConfiguredStreamUser()) services.streamMode?.reportStatus();
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
