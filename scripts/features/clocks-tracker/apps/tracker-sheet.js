/**
 * TrackerSheet: a private "Trackers" tab on the PF2e character sheet.
 *
 * The dock shows the party's shared trackers; this shows one PC's own, stored
 * in the actor's flags and seen only by its owners and the GM. It is a world
 * opt-in, and it only ever touches PF2e character sheets the viewer owns.
 *
 * The panel is `sheetShellHTML` and the rows are the same keyed `TrackerList`
 * the dock mounts (../trackers/tracker-render.js), so the two cannot drift.
 * Writes go through an {@link ActorTrackerStore} with `{render:false}`, and the
 * open tab repaints itself in place off `updateActor`, so values animate rather
 * than the whole sheet redrawing.
 */

import { MODULE_ID, FLAG_NS } from "../const.js";
import { Features } from "../features.js";
import { ActorTrackerStore } from "../trackers/actor-trackers.js";
import { listView } from "../trackers/view.js";
import { TrackerList, sheetShellHTML, paintShell, openMenu } from "../trackers/tracker-render.js";
import { valueItems, confirmDelete } from "./tracker-hud.js";

const L = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const TAB = "glct-trackers";

export class TrackerSheet {
  /** Wire the character-sheet hooks (no-op off PF2e).
   *
   *  Foundry fires a render hook under the LEAF sheet class name, and PF2e and
   *  alternate sheet modules have renamed that class across versions. So the
   *  character-sheet classes actually registered in this world are read at
   *  `ready` and each is hooked by its real name, with a few fallbacks. The
   *  injection is idempotent, so several hooks firing is harmless. */
  static register() {
    if (game.system?.id !== "pf2e") return;
    Hooks.once("ready", () => this._wireHooks());
  }

  static #wired = false;

  static _wireHooks() {
    if (this.#wired) return;
    this.#wired = true;
    const names = new Set(["CharacterSheetPF2e", "ActorSheetPF2e", "ActorSheet", "ActorSheetV2"]);
    try {
      for (const entry of Object.values(CONFIG?.Actor?.sheetClasses?.character ?? {})) {
        if (entry?.cls?.name) names.add(entry.cls.name);
      }
    } catch (err) { console.warn(`${MODULE_ID} | could not read character sheet classes`, err); }
    for (const n of names) Hooks.on(`render${n}`, (app, html) => this._onRender(app, html));

    Hooks.on("updateActor", (actor, changes) => {
      if (!this.enabled) return;
      const flat = foundry.utils.flattenObject(changes ?? {});
      if (!Object.keys(flat).some((k) => k.startsWith(`flags.${MODULE_ID}.${FLAG_NS}`))) return;
      try { this._repaint(actor); }
      catch (err) { console.warn(`${MODULE_ID} | sheet trackers repaint failed`, err); }
    });
  }

  static get enabled() {
    try { return Features.on("trackers.sheet"); } catch { return false; }
  }

  /** Re-render every open character sheet (the world toggle flipped). */
  static refreshAll() {
    const apps = foundry.applications?.instances?.values?.() ?? [];
    const legacy = Object.values(ui.windows ?? {});
    for (const app of [...apps, ...legacy]) {
      if (app?.actor?.type === "character" && app.rendered) app.render();
    }
  }

  static _onRender(app, html) {
    if (game.system?.id !== "pf2e" || !this.enabled) return;
    const actor = app?.actor ?? app?.document ?? null;
    if (!(actor instanceof Actor) || actor.type !== "character") return;
    if (!actor.isOwner) return;                       // private to owners + GM
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    try { this._inject(root, app, actor); }
    catch (err) { console.warn(`${MODULE_ID} | sheet trackers inject failed`, err); }
  }

  /* ------------------------------ injection ------------------------------ */

  /** Mounted tabs by actor UUID: { section, list, store }. An unlinked token's
   *  actor shares its base actor's id, so the id cannot key this. */
  static _mounts = new Map();

  /** Whether our tab was the one showing, per application. */
  static _showing = new WeakMap();

  static _inject(root, app, actor) {
    // Anchor off the sheet's own tab chrome: a nav link and a content section
    // keyed by data-tab is the shape every Foundry tabbed sheet uses.
    const navLink = root.querySelector("nav a[data-tab], nav [data-tab]");
    const nav = navLink?.closest("nav") ?? navLink?.parentElement ?? null;
    const contentTab = root.querySelector("section.tab[data-tab], div.tab[data-tab], [data-tab].tab");
    const body = contentTab?.parentElement ?? null;
    if (!nav || !body || !navLink || !contentTab) return;

    nav.querySelector(`[data-tab="${TAB}"]`)?.remove();
    body.querySelector(`:scope > [data-tab="${TAB}"]`)?.remove();

    const store = new ActorTrackerStore(actor);

    const link = document.createElement(navLink.tagName);
    link.className = navLink.className.replace(/\bactive\b/g, "").trim();
    link.classList.add("glct-trk-tab-btn");
    link.dataset.tab = TAB;
    if (navLink.dataset.group) link.dataset.group = navLink.dataset.group;
    link.setAttribute("data-tooltip", L("GLCT.tracker.sheetTitle"));
    link.setAttribute("aria-label", L("GLCT.tracker.sheetTitle"));
    link.innerHTML = `<i class="fa-solid fa-list-check"></i>`;
    nav.appendChild(link);

    const section = document.createElement(contentTab.tagName);
    section.className = contentTab.className.replace(/\bactive\b/g, "").trim();
    section.classList.add("glct-trk-tab", "glct-trk-skin");
    section.dataset.tab = TAB;
    if (contentTab.dataset.group) section.dataset.group = contentTab.dataset.group;
    section.innerHTML = sheetShellHTML({ canWrite: store.canWrite }, L);
    body.appendChild(section);

    const list = new TrackerList(section.querySelector("[data-rows]"), {
      L, variant: "sheet", onAction: (a) => this._onAction(store, a, section),
    });
    const mount = { section, list, store };
    this._mounts.set(actor.uuid, mount);
    this._paint(mount, false);

    section.querySelector("[data-add]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      import("./tracker-editor.js").then(({ TrackerEditor }) => TrackerEditor.create(store));
    });

    this._wireTabs(app, nav, body, link);
    if (this._showing.get(app)) this._setActive(nav, body, TAB);
  }

