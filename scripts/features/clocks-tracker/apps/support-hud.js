/**
 * SupportHud — the Comms-Coin window. A frameless, draggable ApplicationV2
 * modeled on WeatherHud/TrackerHud. It rests as a compact coin (a portrait bust
 * rising over a segmented availability-pool gauge) and expands to a tight dossier
 * on hover (CSS-driven). The gauge segments + the four action rows are built
 * imperatively so a pool roll repaints without a full re-render.
 *
 * GM authors the roster + picks the active support; players get a read-only coin
 * (shown only when the GM has revealed it) and may fire actions on supports whose
 * playerInvoke flag is set. State writes are GM-authoritative (see SupportStore).
 */

import { MODULE_ID, SETTINGS, SUPPORT_ABILITY_KINDS, SUPPORT_FACTION_MOD, SUPPORT_ROUND_LIMITED_KINDS } from "../const.js";
import { SupportStore } from "../support/support-store.js";
import { SupportCard } from "../support/support-card.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const NS = "http://www.w3.org/2000/svg";

const KIND_ICON = {
  passive: "fa-solid fa-shield-halved",
  radio: "fa-solid fa-tower-broadcast",
  fieldCombat: "fa-solid fa-bolt",
  fieldExplore: "fa-solid fa-route"
};
const KIND_CLASS = { passive: "passive", radio: "radio", fieldCombat: "fc", fieldExplore: "fx" };

