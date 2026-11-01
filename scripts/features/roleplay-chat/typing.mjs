/**
 * Roleplay Chat — the "…" over a token while its player writes in character.
 *
 * A writer's client announces itself on the suite socket at most once per `TYPING.ping` while text is in
 * the box, and once more with `on: false` when the box empties, the line is sent or the mode leaves
 * character. Every other client draws the pill over that token and drops it after `TYPING.expire`
 * without a fresh ping, so a client that closes mid-sentence cannot leave one up forever.
 *
 * It carries no text and no name: only a scene and a token id, which every client already holds. It is
 * still a claim about somebody, so the receiver honours it only on the server's attested sender, and
 * only when that user is a GM or owns the token's actor (`acceptTyping`). A line about to be whispered,
 * a hidden token, a slash command and the Narrator announce nothing (`shouldAnnounceTyping`).
 */

import { Features } from "../../core/registry.mjs";
import { emitSocket, onSocket } from "../../core/socket.mjs";
import { isConfiguredStreamUser } from "../stream/settings.js";
import { FEATURE_ID } from "./constants.mjs";
import { TYPING, acceptTyping, shouldAnnounceTyping, visibilityMode } from "./model.mjs";
import { overlaysOn, streamBubblesOn, typingOn } from "./settings.mjs";
import { overlay } from "./overlay.mjs";

const KIND = "typing";

let lastPing = 0;
/** `${scene}:${token}` this client last said it was typing over, or null. */
let announced = null;

/* ── the writer ────────────────────────────────────────────────────────────── */

/**
 * The composer calls this on every input, and with `text: ""` once a line is sent.
 * @param {{mode: string, speaker: object|null, text: string}} s
 */
export function noteTyping({ mode, speaker, text }) {
  if (!typingOn()) return stop();
  const data = speaker?.speakerData;
  const token = data?.token && data?.scene ? game.scenes?.get(data.scene)?.tokens?.get(data.token) : null;
  const announce = shouldAnnounceTyping({
    mode,
    visibility: visibilityMode(game.settings.get("core", "messageMode"), false),
    token: token ? { hidden: Boolean(token.hidden) } : null,
    text
  });
  if (!announce) return stop();
  const key = `${data.scene}:${data.token}`;
  if (announced && announced !== key) stop();
  const now = Date.now();
  if (announced === key && now - lastPing < TYPING.ping) return;
  announced = key;
  lastPing = now;
  emitSocket(FEATURE_ID, { t: KIND, on: true, scene: data.scene, token: data.token });
}

/** Say once that this client stopped, if it ever said it started. */
export function stop() {
  if (!announced) return;
  const [scene, token] = announced.split(":");
  announced = null;
  lastPing = 0;
  emitSocket(FEATURE_ID, { t: KIND, on: false, scene, token });
}

/* ── everybody else ────────────────────────────────────────────────────────── */

const isId = (value) => typeof value === "string" && /^[A-Za-z0-9]{1,64}$/.test(value);

export function listenTyping() {
  onSocket(FEATURE_ID, (payload, _claimed, meta) => {
    if (payload.t !== KIND) return;
    if (!canvas?.ready || payload.scene !== canvas.scene?.id) return;
    const placeable = canvas.tokens?.get(payload.token);
    const sender = game.users?.get(meta?.attested ?? "");
    // Taking a pill down is a claim about somebody too: only the writer (or a GM) may.
    if (!payload.on) {
      if (sender && (sender.isGM || placeable?.actor?.testUserPermission?.(sender, "OWNER"))) overlay.typing(payload.token, false);
      return;
    }
    if (!typingOn() || !overlaysOn()) return;
    if (Features.on("stream") && isConfiguredStreamUser() && !streamBubblesOn()) return;
    const ok = acceptTyping({
      attested: Boolean(sender),
      senderIsGM: Boolean(sender?.isGM),
      senderOwns: Boolean(placeable?.actor?.testUserPermission?.(sender, "OWNER")),
      tokenVisible: Boolean(placeable?.visible && !placeable.document?.hidden)
    });
    if (ok) overlay.typing(payload.token, true);
  }, {
    validate: (p) => p?.t === KIND && typeof p.on === "boolean" && isId(p.scene) && isId(p.token)
  });
}
