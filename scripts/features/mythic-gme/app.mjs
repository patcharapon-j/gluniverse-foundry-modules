/**
 * Mythic GME: the oracle panel, the Foundry half.
 *
 * What it shows is decided in `model.mjs` and drawn by `render.mjs`, both pure,
 * so the preview draws this exact markup. This file is who may open it, the
 * clicks, and keeping the GM's place across a redraw: the question being
 * typed, the search box, the page and the log's scroll.
 *
 * GM only. `foundry.applications.api` is read at module scope, so nothing a
 * check tool loads under Node may import this file.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { APP_ID, SETTINGS } from "./constants.mjs";
import { postEntry } from "./chat.mjs";
import { addRow, removeRow, stepWeight } from "./lists.mjs";
import { matchesQuery, panelModel } from "./model.mjs";
import { panelHTML } from "./render.mjs";
import {
  endScene, onLogged, rollAdjustment, rollAskFate, rollCoreMeaning, rollElementTable, rollEvent, rollList, rollSceneCheck,
} from "./session.mjs";
import {
  adjustChaos, autoEvent, canWriteWorld, clearLog, getChaos, linkActions1, readLists, readLog, readUi, resolveActions1,
  updateLists, writeUi,
} from "./store.mjs";

const { ApplicationV2 } = foundry.applications.api;

const t = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

export class MythicPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    // The frame stays bare: `.gl-glass` never goes on an ApplicationV2 frame
    // (it declares `position` and would drop the window into document flow).
    id: APP_ID,
    classes: ["gmyth", "gmyth-panel"],
    tag: "div",
    window: { title: "GLMYTHIC.title", icon: "fa-solid fa-hat-wizard", resizable: true },
    position: { width: 344, height: 660 },
    actions: {
      cfDown: MythicPanel.prototype._onCfDown,
      cfUp: MythicPanel.prototype._onCfUp,
      setTab: MythicPanel.prototype._onSetTab,
      askFate: MythicPanel.prototype._onAskFate,
      rollEvent: MythicPanel.prototype._onRollEvent,
      sceneCheck: MythicPanel.prototype._onSceneCheck,
      endScene: MythicPanel.prototype._onEndScene,
      rollAdjust: MythicPanel.prototype._onRollAdjust,
      rollMeaning: MythicPanel.prototype._onRollMeaning,
      rollElement: MythicPanel.prototype._onRollElement,
      unlinkActions: MythicPanel.prototype._onUnlinkActions,
      rollList: MythicPanel.prototype._onRollList,
      stepWeight: MythicPanel.prototype._onStepWeight,
      removeRow: MythicPanel.prototype._onRemoveRow,
      whisperEntry: MythicPanel.prototype._onWhisperEntry,
      revealEntry: MythicPanel.prototype._onRevealEntry,
      clearLog: MythicPanel.prototype._onClearLog,
    },
  };

  /** Open the one panel, or bring it forward. Never toggles: a scene button can fire twice. */
  static open() {
    if (!game.user.isGM) return null;
    const app = MythicPanel.current ?? new MythicPanel();
    app.render({ force: true });
    if (app.rendered) app.bringToFront?.();
    return app;
  }

  static get current() {
    return foundry.applications.instances.get(APP_ID) ?? null;
  }

  #question = "";
  #query = "";
  #fresh = null;
  #unsubscribe = null;
  /** The page on screen. Held here, because the stored copy is written behind a queue. */
  #tab = null;

  async _prepareContext() {
    const actions1 = await resolveActions1();
    const ui = readUi();
    this.#tab ??= ui.tab;
    return panelModel({
      chaos: getChaos(),
      ui: { ...ui, tab: this.#tab },
      log: readLog(),
      lists: readLists(),
      question: this.#question,
      query: this.#query,
      autoEvent: autoEvent(),
      actions1,
      fresh: this.#fresh,
      writable: canWriteWorld(),
    });
  }

  async _renderHTML(context) {
    return panelHTML(context, t);
  }

  _replaceHTML(result, content) {
    const scroll = (sel) => content.querySelector(sel)?.scrollTop ?? 0;
    const logTop = scroll(".gmyth-log-scroll");
    const groupsTop = scroll(".gmyth-groups");
    const listTop = scroll('[data-page="lists"]');
    const active = document.activeElement;
    const focusName = content.contains(active) ? active?.name : null;
    content.innerHTML = result;
    const set = (sel, v) => {
      const el = content.querySelector(sel);
      if (el) el.scrollTop = v;
    };
    // A new roll is read from the top; anything else keeps the GM's place.
    set(".gmyth-log-scroll", this.#fresh ? 0 : logTop);
    set(".gmyth-groups", groupsTop);
    set('[data-page="lists"]', listTop);
    if (focusName) {
      const input = content.querySelector(`[name="${focusName}"]`);
      input?.focus();
      if (input?.setSelectionRange && typeof input.value === "string") input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const pos = game.settings.get(SUITE_ID, SETTINGS.panelPos);
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) this.setPosition({ left: pos.left, top: pos.top });
    this.#unsubscribe = onLogged((entry) => {
      this.#fresh = entry.id;
      this.render();
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // The fresh mark plays once; the next redraw must not replay it.
    this.#fresh = null;
    const root = this.element;
    if (!root) return;

    const question = root.querySelector('input[name="gmyth-question"]');
    question?.addEventListener("input", () => (this.#question = question.value));
    question?.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      this.#ask(readUi().odds);
    });

    const search = root.querySelector('input[name="gmyth-query"]');
    search?.addEventListener("input", () => this.#filter(search.value));

    for (const form of root.querySelectorAll("form.gmyth-add")) {
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const input = form.querySelector("input");
        const name = input?.value ?? "";
        if (!name.trim()) return;
        updateLists((l) => addRow(l, form.dataset.list, name)).then(() => this.render());
      });
    }

    const drop = root.querySelector('[data-drop="actions1"]');
    if (drop && canWriteWorld()) {
      drop.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        drop.classList.add("is-over");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
      drop.addEventListener("drop", (ev) => this.#onDropTable(ev, drop));
    }
  }

  _onClose(options) {
    super._onClose?.(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async close(options) {
    try {
      const p = this.position;
      if (p && Number.isFinite(p.left)) await game.settings.set(SUITE_ID, SETTINGS.panelPos, { left: p.left, top: p.top });
    } catch {
      /* the position is a convenience */
    }
    return super.close(options);
  }

  /* ── in place: no redraw under the cursor ──────────────────────────────── */

  #filter(query) {
    this.#query = String(query ?? "");
    const root = this.element;
    let any = false;
    for (const group of root.querySelectorAll(".gmyth-group")) {
      let shown = 0;
      for (const chip of group.querySelectorAll("[data-el]")) {
        const hit = matchesQuery(chip.textContent, this.#query);
        chip.hidden = !hit;
        if (hit) shown++;
      }
      group.hidden = !shown;
      any ||= shown > 0;
    }
    const none = root.querySelector("[data-none]");
    if (none) none.hidden = any;
  }

  _onSetTab(_ev, target) {
    const tab = target.dataset.tab;
    const root = this.element.querySelector(".gmyth-root");
    if (!root || !tab) return;
    this.#tab = tab;
    root.dataset.tab = tab;
    for (const b of root.querySelectorAll(".gmyth-tab")) {
      const on = b.dataset.tab === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    }
    writeUi({ tab });
  }

  /* ── rolls ─────────────────────────────────────────────────────────────── */

  async #ask(odds) {
    const question = this.#question;
    this.#question = "";
    await rollAskFate(odds, question);
  }

  _onAskFate(_ev, target) {
    return this.#ask(target.dataset.odds);
  }

  _onRollEvent() {
    return rollEvent();
  }

  _onSceneCheck() {
    return rollSceneCheck();
  }

  _onRollAdjust() {
    return rollAdjustment();
  }

  _onEndScene(_ev, target) {
    return endScene(target.dataset.control === "1");
  }

  _onRollMeaning(_ev, target) {
    return rollCoreMeaning(target.dataset.table);
  }

  _onRollElement(_ev, target) {
    return rollElementTable(target.dataset.el);
  }

  _onRollList(_ev, target) {
    return rollList(target.dataset.list);
  }

  /* ── chaos ─────────────────────────────────────────────────────────────── */

  async _onCfDown() {
    await adjustChaos(-1);
  }

  async _onCfUp() {
    await adjustChaos(1);
  }

  /* ── lists ─────────────────────────────────────────────────────────────── */

  async _onStepWeight(_ev, target) {
    const { list, row } = target.dataset;
    // The pips cycle: a full row goes back to one.
    const current = readLists()[list]?.find((r) => r.id === row)?.weight ?? 1;
    await updateLists((l) => (current >= 3 ? stepWeight(stepWeight(l, list, row, -1), list, row, -1) : stepWeight(l, list, row, 1)));
    this.render();
  }

  async _onRemoveRow(_ev, target) {
    const { list, row } = target.dataset;
    await updateLists((l) => removeRow(l, list, row));
    this.render();
  }

  /* ── the linked table ──────────────────────────────────────────────────── */

  async #onDropTable(ev, zone) {
    ev.preventDefault();
    zone.classList.remove("is-over");
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    const data = TE?.getDragEventData?.(ev) ?? {};
    if (data.type !== "RollTable" || !data.uuid) {
      ui.notifications?.warn(t("GLMYTHIC.meaning.dropWrong"));
      return;
    }
    await linkActions1(data.uuid);
  }

  _onUnlinkActions() {
    return linkActions1("");
  }

  /* ── the log ───────────────────────────────────────────────────────────── */

  #entry(target) {
    return readLog().find((e) => e.id === target.dataset.id) ?? null;
  }

  async _onWhisperEntry(_ev, target) {
    if (await postEntry(this.#entry(target), "whisper")) ui.notifications?.info(t("GLMYTHIC.log.whispered"));
  }

  async _onRevealEntry(_ev, target) {
    await postEntry(this.#entry(target), "table");
  }

  async _onClearLog() {
    await clearLog();
    this.render();
  }
}
