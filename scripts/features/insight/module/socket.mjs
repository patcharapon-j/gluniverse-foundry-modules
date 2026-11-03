// module/socket.mjs — GM to player delivery.
//
// Two rules, both of which used to be missing and neither of which shows on the
// GM's own screen:
//
//  * An Insight is private, so it travels with `recipients`, which the SERVER
//    filters. It used to be broadcast to every client with a `target` field each
//    client checked for itself, which put every private whisper in every other
//    player's socket traffic, one console line away.
//  * Only a GM sends one. A raw module socket carries no identity a client can
//    trust, so the sender is the server-attested one (`meta.attested`), and a
//    payload from a player, or from nobody the server vouched for, is dropped.
//    Without that any player could put a card, with markup in it, on anyone's
//    screen, the GM's included.
//
// The body is reduced to the allow-list here, on the receiving side, whoever
// built it (module/body.mjs).

import { onSocket, emitSocket } from "../../../core/socket.mjs";
import { enqueue } from "./queue.mjs";
import { safeBody, isBlankBody } from "./body.mjs";
import { sharedLabel } from "./recipients.mjs";

const FEATURE_ID = "insight";
export const MESSAGE_TYPE = "insight.notification";

const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * The shape a notification must have to be shown at all. Pure.
 * @param {object} p
 * @returns {boolean}
 */
export function validPayload(p) {
  if (!p || p.type !== MESSAGE_TYPE) return false;
  if (typeof p.id !== "string" || !p.id || p.id.length > 80) return false;
  if (!Array.isArray(p.targets) || !p.targets.length || p.targets.length > 64) return false;
  if (!p.targets.every((t) => typeof t === "string" && t.length <= 40)) return false;
  if (typeof p.body !== "string") return false;
  for (const k of ["title", "sense", "image", "theme"]) {
    if (p[k] != null && typeof p[k] !== "string") return false;
  }
  if (p.shared != null && typeof p.shared !== "boolean") return false;
  return true;
}

/**
 * Who else a card went to, as this recipient may be told. Empty unless the GM
 * chose to say so; a card sent to several people without it still reads
 * "Only you" on each screen, which is the GM's call. Pure.
 * @param {object} p - a payload that passed `validPayload`
 * @param {string} selfId
 * @returns {string[]} user ids, never `selfId`
 */
export function sharedWith(p, selfId) {
  if (p?.shared !== true) return [];
  return [...new Set(p.targets)].filter((t) => t !== selfId);
}

/**
 * What the card is drawn from, re-derived from a payload. Pure.
 * @param {object} p
 */
export function cardData(p) {
  return {
    id: p.id,
    title: text(p.title, 140),
    sense: text(p.sense, 60),
    body: safeBody(p.body),
    image: text(p.image, 400),
    theme: text(p.theme, 40),
  };
}

/**
 * Whether this client shows an arriving payload. Pure.
 * @param {object} payload - already passed `validPayload`
 * @param {string|null} attested - the server-attested sender id, or null
 * @param {{get: (id: string) => ({isGM?: boolean}|undefined)}} users
 * @param {string} selfId - this client's user id
 */
export function accepts(payload, attested, users, selfId) {
  const sender = attested ? users?.get(attested) : null;
  if (!sender?.isGM) return false;
  return payload.targets.includes(selfId);
}

/** Register the socket listener. Called once during `ready`. */
export function registerSocket() {
  onSocket(FEATURE_ID, (payload, _claimed, meta) => {
    if (!accepts(payload, meta?.attested ?? null, game.users, game.user.id)) return;
    receive(payload);
  }, { validate: validPayload });
}

function receive(payload) {
  if (!payload.targets.includes(game.user.id)) return;
  const data = cardData(payload);
  if (isBlankBody(data.body) && !data.title) return;
  // Names are looked up here, on the receiving side, from the ids the server
  // delivered; the payload never carries a name a sender could dress up.
  const names = sharedWith(payload, game.user.id).map((id) => game.users.get(id)?.name);
  data.shared = sharedLabel(names, (k, d) => game.i18n.format(k, d), game.i18n.lang);
  enqueue(data);
}

/**
 * Send a notification to one or more users. GM only.
 * @param {object} data
 * @param {string} [data.target] - one user id
 * @param {string[]} [data.targets] - several user ids
 * @param {string|null} [data.title]
 * @param {string} data.body - HTML; reduced to the allow-list on arrival
 * @param {string|null} [data.sense] - the label on the card's tag
 * @param {string|null} [data.image]
 * @param {string|null} [data.theme] - accent preset override
 * @param {boolean} [data.shared] - tell each recipient who else got it
 * @returns {boolean} whether anything was sent
 */
export function sendNotification(data) {
  if (!game.user?.isGM) return false;
  const targets = [...new Set([...(data.targets ?? []), data.target].filter((t) => typeof t === "string" && t))];
  const payload = {
    type: MESSAGE_TYPE,
    id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    targets,
    title: data.title || null,
    body: String(data.body ?? ""),
    sense: data.sense || null,
    image: data.image || null,
    theme: data.theme || null,
    shared: data.shared === true,
  };
  if (!validPayload(payload)) return false;

  const others = targets.filter((t) => t !== game.user.id);
  if (others.length) emitSocket(FEATURE_ID, payload, { recipients: others });

  // A GM sending to themselves (to try a card out) is not echoed by the server.
  if (targets.includes(game.user.id)) receive(payload);
  return true;
}
