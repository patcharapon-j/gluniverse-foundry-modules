/**
 * GLUniverse Suite — the quick palette.
 *
 * One hotkey (Ctrl+K by default, GM only) opens a search box over whatever the
 * enabled features offer: Stage's cast and the world's Actors, the viewed
 * Theatre scene's shots. Type, pick a row with the arrows, and press Enter to
 * act on it; Shift/Ctrl/Alt+Enter run a row's other actions, which the footer
 * names. Esc or a click outside closes it.
 *
 * Features contribute through `registerQuickProvider` from their own onInit, so
 * a disabled feature offers nothing and the keybinding exists only while some
 * feature has registered (it is latched: registered once, whichever feature
 * comes first, because `game.keybindings.register` throws on a duplicate).
 *
 * A provider:
 *   { id, order, label: i18n key, icon, available(): boolean,
 *     search(query): Item[] }
 * An item:
 *   { key, title, sub?, img?, icon?, badge?,
 *     actions: [{ id, label, icon, mod: "" | "shift" | "ctrl" | "alt" }],
 *     run(actionId): Promise }
 * The first action is the plain-Enter one. Every string is set as text, never
 * markup: titles are actor and shot names.
 */

import { SUITE_ID, warn } from "./const.mjs";

const ROOT_ID = "glqp-root";
const KEYBINDING = "quick.palette";

/** @type {Map<string, object>} */
const providers = new Map();
let keyRegistered = false;
/** The last query, offered again (selected) on the next open. */
let lastQuery = "";

