/**
 * Flatfinder — the encounter planner window (GM only).
 *
 * Builds a fight before it is on the board: drop creatures and hazards in from
 * the Actors sidebar or a compendium, set how many and whether each is Elite or
 * Weak, and the same meter and rating as the tracker strip say how hard it is
 * for the party. The plan is the client setting `ff.planner`, read and written
 * through planner-store.mjs; the markup is view.mjs `plannerHTML`; the rating is
 * encounter-model.mjs. This file only binds the three together.
 *
 * The class is built in a memoised factory, never at module scope: this module
 * is imported by flatfinder.js, which the check tools load under plain Node,
 * where `foundry` does not exist.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { ffKey } from "./constants.js";
import { getSetting } from "./settings.js";
import { adjustmentOf, baseLevelOf, liveLevelOf } from "./adjustments.js";
import { combatParticipants, isPartyMember, partyOf, threatEntry } from "./encounter.js";
import { buildEncounter } from "./encounter-model.mjs";
import {
  addRow,
  clearParty,
  clearRows,
  cycleAdjustment,
  normalizePlan,
  planEntries,
  removeRow,
  setCount,
  setParty,
} from "./planner-store.mjs";
import { plannerHTML } from "./view.mjs";

const KEY = ffKey("planner");
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

export function readPlan() {
  try {
    return normalizePlan(game.settings.get(SUITE_ID, KEY));
  } catch {
    return normalizePlan(null);
  }
}

async function writePlan(plan) {
  try {
    await game.settings.set(SUITE_ID, KEY, normalizePlan(plan));
  } catch (error) {
    warn("flatfinder | could not save the encounter plan", error);
  }
}

const viewedCombat = () => game.combats?.viewed ?? game.combat ?? null;

/** A planned row from an actor, or null (with a notice) for something that is not a threat. */
function rowFromActor(actor) {
  if (!actor || actor.documentName !== "Actor") return null;
  if (actor.type === "character" || isPartyMember(actor)) {
    ui.notifications?.info(t("PF2E-FLATFINDER.Planner.NotThreat", { name: actor.name }));
    return null;
  }
  if (actor.type !== "npc" && actor.type !== "hazard") return null;
  const entry = threatEntry(actor);
  return {
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    base: baseLevelOf(actor) ?? liveLevelOf(actor),
    hazard: entry.hazard,
    adjustment: entry.hazard ? null : adjustmentOf(actor),
    count: 1,
    bossFactor: entry.bossFactor,
    bossTier: entry.bossTier,
    minion: entry.minion,
  };
}

/** Refresh a planned row from its world actor, for display only (compendium rows keep what was stored). */
function refreshed(row) {
  if (!row.uuid || row.uuid.startsWith("Compendium.")) return row;
  let doc = null;
  try {
    doc = fromUuidSync(row.uuid);
  } catch {
    doc = null;
  }
  if (doc?.documentName !== "Actor") return row;
  const fresh = threatEntry(doc);
  return {
    ...row,
    name: doc.name,
    img: doc.img,
    base: baseLevelOf(doc) ?? liveLevelOf(doc) ?? row.base,
    hazard: fresh.hazard,
    bossFactor: fresh.bossFactor,
    bossTier: fresh.bossTier,
    minion: fresh.minion,
  };
}

let _cls = null;
let _app = null;

