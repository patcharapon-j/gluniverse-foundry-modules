/**
 * Diorama view — bringing the table along.
 *
 *   INVITE   The GM opening the view invites the players viewing that scene.
 *            Each client obeys its own `dio.invite`: ask (a small toast with
 *            Join / Not now), auto, or never.
 *   SUMMON   "Bring everyone to my view": the GM's camera, which every client
 *            that has the view open on that scene tweens to.
 *
 *   HOLD     A miniature picked up in the lift move style: its pose, so the
 *            table watches it travel. From the token's owner (or a GM), and
 *            drawn only by a viewer whose board shows that token.
 *
 * Invite and summon are honoured only from a GM, by the server-attested sender
 * (`meta.attested`), never the claimed one. Recipients are filtered on the
 * server, so a client on another scene is never sent either.
 *
 * Light on purpose: main.mjs imports this at ready, and the view itself is
 * loaded only when something actually opens it (`loadView`).
 */

import { emitSocket, onSocket } from "../../../core/socket.mjs";
import { FEATURE_ID, MSG, SETTINGS, TIMING } from "../constants.mjs";
import { el, setting, streamOwnsView, t } from "./util.mjs";

/** Users currently viewing a scene, other than this one. */
export function usersOnScene(sceneId) {
  const out = [];
  for (const u of globalThis.game?.users ?? []) {
    if (!u.active || u.isSelf || u.id === game.user.id) continue;
    if (u.viewedScene === sceneId) out.push(u.id);
  }
  return out;
}

export function sendInvite(sceneId) {
  const recipients = usersOnScene(sceneId);
  if (recipients.length) emitSocket(FEATURE_ID, { type: MSG.invite, sceneId }, { recipients });
}

export function sendSummon(sceneId, camera) {
  const recipients = usersOnScene(sceneId);
  if (recipients.length) emitSocket(FEATURE_ID, { type: MSG.summon, sceneId, camera }, { recipients });
}

/**
 * A miniature in this player's hand, to everyone else watching the scene. A
 * hidden token's pose goes to GMs only: players are never told where it is.
 */
export function sendHold(sceneId, doc, pose) {
  const all = usersOnScene(sceneId);
  const recipients = doc?.hidden ? all.filter((id) => globalThis.game?.users?.get(id)?.isGM) : all;
  if (!recipients.length || !doc?.id) return;
  emitSocket(FEATURE_ID, {
    type: MSG.hold, sceneId, tokenId: doc.id, phase: pose.phase,
    x: pose.x, y: pose.y, footQ: pose.footQ, groundQ: pose.groundQ, tone: pose.tone ?? "info",
  }, { recipients });
}

/** Payload shape check (runs before the handler). */
export function validPayload(p) {
  if (!p || typeof p !== "object" || typeof p.sceneId !== "string") return false;
  if (p.type === MSG.invite) return true;
  if (p.type === MSG.summon) return !!p.camera && typeof p.camera === "object";
  if (p.type === MSG.hold) {
    return typeof p.tokenId === "string" && (p.phase === "carry" || p.phase === "drop")
      && [p.x, p.y, p.footQ].every((v) => typeof v === "number" && Number.isFinite(v));
  }
  return false;
}

let _toast = null;

function closeToast() {
  if (!_toast) return;
  clearTimeout(_toast.timer);
  _toast.node.remove();
  _toast = null;
}

function askToast(senderName, onJoin) {
  closeToast();
  const join = el("button", { type: "button", class: "gldio-btn gldio-btn--text gl-btn gl-btn-accent", text: t("GLDIO.invite.join") });
  const later = el("button", { type: "button", class: "gldio-btn gldio-btn--text gl-btn", text: t("GLDIO.invite.later") });
  const node = el("div", { class: "gldio-toast gl-glass gl-type", role: "dialog", "aria-live": "polite" }, [
    el("i", { class: "fa-solid fa-cubes", "aria-hidden": "true" }),
    el("span", { class: "gldio-toast-text", text: t("GLDIO.invite.ask", { name: senderName }) }),
    join, later,
  ]);
  join.addEventListener("click", () => { closeToast(); onJoin(); });
  later.addEventListener("click", closeToast);
  document.body.append(node);
  _toast = { node, timer: setTimeout(closeToast, TIMING.inviteTimeout) };
}

/**
 * Wire the socket. Called from onReady.
 * @param {() => Promise<object>} loadView  resolves the overlay module
 * @param {() => boolean} isOpen            without loading it
 */
export function wireSocket(loadView, isOpen) {
  onSocket(FEATURE_ID, async (payload, _claimed, meta) => {
    const sender = meta?.attested ? game.users.get(meta.attested) : null;
    // A hold comes from whoever owns the token (the view checks the ownership).
    if (payload.type === MSG.hold) {
      if (sender && isOpen()) (await loadView()).applyHold(payload, sender);
      return;
    }
    if (!sender?.isGM) return;
    if (payload.sceneId !== globalThis.canvas?.scene?.id) return;
    if (payload.type === MSG.invite) {
      const mode = setting(SETTINGS.invite, "ask");
      if (mode === "never" || isOpen()) return;
      const open = () => loadView().then((view) => view.openView());
      // The stream capture never shows a toast to the audience: "ask" joins.
      if (mode === "auto" || streamOwnsView()) { open(); return; }
      askToast(sender.name, open);
      return;
    }
    if (payload.type === MSG.summon && isOpen()) {
      const view = await loadView();
      view.applySummon(payload.sceneId, payload.camera);
    }
  }, { validate: validPayload });
}

export { closeToast };
