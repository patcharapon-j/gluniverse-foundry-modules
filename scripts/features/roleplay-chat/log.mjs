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
import { I18N, hasAsides, isInCharacter, leadJoint, quoteEdges } from "./model.mjs";
import { leadHTML, lineHTML, logHeadHTML, oocTagHTML } from "./render.mjs";
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
    hiddenFromPlayers: who.hiddenFromPlayers && !who.unknown,
    hiddenHint: loc("GLRP.log.hiddenName")
  });
  header.prepend(head);
  content.classList.add("glrp-body");
  trimEdges(content);
  if (mode === "do") addLead(content, who.name);
  if (mode === "say") markAsides(content);
}

/**
 * Puts the speaker's bold name at the front of a Do line, as nodes. The body is never re-parsed, so
 * nothing an enricher bound to it is lost, and when the line is a paragraph the name goes inside it:
 * set in front of a `<p>`, it stood on a line of its own above the action.
 */
export function addLead(el, name) {
  const opening = [...el.childNodes].find((n) => n.nodeType !== Node.TEXT_NODE || n.textContent.trim());
  const host = opening?.nodeType === Node.ELEMENT_NODE && opening.matches("p") ? opening : el;
  // The lead is the same markup the overlays draw, parsed from an escaped string, never from the body.
  const t = document.createElement("template");
  t.innerHTML = leadHTML(name, "");
  const lead = t.content.firstElementChild;
  const head = host.firstChild;
  if (head?.nodeType === Node.TEXT_NODE) head.textContent = head.textContent.trimStart();
  const joint = leadJoint(firstText(host));
  host.prepend(lead, ...(joint ? [document.createTextNode(joint)] : []));
}

/** The line's first visible characters, to decide the joint between the name and the action. */
function firstText(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trimStart();
    if (text) return text;
  }
  return "";
}

/**
 * Sets a Say line's `*asides*` apart, in place. Only text nodes are rewritten, so links, enrichers and
 * anything else bound to the body survive; an aside that straddles markup is left as typed. The quote
 * marks around each aside, and the line's own outer marks, follow `asideRuns` / `quoteEdges`.
 */
export function markAsides(el) {
  if (!hasAsides(el.textContent)) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (hasAsides(node.textContent) && !node.parentElement?.closest("a, code, pre, .glrp-aside")) nodes.push(node);
  }
  if (!nodes.length) return;
  for (const node of nodes) {
    const t = document.createElement("template");
    t.innerHTML = lineHTML("say", node.textContent);
    node.replaceWith(t.content);
  }
  // Each aside's marks are decided across the whole body, not the text node it came from: in
  // "<b>Hold!</b> *draws* <b>Run!</b>" the words either side live in other elements.
  const runs = textRuns(el);
  runs.forEach((run, i) => {
    if (!run.aside || runs[i - 1]?.aside === run.aside) return;
    let last = i;
    while (runs[last + 1]?.aside === run.aside) last += 1;
    run.aside.toggleAttribute("data-closes", runs[i - 1]?.aside === null);
    run.aside.toggleAttribute("data-opens", runs[last + 1]?.aside === null);
  });
  const edges = quoteEdges(runs.map((run) => ({ aside: Boolean(run.aside) })));
  if (!edges.opens) el.dataset.glrpOpen = "aside";
  if (!edges.closes) el.dataset.glrpClose = "aside";
}

/** The body's visible text nodes in order, each with the aside it sits in, or null. */
function textRuns(el) {
  const runs = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent.trim()) runs.push({ aside: node.parentElement?.closest(".glrp-aside") ?? null });
  }
  return runs;
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
