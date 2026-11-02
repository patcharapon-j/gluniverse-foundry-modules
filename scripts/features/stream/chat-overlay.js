import { CHAT_POSITIONS, CLASSES, DEFAULT_CHAT_SETTINGS, HOOKS, MODULE_ID } from "./constants.js";
import { OVERLAY_EASE, OVERLAY_EASE_EXIT, animate, overlayTiming, prefersCalmMotion, remove } from "./motion/engine.js";
import { waitForDiceAnimation } from "./dice-wait.js";
import { createCardFeed, hasCardFeed } from "./extensions.mjs";
import { getChatFilter, getChatSettings } from "./settings.js";
import { DAGGERHEART_SYSTEM, allows, authorColumn, classifyMessage } from "./chat-filter.mjs";
import { isAudienceVisible } from "./audience.mjs";
import { frameImage } from "../../core/face-frame.mjs";
import { rpModeOf } from "../../core/rp-mode.mjs";

/** How far, in px, a cloned card slides in from and out to the edge its stack hugs. */
const CARD_SLIDE_PX = 40;

/** The corner the overlay sits in, from the settings; an unknown value falls back to the default. */
function chatPosition(settings) {
  return CHAT_POSITIONS.includes(settings?.position) ? settings.position : DEFAULT_CHAT_SETTINGS.position;
}

/** -1 for a stack hugging the left edge, 1 for the right. */
function sideSign(position) {
  return position.endsWith("right") ? 1 : -1;
}

export class ChatOverlay {
  constructor(streamMode) {
    this.streamMode = streamMode;
    this.cards = [];
    this.cardsByMessageId = new Map();
    /**
     * Messages already shown this session, kept after their card expires. Foundry re-renders a message on
     * every update (a module writing a flag, a roll revealed) and when older history is loaded, and each
     * of those passes every other test here — so an expired card's message would come back on the
     * broadcast as if it had just been posted.
     */
    this.shownMessageIds = new Set();
    /** When stream mode last started; anything posted before it is history, not news. */
    this.activatedAt = 0;
    // Null unless a feature has claimed the card-feed slot for this world's system; every use below is
    // optional-chained so the overlay degrades to cloned chat cards.
    this.feed = createCardFeed(this, game.system?.id);
  }

