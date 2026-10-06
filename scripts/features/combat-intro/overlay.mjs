/**
 * Combat Intro — the DOM skeleton.
 *
 * Builds the markup docs/COMBAT_INTRO.md pins as a contract with both skins'
 * stylesheets, and nothing else: it never animates and never listens. The
 * director owns the clock and the event delegation; this file only answers
 * "what does the state look like as DOM".
 *
 * Pure: no `game`, `canvas`, `foundry`, `ui` or `Hooks`. Every interpolated
 * string goes through escapeHTML, because names and image paths come from
 * actors any player may have authored.
 *
 * Where things go (the layers are the director's):
 *   layers.front   .glci-intro            (nothing 3D is on screen during it)
 *   layers.back    .glci-table, .glci-sort (behind the dice canvas, so a die
 *                                           floats over its own card)
 *   layers.gm      button.glci-gm-btn     (GM only)
 */
import { escapeHTML as esc } from "../../core/util.mjs";
import { QUICK_STATS, INTRO_LINES, BOSS_TIERS } from "./constants.mjs";
import { npcGroups } from "./state-model.mjs";

/** An NPC carries no stat values, so its picker draws from this list. Labels: GLCI.stat.<slug>. */
export const NPC_STATS = Object.freeze([
  "perception", "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation",
  "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery",
]);

/** Runtime-built i18n families this file reaches (the check tool walks them). */
export const I18N_DYNAMIC = Object.freeze({
  "GLCI.stat": NPC_STATS,
  "GLCI.intro.etched": INTRO_LINES.etched,
  "GLCI.intro.aegis": INTRO_LINES.aegis,
  "GLCI.boss.tier": BOSS_TIERS,
});

/** The boss plate: tier and how many turns a round it takes. Empty for anything else. */
function bossMark(b, t, f) {
  if (!b) return "";
  return `<span class="glci-boss" data-tier="${esc(b.tier)}"><b>${esc(t("GLCI.boss.tag"))}</b><span>${esc(t(`GLCI.boss.tier.${b.tier}`))}</span>${b.turns > 1 ? `<span>${esc(f("GLCI.boss.turns", { n: b.turns }))}</span>` : ""}</span>`;
}

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * The root and its six layers, for main.mjs and the preview. The director
 * never creates its own root: it is handed one.
 */