  static _paint(mount, animate) {
    const { store, list, section } = mount;
    const view = listView(store.all, { isGM: game.user?.isGM, canWrite: store.canWrite, sheet: true });
    list.update(view, { animate });
    paintShell(section, view);
  }

  /** Repaint a mounted tab in place from the actor's current flags. */
  static _repaint(actor) {
    const mount = this._mounts.get(actor.uuid);
    if (!mount) return;
    if (!mount.section.isConnected) { mount.list.destroy(); this._mounts.delete(actor.uuid); return; }
    mount.store = new ActorTrackerStore(actor);
    this._paint(mount, true);
  }

  static _onAction(store, { act, id, ev, row }, section) {
    if (!store.canWrite) return;
    const t = store.get(id);
    if (!t) return;
    switch (act) {
      case "inc": store.step(id, +1); break;
      case "dec": store.step(id, -1); break;
      case "roll": store.rollPool(id); break;
      case "reset": store.resetPool(id); break;
      case "menu": {
        let x = ev?.clientX, y = ev?.clientY;
        if (!Number.isFinite(x) || (x === 0 && y === 0)) {
          const r = row.getBoundingClientRect();
          x = r.right - 8; y = r.top + r.height / 2;
        }
        const items = [
          { icon: "fa-solid fa-pen", label: L("GLCT.tracker.edit"), run: () => import("./tracker-editor.js").then(({ TrackerEditor }) => TrackerEditor.edit(store, id)) },
          { icon: "fa-solid fa-clone", label: L("GLCT.tracker.ctx.duplicate"), run: () => store.duplicate(id) },
        ];
        const values = valueItems(t, store);
        if (values.length) items.push({ sep: true }, ...values);
        items.push({ sep: true }, {
          icon: "fa-solid fa-trash", label: L("GLCT.tracker.delete"), danger: true,
          run: async () => { if (await confirmDelete(store.get(id))) await store.delete(id); },
        });
        openMenu(section.querySelector(".glct-trk-root") ?? section, x, y, items);
        break;
      }
    }
  }

  /* ------------------------------ tab activation ------------------------------ */

  // Foundry's Tabs controller is bound before the render hook, so it does not
  // know this tab exists. Its `active` must never be handed this tab's name: on
  // the next render it would restore a tab that does not exist yet and the body
  // would come back blank. So a click on our link stops before Foundry sees it,
  // and leaving our tab is done by hand (Foundry still believes the tab being
  // clicked is the active one, so its own handler would do nothing).
  static _wireTabs(app, nav, body, link) {
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._showing.set(app, true);
      this._setActive(nav, body, TAB);
    });
    nav.addEventListener("click", (ev) => {
      const hit = ev.target.closest?.("[data-tab]");
      if (!hit || hit === link || !nav.contains(hit) || !this._showing.get(app)) return;
      const name = hit.dataset.tab;
      this._showing.set(app, false);
      this._setActive(nav, body, name);
      const tabs = app?._tabs?.[0];
      if (tabs && name) tabs.active = name;
    });
  }

  /** Show exactly the top-level tab `name`. */
  static _setActive(nav, body, name) {
    nav.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === name));
    body.querySelectorAll(":scope > .tab").forEach((s) => s.classList.toggle("active", s.dataset.tab === name));
  }
}