  registerHooks() {
    // A system with a reader (PF2e, Daggerheart) gets its own roll cards, built from new messages only,
    // never from re-rendered history.
    Hooks.on("createChatMessage", message => {
      if (!this.streamMode.active || !usesRollCards()) return;
      this.feed?.handleCreate(message)?.catch(error => console.error(`${MODULE_ID} | Roll card failed`, error));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => this.handleRenderedMessage(message, html));
    Hooks.on("updateChatMessage", (message, changes) => this.handleMessageUpdate(message, changes));
    Hooks.on("deleteChatMessage", message => this.handleMessageDelete(message));
    Hooks.on(HOOKS.settingsChanged, key => {
      if (key === "chatSettings") this.applySettings();
    });
    Hooks.on(HOOKS.streamModeChanged, active => {
      if (active) {
        this.activatedAt = Date.now();
        this.applySettings();
        if (usesRollCards()) this.feed?.prescan();
      } else this.clear();
    });
    // New combatants are the next people to roll: frame their art ahead of time.
    const prescan = () => {
      if (this.streamMode.active && usesRollCards()) this.feed?.prescan();
    };
    Hooks.on("createCombatant", prescan);
    Hooks.on("combatStart", prescan);
    Hooks.on("canvasReady", prescan);
  }

  handleRenderedMessage(message, html) {
    if (!this.streamMode.active) return;
    // A feed may hand a message back to be shown as the system's own card (a Daggerheart card posted
    // from a sheet), so the stream shows it whole.
    if (usesRollCards() && !this.feed?.clones?.(message)) return;
    if (!isAudienceVisible(message)) return;
    if (!passesChatFilter(message)) return;
    const source = getElement(html);
    if (!source) return;
    // Modules such as RSReforged run transient/preview renders through
    // renderChatMessageHTML while processing a roll: unsaved ChatMessage husks with
    // no world id, timestamp 0 and empty content. A player's chat log never shows
    // these as cards, so neither should the stream — only mirror messages that
    // actually exist in the world.
    if (!isPersistedMessage(message, source)) return;
    const messageId = message?.id ?? message?.uuid ?? source.dataset.messageId ?? source.dataset.messageUuid;

    if (messageId) {
      const existing = this.cardsByMessageId.get(messageId);
      if (existing) {
        if (existing.element?.isConnected) this.refreshCardContents(existing, message, source);
        return;
      }
      if (this.shownMessageIds.has(messageId)) return;
    }
    // History: a message posted before stream mode started (with a little slack for one being posted as
    // it starts) is never news, however it came to be re-rendered.
    const postedAt = Number(message?.timestamp);
    if (Number.isFinite(postedAt) && postedAt > 0 && postedAt < this.activatedAt - 2000) return;
    if (messageId) this.shownMessageIds.add(messageId);

    const placeholder = { pending: true, messageId };
    if (messageId) this.cardsByMessageId.set(messageId, placeholder);
    this.createCardAfterDice(message, source, messageId, placeholder);
  }

  handleMessageUpdate(message, changes) {
    if (!this.streamMode.active) return;
    // A roll card is rebuilt from the message by its own feed, when the feed reads updates at all: PF2e
    // rerolls by posting a new message, Daggerheart rewrites the one it posted (a reroll, the Fear claim).
    if (usesRollCards()) {
      try {
        this.feed?.handleUpdate?.(message, changes)?.catch?.(error => console.error(`${MODULE_ID} | Roll card update failed`, error));
      } catch (error) {
        console.error(`${MODULE_ID} | Roll card update failed`, error);
      }
      if (!this.feed?.clones?.(message)) return;
    }
    const id = message?.id;
    if (!id) return;
    const record = this.cardsByMessageId.get(id);
    if (!record?.element?.isConnected) return;
    window.requestAnimationFrame(() => {
      const latest = getLatestRenderedMessage(null, message, id);
      if (latest) this.refreshCardContents(record, message, latest);
    });
  }

  handleMessageDelete(message) {
    const id = message?.id;
    if (!id) return;
    if (usesRollCards() && this.feed?.handleDelete(message)) return;
    const record = this.cardsByMessageId.get(id);
    // Mark the record so an in-flight createCardAfterDice (still awaiting the dice
    // animation) aborts instead of building a card for a message that no longer
    // exists — e.g. RSReforged merges a damage roll into the parent attack card and
    // then deletes the transient child message.
    if (record) record.cancelled = true;
    if (record?.element?.isConnected) this.removeCard(record.element);
    else if (record) this.cardsByMessageId.delete(id);
  }

  async createCardAfterDice(message, source, messageId, placeholder) {
    await waitForDiceAnimation(message);
    await nextFrame();
    // A bundling system (e.g. RSReforged) can merge this roll into another card and
    // delete the message while we were waiting on the dice. Bail out if it was
    // cancelled by a delete, or no longer exists in the world, so we don't emit a
    // duplicate/orphan card for content that already lives in the bundled card.
    const stillExists = !messageId || Boolean(game.messages?.get?.(messageId));
    if (!this.streamMode.active || placeholder?.cancelled || !stillExists) {
      if (messageId && this.cardsByMessageId.get(messageId) === placeholder) this.cardsByMessageId.delete(messageId);
      return;
    }

    const latest = getLatestRenderedMessage(source, message, messageId) ?? source;
    if (!latest) {
      if (messageId && this.cardsByMessageId.get(messageId) === placeholder) this.cardsByMessageId.delete(messageId);
      return;
    }

    const settings = getChatSettings();
    const root = this.streamMode.getChatRoot();
    this.applySettings();

    const card = document.createElement("div");
    card.className = `gluniverse-stream-chat-card ${CHAT_CONTEXT_CLASS}`;
    if (messageId) card.dataset.streamMessageId = messageId;
    card.append(this.buildClone(latest, message));
    applyThemeContext(card, latest);
    card.style.maxHeight = "0px";
    card.style.opacity = "0";
    root.append(card);

    const record = {
      element: card,
      messageId,
      phase: "entering",
      timeout: window.setTimeout(() => this.removeCard(card), Math.max(0, Number(settings.lifetimeMs) || 0))
    };
    this.cards.push(record);
    if (messageId) this.cardsByMessageId.set(messageId, record);
    this.mirrorLiveSource(record, latest, message);

    window.requestAnimationFrame(() => this.animateCardIn(record, chatPosition(settings)));
    this.enforceMaxVisible();
  }

  /** When more cards are up than `maxVisible` allows, the oldest leave. */
  enforceMaxVisible() {
    const max = Math.max(1, Number(getChatSettings().maxVisible) || DEFAULT_CHAT_SETTINGS.maxVisible);
    while (this.cards.length > max) this.removeCard(this.cards[0].element);
  }

  /**
   * The card opens to its content height while it slides in from the edge its stack hugs. No overshoot,
   * no blur and no sweep: the wrapper is a quiet frame around Foundry's own card, and the stack below it
   * moves once, by exactly the room the new card takes.
   */
  animateCardIn(record, position) {
    const card = record.element;
    if (!card?.isConnected || record.phase !== "entering") return;
    const d = overlayTiming(card);
    const height = `${card.scrollHeight}px`;
    const settle = () => {
      if (record.phase !== "entering") return;
      record.phase = "shown";
      this.trackCardHeight(record);
      this.syncCardHeight(record);
    };

    if (prefersCalmMotion()) {
      animate(card, { opacity: [0, 1], duration: d("calmFade"), ease: "linear" });
      animate(card, { maxHeight: ["0px", height], duration: d("calmResize"), ease: "linear", onComplete: settle });
      return;
    }

    animate(card, { maxHeight: ["0px", height], duration: d("cardIn"), ease: OVERLAY_EASE, onComplete: settle });
    animate(card, { opacity: [0, 1], duration: d("cardFade"), ease: OVERLAY_EASE });
    animate(card, { translateX: [`${sideSign(position) * CARD_SLIDE_PX}px`, "0px"], duration: d("cardSlide"), ease: OVERLAY_EASE });
  }

  refreshCardContents(record, message, source) {
    const card = record?.element;
    if (!card?.isConnected) return;
    const latest = getLatestRenderedMessage(source, message, record.messageId) ?? source;
    if (!latest) return;
    if (latest !== record.mirrorSource) this.mirrorLiveSource(record, latest, message);
    const newClone = this.buildClone(latest, message);
    record.mirrorHtml = latest.outerHTML;
    const oldClone = card.querySelector(".gluniverse-stream-chat-message-clone");
    if (oldClone) oldClone.replaceWith(newClone);
    else card.prepend(newClone);
    applyThemeContext(card, latest);
    if (record.phase === "shown") {
      this.trackCardHeight(record);
      this.syncCardHeight(record);
    }
  }

  // Keep the card's height in sync with its content for the card's whole life.
  // Systems/modules (dnd5e, RSReforged) rewrite the chat card DOM asynchronously
  // after the initial render — via re-render hooks and a MutationObserver — and
  // dice icons/avatars load late, so the content grows after we first measure it.
  // A one-shot max-height snapshot would freeze the card at its early (tiny) size
  // and clip the bundled multiroll content. A ResizeObserver on the cloned content
  // re-measures whenever it changes and eases the card to the new height.
  trackCardHeight(record) {
    const card = record?.element;
    if (!card?.isConnected) return;
    const content = card.querySelector(".gluniverse-stream-chat-message-clone") ?? card;
    if (typeof ResizeObserver === "function") {
      record.resizeObserver?.disconnect();
      const observer = new ResizeObserver(() => window.requestAnimationFrame(() => this.syncCardHeight(record)));
      observer.observe(content);
      record.resizeObserver = observer;
      return;
    }
    // Without ResizeObserver, release the cap so late content is never clipped.
    if (record.phase === "shown") card.style.maxHeight = "none";
  }

  syncCardHeight(record) {
    const card = record?.element;
    if (!card?.isConnected || record.phase !== "shown") return;
    const height = card.scrollHeight;
    if (record.syncedHeight === height) return;
    record.syncedHeight = height;
    if (prefersCalmMotion()) {
      card.style.maxHeight = `${height}px`;
      return;
    }
    animate(card, { maxHeight: `${height}px`, duration: overlayTiming(card)("cardResize"), ease: OVERLAY_EASE });
  }

  // Mirror the live chat card for the stream card's whole life. RSReforged (and
  // dnd5e itself) rewrite the rendered message DOM *after* the render hook — async
  // template injection, a MutationObserver-driven bonus manager, post-dice reveals —
  // without updating the ChatMessage document, so no update hook fires. A one-shot
  // clone can therefore capture an empty pre-processed husk and never recover.
  // Watching the live element and re-cloning on change keeps the stream card
  // pixel-identical to what a player sees in their chat log.
  //
  // Re-cloning is not free (clone, image normalising, a height re-measure and
  // ease), so it happens at most once a frame, never for Foundry's relative
  // timestamp ticking over (the clone's own timestamp is set from the message),
  // and not at all when the source has come back to exactly what was last
  // cloned — a class toggled and back, a module re-rendering identical markup.
  mirrorLiveSource(record, source, message) {
    record.mirrorObserver?.disconnect();
    record.mirrorSource = source instanceof HTMLElement ? source : null;
    if (!record.mirrorSource || typeof MutationObserver !== "function") return;
    record.mirrorHtml = record.mirrorSource.outerHTML;
    let scheduled = false;
    const observer = new MutationObserver(mutations => {
      if (scheduled || !mutations.some(changesContent)) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        if (!record.element?.isConnected || record.phase === "exiting") return;
        const live = record.mirrorSource;
        if (live?.isConnected && live.outerHTML === record.mirrorHtml) return;
        this.refreshCardContents(record, message, live);
      });
    });
    observer.observe(record.mirrorSource, { childList: true, subtree: true, attributes: true, characterData: true });
    record.mirrorObserver = observer;
  }

  buildClone(source, message) {
    const clone = source.cloneNode(true);
    clone.removeAttribute("id");
    clone.classList.add("gluniverse-stream-chat-message-clone");
    normalizeImages(clone, message);
    syncTimestamp(clone, message);
    stripOwnerControls(clone);
    return clone;
  }

  applySettings() {
    if (!this.streamMode.active) return;
    const root = this.streamMode.getChatRoot();
    const settings = getChatSettings();
    const position = chatPosition(settings);
    root.className = `${CLASSES.chatRoot} position-${position}`;
    // Cards read the edge their stack hugs off this, to slide in from and out to it.
    root.dataset.side = sideSign(position) > 0 ? "right" : "left";
    root.style.setProperty("--stream-chat-offset-x", `${numberOrZero(settings.offsetX)}px`);
    root.style.setProperty("--stream-chat-offset-y", `${numberOrZero(settings.offsetY)}px`);
    // Roll cards are designed on a 1920px frame; scale them with the stream's actual width, then by the
    // Director's card scale.
    const frameScale = (window.innerWidth || 1920) / 1920;
    root.style.setProperty("--glus-rc-scale", String(frameScale * settings.cardScale));
  }

  /**
   * Slide the card out toward the edge its stack hugs, then close the room it held (its height and its
   * share of the stack's spacing together, so the cards behind it move once), then remove it.
   */
  removeCard(card) {
    const index = this.cards.findIndex(record => record.element === card);
    const record = index >= 0 ? this.cards[index] : null;
    if (record) {
      window.clearTimeout(record.timeout);
      record.resizeObserver?.disconnect();
      record.mirrorObserver?.disconnect();
      record.phase = "exiting";
      if (record.messageId && this.cardsByMessageId.get(record.messageId) === record) {
        this.cardsByMessageId.delete(record.messageId);
      }
      this.cards.splice(index, 1);
      // A card the feed built (a roll card, a status card) animates itself out and reports back, so the
      // feed can drop the message ids, timers and framing watches it was holding. The property is the
      // whole contract: rename it on one side and the card still disappears, while everything behind it
      // leaks for the rest of the session.
      if (record.card) {
        this.feed?.forget(record);
        record.card.exit();
        return;
      }
    }
    if (!card?.isConnected) return;

    remove(card);
    const d = overlayTiming(card);
    const style = getComputedStyle(card);
    const height = `${card.getBoundingClientRect().height}px`;
    const close = {
      maxHeight: [height, "0px"],
      marginTop: [style.marginTop, "0px"],
      marginBottom: [style.marginBottom, "0px"]
    };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      card.remove();
    };
    // The card is gone on a timer as well: a background tab runs no frames, and a card that never
    // reported back would hold its slot in the stack.
    if (prefersCalmMotion()) {
      animate(card, { opacity: 0, duration: d("calmFade"), ease: "linear" });
      animate(card, { ...close, duration: d("calmResize"), ease: "linear", onComplete: finish });
      window.setTimeout(finish, d("calmResize") + d("calmFade"));
      return;
    }
    const side = sideSign(chatPosition(getChatSettings()));
    animate(card, {
      opacity: 0,
      translateX: `${side * CARD_SLIDE_PX}px`,
      duration: d("cardOut"),
      ease: OVERLAY_EASE_EXIT,
      onComplete: () => {
        if (!card.isConnected) return finish();
        animate(card, { ...close, duration: d("cardCollapse"), ease: OVERLAY_EASE, onComplete: finish });
      }
    });
    window.setTimeout(finish, d("cardOut") + d("cardCollapse") + d("cardResize"));
  }

  clear() {
    for (const record of this.cards) {
      window.clearTimeout(record.timeout);
      record.resizeObserver?.disconnect();
      record.mirrorObserver?.disconnect();
      if (record.card) {
        this.feed?.forget(record);
        record.card.destroy();
      }
    }
    this.cards = [];
    this.cardsByMessageId.clear();
    this.shownMessageIds.clear();
    this.feed?.clear();
    document.querySelectorAll(".gluniverse-stream-chat-card").forEach(card => {
      remove(card);
      card.remove();
    });
  }
}