export function createRoot(doc = globalThis.document) {
  const root = doc.createElement("div");
  root.className = "glci gl-type";
  root.innerHTML = `<canvas class="glci-bg"></canvas><div class="glci-cssbg"><i class="glci-cssbg-grid"></i><i class="glci-cssbg-scan"></i><i class="glci-cssbg-rule"></i><i class="glci-cssbg-band"></i><i class="glci-cssbg-cols"></i></div><div class="glci-back"></div><div class="glci-dice"></div><div class="glci-front"></div><div class="glci-gm"></div>`;
  const q = (s) => root.querySelector(s);
  return { root, layers: { bg: q(".glci-bg"), cssbg: q(".glci-cssbg"), back: q(".glci-back"), dice: q(".glci-dice"), front: q(".glci-front"), gm: q(".glci-gm") } };
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function chip(slug, label, value, pressed, disabled) {
  return `<button type="button" class="glci-chip" data-stat="${esc(slug)}" aria-pressed="${pressed ? "true" : "false"}"${disabled ? " disabled" : ""}>`
    + `<span class="glci-chip-l">${esc(label)}</span>${value == null ? "" : `<span class="glci-chip-v">${esc(signed(value))}</span>`}</button>`;
}

function statLabel(slot, slug, t) {
  const s = slot.stats?.find((x) => x.slug === slug);
  if (s?.label) return s.label;
  return NPC_STATS.includes(slug) ? t(`GLCI.stat.${slug}`) : slug;
}

function statPicker(slot, { t, gm, locked, values }) {
  const disabled = locked && !gm;
  const pool = values ? slot.stats.map((s) => s.slug) : NPC_STATS;
  const quick = QUICK_STATS.filter((s) => pool.includes(s));
  const rest = pool.filter((s) => !quick.includes(s));
  const valueOf = (slug) => (values ? slot.stats.find((x) => x.slug === slug)?.mod ?? null : null);
  const lock = `<span class="glci-lockmark" title="${esc(t("GLCI.card.locked"))}" aria-label="${esc(t("GLCI.card.locked"))}"></span>`;
  return `<div class="glci-stats">${quick.map((s) => chip(s, statLabel(slot, s, t), valueOf(s), slot.statistic === s, disabled)).join("")}${lock}</div>`
    + (rest.length ? `<details class="glci-more"><summary>${esc(t("GLCI.stat.more"))}</summary><div class="glci-more-list">${rest.map((s) => chip(s, statLabel(slot, s, t), valueOf(s), slot.statistic === s, disabled)).join("")}</div></details>` : "");
}

/**
 * A volley's statistic, for the GM: one menu, not a wall of chips. Several
 * creature kinds each carrying the full picker is what pushed the roll table
 * off the screen; the current statistic is already printed in the volley head.
 */
function statMenu(slot, t) {
  const chips = NPC_STATS.map((s) => chip(s, statLabel(slot, s, t), null, slot.statistic === s, false)).join("");
  return `<details class="glci-more glci-more--stat"><summary>${esc(t("GLCI.stat.change"))}</summary><div class="glci-more-list">${chips}</div></details>`;
}

function pcCard(slot, n, ctx) {
  const { t, f } = ctx.i18n;
  const role = ctx.viewer?.role ?? "player";
  const gm = role === "gm";
  const may = role !== "spectator" && !!ctx.mayAct(slot);
  const controls = role === "spectator" ? "" : `
      <div class="glci-card-controls">
        ${statPicker(slot, { t, gm, locked: slot.locked, values: true })}
        ${slot.mods.length ? `<div class="glci-mods">${slot.mods.map((m) => `<button type="button" class="glci-chip glci-chip--mod" data-mod="${esc(m.slug)}" aria-pressed="${m.enabled ? "true" : "false"}"><span class="glci-chip-l">${esc(m.label)}</span><span class="glci-chip-v">${esc(signed(m.value))}</span></button>`).join("")}</div>` : ""}
        <div class="glci-card-actions">
          <button type="button" class="glci-roll" data-action="throw">${esc(t("GLCI.card.roll"))}</button>
          ${gm ? `<button type="button" class="glci-rollfor" data-gm="rollFor">${esc(f("GLCI.gm.rollFor", { name: slot.name }))}</button>
          <button type="button" class="glci-lock" data-gm="lock" aria-pressed="${slot.locked ? "true" : "false"}" title="${esc(t(slot.locked ? "GLCI.gm.unlock" : "GLCI.gm.lock"))}"></button>` : ""}
        </div>
      </div>`;
  return `
    <article class="glci-card" data-slot="${esc(slot.id)}" data-kind="pc" data-side="party" data-state="waiting" data-may-act="${may ? 1 : 0}" data-locked="${slot.locked ? 1 : 0}"${ctx.state.late ? ' data-late="1"' : ""}>
      <i class="glci-card-frame" aria-hidden="true"></i>
      <div class="glci-card-art">${slot.img ? `<img src="${esc(slot.img)}" alt="" draggable="false">` : ""}</div>
      <header class="glci-card-head">
        <span class="glci-card-tag">${ctx.state.late ? esc(t("GLCI.late.title")) : `PC / ${pad2(n + 1)}`}</span>
        <h3 class="glci-card-name">${esc(slot.name)}</h3>
        <span class="glci-card-stat">${esc(statLabel(slot, slot.statistic, t))}</span>
      </header>
      <div class="glci-card-die" aria-hidden="true"><i></i></div>
      <div class="glci-card-total"><span class="glci-card-total-k">${esc(t("GLCI.card.waiting"))}</span><b class="glci-card-total-v">—</b><span class="glci-card-nat"></span></div>
      ${controls}
    </article>`;
}

function volleyCard(g, slots, ctx) {
  const { t, f } = ctx.i18n;
  const gm = ctx.viewer?.role === "gm";
  const first = slots[0];
  return `
    <article class="glci-volley" data-group="${esc(g.group)}" data-side="${esc(g.side ?? "hostile")}"${g.boss ? ` data-boss="${esc(g.boss.tier)}"` : ""} data-slots="${esc(g.slotIds.join(" "))}" data-state="waiting" data-may-act="${gm ? 1 : 0}">
      <i class="glci-card-frame" aria-hidden="true"></i>
      <div class="glci-volley-art">${g.img ? `<img src="${esc(g.img)}" alt="" draggable="false">` : ""}</div>
      <header class="glci-volley-head">
        ${bossMark(g.boss, t, f)}
        <h3 class="glci-volley-name">${esc(g.name)}</h3>
        ${g.slotIds.length > 1 ? `<span class="glci-volley-count">×${g.slotIds.length}</span>` : ""}
        <span class="glci-volley-stat">${esc(statLabel(first, first.statistic, t))}</span>
      </header>
      ${gm ? `<div class="glci-card-controls">${statMenu(first, t)}</div>` : ""}
      <div class="glci-volley-dice">${slots.map((s) => `<span class="glci-mini-die" data-slot="${esc(s.id)}" data-state="waiting"><i class="glci-mini-total"></i></span>`).join("")}</div>
      <span class="glci-volley-seal">${esc(t("GLCI.card.sealed"))}</span>
      ${gm ? `<button type="button" class="glci-volley-throw" data-gm="volley" data-group="${esc(g.group)}">${esc(t("GLCI.gm.volley"))}</button>` : ""}
    </article>`;
}

function introMarkup(state, ctx) {
  const { t, f } = ctx.i18n;
  const skin = INTRO_LINES[state.skin] ? state.skin : "etched";
  const k = (line) => `GLCI.intro.${skin}.${line}`;
  const intro = state.intro;
  const side = (name, list) => `
      <div class="glci-roster-side" data-side="${name}">
        ${list.map((p, i) => `<div class="glci-roster-item" data-side="${esc(p.side ?? (name === "party" ? "party" : "hostile"))}"${p.boss ? ` data-boss="${esc(p.boss.tier)}"` : ""} style="--glci-i:${i}">${p.img ? `<img src="${esc(p.img)}" alt="" draggable="false">` : "<i></i>"}${bossMark(p.boss, t, f)}<span class="glci-roster-name">${esc(p.name)}</span>${p.count > 1 ? `<span class="glci-roster-count">×${p.count}</span>` : ""}</div>`).join("")}
      </div>`;
  const sev = intro.threat?.severity;
  return `
    <div class="glci-intro">
      <div class="glci-intro-head">
        <div class="glci-intro-eyebrow"><span>${esc(t(k("eyebrow")))}</span></div>
        <h1 class="glci-intro-title">${esc(intro.title || t("GLCI.intro.untitled"))}</h1>
        ${INTRO_LINES[skin].includes("motto") ? `<div class="glci-intro-motto">${esc(t(k("motto")))}</div>` : ""}
      </div>
      <div class="glci-roster">
        ${side("party", intro.party)}
        <div class="glci-intro-versus"><span>${esc(t(k("versus")))}</span></div>
        ${side("hostiles", intro.hostiles)}
      </div>
      <div class="glci-threat" data-severity="${esc(sev ?? "none")}">${sev ? `
        <span class="glci-threat-k">${esc(t(k("threat")))}</span>
        <b class="glci-threat-v">${esc(t(`GLCI.threat.${sev}`))}</b>
        ${intro.threat.budget ? `<span class="glci-threat-xp">${esc(f("GLCI.threat.xp", { xp: intro.threat.xp, budget: intro.threat.budget }))}</span>` : ""}` : ""}
      </div>
    </div>`;
}

/* ── the contract ───────────────────────────────────────────────────────── */

/**
 * Build everything for one state.
 * @param {object} ctx { layers, state, i18n, viewer, mayAct }
 * @returns {{ intro, table, sort, gm, cards: Map<slotId, Element>, minis: Map<slotId, Element>, volleys: Map<group, Element> }}
 */
function build(ctx) {
  const { layers, state } = ctx;
  const { t } = ctx.i18n;
  for (const k of ["back", "front", "gm"]) layers[k].replaceChildren();
  const late = !!state.late;
  const pcs = state.slots.filter((s) => s.kind === "pc");   // a late sequence holds only its reinforcements
  const groups = npcGroups(state.slots);
  const byId = new Map(state.slots.map((s) => [s.id, s]));

  if (!late) layers.front.insertAdjacentHTML("beforeend", introMarkup(state, ctx));
  layers.back.insertAdjacentHTML("beforeend", `
    <div class="glci-table" data-pcs="${pcs.length}" data-groups="${groups.length}">
      <div class="glci-party">${pcs.map((s, i) => pcCard(s, i, ctx)).join("")}</div>
      <div class="glci-hostiles">${groups.map((g) => volleyCard(g, g.slotIds.map((id) => byId.get(id)), ctx)).join("")}</div>
    </div>
    <div class="glci-sort"></div>`);
  if (ctx.viewer?.role === "gm") {
    layers.gm.innerHTML = ["skip", "rest", "cancel"].map((a) => {
      const key = a === "rest" ? "GLCI.gm.rollRemaining" : `GLCI.gm.${a}`;
      return `<button type="button" class="glci-gm-btn" data-gm="${a}">${esc(t(key))}</button>`;
    }).join("");
  }
  const q = (el, s) => [...el.querySelectorAll(s)];
  return {
    intro: layers.front.querySelector(".glci-intro"),
    table: layers.back.querySelector(".glci-table"),
    sort: layers.back.querySelector(".glci-sort"),
    gm: layers.gm,
    cards: new Map(q(layers.back, ".glci-card").map((el) => [el.dataset.slot, el])),
    minis: new Map(q(layers.back, ".glci-mini-die").map((el) => [el.dataset.slot, el])),
    volleys: new Map(q(layers.back, ".glci-volley").map((el) => [el.dataset.group, el])),
  };
}

/**
 * Bring an already built skeleton up to a new state without rebuilding it:
 * the pressed chip, the lock, the toggled modifiers, who may act.
 */
function sync(refs, ctx) {
  const { state } = ctx;
  const { t } = ctx.i18n;
  const role = ctx.viewer?.role ?? "player";
  const gm = role === "gm";
  for (const slot of state.slots) {
    const card = refs.cards.get(slot.id);
    if (card) {
      const may = role !== "spectator" && !!ctx.mayAct(slot);
      card.dataset.mayAct = may ? "1" : "0";
      card.dataset.locked = slot.locked ? "1" : "0";
      const stat = card.querySelector(".glci-card-stat");
      const label = statLabel(slot, slot.statistic, t);
      if (stat && stat.textContent !== label) stat.textContent = label;
      for (const c of card.querySelectorAll(".glci-chip[data-stat]")) {
        c.setAttribute("aria-pressed", c.dataset.stat === slot.statistic ? "true" : "false");
        c.disabled = !!slot.locked && !gm;
      }
      for (const c of card.querySelectorAll(".glci-chip[data-mod]")) {
        const m = slot.mods.find((x) => x.slug === c.dataset.mod);
        c.setAttribute("aria-pressed", m?.enabled ? "true" : "false");
      }
      const lock = card.querySelector(".glci-lock");
      if (lock) { lock.setAttribute("aria-pressed", slot.locked ? "true" : "false"); lock.title = t(slot.locked ? "GLCI.gm.unlock" : "GLCI.gm.lock"); }
    }
  }
  for (const [group, el] of refs.volleys) {
    const first = state.slots.find((s) => s.group === group);
    if (!first) continue;
    const label = statLabel(first, first.statistic, t);
    const stat = el.querySelector(".glci-volley-stat");
    if (stat && stat.textContent !== label) stat.textContent = label;
    for (const c of el.querySelectorAll(".glci-chip[data-stat]")) c.setAttribute("aria-pressed", c.dataset.stat === first.statistic ? "true" : "false");
  }
}

/** One sort tile. The director positions it; `.glci-rank-total` is filled at the hold beat. */
function rank(slot, n) {
  return `<div class="glci-rank" data-slot="${esc(slot.id)}" data-kind="${slot.kind}" data-side="${esc(slot.side ?? (slot.kind === "pc" ? "party" : "hostile"))}"${slot.boss ? ` data-boss="${esc(slot.boss.tier)}"` : ""}>
    <span class="glci-rank-n">${pad2(n + 1)}</span>
    <span class="glci-rank-art">${slot.img ? `<img src="${esc(slot.img)}" alt="" draggable="false">` : ""}</span>
    <span class="glci-rank-name">${esc(slot.name)}</span>
    <b class="glci-rank-total">—</b>
  </div>`;
}

export default { createRoot, build, sync, rank, NPC_STATS, I18N_DYNAMIC };
