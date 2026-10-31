/**
 * Roleplay Chat — the chat log.
 *
 * An in-character entry keeps Foundry's own element, its timestamp, its delete button and everything
 * any other module added to it; only the sender line is replaced by a head (portrait, name, what kind
 * of line it is) and the body is set in the voice of its mode. An out-of-character entry keeps
 * Foundry's look and gains a small OOC tag.
 *
 * Nothing is restyled whose content this viewer may not read: Foundry has already swapped such a body
 * for its own placeholder, and a head over it would name the speaker of a line the viewer was not sent.
 */

import { rpModeOf } from "../../core/rp-mode.mjs";
import { I18N, isInCharacter } from "./model.mjs";
import { leadHTML, logHeadHTML, oocTagHTML } from "./render.mjs";
import { identityOf } from "./identity.mjs";

const loc = (key) => game.i18n.localize(key);

export function restyleMessage(message, html) {
  if (!(html instanceof HTMLElement) || html.dataset.glrpDone) return;
  const mode = rpModeOf(message?.flags);
  if (message?.style === CONST.CHAT_MESSAGE_STYLES.OOC) return tagOoc(html);
  if (!isInCharacter(mode) || !message.isContentVisible) return;

  const who = identityOf(message);
  const header = html.querySelector(".message-header");
  const sender = header?.querySelector(".message-sender");
  const content = html.querySelector(".message-content");
  if (!header || !content) return;

  html.dataset.glrpDone = "1";
  html.dataset.glrpMode = mode;
  html.classList.add("glrp-msg");
  // Foundry's sender line is hidden, not removed, because systems read it (PF2e rewrites it for a
  // hidden name) — but it is given the same name the head shows, so it cannot say more than the head.
  if (sender) sender.textContent = who.name;
  const head = document.createElement("div");
  head.className = "glrp-head-wrap";
  head.innerHTML = logHeadHTML({
    mode,
    name: who.name,
    img: who.img,
    label: loc(I18N.label(mode)),
    // The mark tells a GM the table reads "Unknown"; a player reading "Unknown" needs no telling.
    hiddenFromPlayers: who.hiddenFromPlayers && game.user.isGM,
    hiddenHint: loc("GLRP.log.hiddenName")
  });
  header.prepend(head);
  content.classList.add("glrp-body");
  if (mode === "do") content.innerHTML = leadHTML(who.name, content.innerHTML.trim());
  else trimEdges(content);
}

/**
 * Foundry's template wraps the content in line breaks. A quote mark drawn by CSS is real content, so
 * the whitespace after it no longer collapses and a Say line reads “ like this ”. The edge text nodes
 * are trimmed in place rather than re-parsed, so nothing an enricher bound to the body is lost.
 */
function trimEdges(el) {
  const first = el.firstChild;
  if (first?.nodeType === Node.TEXT_NODE) first.textContent = first.textContent.trimStart();
  const last = el.lastChild;
  if (last?.nodeType === Node.TEXT_NODE) last.textContent = last.textContent.trimEnd();
}

function tagOoc(html) {
  if (html.querySelector(".glrp-ooc-tag")) return;
  const sender = html.querySelector(".message-sender");
  if (!sender) return;
  html.dataset.glrpDone = "1";
  html.classList.add("glrp-ooc");
  sender.insertAdjacentHTML("afterend", oocTagHTML(loc(I18N.label("ooc"))));
}