function L(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

/**
 * Add a feature's results to the palette. Call from the feature's onInit (the
 * init hook): the first call also registers the palette's keybinding.
 */
export function registerQuickProvider(provider) {
  if (!provider?.id || typeof provider.search !== "function") return;
  providers.set(provider.id, provider);
  if (keyRegistered) return;
  keyRegistered = true;
  try {
    game.keybindings.register(SUITE_ID, KEYBINDING, {
      name: "GLS.quick.key.name",
      hint: "GLS.quick.key.hint",
      editable: [{ key: "KeyK", modifiers: ["Control"] }],
      restricted: true,
      precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL ?? 0,
      onDown: () => {
        if (!game.user?.isGM) return false;
        toggleQuickPalette();
        return true;
      },
    });
  } catch (e) {
    warn("quick palette | could not register the keybinding", e);
  }
}

export const isQuickPaletteOpen = () => !!document.getElementById(ROOT_ID);

export function toggleQuickPalette() {
  return isQuickPaletteOpen() ? closeQuickPalette() : openQuickPalette();
}

export function closeQuickPalette() {
  const root = document.getElementById(ROOT_ID);
  root?._glqpCleanup?.();
  root?.remove();
}

/** The live providers, in their order. */
function live() {
  return [...providers.values()]
    .filter((p) => { try { return p.available?.() !== false; } catch { return false; } })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

const MOD_KEYS = Object.freeze({ "": "↵", shift: "⇧↵", ctrl: "Ctrl↵", alt: "Alt↵" });

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function icon(cls) {
  const i = el("i", cls);
  i.setAttribute("aria-hidden", "true");
  return i;
}

/** Open the palette (GM only). Focuses the field with the last query selected. */
export function openQuickPalette() {
  if (!game.user?.isGM) return null;
  if (isQuickPaletteOpen()) {
    document.querySelector(`#${ROOT_ID} .glqp-input`)?.focus();
    return null;
  }
  const scrim = el("div", "glqp-scrim");
  scrim.id = ROOT_ID;
  const box = el("section", "glqp gl-glass gl-type");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", L("GLS.quick.title"));

  const field = el("label", "glqp-field");
  const input = el("input", "glqp-input");
  Object.assign(input, { type: "search", spellcheck: false, autocomplete: "off", placeholder: L("GLS.quick.placeholder") });
  input.setAttribute("aria-label", L("GLS.quick.placeholder"));
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  field.append(icon("fa-solid fa-magnifying-glass"), input);

  const list = el("div", "glqp-results gl-scroll");
  list.setAttribute("role", "listbox");
  list.id = `${ROOT_ID}-list`;
  input.setAttribute("aria-controls", list.id);
  const foot = el("footer", "glqp-foot");

  box.append(field, list, foot);
  scrim.append(box);
  document.body.append(scrim);

  /** The rows on screen, in order: { item, node }. */
  let rows = [];
  let active = 0;
  let busy = false;

  const setActive = (i, scroll = true) => {
    if (!rows.length) { active = 0; renderFoot(); return; }
    active = (i + rows.length) % rows.length;
    rows.forEach((r, k) => {
      r.node.classList.toggle("is-active", k === active);
      r.node.setAttribute("aria-selected", k === active ? "true" : "false");
    });
    input.setAttribute("aria-activedescendant", rows[active].node.id);
    if (scroll) rows[active].node.scrollIntoView({ block: "nearest" });
    renderFoot();
  };

  const renderFoot = () => {
    const item = rows[active]?.item;
    const parts = (item?.actions ?? []).map((a) => {
      const s = el("span", "glqp-key");
      s.append(el("kbd", "", MOD_KEYS[a.mod ?? ""] ?? "↵"), document.createTextNode(` ${a.label}`));
      return s;
    });
    const esc = el("span", "glqp-key");
    esc.append(el("kbd", "", "Esc"), document.createTextNode(` ${L("GLS.quick.close")}`));
    foot.replaceChildren(...parts, esc);
  };

  const run = async (item, action) => {
    if (!item || !action || busy) return;
    busy = true;
    lastQuery = input.value;
    closeQuickPalette();
    try {
      await item.run(action.id);
    } catch (e) {
      warn("quick palette | action failed", e);
      ui.notifications?.error(L("GLS.quick.failed"));
    }
  };

  const search = () => {
    const q = input.value;
    const prevKey = rows[active]?.item?.key;
    const groups = [];
    for (const p of live()) {
      let items = [];
      try { items = p.search(q) ?? []; } catch (e) { warn(`quick palette | ${p.id} search failed`, e); }
      if (items.length) groups.push({ p, items });
    }
    rows = [];
    const nodes = [];
    for (const { p, items } of groups) {
      const head = el("h4", "glqp-group");
      head.append(icon(p.icon ?? "fa-solid fa-circle"), document.createTextNode(L(p.label)));
      nodes.push(head);
      for (const item of items) {
        const row = el("div", "glqp-row");
        row.id = `${ROOT_ID}-r${rows.length}`;
        row.setAttribute("role", "option");
        const thumb = el("span", "glqp-thumb");
        if (item.img) {
          const img = el("img");
          Object.assign(img, { src: item.img, alt: "", loading: "lazy", draggable: false });
          thumb.append(img);
        } else thumb.append(icon(item.icon ?? p.icon ?? "fa-solid fa-circle"));
        const text = el("span", "glqp-text");
        text.append(el("span", "glqp-title", item.title || "—"));
        if (item.sub) text.append(el("span", "glqp-sub", item.sub));
        row.append(thumb, text);
        if (item.badge) row.append(el("span", "glqp-badge", item.badge));
        const acts = el("span", "glqp-acts");
        for (const a of item.actions ?? []) {
          const b = el("button", "glqp-act");
          b.type = "button";
          b.dataset.tooltip = `${a.label} (${MOD_KEYS[a.mod ?? ""] ?? "↵"})`;
          b.setAttribute("aria-label", a.label);
          b.append(icon(a.icon ?? "fa-solid fa-play"));
          b.addEventListener("click", (ev) => { ev.stopPropagation(); run(item, a); });
          acts.append(b);
        }
        row.append(acts);
        const idx = rows.length;
        row.addEventListener("mousemove", () => { if (active !== idx) setActive(idx, false); });
        row.addEventListener("click", () => run(item, item.actions?.[0]));
        rows.push({ item, node: row });
        nodes.push(row);
      }
    }
    if (!rows.length) {
      const empty = el("p", "glqp-empty");
      empty.append(icon("fa-solid fa-magnifying-glass"), document.createTextNode(L(live().length ? "GLS.quick.none" : "GLS.quick.nothing")));
      nodes.push(empty);
    }
    list.replaceChildren(...nodes);
    const keep = prevKey ? rows.findIndex((r) => r.item.key === prevKey) : -1;
    setActive(Math.max(0, keep), keep > 0);
  };

  input.addEventListener("input", () => { rows = []; search(); });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive(active + 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(active - 1); }
    else if (ev.key === "Escape" || (ev.code === "KeyK" && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); ev.stopPropagation(); lastQuery = input.value; closeQuickPalette(); }
    else if (ev.key === "Enter") {
      ev.preventDefault();
      const item = rows[active]?.item;
      const mod = ev.shiftKey ? "shift" : (ev.ctrlKey || ev.metaKey) ? "ctrl" : ev.altKey ? "alt" : "";
      const action = mod ? item?.actions?.find((a) => a.mod === mod) : item?.actions?.[0];
      run(item, action);
    }
    // Keep the board's own keybindings (WASD, Delete…) away from what is typed here.
    ev.stopPropagation();
  });
  scrim.addEventListener("pointerdown", (ev) => {
    if (ev.target === scrim) { lastQuery = input.value; closeQuickPalette(); }
  });
  // A re-render elsewhere (a cut, a cast change) can make a row stale; refresh on the suite's hooks.
  const refresh = () => { if (isQuickPaletteOpen()) search(); };
  const hookIds = ["updateSetting", "updateScene"].map((name) => [name, Hooks.on(name, refresh)]);
  scrim._glqpCleanup = () => { for (const [name, id] of hookIds) Hooks.off(name, id); };

  input.value = lastQuery;
  search();
  input.focus();
  input.select();
  return scrim;
}
