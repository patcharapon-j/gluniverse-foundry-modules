// module/compose-dialog.mjs — GM compose dialog for sending notifications

import { featurePath } from "../../../core/const.mjs";
import { sendNotification } from "./socket.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class InsightComposeDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "insight-compose-dialog",
    classes: ["insight-compose"],
    position: { width: 360, height: "auto" },
    window: {
      title: "INSIGHT.ComposeTitle",
      minimizable: true,
      resizable: false,
    },
    actions: {
      send: InsightComposeDialog.#onSend,
    },
  };

  static PARTS = {
    form: { template: featurePath("insight", "templates/compose-dialog.hbs") },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    // Get connected recipients: all non-self users.
    // Players appear first, then other GMs (so a GM can whisper to a player
    // who is also serving as a co-GM or GM assistant).
    const gmSuffix = ` ${game.i18n.localize("INSIGHT.ComposeTargetGMSuffix")}`;
    context.players = game.users
      .filter(u => u.active && u.id !== game.user.id)
      .map(u => ({
        id: u.id,
        name: u.isGM ? `${u.name}${gmSuffix}` : u.name,
        isGM: u.isGM,
        selected: u.id === this._lastTarget,
      }))
      .sort((a, b) => {
        if (a.isGM !== b.isGM) return a.isGM ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    context.message = "";
    return context;
  }

  /** @override — autofocus the message field and bind Ctrl/Cmd+Enter to send. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const message = this.element.querySelector('[name="message"]');
    message?.focus();
    message?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const btn = this.element.querySelector(".insight-send-btn");
        InsightComposeDialog.#onSend.call(this, event, btn);
      }
    });
  }

  /**
   * Handle Send button click (or Ctrl/Cmd+Enter).
   * @param {PointerEvent|KeyboardEvent} event
   * @param {HTMLElement} target
   */
  static #onSend(event, target) {
    const form = this.element.querySelector("form");
    const formData = new FormData(form);

    const message = formData.get("message")?.trim();
    const targetUser = formData.get("target");

    if (!message || !targetUser) {
      ui.notifications.warn(game.i18n.localize("INSIGHT.ComposeValidation"));
      return;
    }

    // Remember the recipient so the next quick send is one keystroke away.
    this._lastTarget = targetUser;

    sendNotification({
      target: targetUser,
      title: null,
      body: message,
      sense: null,
      image: null,
    });

    // Signal flash on commit (§6.2), then close once the sweep has read.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (target && !reduced) {
      target.classList.add("insight-sent");
      target.textContent = game.i18n.localize("INSIGHT.ComposeSent");
      setTimeout(() => this.close(), 420);
    } else {
      this.close();
    }
  }

}
