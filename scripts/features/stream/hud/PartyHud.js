/**
 * Party HUD overlay — renders on the stream client only.
 *
 * Receives GM-computed snapshots (see hud-controller.js) and reconciles a row of
 * Etched-Glass character cards keyed by actor id. Motion is value-driven: HP
 * uses a fighting-game "ghost"/lag bar that reveals the exact delta (red drain
 * on damage, green lead on heal), numbers count to their new value, AC flips,
 * the class resource pips fill/glow, conditions stagger in/out, the row FLIP-
 * reorders, and the active-turn card glows. Nothing animates without a state
 * change. Reduced motion is honoured by CSS (near-zero durations) and by
 * skipping the JS count tween.
 */

import { CLASSES, HOOK_NS } from "../constants.js";
import { escapeHTML } from "../../../core/util.mjs";
import { requestHudState } from "../socket.js";

const ROOT_ID = "gls-hud-root";
const PORTRAIT_FALLBACK = "icons/svg/mystery-man.svg";

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function pct(value, max) {
  const m = Number(max);
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.max(0, Math.min(1, Number(value) / m));
}

export class PartyHud {
  constructor(streamMode) {
    this.streamMode = streamMode;
    this.root = null;
    this.state = null;
    /** @type {Map<string, {el: HTMLElement, snap: object, countRAF: number|null}>} */
    this.cards = new Map();
  }

  registerHooks() {
    Hooks.on(`${HOOK_NS}.streamModeChanged`, active => {
      if (active && this.#isStreamClient()) {
        this.#ensureRoot();
        this.render();
        requestHudState();
      } else {
        this.#teardown();
      }
    });
    // A stream client that loads mid-session asks the GM for the current state.
    if (this.#isStreamClient() && this.streamMode?.active) requestHudState();
  }

  #isStreamClient() {
    return Boolean(this.streamMode?.isStreamUser);
  }

  /** Called from the socket handler with the GM-authoritative state. */
  applyState(state) {
    this.state = state;
    if (!this.#isStreamClient() || !this.streamMode?.active) return;
    this.render();
  }

  render() {
    const state = this.state;
    if (!this.#isStreamClient() || !this.streamMode?.active || !state?.visible) {
      this.#hideRoot();
      return;
    }
    const root = this.#ensureRoot();
    this.#applyLayout(state.layout ?? {});
    root.classList.remove("gls-hud-hidden");

    const cards = state.cards ?? [];
    const incomingIds = new Set(cards.map(c => c.id));

    // FLIP: capture current positions before any DOM mutation.
    const firstRects = new Map();
    for (const [id, rec] of this.cards) firstRects.set(id, rec.el.getBoundingClientRect());

    // Remove cards no longer present (animated out).
    for (const [id, rec] of [...this.cards]) {
      if (!incomingIds.has(id)) {
        this.#exitCard(rec.el);
        if (rec.countRAF) cancelAnimationFrame(rec.countRAF);
        this.cards.delete(id);
      }
    }

    // Create/update + order.
    cards.forEach((snap, index) => {
      let rec = this.cards.get(snap.id);
      if (!rec) {
        const el = this.#buildCard(snap);
        rec = { el, snap: null, countRAF: null };
        this.cards.set(snap.id, rec);
        root.appendChild(el);
        this.#enterCard(el);
      }
      // Maintain DOM order to match incoming order (for FLIP + visual order).
      if (root.children[index] !== rec.el) root.insertBefore(rec.el, root.children[index] ?? null);
      this.#updateCard(rec, snap);
      rec.snap = snap;
    });

    this.#flip(firstRects);
  }

  // ---- root / layout -------------------------------------------------------

  #ensureRoot() {
    if (this.root?.isConnected) return this.root;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = `${ROOT_ID} ${CLASSES.allowedUi}`; // allow-listed so UI hiding never blanks it
    document.body.appendChild(root);
    this.root = root;
    return root;
  }