// Theme context (Foundry core themes + module themes such as PF2e Dorako UI) is
// provided to chat messages by ancestor elements, not the message itself: core
// defines its CSS variables on a `.themed.theme-dark`/`.theme-light` ancestor and
// modules scope their chat styling under a `[data-theme]` ancestor. Because the
// stream card lives outside `#chat-log`, the cloned message loses that context and
// renders unstyled. Re-apply the relevant markers from the live message's ancestry
// onto the card so the clone resolves the same variables and matches scoped rules.
const THEME_CLASS_PATTERN = /^(themed|theme-[\w-]+|dorako-ui|color-?scheme-[\w-]+)$/i;
const THEME_CONTEXT_ATTRIBUTES = ["data-theme", "data-color-scheme"];

// Foundry core and game systems (notably dnd5e) scope their chat card styling to a
// container ancestor rather than the message element itself — e.g. dnd5e matches
// `:is(.chat-popout, #chat-log, .chat-log) .message`. The cloned message lives
// outside `#chat-log`, so without that ancestor the card renders unstyled. Marking
// the wrapper as `.chat-popout` (the same context core uses for a popped-out
// message) restores those rules. Crucially we do NOT add the `[data-gm-user]`
// marker that the live sidebar carries for a GM, so dnd5e keeps concealed/secret
// card details hidden — matching exactly what a normal player sees on stream.
const CHAT_CONTEXT_CLASS = "chat-popout";

