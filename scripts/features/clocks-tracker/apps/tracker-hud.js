/**
 * TrackerHud — the floating Tracker dock as a frameless ApplicationV2.
 *
 * Mirrors GlctHud's strategy: the Handlebars template provides the panel
 * skeleton; the per-tracker rows are built imperatively in _buildRows so that
 * value/roll changes mutate the existing DOM (keeping reel/fill animations
 * continuous) instead of forcing a full re-render. A structural signature
 * decides between a cheap repaint (value changed) and a rebuild (a tracker was
 * added/removed/reordered or its shape edited).
 *
 * GM controls everything; players see a read-only dock — except a resource
 * pool whose `playerRoll` flag is set, which they may click to roll.
 */

import { MODULE_ID, SETTINGS } from "../const.js";
import { TrackerStore } from "../trackers/trackers.js";
import { TrackerRender } from "../trackers/tracker-render.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class TrackerHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async open() {
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    return this.instance;
  }

  /** Repaint from current tracker state (no full re-render unless structure changed). */
  static refresh() { this.instance?.update(); }

  /** Force a structural rebuild (e.g. when isGM context changes). */
  static async refreshStructure() {
    if (this.instance?.rendered) await this.instance.render();
  }

  static DEFAULT_OPTIONS = {
    id: "glct-tracker-hud",
    // `glct-trk-skin` carries the shared tracker visuals (also worn by the PC
    // sheet tab); `glct` is the module-wide theme hook.
    classes: ["glct", "glct-trk-skin"],
    tag: "div",
    window: { frame: false, positioned: false, minimizable: false, resizable: false },
    actions: {
      addTracker: TrackerHud.prototype._onAddTracker
    }
  };

  static PARTS = {
    hud: { template: `modules/${MODULE_ID}/templates/tracker-hud.hbs` }
  };

  _rows = new Map();   // id -> { el, paint, flash, vsig }
  _sig = null;         // last structural signature array
  _ctx = null;         // open context menu element, if any
  _ctxOff = null;      // teardown for the menu's window listeners

  /** Compact ("playing-card") mode is a per-client preference. */
  get compact() {
    try { return !!game.settings.get(MODULE_ID, SETTINGS.trackerHudCompact); } catch { return false; }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, { isGM: game.user?.isGM ?? false, compact: this.compact });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._rows.clear();
    this._sig = null;
    this._applyPosition();
    this._wireViewportClamp();
    this._wireDockChrome();
    this.update();
  }

  async _onClose(options) {
    this._closeContextMenu();
    clearTimeout(this._clampT);
    if (this._onViewportResize) window.removeEventListener("resize", this._onViewportResize);
    if (this._resizeRAF) { cancelAnimationFrame(this._resizeRAF); this._resizeRAF = null; }
    await super._onClose(options);
  }

  /* ------------------------------ painting ------------------------------ */

  update() {
    if (!this.rendered) return;
    const list = TrackerStore.visible();
    const sig = list.map(t => this._structuralSig(t));

    const same = this._sig && sig.length === this._sig.length && sig.every((s, i) => s === this._sig[i]);
    if (!same) { this._buildRows(list); this._sig = sig; }

    const compact = this.compact;
    for (const t of list) {
      const rec = this._rows.get(t.id);
      if (!rec) continue;
      const vsig = this._valueSig(t);
      const changed = rec.vsig !== undefined && rec.vsig !== vsig;
      rec.vsig = vsig;
      // While collapsed, a value change pops the card out to its full row first,
      // then plays the change once it has finished expanding, so the two motions
      // don't fight. The row keeps showing its previous value until then.
      if (changed && compact && t.type !== "separator") {
        rec.flash();
        rec.paintAfterExpand(t);
      } else {
        rec.paint(t);
      }
    }

    // header count + empty hint + dock auto-hide for players with nothing to see
    const root = this.element;
    root.querySelector("[data-count]")?.replaceChildren(document.createTextNode(String(list.length)));
    const empty = root.querySelector("[data-empty]");
    if (empty) empty.style.display = list.length ? "none" : "block";

    const dock = root.querySelector("[data-dock]");
    if (dock) dock.style.display = (!game.user.isGM && list.length === 0) ? "none" : "";
  }

  _structuralSig(t) {
    return [t.id, t.order, t.type, t.name, t.title, t.subtitle, t.label, t.slices, t.boxes,
      t.size, t.count, t.discard, t.playerRoll, t.bad, t.visibleToPlayers].join("|");
  }

  /** The live value that, when it changes, should pop a compact card open. */
  _valueSig(t) {
    if (t.type === "pool") return String(Math.trunc(Number(t.current) || 0));
    return String(Math.trunc(Number(t.value) || 0));
  }

  _buildRows(list) {
    const host = this.element.querySelector("[data-rows]");
    if (!host) return;
    this._closeContextMenu();                   // a rebuild invalidates any open menu
    this._rows.forEach(r => r.cancelPop?.());   // clear any pop-out timers/placeholders first
    host.replaceChildren();
    this._rows.clear();
    for (const t of list) {
      const built = this._buildRow(t);
      host.appendChild(built.el);
      this._rows.set(t.id, built);
    }
    if (game.user.isGM) this._wireReorder(host);
  }

  /* ------------------------------ row builders ------------------------------ */

  // Low-level DOM + body builders are shared with the per-PC sheet tab; the dock
  // delegates to TrackerRender so both mounts produce byte-identical rows.
  _el(...a) { return TrackerRender.el(...a); }
  _svg(...a) { return TrackerRender.svg(...a); }
  _polar(...a) { return TrackerRender.polar(...a); }

  /** Shared row shell: grip (GM) · type body · GM tools · overlay. */
  _buildRow(t) {
    const isGM = game.user.isGM;
    // A clock flagged `bad` (a hazard clock whose completion is bad news) wears
    // the same red dread treatment as a hazard tracker.
    const badClock = t.type === "clock" && t.bad;
    const row = this._el("div", "trow type-" + t.type + (t.type === "hazard" ? " hazard" : "") + (badClock ? " badclock" : "") + (t.type === "separator" ? " sep" : ""));
    row.dataset.id = t.id;
    if (isGM && !t.visibleToPlayers) row.classList.add("hiddenfromplayers");
    if (t.type === "hazard" || badClock) row.appendChild(this._el("div", "haz-scan"));

    if (isGM) {
      const grip = this._el("div", "grip");
      for (let i = 0; i < 6; i++) grip.appendChild(this._el("i"));
      row.appendChild(grip);
    }

    const body = this._buildBody(t);
    row.appendChild(body.content);
    // GM management (edit / visibility / delete) and value stepping now live on a
    // right-click context menu rather than hover buttons — see _openContextMenu.

    if (t.type !== "hazard" && t.type !== "separator") {
      const ovl = this._el("div", "rovl");
      ovl.appendChild(this._el("div", "ot"));
      row.appendChild(ovl);
      body.overlay = ovl;
    }

    // Compact "playing-card" face — shown only while the dock is collapsed.
    const mini = this._buildMini(t);
    row.appendChild(mini.el);

    this._wireRowInteractions(row, t.type, body.content, body.stepEls ?? []);

    // --- compact pop-out -------------------------------------------------
    // While the dock is collapsed, a value change lifts this card out of the
    // grid (leaving a placeholder so neighbours don't shift), morphs it into a
    // full-width row, dwells, then morphs back into the card. JS sets the
    // geometry; CSS eases between the values for a smooth transition.
    const DWELL = 2400;
    const EXPAND = 430;
    let popTimer = null, paintTimer = null, popActive = false;

    const placeholder = () => row.parentElement?.querySelector(`.tcard-ph[data-for="${t.id}"]`);

    const cleanup = () => {
      popActive = false;
      clearTimeout(popTimer); popTimer = null;
      clearTimeout(paintTimer); paintTimer = null;
      row.classList.remove("popping", "expanded");
      row.style.cssText = "";
      placeholder()?.remove();
    };

    const settle = () => {
      const host = row.parentElement;
      if (!host) return cleanup();
      const ph = placeholder();
      const hostRect = host.getBoundingClientRect();
      row.classList.remove("expanded");             // cross-fade content back to the mini
      if (ph) {
        const r = ph.getBoundingClientRect();
        // round to whole pixels — sub-pixel offsets render text blurry at rest
        row.style.left = `${Math.round(r.left - hostRect.left)}px`;
        row.style.top = `${Math.round(r.top - hostRect.top)}px`;
        row.style.width = `${Math.round(r.width)}px`;
        row.style.height = `${Math.round(r.height)}px`;
      }
      popTimer = setTimeout(cleanup, 460);          // after the morph-back, drop to in-flow
    };

    const flash = () => {
      const host = row.parentElement;
      if (!host || !this.compact) return;
      if (popActive) { clearTimeout(popTimer); popTimer = setTimeout(settle, DWELL); return; } // extend dwell
      popActive = true;

      const hostRect = host.getBoundingClientRect();
      const cardRect = row.getBoundingClientRect();

      const ph = document.createElement("div");
      ph.className = "tcard-ph";
      ph.dataset.for = t.id;
      ph.style.width = `${cardRect.width}px`;
      ph.style.height = `${cardRect.height}px`;
      row.after(ph);

      // pin the card exactly where it sits, then expand on the next frame.
      // Round to whole pixels so the resting text isn't blurred by sub-pixels.
      const cx = Math.round(cardRect.left - hostRect.left);
      const cy = Math.round(cardRect.top - hostRect.top);
      row.classList.add("popping");
      row.style.left = `${cx}px`;
      row.style.top = `${cy}px`;
      row.style.width = `${Math.round(cardRect.width)}px`;
      row.style.height = `${Math.round(cardRect.height)}px`;
      void row.offsetWidth;

      row.classList.add("expanded");
      row.style.left = "5px";                                // match the compact .trk-rows padding
      row.style.top = `${cy}px`;                             // stay on its own band, just stretch wide
      row.style.width = `${host.clientWidth - 10}px`;
      row.style.height = "28px";

      popTimer = setTimeout(settle, DWELL);
    };

    const paint = (tr) => { body.paint(tr); mini.paint(tr); };
    // Defer the change animation until the card has finished expanding.
    const paintAfterExpand = (tr) => {
      clearTimeout(paintTimer);
      paintTimer = setTimeout(() => { if (this.rendered) paint(tr); }, EXPAND);
    };
    return { el: row, paint, paintAfterExpand, flash, cancelPop: cleanup, vsig: undefined };
  }

  // Body builders + the reel/pie/overlay helpers live in TrackerRender, shared
  // with the per-PC sheet tab. The dock keeps thin wrappers for the few helpers
  // its dock-only code (mini cards, context menu) still calls.
  _buildBody(t) { return TrackerRender.buildBody(t); }
  _bound(v) { return TrackerRender.bound(v); }
  _makePie(...a) { return TrackerRender.makePie(...a); }

  /* ---- COMPACT MINI (vertical "playing-card" face for collapsed mode) ---- */
  _buildMini(t) {
    const el = this._el("div", "tmini t-" + t.type);
    const name = this._el("div", "tm-name");
    const core = this._el("div", "tm-core");
    el.append(name, core);

    let paint;
    switch (t.type) {
      case "clock": {
        const slices = Math.max(1, Math.trunc(Number(t.slices) || 6));
        const { svg, segs } = this._makePie(slices, 24);
        core.appendChild(svg);
        const sub = this._el("div", "tm-sub"); el.appendChild(sub);
        paint = (tr) => {
          name.textContent = tr.name ?? "";
          const v = Math.max(0, Math.min(slices, Math.trunc(Number(tr.value) || 0)));
          segs.forEach((sg, i) => sg.classList.toggle("fill", i < v));
          sub.textContent = `${v}/${slices}`;
          el.classList.toggle("complete", v >= slices);
        };
        break;
      }
      case "pool": {
        // Like the point card: the remaining count is the hero, the die size a faint cap.
        const val = this._el("div", "tm-val big");
        const sizelbl = this._el("div", "tm-max");
        core.append(val, sizelbl);
        paint = (tr) => {
          name.textContent = tr.name ?? "";
          const cur = Math.max(0, Math.trunc(Number(tr.current) || 0));
          const size = Math.max(2, Math.trunc(Number(tr.size) || 6));
          val.textContent = String(cur);
          sizelbl.textContent = `d${size}`;
          el.classList.toggle("at-min", cur === 0);
        };
        break;
      }
      case "task":
      case "hazard": {
        const boxes = Math.max(1, Math.trunc(Number(t.boxes) || (t.type === "hazard" ? 8 : 6)));
        const val = this._el("div", "tm-val");
        core.appendChild(val);
        paint = (tr) => {
          name.textContent = tr.title ?? "";
          const v = Math.max(0, Math.min(boxes, Math.trunc(Number(tr.value) || 0)));
          val.innerHTML = `<b>${v}</b><i>/${boxes}</i>`;
          el.classList.toggle("full", v >= boxes);
        };
        break;
      }
      case "separator": {
        el.classList.add("sep");
        paint = (tr) => { name.textContent = (tr.label ?? "").trim(); };
        break;
      }
      default: { // point
        const val = this._el("div", "tm-val big");
        const maxlbl = this._el("div", "tm-max");
        core.append(val, maxlbl);
        paint = (tr) => {
          name.textContent = tr.name ?? "";
          const lo = this._bound(tr.min), hi = this._bound(tr.max);
          const v = Math.trunc(Number(tr.value) || 0);
          val.textContent = String(v);
          maxlbl.textContent = hi !== null ? `/${hi}` : "";
          maxlbl.style.display = hi !== null ? "" : "none";
          el.classList.toggle("at-max", hi !== null && v >= hi);
          el.classList.toggle("at-min", lo !== null && v <= lo);
        };
      }
    }
    return { el, paint };
  }

  /* ------------------------------ interactions ------------------------------ */

  _wireRowInteractions(row, type, content, stepEls) {
    const isGM = game.user.isGM;
    const id = row.dataset.id;

    // The value zone keeps the simple gesture: left-click increments, right-click
    // decrements (pool: left rolls, right resets). Right-clicking anywhere else on
    // the row — the name/title and the spacing up to the value — opens the GM
    // context menu instead. Players never get the menu, so they're unaffected.
    if (type !== "separator") content.style.cursor = isGM ? "context-menu" : "default";
    if (isGM) {
      row.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        this._openContextMenu(ev, TrackerStore.get(id));
      });
    }

    if (type === "separator") return;   // purely decorative, no value to step

    // Who may step the value: the GM always; a player only on a pool they may roll.
    const canStep = isGM || (type === "pool" && TrackerStore.get(id)?.playerRoll);

    // A rollable pool reads as one big "roll" button: a click anywhere on its body
    // — the number, the name, or the ▶ "players may roll" affordance — rolls it.
    // Players especially expect that play glyph to do something; previously only the
    // number zone was wired, so clicking the affordance was inert. The GM's context
    // menu lives on the right-click (a separate event), so it stays unaffected.
    if (type === "pool" && canStep) {
      content.style.cursor = "pointer";
      content.addEventListener("click", () => TrackerStore.rollPool(id));

      // The compact "playing-card" face is a separate element that *replaces* the
      // body while the dock is collapsed (the body gets pointer-events:none), so it
      // needs its own roll wiring — otherwise a player in compact mode has nothing
      // clickable. A double-tap on a card expands the dock, so we defer the single
      // click briefly and cancel it on a double-click so expanding doesn't also roll.
      const mini = row.querySelector(".tmini");
      if (mini) {
        mini.style.cursor = "pointer";
        let clickTimer = null;
        mini.addEventListener("click", () => {
          if (clickTimer) return;
          clickTimer = setTimeout(() => { clickTimer = null; TrackerStore.rollPool(id); }, 240);
        });
        mini.addEventListener("dblclick", () => {
          if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        });
      }
    }

    for (const el of stepEls) {
      el.style.cursor = canStep ? "pointer" : "default";
      el.addEventListener("click", ev => {
        ev.stopPropagation();
        if (type === "pool") { if (canStep) TrackerStore.rollPool(id); return; }
        if (!isGM) return;
        TrackerStore.step(id, +1);
      });
      el.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        ev.stopPropagation();          // keep stepping on the value; don't open the menu
        if (type === "pool") { if (isGM) TrackerStore.resetPool(id); return; }
        if (!isGM) return;
        TrackerStore.step(id, -1);
      });
    }
  }

  /* ------------------------------ context menu ------------------------------ */

  /** Build the ordered list of menu entries for a tracker (management only —
   *  value stepping lives on the value zone's left/right click). */
  _contextItems(t) {
    const L = k => game.i18n.localize(k);
    const items = [];
    items.push({ icon: "fa-gear", label: L("GLCT.tracker.edit"), run: () => this._editTracker(t.id) });
    items.push({
      icon: t.visibleToPlayers ? "fa-eye-slash" : "fa-eye",
      label: L(t.visibleToPlayers ? "GLCT.tracker.ctx.hide" : "GLCT.tracker.ctx.show"),
      run: () => TrackerStore.setVisibility(t.id, !t.visibleToPlayers)
    });
    items.push({ sep: true });
    items.push({ icon: "fa-trash", label: L("GLCT.tracker.delete"), danger: true, run: () => this._deleteTracker(t.id) });
    return items;
  }

  /** Pop a floating context menu at the cursor; dismissed on outside click / Escape. */
  _openContextMenu(ev, t) {
    if (!t || !game.user.isGM) return;
    this._closeContextMenu();

    const menu = this._el("div", "trk-ctx");
    for (const it of this._contextItems(t)) {
      if (it.sep) { menu.appendChild(this._el("div", "ctx-sep")); continue; }
      const b = this._el("button", "ctx-item" + (it.danger ? " danger" : ""));
      b.appendChild(this._el("i", "fa-solid " + it.icon));
      b.appendChild(this._el("span", null, it.label));
      b.addEventListener("click", e => { e.stopPropagation(); this._closeContextMenu(); it.run(); });
      menu.appendChild(b);
    }

    // Mount outside .trk-dock (which clips overflow); .glct-trk-root grants pointer events.
    const root = this.element.querySelector(".glct-trk-root") ?? this.element;
    menu.style.visibility = "hidden";
    root.appendChild(menu);

    // Clamp to the viewport so the menu never spills off-screen.
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const x = Math.max(6, Math.min(ev.clientX, window.innerWidth - mw - 6));
    const y = Math.max(6, Math.min(ev.clientY, window.innerHeight - mh - 6));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = "";
    requestAnimationFrame(() => menu.classList.add("show"));
    this._ctx = menu;

    const onDown = e => { if (!menu.contains(e.target)) this._closeContextMenu(); };
    const onKey = e => { if (e.key === "Escape") { e.preventDefault(); this._closeContextMenu(); } };
    // Defer wiring so the opening right-click doesn't immediately dismiss it.
    setTimeout(() => {
      if (!this._ctx) return;
      window.addEventListener("pointerdown", onDown, true);
      window.addEventListener("contextmenu", onDown, true);
      window.addEventListener("keydown", onKey, true);
    }, 0);
    this._ctxOff = () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }

  _closeContextMenu() {
    this._ctxOff?.(); this._ctxOff = null;
    this._ctx?.remove(); this._ctx = null;
  }

  _wireReorder(host) {
    host.querySelectorAll(".trow .grip").forEach(grip => {
      grip.addEventListener("pointerdown", ev => {
        ev.preventDefault();
        const row = grip.closest(".trow");
        row.classList.add("dragging");
        const move = e => {
          const after = [...host.querySelectorAll(".trow:not(.dragging)")].find(c => {
            const r = c.getBoundingClientRect();
            return e.clientY < r.top + r.height / 2;
          });
          if (after) host.insertBefore(row, after); else host.appendChild(row);
        };
        const up = async () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          row.classList.remove("dragging");
          const ids = [...host.querySelectorAll(".trow")].map(r => r.dataset.id);
          await TrackerStore.reorder(ids);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
    });
  }

  _wireDockChrome() {
    const head = this.element.querySelector("[data-drag]");
    if (head) {
      head.addEventListener("pointerdown", this._onDragDock.bind(this));
      // Double-tap the header to switch standard <-> compact (mirrors the calendar HUD).
      head.addEventListener("dblclick", ev => {
        if (ev.target.closest("button")) return;
        ev.preventDefault();
        this._onToggleCompact();
      });
    }
    // While collapsed, double-tapping a card expands the whole dock again.
    this.element.querySelector("[data-rows]")?.addEventListener("dblclick", ev => {
      if (!this.compact || !ev.target.closest(".tmini")) return;
      ev.preventDefault();
      this._onToggleCompact();
    });
  }

  async _onToggleCompact() {
    this._closeContextMenu();
    const next = !this.compact;
    try { await game.settings.set(MODULE_ID, SETTINGS.trackerHudCompact, next); } catch { /* ignore */ }
    // Tear down any in-flight pop-outs (timers, placeholders, inline geometry)
    // so the dock lands in a clean state on either side of the toggle.
    this._rows.forEach(r => r.cancelPop?.());
    this.element.querySelector("[data-dock]")?.classList.toggle("compact", next);
    this.update();   // reconcile every row to its current value after the toggle
    // The dock's width changed — re-clamp once the layout settles so a wider
    // (standard) dock near a screen edge can't be pushed off it.
    clearTimeout(this._clampT);
    this._clampT = setTimeout(() => this._clampToViewport(), 60);
  }

  _onDragDock(ev) {
    if (ev.button !== 0 || ev.target.closest("button")) return;
    ev.preventDefault();
    const el = this.element;
    const rect = el.getBoundingClientRect();
    const ox = ev.clientX - rect.left, oy = ev.clientY - rect.top;
    const start = { x: ev.clientX, y: ev.clientY };
    let moved = false;
    const move = e => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
        moved = true; el.style.right = "auto";
      }
      if (moved) {
        el.style.left = `${e.clientX - ox}px`; el.style.top = `${e.clientY - oy}px`;
        this._clampToViewport();   // never let a drag carry the dock off-screen
      }
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return;
      const r = el.getBoundingClientRect();
      try { await game.settings.set(MODULE_ID, SETTINGS.trackerHudPosition, { left: Math.round(r.left), top: Math.round(r.top) }); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  _applyPosition() {
    const el = this.element;
    el.style.position = "fixed";
    el.style.zIndex = "69";
    let pos = {};
    try { pos = game.settings.get(MODULE_ID, SETTINGS.trackerHudPosition) ?? {}; } catch { /* ignore */ }
    if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      el.style.left = `${pos.left}px`; el.style.top = `${pos.top}px`; el.style.right = "auto";
      this._clampToViewport();   // a saved position may be off-screen on a smaller window
    } else {
      el.style.right = "14px"; el.style.top = "96px"; el.style.left = "auto";
    }
  }

  /**
   * Keep the dock fully on-screen. Top-left anchored, so we bound `left`/`top`
   * by the dock's own width/height. Used after restoring a saved position, on
   * every drag frame, and on viewport resize, so the dock can never be
   * stranded past a window edge.
   */
  _clampToViewport() {
    const el = this.element;
    if (!el) return;
    // Only act on a left-anchored dock; the default right-edge anchoring is
    // fluid and already safe, so we leave it untouched.
    if (el.style.right !== "auto") return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const m = 6;
    const left = Math.min(Math.max(r.left, m), Math.max(m, window.innerWidth - m - r.width));
    const top = Math.min(Math.max(r.top, m), Math.max(m, window.innerHeight - m - r.height));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.right = "auto";
  }

  /** Re-clamp on window resize so a shrinking viewport can't strand the dock. */
  _wireViewportClamp() {
    this._onViewportResize ??= () => {
      if (this._resizeRAF) return;
      this._resizeRAF = requestAnimationFrame(() => {
        this._resizeRAF = null;
        if (this.rendered) this._applyPosition();
      });
    };
    window.removeEventListener("resize", this._onViewportResize);
    window.addEventListener("resize", this._onViewportResize);
  }

  /* ------------------------------ CRUD entry points ------------------------------ */

  async _onAddTracker() {
    if (!game.user.isGM) return;
    const { TrackerEditor } = await import("./tracker-editor.js");
    TrackerEditor.create();
  }

  async _editTracker(id) {
    const { TrackerEditor } = await import("./tracker-editor.js");
    TrackerEditor.edit(TrackerStore, id);
  }

  async _deleteTracker(id) {
    const t = TrackerStore.get(id);
    const label = t?.name ?? t?.title ?? game.i18n.localize("GLCT.tracker.title");
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("GLCT.tracker.delete") },
      content: `<p>${game.i18n.format("GLCT.tracker.confirmDelete", { name: foundry.utils.escapeHTML(label) })}</p>`
    });
    if (confirmed) await TrackerStore.delete(id);
  }
}