  #applyLayout(layout) {
    const root = this.#ensureRoot();
    root.dataset.anchor = layout.anchor ?? "bottom";
    root.dataset.align = layout.align ?? "center";
    root.style.setProperty("--gls-hud-offset-x", `${Number(layout.offsetX) || 0}px`);
    root.style.setProperty("--gls-hud-offset-y", `${Number(layout.offsetY) || 0}px`);
    root.style.setProperty("--gls-hud-scale", `${(Number(layout.scale) || 100) / 100}`);
  }

  #hideRoot() {
    this.root?.classList.add("gls-hud-hidden");
  }

  #teardown() {
    for (const rec of this.cards.values()) if (rec.countRAF) cancelAnimationFrame(rec.countRAF);
    this.cards.clear();
    this.root?.remove();
    this.root = null;
  }

  // ---- card construction ---------------------------------------------------

  #buildCard(snap) {
    const el = document.createElement("div");
    el.className = "gls-hud-card gl-glass";
    el.dataset.actorId = snap.id;
    el.innerHTML = `
      <div class="gls-hud-portrait"><img alt="" draggable="false"/><div class="gls-hud-down-veil"></div></div>
      <div class="gls-hud-body">
        <div class="gls-hud-header">
          <span class="gls-hud-name"></span>
          <span class="gls-hud-meta"><span class="gls-hud-classlevel"></span><span class="gls-hud-race"></span></span>
        </div>
        <div class="gls-hud-vitals">
          <div class="gls-hud-hp">
            <div class="gls-hud-hp-bar">
              <div class="gls-hud-hp-ghost"></div>
              <div class="gls-hud-hp-fill"></div>
              <div class="gls-hud-hp-temp"></div>
            </div>
            <div class="gls-hud-hp-text"><span class="gls-hud-hp-value">0</span><span class="gls-hud-hp-sep">/</span><span class="gls-hud-hp-max">0</span><span class="gls-hud-hp-temp-text"></span></div>
          </div>
          <div class="gls-hud-ac" title="Armor Class"><i class="fa-solid fa-shield-halved"></i><span class="gls-hud-ac-value">—</span></div>
          <div class="gls-hud-resource"></div>
        </div>
        <div class="gls-hud-conditions"></div>
        <div class="gls-hud-abilities"></div>
      </div>`;
    return el;
  }

  // ---- card update + animation --------------------------------------------

  #updateCard(rec, snap) {
    const el = rec.el;
    const prev = rec.snap;
    el.classList.toggle("is-turn", Boolean(snap.turn));
    el.classList.toggle("is-down", Boolean(snap.defeated));

    const img = el.querySelector(".gls-hud-portrait img");
    if (img.getAttribute("src") !== snap.img) img.src = snap.img || PORTRAIT_FALLBACK;

    this.#setText(el, ".gls-hud-name", snap.name);
    this.#setText(el, ".gls-hud-classlevel", snap.classLevel);
    this.#setText(el, ".gls-hud-race", snap.race);
    el.querySelector(".gls-hud-race").style.display = snap.race ? "" : "none";

    this.#updateHP(el, prev?.hp, snap.hp, snap.tempHp);
    this.#updateAC(el, prev?.ac, snap.ac);
    this.#updateResource(el, prev?.resource, snap.resource);
    this.#updateConditions(el, prev?.conditions ?? [], snap.conditions ?? []);
    this.#updateAbilities(el, snap.abilities ?? []);
    this.#startCount(rec, prev?.hp?.value, snap.hp?.value);
  }

  #updateHP(el, prevHP, hp, tempHp) {
    const bar = el.querySelector(".gls-hud-hp-bar");
    const fill = el.querySelector(".gls-hud-hp-fill");
    const ghost = el.querySelector(".gls-hud-hp-ghost");
    const tempEl = el.querySelector(".gls-hud-hp-temp");

    const newPct = pct(hp.value, hp.max);
    const oldPct = prevHP ? pct(prevHP.value, prevHP.max) : newPct;
    const tempPct = pct(tempHp ?? hp.temp ?? 0, hp.max);

    // HP band colour by ratio (green → amber → red), independent of delta flash.
    bar.dataset.band = newPct > 0.5 ? "high" : newPct > 0.25 ? "mid" : "low";

    this.#setText(el, ".gls-hud-hp-max", hp.max);
    tempEl.style.width = `${tempPct * 100}%`;
    const tempText = el.querySelector(".gls-hud-hp-temp-text");
    tempText.textContent = (tempHp ?? hp.temp) ? `+${tempHp ?? hp.temp}` : "";

    if (prevHP && hp.value < prevHP.value) {
      // Damage: solid bar snaps down; the ghost holds the old height and drains
      // to reveal the lost slice in red.
      fill.style.width = `${newPct * 100}%`;
      ghost.classList.remove("heal");
      ghost.classList.add("damage");
      ghost.style.transition = "none";
      ghost.style.width = `${oldPct * 100}%`;
      void ghost.offsetWidth; // reflow so the next width animates
      ghost.style.transition = "";
      ghost.style.width = `${newPct * 100}%`;
      this.#flash(el, "damage");
    } else if (prevHP && hp.value > prevHP.value) {
      // Heal: ghost leads to the new (higher) height in green, the solid bar
      // grows up to meet it.
      ghost.classList.remove("damage");
      ghost.classList.add("heal");
      ghost.style.transition = "none";
      ghost.style.width = `${newPct * 100}%`;
      void ghost.offsetWidth;
      ghost.style.transition = "";
      fill.style.width = `${newPct * 100}%`;
      this.#flash(el, "heal");
    } else {
      // No change (or first paint): settle both bars.
      fill.style.width = `${newPct * 100}%`;
      ghost.style.width = `${newPct * 100}%`;
    }
  }

  #flash(el, kind) {
    const card = el;
    card.classList.remove("flash-damage", "flash-heal");
    void card.offsetWidth;
    card.classList.add(`flash-${kind}`);
    const cls = `flash-${kind}`;
    card.addEventListener("animationend", function handler(e) {
      if (e.animationName && e.target === card) {
        card.classList.remove(cls);
        card.removeEventListener("animationend", handler);
      }
    });
    // Fallback removal in case animationend doesn't fire (reduced motion).
    window.setTimeout(() => card.classList.remove(cls), 1200);
  }

  #updateAC(el, prevAC, ac) {
    const valueEl = el.querySelector(".gls-hud-ac-value");
    const next = ac == null ? "—" : String(ac);
    if (valueEl.textContent === next) return;
    valueEl.textContent = next;
    if (prevAC != null && ac != null && ac !== prevAC) {
      const wrap = el.querySelector(".gls-hud-ac");
      wrap.classList.remove("flip");
      void wrap.offsetWidth;
      wrap.classList.add("flip");
    }
  }

  #updateResource(el, prevRes, res) {
    const wrap = el.querySelector(".gls-hud-resource");
    if (!res) {
      wrap.innerHTML = "";
      wrap.style.display = "none";
      return;
    }
    wrap.style.display = "";
    const changed = !prevRes || prevRes.label !== res.label || prevRes.max !== res.max;
    if (changed) {
      const pips = Number.isFinite(res.max) && res.max > 0 && res.max <= 12
        ? Array.from({ length: res.max }, (_, i) => `<span class="gls-hud-pip" data-i="${i}"></span>`).join("")
        : "";
      wrap.innerHTML = `
        <span class="gls-hud-resource-label">${escapeHTML(res.label ?? "")}</span>
        <span class="gls-hud-resource-pips">${pips}</span>
        <span class="gls-hud-resource-num">${escapeHTML(String(res.value ?? 0))}${res.max ? `<span class="gls-hud-resource-max">/${escapeHTML(String(res.max))}</span>` : ""}</span>`;
    } else {
      this.#setText(el, ".gls-hud-resource-num", `${res.value ?? 0}`);
      const numEl = wrap.querySelector(".gls-hud-resource-num");
      if (numEl && res.max) numEl.innerHTML = `${escapeHTML(String(res.value ?? 0))}<span class="gls-hud-resource-max">/${escapeHTML(String(res.max))}</span>`;
    }
    const pipEls = wrap.querySelectorAll(".gls-hud-pip");
    pipEls.forEach((pip, i) => {
      const wasFilled = pip.classList.contains("filled");
      const filled = i < (res.value ?? 0);
      pip.classList.toggle("filled", filled);
      if (filled && !wasFilled && prevRes) {
        pip.classList.remove("just-filled");
        void pip.offsetWidth;
        pip.classList.add("just-filled");
      }
    });
  }

  #updateConditions(el, prevConds, conds) {
    const wrap = el.querySelector(".gls-hud-conditions");
    const prevIds = new Set(prevConds.map(c => c.id));
    const nextIds = new Set(conds.map(c => c.id));

    // Remove dropped conditions with an exit animation.
    for (const child of [...wrap.children]) {
      if (!nextIds.has(child.dataset.condId)) {
        child.classList.add("removing");
        child.addEventListener("animationend", () => child.remove(), { once: true });
        window.setTimeout(() => child.remove(), 400);
      }
    }
    // Add new conditions, staggered.
    let added = 0;
    conds.forEach(cond => {
      if (prevIds.has(cond.id) && wrap.querySelector(`[data-cond-id="${CSS.escape(cond.id)}"]`)) return;
      if (wrap.querySelector(`[data-cond-id="${CSS.escape(cond.id)}"]`)) return;
      const chip = document.createElement("span");
      chip.className = "gls-hud-condition";
      chip.dataset.condId = cond.id;
      chip.title = cond.label ?? "";
      chip.style.setProperty("--stagger", `${added * 60}ms`);
      chip.innerHTML = `<img src="${escapeHTML(cond.img || "icons/svg/aura.svg")}" alt="${escapeHTML(cond.label ?? "")}"/>`;
      wrap.appendChild(chip);
      added += 1;
    });
    wrap.style.display = conds.length ? "" : "none";
  }

  #updateAbilities(el, abilities) {
    const wrap = el.querySelector(".gls-hud-abilities");
    if (!abilities.length) {
      wrap.innerHTML = "";
      wrap.style.display = "none";
      return;
    }
    wrap.style.display = "";
    const want = abilities.map(a => `${a.key}:${a.value}`).join("|");
    if (wrap.dataset.sig === want) return;
    wrap.dataset.sig = want;
    wrap.innerHTML = abilities.map(a => {
      const sign = a.mod >= 0 ? "+" : "";
      return `<span class="gls-hud-ability"><span class="gls-hud-ability-label">${escapeHTML(a.label)}</span><span class="gls-hud-ability-score">${escapeHTML(String(a.value))}</span><span class="gls-hud-ability-mod">${sign}${escapeHTML(String(a.mod))}</span></span>`;
    }).join("");
  }

  /** rAF count tween from old → new HP value (instant under reduced motion). */
  #startCount(rec, from, to) {
    const valueEl = rec.el.querySelector(".gls-hud-hp-value");
    const target = Number(to) || 0;
    const start = Number.isFinite(from) ? Number(from) : target;
    if (rec.countRAF) cancelAnimationFrame(rec.countRAF);
    if (start === target || prefersReducedMotion()) {
      valueEl.textContent = String(target);
      return;
    }
    const duration = 520;
    const t0 = performance.now();
    const tick = now => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      valueEl.textContent = String(Math.round(start + (target - start) * eased));
      if (p < 1) rec.countRAF = requestAnimationFrame(tick);
      else { valueEl.textContent = String(target); rec.countRAF = null; }
    };
    rec.countRAF = requestAnimationFrame(tick);
  }

  // ---- enter / exit / FLIP -------------------------------------------------

  #enterCard(el) {
    el.classList.add("gls-hud-entering");
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("gls-hud-entering")));
  }

  #exitCard(el) {
    el.classList.add("gls-hud-exiting");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 500);
  }

  #flip(firstRects) {
    if (prefersReducedMotion()) return;
    for (const [id, rec] of this.cards) {
      const first = firstRects.get(id);
      if (!first) continue;
      const last = rec.el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      rec.el.style.transition = "none";
      rec.el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        rec.el.style.transition = "";
        rec.el.style.transform = "";
      });
    }
  }

  #setText(el, selector, value) {
    const node = el.querySelector(selector);
    if (!node) return;
    const next = value == null ? "" : String(value);
    if (node.textContent !== next) node.textContent = next;
  }
}