// Transient renders (RSReforged previews/processing husks, locally constructed
// ChatMessage objects) go through renderChatMessageHTML but are never part of the
// world's chat history — they have no id in game.messages, timestamp 0 and empty
// content. Only persisted messages become stream cards.
function isPersistedMessage(message, source) {
  const id = message?.id ?? source?.dataset?.messageId;
  return Boolean(id && game.messages?.get?.(id));
}

/**
 * The GM's chat filter, on the cloned-card path. Classified from plain facts about the message so the
 * same rows mean the same thing here as on PF2e roll cards — see `chat-filter.mjs`.
 */
function passesChatFilter(message) {
  const pf2e = message?.flags?.pf2e ?? {};
  // A Daggerheart world with roll cards switched off still files its rolls under their own rows.
  const daggerheart = message?.flags?.[DAGGERHEART_SYSTEM] ?? {};
  const row = classifyMessage({
    style: message?.style ?? 0,
    rollCount: message?.rolls?.length ?? 0,
    contextType: pf2e.context?.type ?? null,
    casting: Boolean(pf2e.casting),
    originType: pf2e.origin?.type ?? null,
    // A Roleplay Chat line files by its mode, so Think is not speech and an RP OOC line is `ooc`.
    rpMode: rpModeOf(message?.flags),
    dhKind: typeof daggerheart.kind === "string" ? daggerheart.kind : null,
    dhReaction: Boolean(daggerheart.plate?.rxn)
  });
  return allows(getChatFilter(), row, authorColumn(Boolean(message?.author?.isGM)));
}

