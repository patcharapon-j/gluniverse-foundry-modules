/**
 * TrackerSheet — a private "Trackers" tab on the PF2e character sheet.
 *
 * The companion to the global Tracker dock: where the dock shows the party's
 * shared trackers, this surfaces a PC's *private* ones — stored in the actor's
 * flags and visible only to the actor's owner(s) and the GM. It is gated behind
 * a world opt-in and only ever touches PF2e character sheets the viewer owns.
 *
 * Rendering reuses the dock's exact row visuals (TrackerRender), wrapped in the
 * same `.trow`/`.rovl` shell so the slot reels, clock pies and overlays look
 * identical. Writes go through an {@link ActorTrackerStore} bound to this actor;
 * because the owner owns the actor, every edit/step/roll persists directly with
 * no GM relay. The tab rebuilds on each sheet render, so a GM edit on another
 * client reflects automatically once Foundry re-renders the open sheet.
 */

import { MODULE_ID, FLAG_NS } from "../const.js";
import { Features } from "../features.js";
import { ActorTrackerStore } from "../trackers/actor-trackers.js";
import { TrackerRender } from "../trackers/tracker-render.js";

const { DialogV2 } = foundry.applications.api;
const L = (k) => game.i18n.localize(k);
const TAB = "glct-trackers";

export class TrackerSheet {
  /** Wire the character-sheet render hooks (no-op on non-PF2e systems).
   *
   *  Foundry fires a render hook under the *leaf* sheet class name
   *  (`renderCharacterSheetPF2e`), not under a base class, and PF2e — plus any
   *  alternate sheet module — has renamed that class across versions. So rather
   *  than hard-code a name, we read the character-sheet classes actually
   *  registered in this world (at `ready`, once every system/module has
   *  registered theirs) and hook each by its real name, with a few static
   *  fallbacks. `_inject` is idempotent, so if several hooks fire it's harmless. */
  static register() {
    if (game.system?.id !== "pf2e") return;
    Hooks.once("ready", () => this._wireHooks());
  }

  static _wireHooks() {
    const names = new Set(["CharacterSheetPF2e", "ActorSheetPF2e", "ApplicationV2", "ActorSheet", "ActorSheetV2"]);
    try {
      const reg = CONFIG?.Actor?.sheetClasses?.character ?? {};
      for (const entry of Object.values(reg)) {
        const n = entry?.cls?.name;
        if (n) names.add(n);
      }
    } catch (err) { console.warn(`${MODULE_ID} | could not read character sheet classes`, err); }
    for (const n of names) Hooks.on(`render${n}`, (app, html) => this._onRender(app, html));
    console.debug(`${MODULE_ID} | sheet-tracker render hooks:`, [...names]);

    // Tracker writes go in with {render:false} (no full sheet redraw); this
    // repaints the open tab in place instead, so value changes animate. Fires on
    // the writer's client and — for cross-client edits — wherever the sheet is
    // open, keeping every viewer's tab live without a heavy re-render.
    Hooks.on("updateActor", (actor, changes) => {
      if (!this.enabled) return;
      // Touched our flags? (catches both a set and a `-=trackers` deletion,
      // whether the diff arrives expanded or already flattened.)
      const flat = foundry.utils.flattenObject(changes ?? {});
      if (!Object.keys(flat).some(k => k.startsWith(`flags.${MODULE_ID}.${FLAG_NS}`))) return;
      try { this._repaint(actor); }
      catch (err) { console.warn(`${MODULE_ID} | sheet trackers repaint failed`, err); }
    });
  }

  /** Is the feature switched on for this world? Honours the Trackers parent toggle. */
  static get enabled() {
    try { return Features.on("trackers.sheet"); } catch { return false; }
  }

  /** Re-render every open character sheet (used when the world toggle flips). */
  static refreshAll() {
    const apps = foundry.applications?.instances?.values?.() ?? Object.values(ui.windows ?? {});
    for (const app of apps) {
      if (app?.actor?.type === "character" && app.rendered) app.render();
    }
  }

  static _onRender(app, html) {
    if (game.system?.id !== "pf2e" || !this.enabled) return;
    const actor = app?.actor ?? app?.document ?? null;
    // Only owned PF2e character *actor* sheets — skip items, journals, the dock,
    // other HUDs and every non-character actor (NPC, loot, vehicle, familiar…).
    if (!(actor instanceof Actor) || actor.type !== "character") return;
    if (!actor.isOwner) return;                       // private to owner + GM only
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    try { this._inject(root, actor); }
    catch (err) { console.warn(`${MODULE_ID} | sheet trackers inject failed`, err); }
  }

  /* ------------------------------ injection ------------------------------ */