function plannerClass() {
  if (_cls) return _cls;
  const { ApplicationV2 } = foundry.applications.api;

  _cls = class FlatfinderPlanner extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      // Never a positioned utility (.gl-glass) on the frame: Foundry's
      // `.application { position: absolute }` is layered and would lose.
      id: "flatfinder-planner",
      classes: ["flatfinder-planner-app"],
      window: { title: "PF2E-FLATFINDER.Planner.Title", icon: "fa-solid fa-chess-rook", resizable: true },
      position: { width: 480, height: "auto" },
    };

    /** What the meter last showed, so a change slides from there and a new rating announces itself once. */
    #last = null;

    async _prepareContext() {
      const stored = readPlan();
      const plan = { ...stored, rows: stored.rows.map(refreshed) };
      const combat = viewedCombat();
      const { pcs, threats } = combatParticipants(combat);
      const party = stored.party ? { ...stored.party, source: "manual" } : partyOf(pcs);
      const model = buildEncounter({
        party,
        threats: planEntries(plan, { shift: getSetting("eliteWeakLevel") !== false }),
      });
      const last = this.#last;
      this.#last = { fill: model.meter.fill, rating: model.rows.length ? model.rating : null };
      return {
        model,
        from: last?.fill ?? null,
        rerated: !!last?.rating && !!this.#last.rating && last.rating !== this.#last.rating,
        manual: !!stored.party,
        canCopy: threats.length > 0,
      };
    }

    async _renderHTML(context) {
      const { model, from, rerated, manual, canCopy } = context;
      return plannerHTML(model, { t, from, rerated, manual, canCopy });
    }

    _replaceHTML(result, content) {
      const list = content.querySelector(".ff-rows-edit");
      const top = list?.scrollTop ?? 0;
      content.innerHTML = result;
      const next = content.querySelector(".ff-rows-edit");
      if (next) next.scrollTop = top;
    }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      const el = this.element;
      el.addEventListener("click", (event) => this.#onClick(event));
      el.addEventListener("dragover", (event) => {
        event.preventDefault();
        el.querySelector(".ff-planner")?.classList.add("is-dragging");
      });
      el.addEventListener("dragleave", (event) => {
        if (!el.contains(event.relatedTarget)) el.querySelector(".ff-planner")?.classList.remove("is-dragging");
      });
      el.addEventListener("drop", (event) => this.#onDrop(event));
    }

    /** Writes run one after another, each from the plan the last one left, so two quick clicks are two steps. */
    #queue = Promise.resolve();

    #change(edit) {
      this.#queue = this.#queue
        .then(async () => {
          await writePlan(edit(readPlan()));
          await this.render();
        })
        .catch((error) => warn("flatfinder | planner edit failed", error));
      return this.#queue;
    }

    async #onClick(event) {
      const button = event.target.closest?.("button[data-ff-action]");
      if (!button || button.disabled || !this.element.contains(button)) return;
      event.preventDefault();
      const { ffAction: action, id } = button.dataset;
      const delta = Number(button.dataset.delta) || 0;
      if (action === "remove") return this.#change((p) => removeRow(p, id));
      if (action === "adjust") return this.#change((p) => cycleAdjustment(p, id));
      if (action === "count") {
        return this.#change((p) => setCount(p, id, (p.rows.find((r) => r.id === id)?.count ?? 1) + delta));
      }
      if (action === "clear") return this.#change(clearRows);
      if (action === "party") return this.#change(clearParty);
      if (action === "step") {
        const field = button.dataset.field;
        return this.#change((p) => {
          const now = p.party ?? partyOf(combatParticipants(viewedCombat()).pcs);
          return setParty(p, { ...now, [field]: now[field] + delta });
        });
      }
      if (action === "copy") return this.#copyCombat();
    }

    #copyCombat() {
      const { threats } = combatParticipants(viewedCombat());
      return this.#change((current) => {
        let plan = clearParty(clearRows(current));
        for (const { combatant, actor } of threats) {
          const row = rowFromActor(actor);
          if (row) plan = addRow(plan, { ...row, name: combatant.name || row.name });
        }
        return plan;
      });
    }

    async #onDrop(event) {
      event.preventDefault();
      this.element.querySelector(".ff-planner")?.classList.remove("is-dragging");
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      let data = null;
      try {
        data = TE?.getDragEventData?.(event);
      } catch {
        data = null;
      }
      if (!data?.uuid) return;
      let doc = null;
      try {
        doc = await fromUuid(data.uuid);
      } catch {
        doc = null;
      }
      const actors =
        doc?.documentName === "Actor"
          ? [doc]
          : doc?.documentName === "Folder" && doc.type === "Actor"
            ? doc.contents ?? []
            : [];
      const rows = actors.map(rowFromActor).filter(Boolean);
      if (!rows.length) return;
      return this.#change((plan) => rows.reduce(addRow, plan));
    }
  };
  return _cls;
}

/** Open (or bring forward) the planner. GM only. */
export function openPlanner() {
  if (!game.user?.isGM) return null;
  const Cls = plannerClass();
  _app ??= new Cls();
  _app.render({ force: true });
  return _app;
}

/** Redraw an open planner (the world it reads from changed). */
export function refreshPlanner() {
  if (_app?.rendered) _app.render();
}