// Interactive roll-editing affordances — e.g. RSReforged's hover overlays for retro
// advantage/disadvantage/crit and GM dice fudging — are owner/GM-only controls that a
// passive spectator never sees. They carry no roll result, can't be used on a
// pointer-inert stream card, and would otherwise leak onto the stream whenever the
// streamer owns the roll or is logged in as a GM. Drop them so the card matches a
// normal player's view of someone else's roll.
const OWNER_CONTROL_SELECTORS = [".rsr-overlay"];

function stripOwnerControls(clone) {
  for (const selector of OWNER_CONTROL_SELECTORS) {
    clone.querySelectorAll(selector).forEach(element => element.remove());
  }
}

// The clone captures the relative timestamp text frozen at render time, and Foundry
// only refreshes timestamps inside `#chat-log`. Re-derive the text from the message's
// own timestamp so the stream card shows the same time as the live chat message.
function syncTimestamp(clone, message) {
  const timestamp = Number(message?.timestamp);
  // Guard against unset/zero timestamps (transient renders) which would otherwise
  // display as a relative time measured from the 1970 epoch.
  if (!Number.isFinite(timestamp) || timestamp <= 0) return;
  const timeSince = foundry?.utils?.timeSince;
  if (typeof timeSince !== "function") return;
  const element = clone.querySelector("time.message-timestamp, .message-timestamp, time");
  if (!element) return;
  element.textContent = timeSince(timestamp);
  element.setAttribute("datetime", new Date(timestamp).toISOString());
}