  static _inject(root, actor) {
    // Anchor off the existing tab chrome so we adopt the sheet's own structure
    // rather than guessing class names. A nav link + a content section keyed by
    // data-tab is the shape every Foundry tabbed sheet uses.
    const navLink = root.querySelector("nav a[data-tab], nav [data-tab]");
    const nav = navLink?.closest("nav") ?? navLink?.parentElement ?? null;
    const contentTab = root.querySelector("section.tab[data-tab], div.tab[data-tab], [data-tab].tab");
    const body = contentTab?.parentElement ?? null;
    if (!nav || !body || !navLink || !contentTab) return;

    // Clear any prior injection (defensive against partial re-renders).
    nav.querySelector(`[data-tab="${TAB}"]`)?.remove();
    body.querySelector(`[data-tab="${TAB}"]`)?.remove();

    const store = new ActorTrackerStore(actor);

    // --- nav item: clone the sibling's shape, swap in our icon/tooltip ---
    const link = document.createElement(navLink.tagName);
    link.className = navLink.className.replace(/\bactive\b/g, "").trim();
    link.classList.add("glct-trk-tab-btn");
    link.dataset.tab = TAB;
    link.setAttribute("data-tooltip", L("GLCT.tracker.title"));
    link.setAttribute("aria-label", L("GLCT.tracker.title"));
    link.innerHTML = `<i class="fa-solid fa-list-check"></i>`;
    nav.appendChild(link);

    // --- content section: same tag/classes as a real tab, minus active ---
    const section = document.createElement(contentTab.tagName);
    section.className = contentTab.className.replace(/\bactive\b/g, "").trim();
    section.classList.add("glct-trk-tab", "glct-trk-skin");
    section.dataset.tab = TAB;
    section.dataset.glctActor = actor.id;              // anchor for active-tab memory
    section.innerHTML = `
      <div class="glct-trk-root">
        <div class="glct-trk-sheet">
          <div class="ts-head">
            <span class="ts-title">${L("GLCT.tracker.title")}</span>
            <span class="ts-count" data-count>0</span>
            ${store.canWrite ? `<button type="button" class="ts-add" data-add title="${L("GLCT.tracker.add")}">+</button>` : ""}
          </div>
          <div class="ts-rows" data-rows></div>
          <div class="ts-empty" data-empty>${L("GLCT.tracker.emptyHint")}</div>
        </div>
      </div>`;
    body.appendChild(section);

    this._rebuildRows(section, store);

    // Add button — wired once per injected section (the header survives row
    // rebuilds, so it must not be re-wired in _rebuildRows).
    if (store.canWrite) {
      section.querySelector("[data-add]")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        import("./tracker-editor.js").then(({ TrackerEditor }) => TrackerEditor.create(store));
      });
    }

    this._wireTabs(nav, body, actor.id);

    // Restore our tab if it was the active one before this re-render.
    if (this._activeActors.get(actor.id)) this._setActive(nav, body, TAB);
  }

  /* ------------------------------ row mount + in-place repaint ------------------------------ */

  // actorId -> { section, rows: Map<id,{el,paint,vsig}>, sig: string[] }. Lets a
  // tracker change repaint the existing rows in place (animating) rather than
  // forcing a full sheet re-render.
  static _mounts = new Map();

  /** (Re)build every row into the section's host and register the mount. */
  static _rebuildRows(section, store) {
    const host = section.querySelector("[data-rows]");
    const list = store.visible();
    host.replaceChildren();
    const rows = new Map();
    for (const t of list) {
      const rec = this._buildRow(store, t);
      host.appendChild(rec.el);
      rec.paint(t);                                    // initial paint (no animation)
      rec.vsig = this._valueSig(t);
      rows.set(t.id, rec);
    }
    this._paintMeta(section, list);
    this._mounts.set(store.actor.id, { section, rows, sig: list.map(t => this._structuralSig(t)) });
  }

  /** Header count + empty-hint visibility. */
  static _paintMeta(section, list) {
    section.querySelector("[data-count]")?.replaceChildren(document.createTextNode(String(list.length)));
    const empty = section.querySelector("[data-empty]");
    if (empty) empty.style.display = list.length ? "none" : "";
  }

  /** Fields that change a row's shape (a rebuild); a value-only change animates. */
  static _structuralSig(t) {
    return [t.id, t.order, t.type, t.name, t.title, t.subtitle, t.label,
      t.slices, t.boxes, t.size, t.count, t.discard, t.playerRoll, t.bad].join("|");
  }

  static _valueSig(t) {
    if (t.type === "pool") return String(Math.trunc(Number(t.current) || 0));
    return String(Math.trunc(Number(t.value) || 0));
  }

  /**
   * Repaint a mounted tab in place from current flag state — the smooth path
   * that replaces a full sheet re-render. A structural change rebuilds the rows;
   * a value change animates the existing row (reel/pie/box motion) like the dock.
   */
  static _repaint(actor) {
    const mount = this._mounts.get(actor.id);
    if (!mount) return;
    if (!mount.section.isConnected) { this._mounts.delete(actor.id); return; }

    const store = new ActorTrackerStore(actor);
    const list = store.visible();
    const sig = list.map(t => this._structuralSig(t));
    const same = sig.length === mount.sig.length && sig.every((s, i) => s === mount.sig[i]);
    if (!same) { this._rebuildRows(mount.section, store); return; }

    for (const t of list) {
      const rec = mount.rows.get(t.id);
      if (!rec) continue;
      const vsig = this._valueSig(t);
      if (rec.vsig === vsig) continue;                 // nothing changed → no needless repaint
      rec.paint(t);
      rec.vsig = vsig;
    }
    this._paintMeta(mount.section, list);
  }

  /** One tracker row: shared body visuals + sheet-side interactions. */
  static _buildRow(store, t) {
    const canWrite = store.canWrite;
    const badClock = t.type === "clock" && t.bad;
    const row = TrackerRender.el("div", "trow type-" + t.type +
      (t.type === "hazard" ? " hazard" : "") + (badClock ? " badclock" : "") + (t.type === "separator" ? " sep" : ""));
    row.dataset.id = t.id;
    if (t.type === "hazard" || badClock) row.appendChild(TrackerRender.el("div", "haz-scan"));

    const body = TrackerRender.buildBody(t);
    row.appendChild(body.content);

    // overlay host (completion/empty stamp) — matches the dock's structure so
    // TrackerRender.setOverlay resolves the same `.trow > .rovl`.
    if (t.type !== "hazard" && t.type !== "separator") {
      const ovl = TrackerRender.el("div", "rovl");
      ovl.appendChild(TrackerRender.el("div", "ot"));
      row.appendChild(ovl);
    }

    // GM/owner tools: edit + delete (every type, separators included).
    if (canWrite) {
      const tools = TrackerRender.el("div", "trk-tools");
      const gear = TrackerRender.el("button", "tk-btn");
      gear.type = "button"; gear.title = L("GLCT.tracker.edit");
      gear.innerHTML = `<i class="fa-solid fa-gear"></i>`;
      gear.addEventListener("click", (ev) => {
        ev.stopPropagation();
        import("./tracker-editor.js").then(({ TrackerEditor }) => TrackerEditor.edit(store, t.id));
      });
      const trash = TrackerRender.el("button", "tk-btn danger");
      trash.type = "button"; trash.title = L("GLCT.tracker.delete");
      trash.innerHTML = `<i class="fa-solid fa-trash"></i>`;
      trash.addEventListener("click", (ev) => { ev.stopPropagation(); this._confirmDelete(store, t); });
      tools.append(gear, trash);
      row.appendChild(tools);
    }

    this._wireValue(store, row, t.type, body.content, body.stepEls ?? [], canWrite);

    // Return a record (not yet painted): the caller paints once on mount, and
    // repaints in place on later changes so value animations replay — exactly
    // like the dock, instead of rebuilding the row from scratch each time.
    return { el: row, paint: body.paint, vsig: undefined };
  }

  /** Left-click steps up / rolls; right-click steps down / resets (owner + GM). */
  static _wireValue(store, row, type, content, stepEls, canWrite) {
    if (type === "separator" || !canWrite) return;
    const id = row.dataset.id;

    if (type === "pool") {
      content.style.cursor = "pointer";
      content.addEventListener("click", () => store.rollPool(id));
      content.addEventListener("contextmenu", (ev) => { ev.preventDefault(); store.resetPool(id); });
    }

    for (const el of stepEls) {
      el.style.cursor = "pointer";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (type === "pool") store.rollPool(id);
        else store.step(id, +1);
      });
      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (type === "pool") store.resetPool(id);
        else store.step(id, -1);
      });
    }
  }

  static async _confirmDelete(store, t) {
    const label = t?.name ?? t?.title ?? L("GLCT.tracker.title");
    const confirmed = await DialogV2.confirm({
      window: { title: L("GLCT.tracker.delete") },
      content: `<p>${game.i18n.format("GLCT.tracker.confirmDelete", { name: foundry.utils.escapeHTML(label) })}</p>`
    });
    if (confirmed) await store.delete(t.id);
  }

  /* ------------------------------ tab activation ------------------------------ */

  // Foundry's Tabs controller doesn't know about our injected data-tab, so we
  // become the source of truth for the top-level tabs: a capture-phase listener
  // toggles `active` for whichever tab was clicked (ours or PF2e's). Driving the
  // DOM directly sidesteps PF2e's "already active" short-circuit, which could
  // otherwise fail to restore a sheet tab the user returns to after viewing
  // ours. The active choice is remembered per actor so it survives re-renders.
  static _activeActors = new Map();

  static _wireTabs(nav, body, actorId) {
    nav.addEventListener("click", (ev) => {
      const hit = ev.target.closest("[data-tab]");
      if (!hit || !nav.contains(hit)) return;
      const name = hit.dataset.tab;
      this._setActive(nav, body, name);
      this._activeActors.set(actorId, name === TAB);
    }, true);   // capture: run before (and regardless of) PF2e's own handler
  }

  /** Show exactly the top-level tab `name`, hiding every sibling (ours included). */
  static _setActive(nav, body, name) {
    nav.querySelectorAll("[data-tab]").forEach(a => a.classList.toggle("active", a.dataset.tab === name));
    body.querySelectorAll(":scope > .tab").forEach(s => s.classList.toggle("active", s.dataset.tab === name));
  }
}
