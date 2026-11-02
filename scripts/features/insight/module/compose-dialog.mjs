// module/compose-dialog.mjs — the GM's compose window.
//
// A recipient chip per connected user, an optional label for the card's tag,
// the message. The draft (who, label, words) lives on the instance, so a user
// connecting or leaving re-renders the list without losing what was typed.

import { featurePath } from "../../../core/const.mjs";
import { scaledMs } from "../../../core/theme.mjs";
import { sendNotification } from "./socket.mjs";
import { composeBody, isBlankBody } from "./body.mjs";
import { applyTheme } from "./themes.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** How long the Sent state reads before the window closes (ms, before the motion tier). */
const SENT_HOLD = 520;

export class InsightComposeDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "insight-compose-dialog",
    classes: ["insight-compose"],
    position: { width: 400, height: "auto" },
    window: {
      title: "INSIGHT.ComposeTitle",
      minimizable: true,
      resizable: false,
    },
    actions: {
      send: InsightComposeDialog.#onSend,
      pickPlayers: InsightComposeDialog.#onPickPlayers,
    },
  };

  static PARTS = {
    form: { template: featurePath("insight", "templates/compose-dialog.hbs") },
  };

  /** Who is ticked; survives re-renders and the window closing. */
  static _picked = new Set();
  /** The label last used, offered again next time. */
  static _sense = "";

  _message = "";

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const gmSuffix = ` ${game.i18n.localize("INSIGHT.ComposeTargetGMSuffix")}`;
    // Players first, then other GMs (a co-GM or an assistant can be whispered to).
    context.people = game.users
      .filter((u) => u.active && u.id !== game.user.id)
      .map((u) => ({
        id: u.id,
        name: u.isGM ? `${u.name}${gmSuffix}` : u.name,
        isGM: u.isGM,
        color: u.color?.css ?? String(u.color ?? ""),
        selected: InsightComposeDialog._picked.has(u.id),
      }))
      .sort((a, b) => (a.isGM !== b.isGM ? (a.isGM ? 1 : -1) : a.name.localeCompare(b.name)));
    context.hasPlayers = context.people.some((p) => !p.isGM);
    context.sense = InsightComposeDialog._sense;
    context.message = this._message;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    applyTheme(this.element);
    const form = this.element.querySelector("form");
    const message = form?.querySelector('[name="message"]');
    message?.focus();
    message?.addEventListener("input", () => { this._message = message.value; });
    form?.querySelector('[name="sense"]')?.addEventListener("input", (event) => {
      InsightComposeDialog._sense = event.target.value;
    });
    form?.addEventListener("change", (event) => {
      if (event.target?.name !== "target") return;
      if (event.target.checked) InsightComposeDialog._picked.add(event.target.value);
      else InsightComposeDialog._picked.delete(event.target.value);
    });
    // Enter in the label field would otherwise submit the form natively and
    // navigate away with the draft. Sending is the Send button's job.
    form?.addEventListener("submit", (event) => event.preventDefault());
    form?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        InsightComposeDialog.#onSend.call(this, event, form.querySelector(".insight-send-btn"));
      }
    });
  }

  /** Tick every connected player (not the other GMs). */
  static #onPickPlayers() {
    for (const input of this.element.querySelectorAll('input[name="target"]')) {
      const user = game.users.get(input.value);
      if (!user || user.isGM) continue;
      input.checked = true;
      InsightComposeDialog._picked.add(input.value);
    }
  }

  static #onSend(_event, button) {
    if (this._sending) return;
    const form = this.element.querySelector("form");
    const data = new FormData(form);
    const targets = data.getAll("target").map(String).filter((id) => game.users.get(id)?.active);
    const body = composeBody(data.get("message"));
    if (!targets.length || isBlankBody(body)) {
      ui.notifications.warn(game.i18n.localize("INSIGHT.ComposeValidation"));
      return;
    }
    const sense = String(data.get("sense") ?? "").trim();
    InsightComposeDialog._sense = sense;

    if (!sendNotification({ targets, title: null, body, sense: sense || null, image: null })) return;
    this._sending = true;
    this._message = "";

    if (button) {
      button.classList.add("insight-sent");
      button.textContent = game.i18n.format("INSIGHT.ComposeSentCount", { count: targets.length });
      setTimeout(() => this.close(), scaledMs(SENT_HOLD, this.element));
    } else {
      this.close();
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose?.(options);
    this._sending = false;
  }
}
