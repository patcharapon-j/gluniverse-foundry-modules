/**
 * GLUniverse Stream — the Chat Filter page.
 *
 * One window, one table: every content type the chat overlay can draw, switched separately for what a
 * player posted and what the GM posted, plus the finer details a shown card may carry. It writes
 * `stream.chatFilter` and nothing else, through the same attested channel the Control Room uses, so a
 * trusted director can edit it exactly as they can edit the overlay's position.
 *
 * Every row and every detail is built from `chat-filter.mjs`, never listed here: a row added there
 * appears on this page by itself, and the check tool requires its label to exist.
 *
 * The class is built in a memoised factory rather than at module scope — `foundry.applications` does not
 * exist under plain Node, where the check tools import this feature's modules.
 */

import { featurePath } from "../../core/const.mjs";
import {
  CHAT_FILTER_AUTHORS,
  CHAT_FILTER_DETAILS,
  CHAT_FILTER_GROUPS,
  CHAT_FILTER_ROWS,
  DEFAULT_CHAT_FILTER
} from "./chat-filter.mjs";
import { FEATURE_ID, MODULE_ID } from "./constants.js";
import { delegationUnavailable } from "./director-auth.mjs";
import { canEditDirectorSettings, getChatFilter, isDirectorUser, setSetting } from "./settings.js";

const L = (key) => `GLUNIVERSE_STREAM.chatFilter.${key}`;

/** Rows that are typed chat, for the "hide typed chat" shortcut. */
const TYPED_CHAT_ROWS = ["speech", "emote", "ooc"];

let instance = null;
let AppClass = null;

export function openChatFilterApp() {
  if (!isDirectorUser()) return ui.notifications?.warn(game.i18n.localize("GLUNIVERSE_STREAM.notifications.notDirector"));
  instance ??= new (chatFilterAppClass())();
  instance.render({ force: true });
}

export function renderChatFilterApp() {
  if (instance?.rendered) instance.render();
}

/** "Players 14 of 18 · GM 12 of 18" — what the Control Room prints beside the button. */
export function summarizeChatFilter(filter = getChatFilter(), { pf2e = isPf2e() } = {}) {
  const rows = visibleRows(pf2e);
  const count = (author) => rows.filter((row) => filter.rows[row.id]?.[author]).length;
  return game.i18n.format(L("summary"), { player: count("player"), gm: count("gm"), total: rows.length });
}

function isPf2e() {
  return game.system?.id === "pf2e";
}

/** A PF2e-only row would be a switch that does nothing in any other world, so it is not offered there. */
function visibleRows(pf2e) {
  return CHAT_FILTER_ROWS.filter((row) => pf2e || !row.pf2e);
}

function chatFilterAppClass() {
  if (AppClass) return AppClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  AppClass = class StreamChatFilterApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-stream-chat-filter`,
      classes: ["gluniverse-stream-director", "gluniverse-stream-filter"],
      tag: "form",
      window: { title: L("title"), icon: "fas fa-filter", resizable: true },
      position: { width: 640, height: 760 },
      actions: {
        column: StreamChatFilterApp.#onColumn,
        preset: StreamChatFilterApp.#onPreset
      }
    };

    static PARTS = {
      main: { template: featurePath(FEATURE_ID, "templates/chat-filter.hbs"), scrollable: [".gluniverse-stream-filter-body"] }
    };

    async _prepareContext(options) {
      const filter = getChatFilter();
      const pf2e = isPf2e();
      const canEdit = canEditDirectorSettings();
      const loc = (key) => game.i18n.localize(key);
      const authorLabel = Object.fromEntries(CHAT_FILTER_AUTHORS.map((author) => [author, loc(L(`columns.${author}`))]));
      const groups = CHAT_FILTER_GROUPS
        .map((group) => ({
          id: group.id,
          label: loc(L(`group.${group.id}.name`)),
          hint: loc(L(`group.${group.id}.hint`)),
          rows: group.rows
            .filter((row) => pf2e || !row.pf2e)
            .map((row) => ({
              id: row.id,
              label: loc(L(`row.${row.id}.name`)),
              hint: loc(L(`row.${row.id}.hint`)),
              cells: CHAT_FILTER_AUTHORS.map((author) => ({
                author,
                authorLabel: authorLabel[author],
                name: `rows.${row.id}.${author}`,
                checked: Boolean(filter.rows[row.id]?.[author])
              }))
            }))
        }))
        .filter((group) => group.rows.length);
      const details = pf2e
        ? CHAT_FILTER_DETAILS.map((detail) => ({
          id: detail.id,
          label: loc(L(`detail.${detail.id}.name`)),
          hint: loc(L(`detail.${detail.id}.hint`)),
          cells: CHAT_FILTER_AUTHORS.map((author) => (detail.authors.includes(author)
            ? { author, authorLabel: authorLabel[author], name: `details.${detail.id}.${author}`, checked: Boolean(filter.details[detail.id]?.[author]), applies: true }
            : { author, applies: false }))
        }))
        : [];
      return {
        ...(await super._prepareContext(options)),
        groups,
        details,
        pf2e,
        canEdit,
        readOnly: !canEdit,
        readOnlyMessage: game.i18n.localize(delegationUnavailable()
          ? "GLUNIVERSE_STREAM.notifications.readOnly"
          : "GLUNIVERSE_STREAM.notifications.readOnlyNoGm"),
        summary: summarizeChatFilter(filter, { pf2e }),
        authors: CHAT_FILTER_AUTHORS.map((author) => ({ author, label: authorLabel[author] }))
      };
    }

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      this.element.addEventListener("change", (event) => this.#onChange(event));
      this.element.addEventListener("submit", (event) => event.preventDefault());
    }

    /** One cell. Written as a whole sanitized object, read fresh, so two quick clicks cannot race. */
    async #onChange(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
      const [section, id, author] = (input.name ?? "").split(".");
      if (!["rows", "details"].includes(section) || !id || !CHAT_FILTER_AUTHORS.includes(author)) return;
      const next = foundry.utils.deepClone(getChatFilter());
      if (!next[section]?.[id] || !(author in next[section][id])) return;
      next[section][id][author] = input.checked;
      await this.#save(next);
    }

    async #save(next) {
      if (!canEditDirectorSettings()) return this.render();
      await setSetting("chatFilter", next);
      // The settings hook re-renders every open copy; this covers a refused write, which changes nothing.
      this.render();
    }

    /** "All" / "None" for one column, over the rows this world offers. */
    static async #onColumn(_event, target) {
      const author = target.dataset.author;
      const on = target.dataset.value === "on";
      if (!CHAT_FILTER_AUTHORS.includes(author)) return;
      const next = foundry.utils.deepClone(getChatFilter());
      for (const row of visibleRows(isPf2e())) next.rows[row.id][author] = on;
      await this.#save(next);
    }

    static async #onPreset(_event, target) {
      const preset = target.dataset.preset;
      let next = foundry.utils.deepClone(getChatFilter());
      if (preset === "defaults") next = foundry.utils.deepClone(DEFAULT_CHAT_FILTER);
      else if (preset === "noChat") {
        for (const row of TYPED_CHAT_ROWS) next.rows[row] = { player: false, gm: false };
      } else if (preset === "rollsOnly") {
        for (const row of CHAT_FILTER_ROWS) {
          const keep = row.group === "checks" || row.group === "actions" || row.group === "dice";
          next.rows[row.id] = { player: keep, gm: keep };
        }
      } else return;
      await this.#save(next);
    }
  };
  return AppClass;
}