export class SupportHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async open() {
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    try { await game.settings.set(MODULE_ID, SETTINGS.supportHudHidden, false); } catch { /* ignore */ }
    return this.instance;
  }

  static async toggle() {
    if (this.instance?.rendered) return this.instance._close();
    return this.open();
  }

  /** Repaint from current support state (no re-render unless structure changed). */
  static refresh() { this.instance?.update(); }

  static DEFAULT_OPTIONS = {
    id: "glct-support-hud",
    classes: ["glct"],
    tag: "div",
    window: { frame: false, positioned: false, minimizable: false, resizable: false },
    actions: {
      muster: SupportHud.prototype._onMuster,
      startMission: SupportHud.prototype._onStartMission,
      recover: SupportHud.prototype._onRecover,
      togglePlayers: SupportHud.prototype._onTogglePlayers,
      openEditor: SupportHud.prototype._onOpenEditor,
      clearActive: SupportHud.prototype._onClearActive,
      clearRound: SupportHud.prototype._onClearRound,
      collapse: SupportHud.prototype._onCollapse
    }
  };

  static PARTS = { hud: { template: `modules/${MODULE_ID}/templates/support-hud.hbs` } };

  _gaugeMax = -1;   // segment count currently built (rebuild gauge when poolMax changes)
  _actsSig = null;  // signature of the active support's abilities (rebuild rows on change)
  _activeId = null; // last painted active support id (reset open state on change)

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, { isGM: game.user?.isGM ?? false });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._gaugeMax = -1;
    this._actsSig = null;
    this.element.classList.toggle("is-gm", game.user.isGM);
    this._applyPosition();
    this._wireChrome();
    this.update();
  }

  /* ------------------------------ painting ------------------------------ */

  update() {
    if (!this.rendered) return;
    const root = this.element;
    const isGM = game.user.isGM;
    const active = SupportStore.active();

    // Whole-widget visibility: players only see it when the GM has revealed it
    // and a support is active; the GM always sees something (coin or muster).
    const sees = SupportStore.viewerSees;
    root.style.display = sees ? "" : "none";
    if (!sees) return;

    const muster = root.querySelector("[data-muster]");
    const coinwrap = root.querySelector("[data-coinwrap]");
    if (muster) muster.hidden = !(isGM && !active);
    if (coinwrap) coinwrap.hidden = !active;

    // Collapse the expanded sheet when the active support changes or clears
    // (so a stale sheet from the previous support never lingers open).
    if (this._activeId !== (active?.id ?? null)) {
      this._activeId = active?.id ?? null;
      if (coinwrap) coinwrap.classList.remove("is-open");
    }

    if (!active) return;
    this._paintActive(active);
  }

  _paintActive(s) {
    const root = this.element;
    const wrap = root.querySelector("[data-coinwrap]");
    wrap.style.setProperty("--glct-sup-accent", s.accent || "#e0a368");
    wrap.classList.toggle("is-downed", !!s.downed);

    const max = SupportStore.poolMax(s);
    const cur = Math.max(0, Math.min(max, Number(s.current) || 0));

    // names / role
    root.querySelectorAll("[data-name]").forEach(e => e.textContent = s.name);
    const role = root.querySelector("[data-role]");
    if (role) role.textContent = s.role || "";

    // portrait art — coin disc ("coin" frame) + expanded hero ("exp" frame)
    this._paintArt(root.querySelector(".coin .disc"), root.querySelector(".coin .disc .art"), s, "coin");
    this._paintArt(root.querySelector(".hero"), root.querySelector(".hero .art"), s, "exp");

    // count badges (coin + pool editor) and the max
    root.querySelectorAll("[data-count]").forEach(e => e.textContent = cur);
    const maxEl = root.querySelector("[data-max]");
    if (maxEl) maxEl.textContent = max;

    // faction line
    const fac = root.querySelector("[data-fac]");
    if (fac) {
      const mod = SUPPORT_FACTION_MOD[s.faction] ?? 0;
      const modTxt = mod > 0 ? `+${mod}d6` : mod < 0 ? `${mod}d6` : "±0";
      fac.innerHTML = `<b>${max}d6</b> · ${game.i18n.localize("GLCT.support.faction")} ${s.faction} (${modTxt})`;
    }

    this._paintGauge(max, cur, s);
    this._paintDice(max, cur, s);
    this._paintActs(s);
    this._paintPlayersBtn();
  }

  /** Point a surface's <img class="art"> at the support image and apply its
   *  per-surface framing (x/y/scale via CSS vars). Toggles .has-img on the frame
   *  container so the placeholder icon shows when there's no portrait. */
  _paintArt(container, artImg, s, surface) {
    if (!container) return;
    if (s.img && artImg) {
      if (artImg.getAttribute("src") !== s.img) artImg.src = s.img;
      const f = SupportStore.frame(s, surface);
      artImg.style.setProperty("--ix", `${f.x}px`);
      artImg.style.setProperty("--iy", `${f.y}px`);
      artImg.style.setProperty("--is", `${f.s}`);
      container.classList.add("has-img");
    } else {
      container.classList.remove("has-img");
      if (artImg) artImg.removeAttribute("src");
    }
  }

  /** Segmented ring around the disc: rebuild thick segments when the count
   *  changes, then light the filled ones. */
  _paintGauge(max, cur, s) {
    const g = this.element.querySelector("[data-gauge]");
    if (!g) return;
    if (this._gaugeMax !== max) {
      g.replaceChildren();
      const cx = 48, cy = 48, r = 42, span = 290, start = 125, gap = max > 1 ? 9 : 0;
      const each = max ? span / max : span;
      const polar = (deg) => { const a = deg * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
      for (let i = 0; i < max; i++) {
        const a0 = start + i * each + gap / 2, a1 = start + (i + 1) * each - gap / 2;
        const [x0, y0] = polar(a0), [x1, y1] = polar(a1);
        const large = (a1 - a0) > 180 ? 1 : 0;
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`);
        p.setAttribute("class", "seg");
        p.dataset.i = String(i);
        g.appendChild(p);
      }
      this._gaugeMax = max;
    }
    g.querySelectorAll(".seg").forEach(p => p.classList.toggle("on", (+p.dataset.i) < cur));
  }

  /** Pool dice in the sheet. GM may click a die to set the current pool directly. */
  _paintDice(max, cur, s) {
    const box = this.element.querySelector("[data-dice]");
    if (!box) return;
    box.replaceChildren();
    const isGM = game.user.isGM;
    for (let i = 0; i < max; i++) {
      const d = document.createElement("div");
      d.className = "die" + (i >= cur ? " spent" : "");
      d.textContent = "d6";
      if (isGM) d.addEventListener("click", () => {
        // click a filled die → spend down to it; click a spent die → fill up to it
        SupportStore.setPool(s.id, (i < cur) ? i : i + 1);
      });
      box.appendChild(d);
    }
  }

  /** Build (on shape change) the four action rows; always repaint disabled/used state. */
  _paintActs(s) {
    const host = this.element.querySelector("[data-acts]");
    if (!host) return;
    const sig = SUPPORT_ABILITY_KINDS.map(k => `${k}:${s.abilities?.[k]?.name}:${s.abilities?.[k]?.costLabel}`).join("|") + "#" + s.id;
    if (sig !== this._actsSig) {
      host.replaceChildren();
      for (const kind of SUPPORT_ABILITY_KINDS) {
        const a = s.abilities?.[kind]; if (!a) continue;
        const burn = SupportStore.isBurnKind(kind);
        const row = document.createElement(kind === "passive" ? "div" : "button");
        row.type = "button";
        row.className = `act ${KIND_CLASS[kind]}`;
        row.dataset.kind = kind;
        row.innerHTML =
          `<i class="ai ${KIND_ICON[kind]}"></i>
           <div class="am"><div class="an">${foundry.utils.escapeHTML(a.name || "")}</div></div>
           <span class="cost">${burn ? '<span class="burn"><i class="fa-solid fa-dice"></i></span>' : ""}${foundry.utils.escapeHTML(a.costLabel || "")}</span>`;
        // Only the ability name shows in the row; the full detail lives in the
        // hover tooltip (rendered on Foundry's global tooltip layer so the row's
        // overflow:hidden never clips it).
        this._bindTip(row, this._tip(a, s, kind));
        if (SupportStore.canInvoke(s)) row.addEventListener("click", () => this._onFire(kind));
        host.appendChild(row);
      }
      this._actsSig = sig;
    }
    // state: when Downed the support is entirely offline — EVERY row greys out,
    // passive included (its aura is also pulled from the party, store-side). The
    // shared 1/round lock marks BOTH round-limited rows, but only while in combat.
    const inCombat = !!game.combat?.started;
    host.querySelectorAll(".act").forEach(row => {
      const kind = row.dataset.kind;
      const disabled = !!s.downed;
      row.classList.toggle("disabled", disabled);
      row.classList.toggle("used", inCombat && SUPPORT_ROUND_LIMITED_KINDS.includes(kind) && !!s.radioUsed);
    });
    this._paintRoundClear(s, inCombat);
  }

  /** GM-only "clear this round's action" button: shown only in combat once the
   *  shared lock is set, so the GM can free up a support that already acted. */
  _paintRoundClear(s, inCombat = !!game.combat?.started) {
    const btn = this.element.querySelector("[data-action='clearRound']");
    if (!btn) return;
    btn.hidden = !(game.user?.isGM && inCombat && !!s?.radioUsed);
  }

  /** A readable one-line preview of an ability (tokens stripped/resolved). */
  _preview(text, s) {
    return String(text ?? "")
      .replace(/\{level\}/g, s.level).replace(/\{half\}/g, Math.floor(s.level / 2)).replace(/\{pool\}/g, s.current ?? 0)
      .replace(/@\w+\[([^\]|]*)(?:\|[^\]]*)?\]/g, "$1")
      .replace(/[{}<>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Rich hover-tooltip HTML for an ability: name, cost, traits, full detail. */
  _tip(a, s, kind) {
    const esc = foundry.utils.escapeHTML;
    const kindLabel = game.i18n.localize(`GLCT.support.kinds.${kind}`);
    const traits = (a.traits ?? []).filter(Boolean)
      .map(t => `<span>${esc(t)}</span>`).join("");
    const body = this._preview(a.cardText, s) || game.i18n.localize("GLCT.support.noDetail");
    const limit = SUPPORT_ROUND_LIMITED_KINDS.includes(kind)
      ? `<div class="tip-limit"><i class="fa-solid fa-hourglass-half"></i> ${esc(game.i18n.localize("GLCT.support.sharedRound"))}</div>`
      : "";
    return `<div class="tip-head"><b>${esc(a.name || kindLabel)}</b>${a.costLabel ? `<span class="tip-cost">${esc(a.costLabel)}</span>` : ""}</div>
        <div class="tip-kind">${esc(kindLabel)}</div>
        ${traits ? `<div class="tip-traits">${traits}</div>` : ""}
        ${limit}
        <div class="tip-body">${esc(body)}</div>`;
  }

  /** Show `innerHTML` in Foundry's global tooltip while the row is hovered. */
  _bindTip(el, innerHTML) {
    const accent = SupportStore.active()?.accent || "#e0a368";
    const show = () => {
      const content = document.createElement("div");
      content.className = "glct-sup-tip";
      content.style.setProperty("--glct-sup-accent", accent);
      content.innerHTML = innerHTML;
      // Open the tooltip toward whichever side has room (the HUD is draggable, so
      // a fixed LEFT runs off-screen when it's parked on the left edge).
      const r = el.getBoundingClientRect();
      const room = Math.max(0, window.innerWidth - r.right);
      const direction = (r.left > room && r.left > 280) ? "LEFT" : "RIGHT";
      try { game.tooltip.activate(el, { content, direction, cssClass: "glct-sup-tip-wrap" }); }
      catch { /* tooltip manager unavailable */ }
    };
    const hide = () => { try { game.tooltip.deactivate(); } catch { /* ignore */ } };
    el.addEventListener("pointerenter", show);
    el.addEventListener("pointerleave", hide);
  }

  _paintPlayersBtn() {
    const btn = this.element.querySelector("[data-players]");
    if (!btn) return;
    const on = SupportStore.visibleToPlayers;
    btn.classList.toggle("on", on);
    const i = btn.querySelector("i");
    if (i) i.className = on ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
  }

  /* ------------------------------ interactions ------------------------------ */

  async _onFire(kind) {
    const active = SupportStore.active();
    if (!active) return;
    // Firing simply posts the support card to chat (and rolls the pool when the
    // ability is a Field Call). No in-HUD takeover — the chat card is the result.
    await SupportCard.fire(active, kind);
    // Result persists via the GM createChatMessage handler → setting onChange → refresh.
    // Repaint immediately on the GM's own client for snappy feedback.
    if (game.user.isGM) this.update();
  }

  _onCollapse() {
    const wrap = this.element.querySelector("[data-coinwrap]");
    wrap?.classList.remove("is-open");
  }

  async _onMuster() {
    if (!game.user.isGM) return;
    const roster = SupportStore.roster();
    if (!roster.length) {
      const ok = await DialogV2.confirm({
        window: { title: game.i18n.localize("GLCT.support.muster") },
        content: `<p>${game.i18n.localize("GLCT.support.noRoster")}</p>`
      });
      if (ok) this._onOpenEditor();
      return;
    }
    const activeId = SupportStore.data.activeId;
    const cards = roster.map(s => {
      const pic = s.img ? `<img src="${s.img}" alt="">` : `<i class="fa-solid fa-user-shield"></i>`;
      const max = SupportStore.poolMax(s);
      const down = s.downedLastMission ? `<span class="sup-pick-down">${game.i18n.localize("GLCT.support.downedLast")}</span>` : "";
      return `<button type="button" class="sup-pick${s.id === activeId ? " active" : ""}" data-id="${s.id}" style="--glct-sup-accent:${s.accent}">
          <span class="sup-pick-pic">${pic}</span>
          <span class="sup-pick-txt"><span class="n">${foundry.utils.escapeHTML(s.name)}</span>
            <span class="r">${foundry.utils.escapeHTML(s.role || "")}</span></span>
          <span class="sup-pick-pool">${max}d6 ${down}</span>
        </button>`;
    }).join("");

    // DialogV2.wait() is the static helper that actually wires the `render`
    // callback (a bare `new DialogV2({render})` never invokes it). The chosen
    // card stashes its pick in `picked`, then closes the dialog; we read it back
    // after wait() resolves. rejectClose:false → a plain close just resolves null.
    let picked = null;
    try {
      await DialogV2.wait({
        window: { title: game.i18n.localize("GLCT.support.musterTitle") },
        classes: ["glct", "glct-sup-picker"],
        content: `<div class="sup-pick-list">${cards}</div>
          <label class="sup-pick-start"><input type="checkbox" name="start" checked> ${game.i18n.localize("GLCT.support.pickAndStart")}</label>`,
        rejectClose: false,
        render: (event, dialog) => {
          const host = dialog?.element ?? event?.currentTarget;
          host?.querySelectorAll?.(".sup-pick").forEach(btn => btn.addEventListener("click", () => {
            const start = host.querySelector?.('input[name="start"]')?.checked;
            picked = { id: btn.dataset.id, start: !!start };
            dialog.close();
          }));
        },
        buttons: [{ action: "cancel", label: game.i18n.localize("GLCT.calendarView.close"), default: true }]
      });
    } catch { /* dialog dismissed */ }

    if (picked?.id) {
      if (picked.start) await SupportStore.startMission(picked.id);
      else await SupportStore.setActive(picked.id);
      // Repaint immediately on the GM's own client so the coin flips from the
      // muster state to the chosen character without waiting on the setting
      // onChange round-trip (which trails applyPassive's embedded-doc writes).
      this.update();
    }
  }

  async _onStartMission() {
    if (!game.user.isGM) return;
    const active = SupportStore.active();
    if (!active) return this._onMuster();
    await SupportStore.startMission(active.id);
    ui.notifications?.info(game.i18n.format("GLCT.support.missionStarted", { name: active.name }));
  }

  async _onRecover() {
    if (!game.user.isGM) return;
    const active = SupportStore.active();
    if (active) await SupportStore.recover(active.id);
  }

  async _onTogglePlayers() {
    if (!game.user.isGM) return;
    try { await game.settings.set(MODULE_ID, SETTINGS.supportHudVisibleToPlayers, !SupportStore.visibleToPlayers); } catch { /* ignore */ }
    this._paintPlayersBtn();
  }

  async _onOpenEditor() {
    if (!game.user.isGM) return;
    const { SupportEditor } = await import("./support-editor.js");
    SupportEditor.show();
  }

  async _onClearActive() {
    if (!game.user.isGM) return;
    await SupportStore.clearActive();
  }

  /** GM: force-clear the shared 1/round action lock so the support can act again. */
  async _onClearRound() {
    if (!game.user.isGM) return;
    await SupportStore.resetRadio();
    this.update();
  }

  /* ------------------------------ chrome / position ------------------------------ */

  _wireChrome() {
    // Drag handles: the muster coin, the resting coin, and the sheet hero. Click
    // vs. drag is sorted out by a movement threshold in _onDrag (a plain click
    // still fires the element's action — e.g. expanding the coin).
    for (const h of this.element.querySelectorAll("[data-drag], .sup-muster-coin")) {
      h.addEventListener("pointerdown", this._onDrag.bind(this));
    }
    // Click the resting coin to expand the sheet (unless the click was actually
    // the tail of a drag — see _onDrag, which swallows that click).
    const coin = this.element.querySelector("[data-coin]");
    if (coin) coin.addEventListener("click", () => {
      const wrap = this.element.querySelector("[data-coinwrap]");
      if (!wrap || wrap.hidden) return;
      wrap.classList.add("is-open");
      this._positionSheet();   // keep the expanded sheet fully on-screen
    });
    // Pool steppers (GM): nudge the current availability pool by ±1.
    this.element.querySelectorAll(".pstep").forEach(b => b.addEventListener("click", () => {
      const a = SupportStore.active();
      if (!a) return;
      const max = SupportStore.poolMax(a);
      const next = Math.max(0, Math.min(max, (Number(a.current) || 0) + Number(b.dataset.pool)));
      SupportStore.setPool(a.id, next);
    }));
  }

  _onDrag(ev) {
    if (ev.button !== 0) return;
    const el = this.element;
    const rect = el.getBoundingClientRect();
    const ox = ev.clientX - rect.left, oy = ev.clientY - rect.top;
    const start = { x: ev.clientX, y: ev.clientY };
    let moved = false;
    const move = e => {
      if (!moved) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;  // still a click
        moved = true;
        el.style.right = "auto"; el.style.bottom = "auto";
        el.classList.add("is-dragging");
      }
      e.preventDefault();
      el.style.left = `${e.clientX - ox}px`;
      el.style.top = `${e.clientY - oy}px`;
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { ev.target?.releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
      if (!moved) return;   // never moved → let the click/action proceed
      el.classList.remove("is-dragging");
      // Swallow the click that trails a drag (so the coin doesn't expand / the
      // muster picker doesn't open). Critically, this is SELF-CLEARING: it eats
      // at most one click within 300ms, then removes itself — otherwise a drag
      // that ends off-element (no trailing click) would leave the swallower armed
      // and silently eat the player's *next* real click.
      let armed = true;
      const swallow = e => { if (!armed) return; armed = false; e.stopPropagation(); e.preventDefault(); el.removeEventListener("click", swallow, true); };
      el.addEventListener("click", swallow, true);
      window.setTimeout(() => { if (armed) { armed = false; el.removeEventListener("click", swallow, true); } }, 300);
      // If the sheet is open while dragging, keep it on-screen at the new spot.
      if (el.querySelector("[data-coinwrap]")?.classList.contains("is-open")) this._positionSheet();
      const r = el.getBoundingClientRect();
      try { await game.settings.set(MODULE_ID, SETTINGS.supportHudPosition, { left: Math.round(r.left), top: Math.round(r.top) }); } catch { /* ignore */ }
    };
    try { ev.target?.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Position the expanded sheet so it stays fully within the viewport. The sheet
   *  prefers to open up-and-left from the coin, but flips to open down / right and
   *  clamps to the screen edges when there isn't room — so it never lands off-screen
   *  (which would also strand the close button and trap the user). */
  _positionSheet() {
    const wrap = this.element.querySelector("[data-coinwrap]");
    const sheet = this.element.querySelector("[data-sheet]");
    if (!wrap || !sheet) return;
    const m = 8;                                  // viewport margin
    const wr = wrap.getBoundingClientRect();
    const sw = sheet.offsetWidth || 300;
    const sh = sheet.offsetHeight || 320;
    const vw = window.innerWidth, vh = window.innerHeight;
    // horizontal: default open left (sheet's right edge at the coin's right edge);
    // if that clips the left margin, open to the right instead, then clamp.
    let left = wr.right - sw;
    if (left < m) left = wr.left;
    left = Math.min(Math.max(left, m), Math.max(m, vw - sw - m));
    // vertical: default open up (sheet's bottom at the coin's bottom); if that
    // clips the top margin, open downward instead, then clamp.
    let top = wr.bottom - sh;
    if (top < m) top = wr.top;
    top = Math.min(Math.max(top, m), Math.max(m, vh - sh - m));
    // convert screen coords → coin-wrap-local (the sheet's offset parent)
    sheet.style.left = `${Math.round(left - wr.left)}px`;
    sheet.style.top = `${Math.round(top - wr.top)}px`;
    sheet.style.right = "auto";
    sheet.style.bottom = "auto";
  }

  _applyPosition() {
    const el = this.element;
    el.style.position = "fixed";
    el.style.zIndex = "68";
    let pos = {};
    try { pos = game.settings.get(MODULE_ID, SETTINGS.supportHudPosition) ?? {}; } catch { /* ignore */ }
    if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      el.style.left = `${pos.left}px`; el.style.top = `${pos.top}px`; el.style.right = "auto"; el.style.bottom = "auto";
    } else {
      el.style.right = "24px"; el.style.bottom = "96px"; el.style.left = "auto"; el.style.top = "auto";
    }
  }

  async _close() {
    try { game.settings.set(MODULE_ID, SETTINGS.supportHudHidden, true).catch(() => {}); } catch { /* ignore */ }
    return this.close({ animate: false });
  }
}