function applyThemeContext(card, source) {
  for (const cls of [...card.classList]) {
    if (THEME_CLASS_PATTERN.test(cls)) card.classList.remove(cls);
  }
  for (const attr of THEME_CONTEXT_ATTRIBUTES) card.removeAttribute(attr);
  if (!(source instanceof HTMLElement)) return;

  const themed = source.closest(".themed");
  if (themed) {
    for (const cls of themed.classList) {
      if (THEME_CLASS_PATTERN.test(cls)) card.classList.add(cls);
    }
  }
  for (const attr of THEME_CONTEXT_ATTRIBUTES) {
    const owner = source.closest(`[${attr}]`);
    if (owner) card.setAttribute(attr, owner.getAttribute(attr));
  }
}

function normalizeImages(element, message) {
  const speakerImage = getSpeakerImage(message);
  element.querySelectorAll("img").forEach(img => {
    const dataSrc = getImageSource(img);
    if ((!img.getAttribute("src") || img.getAttribute("src") === "") && dataSrc) img.setAttribute("src", dataSrc);
    img.removeAttribute("loading");
  });
  ensureSpeakerImage(element, speakerImage);
}

function ensureSpeakerImage(element, imageUrl) {
  if (!imageUrl) return;
  const header = element.querySelector(".message-header") ?? element.querySelector("header");
  if (!header) return;
  const image = header.querySelector("img.avatar, img.message-avatar, img.gluniverse-stream-speaker-avatar, img");
  if (image) {
    if (!image.getAttribute("src")) image.setAttribute("src", imageUrl);
    frameImage(image, "avatar-circle");
    return;
  }
  const avatar = document.createElement("img");
  avatar.className = "avatar gluniverse-stream-speaker-avatar";
  avatar.src = imageUrl;
  avatar.alt = "";
  header.prepend(avatar);
  // Full-body tokens are tiny in a 36px square; once the head is found, the avatar is cropped to it.
  frameImage(avatar, "avatar-circle");
}

