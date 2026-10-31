/**
 * Roleplay Chat — posting a typed line.
 *
 * Foundry hands every message typed into the chat box to the `chatMessage` hook before it parses it.
 * A line this feature owns (plain text, `/ic`, `/ooc`, `/em`, `/emote`, `/me`, `/think`) is posted here
 * and the hook returns false, which tells Foundry the message was handled: the box clears and the line
 * goes into the up-arrow history exactly as if Foundry had posted it. Everything else — rolls, whispers,
 * macros, another module's commands — is Foundry's, untouched.
 *
 * Only the chat box is intercepted. The same hook fires for `ui.chat.processMessage` called from a chat
 * macro or another module, which carry speakers of their own, so the composer arms itself on the box's
 * own Enter (`armSend`) and a message that did not come from there is left alone.
 */

import { err } from "../../core/const.mjs";
import {
  buildMessage,
  composerMode,
  hasText,
  lineMode,
  parseInput,
  visibilityMode
} from "./model.mjs";
import { getComposer } from "./settings.mjs";
import { currentSpeaker } from "./speaker.mjs";

let armed = false;
let disarm = null;

/** Called on the chat box's Enter keydown, before Foundry's own handler sends the message. */
export function armSend() {
  armed = true;
  clearTimeout(disarm);
  // Foundry sends synchronously inside the same keydown, so the next task is always after the hook.
  disarm = setTimeout(() => { armed = false; }, 0);
}

/** The `chatMessage` hook. */
export function onChatMessage(_chatLog, message) {
  if (!armed || typeof message !== "string") return;
  armed = false;
  const speaker = currentSpeaker();
  const parsed = parseInput(message, composerMode(getComposer(), speaker?.kind ?? null));
  if (parsed.pass) return;
  const mode = lineMode(parsed.mode, speaker?.kind ?? null);
  // In character with nobody to be: Foundry's own `/ic` and `/em` say so and keep the text in the box,
  // and `/think` does the same through the command registered in `registerThinkCommand`.
  if (mode !== "ooc" && !speaker) return;
  if (!hasText(parsed.body)) return false;
  post({ mode, body: parsed.body, override: parsed.override, speaker });
  return false;
}

/**
 * `/think` as a Foundry chat command, for every road the hook does not take: a chat macro, another
 * module calling `processMessage`, and a user with no speaker, who gets Foundry's own error and keeps
 * their text. Without it `/think` would be "not a valid chat command" whenever the hook stood aside.
 */
export function registerThinkCommand() {
  const ChatLog = CONFIG.ui?.chat ?? foundry.applications?.sidebar?.tabs?.ChatLog;
  const commands = ChatLog?.CHAT_COMMANDS;
  if (!commands || typeof commands !== "object" || "think" in commands) return;
  commands.think = {
    rgx: /^(\/think(?:\s|&nbsp;)+)([^]*)/i,
    fn(_command, match) {
      const speaker = currentSpeaker();
      if (!speaker) throw new Error(game.i18n.localize("GLRP.errors.noSpeaker"));
      const body = String(match?.[2] ?? "").trim().replace(/\n/g, "<br>");
      if (hasText(body)) post({ mode: lineMode("think", speaker.kind), body, override: true, speaker });
      return false;
    }
  };
}

function post({ mode, body, override, speaker }) {
  const { data, options } = buildMessage({
    mode,
    body,
    speaker: mode === "ooc" ? null : speaker?.speakerData ?? null,
    authorId: game.user.id,
    messageMode: visibilityMode(game.settings.get("core", "messageMode"), override),
    styles: CONST.CHAT_MESSAGE_STYLES
  });
  ChatMessage.implementation.create(data, options).catch((error) => {
    err("Roleplay Chat: the line could not be posted.", error);
    ui.notifications?.error(game.i18n.localize("GLRP.errors.post"));
  });
}
