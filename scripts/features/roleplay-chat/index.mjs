/**
 * Roleplay Chat — suite adapter.
 *
 * Speak, act and think as a character from the chat box. A switch above the box picks out of character
 * or in character, and in character, Say, Do or Think; the speaker is a chip beside it. Every client
 * draws the line over the speaker's token (or in a caption lane when there is no token it can see),
 * the chat log sets each line in its voice, and the stream shows it as a card of its own kind.
 *
 * Any system. It does not require `stream`: the stream reads the line's `rp.mode` flag through
 * `core/rp-mode.mjs` and this feature only contributes one switch to the stream's Control Room.
 *
 * Nothing runs at import: every hook, element and command is wired in `onInit` / `onReady`, so a
 * disabled feature leaves Foundry's chat exactly as it was.
 */

import { Suite } from "../../core/registry.mjs";
import { registerPanelSection } from "../stream/extensions.mjs";
import { CSS, FEATURE_ID, PREFIX } from "./constants.mjs";
import { registerKeybindings, registerSettings } from "./settings.mjs";
import { cycle, mountComposer, render, scheduleRender, toggle } from "./composer.mjs";
import { onChatMessage, registerThinkCommand } from "./send.mjs";
import { restyleMessage } from "./log.mjs";
import { overlay } from "./overlay.mjs";
import { claimChange, renderSection } from "./panel.mjs";
import * as Model from "./model.mjs";

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.roleplay-chat.title",
  hint: "GLS.feature.roleplay-chat.hint",
  icon: "fa-solid fa-masks-theater",
  settingPrefix: PREFIX,
  requires: [],
  // The composer and send path speak v14's chat API (`core.messageMode`, `renderChatInput`).
  minimumGeneration: 14,
  core: false,
  defaultEnabled: false,

  registerSettings() { registerSettings(); },

  onInit() {
    registerKeybindings({ onToggle: toggle, onCycle: cycle });
    registerThinkCommand();
    Hooks.on("chatMessage", onChatMessage);
    Hooks.on("renderChatMessageHTML", restyleMessage);
    Hooks.on("renderChatInput", (_app, elements) => mountComposer(elements?.["#chat-message"]));
  },

  onReady() {
    document.body.classList.add(CSS.bodyOn);
    // Foundry's own "In character" message mode is this feature's switch now, and its button is hidden.
    // A client left on it would see no mode button pressed, so it is put back on Public, which is what
    // a typed line is posted as anyway (`visibilityMode`).
    if (game.settings.get("core", "messageMode") === "ic") game.settings.set("core", "messageMode", "public");

    mountComposer(document.getElementById("chat-message"));
    for (const hook of ["controlToken", "canvasReady", "createToken", "deleteToken", "createActor", "deleteActor"]) {
      Hooks.on(hook, scheduleRender);
    }
    Hooks.on("updateToken", (doc, change) => { if ("name" in change || "hidden" in change) scheduleRender(); });
    Hooks.on("updateActor", (doc, change) => { if ("ownership" in change || "name" in change || "img" in change) scheduleRender(); });
    Hooks.on("updateUser", (user, change) => { if (user.id === game.user.id && "character" in change) scheduleRender(); });

    Hooks.on("createChatMessage", (message) => overlay.show(message));
    Hooks.on("deleteChatMessage", (message) => overlay.forget(message.id));
    Hooks.on("canvasTearDown", () => overlay.clearTokens());

    registerPanelSection({ id: FEATURE_ID, order: 30, render: renderSection, change: claimChange, gmOnly: true });
    render();
  },

  api: { model: Model }
});