function getImageSource(img) {
  for (const attr of ["data-src", "data-original", "data-lazy-src", "data-tooltip-src", "src"]) {
    const value = img.getAttribute(attr);
    if (value) return value;
  }
  return img.dataset.src ?? img.dataset.original ?? img.dataset.lazySrc ?? null;
}

function getSpeakerImage(message) {
  const speaker = message?.speaker ?? {};
  const tokenDocument = getSpeakerTokenDocument(speaker);
  const actor = tokenDocument?.actor ?? message?.actor ?? message?.speakerActor ?? game.actors?.get?.(speaker.actor);
  return tokenDocument?.texture?.src ?? tokenDocument?.img ?? actor?.img ?? null;
}

function getSpeakerTokenDocument(speaker) {
  if (!speaker?.token) return null;
  const scene = game.scenes?.get?.(speaker.scene) ?? canvas?.scene;
  return scene?.tokens?.get?.(speaker.token)
    ?? canvas?.tokens?.placeables?.find(token => token.document?.id === speaker.token)?.document
    ?? null;
}

/**
 * Roll cards need a feature providing a feed for this world's system — PF2e and Daggerheart today, each
 * with a reader of its own. With `stream-cards` absent or disabled, or in any other system, this is false
 * and the overlay clones Foundry-rendered chat cards, which is the path every other world takes and has
 * always worked.
 */
function usesRollCards() {
  return hasCardFeed(game.system?.id);
}

function getLatestRenderedMessage(source, message, messageId) {
  const id = message?.id ?? messageId;
  const uuid = message?.uuid;
  const selectors = [];
  if (id) selectors.push(`#chat-log [data-message-id="${cssEscape(id)}"]`, `#chat [data-message-id="${cssEscape(id)}"]`);
  if (uuid) selectors.push(`#chat-log [data-message-uuid="${cssEscape(uuid)}"]`, `#chat [data-message-uuid="${cssEscape(uuid)}"]`);
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  return source?.isConnected && !source.closest(".gluniverse-stream-chat-card") ? source : null;
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nextFrame() {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()));
}

function getElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element instanceof HTMLElement) return html.element;
  return null;
}

/** Whether a mutation on a mirrored chat card could change what the clone shows. */
function changesContent(mutation) {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
  return !target?.closest?.(".message-timestamp");
}
