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
import { actorsOf, playerOwners } from "./recipients.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** How long the Sent state reads before the window closes (ms, before the motion tier). */
const SENT_HOLD = 520;

/** "Send", or "Send to 3" once anyone is ticked. */
const sendLabel = (count) => (count > 0
  ? game.i18n.format("INSIGHT.ComposeSendCount", { count })
  : game.i18n.localize("INSIGHT.ComposeSend"));

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
      pickSelected: InsightComposeDialog.#onPickSelected,
      pickTargets: InsightComposeDialog.#onPickTargets,
      pickNone: InsightComposeDialog.#onPickNone,
    },
  };

  static PARTS = {
    form: { template: featurePath("insight", "templates/compose-dialog.hbs") },
  };

  /** Who is ticked; survives re-renders and the window closing. */
  static _picked = new Set();
  /** The label last used, offered again next time. */
  static _sense = "";
  /** Whether a card to several people names the others; remembered like the label. */
  static _shared = false;

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
    const picked = context.people.filter((p) => p.selected).length;
    context.sendLabel = sendLabel(picked);
    context.shared = InsightComposeDialog._shared;
    context.soloPick = picked < 2;
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
      if (event.target?.name === "shared") {
        InsightComposeDialog._shared = event.target.checked;
        return;
      }
      if (event.target?.name !== "target") return;
      if (event.target.checked) InsightComposeDialog._picked.add(event.target.value);
      else InsightComposeDialog._picked.delete(event.target.value);
      this.#syncPicked();
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

  /**
   * Keep the Send button's count and the "who else" switch in step with the
   * chips. Written in place, never re-rendered, so the caret stays put.
   */
  #syncPicked() {
    const form = this.element?.querySelector("form");
    if (!form) return;
    const count = form.querySelectorAll('input[name="target"]:checked').length;
    const send = form.querySelector(".insight-send-btn");
    if (send && !this._sending) send.textContent = sendLabel(count);
    const shared = form.querySelector('input[name="shared"]');
    if (shared) shared.disabled = count < 2;
  }

  /** Tick these user ids (the ones that have a chip); the rest stay as they are. */
  #tick(ids) {
    const wanted = new Set(ids);
    let added = 0;
    for (const input of this.element.querySelectorAll('input[name="target"]')) {
      if (!wanted.has(input.value)) continue;
      if (!input.checked) added++;
      input.checked = true;
      InsightComposeDialog._picked.add(input.value);
    }
    this.#syncPicked();
    return added;
  }

  /** Tick every connected player (not the other GMs). */
  static #onPickPlayers() {
    this.#tick(game.users.filter((u) => u.active && !u.isGM).map((u) => u.id));
  }

  /** Tick the players who own the tokens the GM has selected. */
  static #onPickSelected() {
    this.#pickOwners(canvas?.tokens?.controlled ?? []);
  }

  /** Tick the players who own the tokens the GM has targeted. */
  static #onPickTargets() {
    this.#pickOwners(game.user.targets ?? []);
  }

  #pickOwners(tokens) {
    const actors = actorsOf(tokens);
    if (!actors.length) {
      ui.notifications.info(game.i18n.localize("INSIGHT.ComposePickNoTokens"));
      return;
    }
    const owners = playerOwners(actors, game.users);
    if (!owners.length) {
      ui.notifications.info(game.i18n.localize("INSIGHT.ComposePickNoOwners"));
      return;
    }
    this.#tick(owners);
  }

  /** Untick everyone. */
  static #onPickNone() {
    for (const input of this.element.querySelectorAll('input[name="target"]')) input.checked = false;
    InsightComposeDialog._picked.clear();
    this.#syncPicked();
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

    // Only meaningful with company; with one recipient the card says "Only you".
    const shared = targets.length > 1 && data.get("shared") === "on";
    if (!sendNotification({ targets, title: null, body, sense: sense || null, image: null, shared })) return;
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
