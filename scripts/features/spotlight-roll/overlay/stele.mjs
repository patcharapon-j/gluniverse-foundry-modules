/**
 * Spotlight Roll · Monolith — one stele: a roller's slab, plinth, gauge and verdict.
 *
 * Pure DOM: no game, canvas, foundry, ui or Hooks. The mount (monolith.mjs)
 * composes one of these per roll (single, a colonnade of them, or one facing a
 * defender) and the director drives them through the v2 overlay contract.
 *
 * Two rules shape everything here.
 *
 *  - The result is unknown at mount. A stele is laid out from the DC line and
 *    the modifier list alone; the natural, the total, the dropped die, the
 *    degree and the DC itself (when it is hidden from this viewer) arrive with
 *    `throwTimeline(beats, model)` and are only written then.
 *  - Everything after the throw is a function of the seeked time: the anime
 *    timeline for discrete beats, `frame(ms)` for the light (custom properties
 *    on this roll's own `[data-roll]` wrappers), and the director's data-*
 *    stamps. A re-throw (a Hero Point) reverts nothing by hand: the director
 *    reverts the old timeline and this stele rebuilds its DOM from scratch.
 */
import { DEGREES } from "../timeline.mjs";
import {
  clamp01, outQuart, outExpo, inOutQuart, lin, f1, jit, seg, poly, circ, SPIN_PEAK,
  geom, engraving, outlinePath, shardGeometry,
} from "./geometry.mjs";
import { TUMBLE } from "../tumble.mjs";

/* ── shared plumbing ───────────────────────────────────────────────────── */

export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const sgn = (v) => (v >= 0 ? "+" : "−") + Math.abs(v);
const ROLL_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 18 6.5v7L10 18 2 13.5v-7Z M10 2 4.5 12.5h11Z M4.5 12.5 2 13.5 M15.5 12.5 18 13.5 M10 18v0"/></svg>`;
const SEAL = `<b class="glsr-mono-seal"><i></i><i></i><i></i></b>`;

/** The keys built at runtime from a value. The check tool walks them. */
export const I18N_DYNAMIC = Object.freeze([
  ...DEGREES.map((k) => `GLSR.degree.${k}`),
  ...DEGREES.map((k) => `GLSR.degreeWord.${k}`),
  ...DEGREES.map((k) => `GLSR.summary.count.${k}`),
  ...DEGREES.map((k) => `GLSR.defender.${k}`),
  "GLSR.fortune.fortune", "GLSR.fortune.misfortune",
]);

/** Everything a stele needs from the mount, built once per request. */
export function makeEnv(ctx) {
  const { root, cssbg, motion = 1, palette, anime } = ctx;
  const i18n = ctx.i18n ?? {};
  const t = (k) => i18n.t?.(k) ?? k;
  const f = (k, data) => i18n.f?.(k, data) ?? k;
  const probe = (prop) => { const i = document.createElement("i"); i.style.color = `var(${prop})`; root.append(i); const c = getComputedStyle(i).color; i.remove(); const m = c.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255]; return [m[0] / 255, m[1] / 255, m[2] / 255]; };
  const mixc = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
  const cb = el("div", "glsr-mono-cbg", `<i class="glsr-mono-cbg-veil"></i><i class="glsr-mono-cbg-rays"></i><i class="glsr-mono-cbg-halo"></i><i class="glsr-mono-cbg-haze"></i>`);
  cssbg.append(cb);
  const pal = palette ?? { gold: probe("--glsr-gold"), crimson: probe("--glsr-crimson"), success: probe("--glsr-success"), fail: probe("--glsr-fail") };
  return {
    ...ctx, anime, t, f, cb, M: motion, AM: Math.min(1, motion),
    GOLD: lin(mixc(pal.gold, probe("--glsr-gold-hot"), 0.7)),
    CRIMSON: lin(mixc(pal.crimson, probe("--glsr-crimson-hot"), 0.2)),
    SUCCESS: lin(pal.success), FAIL: lin(pal.fail),
    DEFENDER: lin(mixc(probe("--gl-violet"), probe("--gl-text-bright"), 0.25)),
  };
}

/** anime.add that tolerates a selector matching nothing (a compact stele has no cartouche). */
export const addTo = (t) => (targets, params, pos) => {
  if (!targets || (targets.length === 0 && !(targets instanceof Element))) return;
  t.add(targets, params, pos);
};

/** The verdict a model carries, or null while sealed / without a DC. */
const degreeOfModel = (m) => (m.sealed || m.degree == null ? null : m.degree);

/* ── the crack ─────────────────────────────────────────────────────────── */

export const crackSvg = (geo) => `<path class="glsr-mono-crack-glow" d="${geo.crackLines.join("")}${geo.branches}"/>`
  + geo.crackLines.map((d) => `<path class="glsr-mono-crack" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" d="${d}"/>`).join("")
  + `<path class="glsr-mono-crack is-branch" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" d="${geo.branches}"/>`;

/**
 * Crisp seams drawn from the impact, a shake, then the slab swaps for clip-path
 * shards that open and slip away. Shared by the roller's stele (critical
 * failure) and the defender's (critical success against them).
 */
export function crackInto(env, t, { slab, shardsEl, geo, slabX, slabTop, u, D }) {
  const { anime, M } = env, d = (ms) => ms * M;
  shardsEl.replaceChildren();
  const clone = slab.cloneNode(true);
  clone.querySelectorAll(".is-breath, .is-scatter, .is-pulse, .is-ignite, .is-natural, .is-runners, .glsr-mono-outline, .glsr-mono-seal").forEach((n) => n.remove());
  // The shards are cut when the throw is scheduled, before any unveiling has
  // played; by the time they show, the verdict has been read, so they carry
  // the revealed state (every register carved, the DC cut, the measurement struck).
  clone.querySelectorAll(".glsr-mono-band-rule, .glsr-mono-band-label, .glsr-mono-band-value, .glsr-mono-cart-num, .glsr-mono-dline-in i, .glsr-mono-dim-rule")
    .forEach((e) => { e.style.transform = ""; e.style.opacity = ""; e.style.clipPath = ""; });
  clone.querySelectorAll(".glsr-mono-dim, .glsr-mono-dim span, .glsr-mono-dword").forEach((e) => { e.style.opacity = "1"; });
  clone.querySelectorAll(".glsr-mono-crack").forEach((e) => { e.setAttribute("stroke-dashoffset", "0"); e.style.strokeDashoffset = "0"; });
  clone.querySelectorAll(".glsr-mono-crack-glow").forEach((e) => { e.style.opacity = "0.6"; });
  const shardEls = geo.shards.map((sh) => {
    const s = el("div", "glsr-mono-shard");
    s.style.clipPath = `polygon(${sh.pts.map(([x, y]) => `${f1(x + slabX)}px ${f1(y + slabTop)}px`).join(",")})`;
    s.append(clone.cloneNode(true));
    shardsEl.append(s);
    return s;
  });
  t.add(slab.querySelectorAll(".glsr-mono-crack"), { strokeDashoffset: [1, 0], duration: d(240), ease: "outExpo", delay: anime.stagger(d(22)) }, D)
    .add(slab.querySelectorAll(".glsr-mono-crack-glow"), { opacity: [0, 0.6], duration: d(260) }, D + d(60))
    .add(slab, { translateX: [0, -7, 6, -4, 2, 0], duration: d(380), ease: "linear" }, D)
    .add(slab, { opacity: [1, 0], duration: 1, ease: "linear" }, D + d(420))
    .add(shardsEl, { opacity: [0, 1], duration: 1, ease: "linear" }, D + d(420));
  const order = geo.shards.map((sh, i) => ({ i, cy: sh.cy })).sort((a, bb) => bb.cy - a.cy);
  const H = globalThis.innerHeight ?? 900;
  order.forEach(({ i }, rank) => {
    const sh = geo.shards[i], s = shardEls[i];
    const ox = Math.cos(sh.mid) * 5 * u, oy = Math.sin(sh.mid) * 5 * u;
    const dir = jit(i, 11) > 0.5 ? 1 : -1;
    t.add(s, { translateX: [0, ox], translateY: [0, oy], duration: d(260), ease: "outExpo" }, D + d(420))
      .add(s, { translateX: ox + Math.cos(sh.mid) * 30 * u, translateY: oy + H * (0.7 + jit(i, 12) * 0.3), rotate: [0, dir * (5 + jit(i, 13) * 12)], duration: d(1100 + jit(i, 14) * 300), ease: "inQuad" }, D + d(1400 + rank * 110))
      .add(s, { opacity: [1, 0], duration: d(500), ease: "inQuad" }, D + d(1400 + rank * 110 + 700));
  });
}

/* ── one stele ─────────────────────────────────────────────────────────── */

/**
 * cfg = { i, model, variant: "full"|"compact", layoutFn(model) → geom,
 *         rootVars, ownsBackdrop, against?: defender, extend?: { rethrow, throw, frame, uniforms } }
 *
 * Every light property is written onto this roll's own `[data-roll]` wrappers
 * (and the overlay root as well for a lone stele, which the CSS backdrop
 * reads), so several steles can each be at their own beat at once.
 */
export function createStele(env, cfg) {
  const { root, back, front, anime, M, cb, t: tr, f: fmt } = env;
  const compact = cfg.variant === "compact";
  let model = cfg.model;
  let g = cfg.layoutFn(model);
  let settled = false;   // after the first build, a rebuild (resize, re-throw) draws everything at rest
  let eng = null, shardGeo = null;
  const refs = {};

  const unitCls = `glsr-mono-unit${compact ? " is-compact" : ""}${cfg.against ? " is-attacker" : ""}`;
  const wrap = el("div", `glsr-mono ${unitCls}`);
  const rise = el("div", "glsr-mono-rise");
  const sink = el("div", "glsr-mono-sink");
  const monument = el("div", "glsr-mono-monument");
  wrap.append(rise); rise.append(sink); sink.append(monument);
  back.append(wrap);
  const fwrap = el("div", `glsr-mono-front ${unitCls}`);
  front.append(fwrap);
  wrap.dataset.roll = fwrap.dataset.roll = String(cfg.i);

  const hosts = cfg.rootVars ? [root, wrap, fwrap] : [wrap, fwrap];
  const setVar = (k, v) => { for (const h of hosts) h.style.setProperty(k, v); };
  const setData = (k, v) => { wrap.dataset[k] = v; fwrap.dataset[k] = v; };
  const dcText = () => (model.dc?.value != null ? String(model.dc.value) : "");

  function svgLayer(cls, inner) {
    return `<svg class="glsr-mono-eng ${cls}" viewBox="0 0 ${f1(g.slabW)} ${f1(g.slabH)}" width="${f1(g.slabW)}" height="${f1(g.slabH)}" aria-hidden="true">${inner}</svg>`;
  }

  /** The DC is shown from the start only when this viewer may see it and the request does not hide it. */
  const sealedDc = () => g.hasDc && (model.dc?.mode === "hidden" || model.dc?.value == null);

  function buildSlab() {
    const mods = model.mods ?? [];
    eng = engraving(g, mods.length);
    shardGeo = shardGeometry(g);
    const all = eng.lines.map((l) => l.d).join("") + eng.marks.map((m) => m.d).join("");
    const sigil = eng.lines.filter((l) => /hex|tri|spoke|ring|arc/.test(l.cls)).map((l) => l.d).join("") + eng.marks.filter((m) => /ticks|aticks|nodes/.test(m.cls)).map((m) => m.d).join("");
    const lit = (d) => `<path class="glsr-mono-halo" d="${d}"/><path class="glsr-mono-core" d="${d}"/>`;
    const carved = eng.lines.map((l) => `<path class="glsr-mono-etch is-${l.cls}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${settled ? 0 : 1}" d="${l.d}"/>`).join("")
      + eng.marks.map((m) => `<path class="glsr-mono-mark is-${m.cls}" d="${m.d}"/>`).join("");
    const conduits = eng.conduits.map((c, k) => `<path class="glsr-mono-runner" data-k="${k}" pathLength="1" stroke-dasharray="0.16 1.2" stroke-dashoffset="0.16" d="${c.d}"/>`).join("");
    const out = outlinePath(g);
    const actor = model.actor ?? {}, rq = model.request ?? {};
    const fortune = model.roll?.fortune;
    const check = String(rq.check ?? "");
    const checkFs = Math.min(40 * g.u, (g.slabW * 0.62) / (Math.max(4, check.length) * 0.78));
    const sealed = sealedDc();
    const hide = sealed ? ' style="opacity:0"' : "";
    const bandLine = (cls, y, label, k) =>
      `<div class="glsr-mono-band ${cls}" style="top:${f1(y)}px"><i class="glsr-mono-band-rule"${sealed ? ' style="transform:scaleX(0)"' : ""}></i><span class="glsr-mono-band-label"${hide}>${label}</span><span class="glsr-mono-band-value" data-band="${k}"${hide}></span></div>`;
    // a register sits half a point below the first total it admits: DC + 9.5, DC − 0.5, DC − 9.5
    const top = (r) => g.dcY - (r + 0.5) * g.ppu - g.slabTop;
    const bands = g.hasDc
      ? bandLine("is-crit", top(9.5), esc(tr("GLSR.band.criticalSuccess")), 10) + bandLine("is-dc", top(-0.5), esc(tr("GLSR.dc")), 0) + bandLine("is-fail", top(-9.5), esc(tr("GLSR.band.failure")), -9)
      : "";
    const head = compact
      ? `<header class="glsr-mono-chead"><div class="glsr-mono-medal">${actor.img ? `<img alt="" src="${esc(actor.img)}">` : ""}</div></header>`
      : `<header class="glsr-mono-head">
          <div class="glsr-mono-kicker">${esc(rq.kind)}${rq.traits?.length ? ` · ${esc(rq.traits.join(" · "))}` : ""}</div>
          <div class="glsr-mono-check" style="font-size:${f1(checkFs)}px">${esc(check)}</div>
          ${rq.title ? `<div class="glsr-mono-title">${esc(rq.title)}</div>` : ""}
          ${fortune ? `<div class="glsr-mono-fortune">${esc(tr(`GLSR.fortune.${fortune}`))}</div>` : ""}
        </header>
        ${bustW() ? "" : actorBlock("")}`;
    return `
      <div class="glsr-mono-slab" style="left:${f1(g.slabX)}px;top:${f1(g.slabTop)}px;width:${f1(g.slabW)}px;height:${f1(g.slabH)}px">
        <div class="glsr-mono-glass"></div>
        <i class="glsr-mono-sheen"></i>
        <div class="glsr-mono-fill"><i class="glsr-mono-meniscus"></i></div>
        ${svgLayer("is-carved", carved)}
        ${svgLayer("is-breath", lit(all))}
        ${svgLayer("is-lit", lit(all))}
        ${svgLayer("is-scatter", lit(all))}
        ${svgLayer("is-pulse", lit(all))}
        ${svgLayer("is-ignite", lit(all))}
        ${svgLayer("is-natural", lit(sigil))}
        ${svgLayer("is-runners", conduits)}
        <div class="glsr-mono-bands">${bands}</div>
        <div class="glsr-mono-cold"></div>
        ${head}
        ${svgLayer("is-crackset", crackSvg(shardGeo))}
        <svg class="glsr-mono-outline" viewBox="0 0 ${f1(g.slabW)} ${f1(g.slabH + 1)}" width="${f1(g.slabW)}" height="${f1(g.slabH + 1)}" aria-hidden="true">
          <path class="glsr-mono-edge" d="${out}"/>
          <path class="glsr-mono-race" pathLength="1" stroke-dasharray="0.1 0.4" stroke-dashoffset="0" d="${out}"/>
        </svg>
      </div>`;
  }

  /** A chip says its value; its label only when the label says more (a formula's flat "+3" does not). */
  const chipLabel = (m) => (m.label != null && String(m.label).trim() !== sgn(m.value) && String(m.label).trim() !== String(m.value) ? esc(m.label) : "");

  /** The roller: a bust standing left of the slab, or the medallion on its face when there is no room. */
  function actorBlock(cls, style = "") {
    const actor = model.actor ?? {};
    return `<div class="glsr-mono-actor${cls}"${style}>
          <div class="glsr-mono-medal">${actor.img ? `<img alt="" src="${esc(actor.img)}">` : ""}</div>
          <div class="glsr-mono-names"><span class="glsr-mono-name">${esc(actor.name)}</span><span class="glsr-mono-role">${esc(actor.title)}</span></div>
        </div>`;
  }
  /** Width of the bust, or 0 when the viewport leaves too little room left of the slab. */
  function bustW() {
    if (compact) return 0;
    const w = Math.min(300 * g.u, g.slabX - 28 * g.u - 56);
    return w >= 120 ? w : 0;
  }
  function buildBust() {
    const w = bustW();
    return w ? actorBlock(" is-bust", ` style="left:${f1(g.slabX - 28 * g.u - w)}px;top:${f1(g.slabTop + 60 * g.u)}px;--glsr-mono-bust-w:${f1(w)}px"`) : "";
  }

  function buildPlinth() {
    const mods = model.mods ?? [];
    const box = `left:${f1(g.plinthX)}px;top:${f1(g.slabBottom)}px;width:${f1(g.plinthW)}px;`;
    const roll = `<button type="button" class="glsr-mono-roll" data-action="throw">${ROLL_ICON}<span>${esc(tr("GLSR.action.roll"))}</span></button>`;
    if (compact) {
      const opt = mods.map((m, i) => (m.optional ? `<button type="button" class="glsr-mono-cmod is-optional" data-mod="${i}"><span class="glsr-mono-mod-in"><b>${sgn(m.value)}</b> ${chipLabel(m)}</span></button>` : "")).join("");
      return `
        <div class="glsr-mono-plinth is-compact" style="${box}min-height:${f1(g.plinthH)}px">
          <div class="glsr-mono-plinth-glass"></div>
          <div class="glsr-mono-cplinth">
            <div class="glsr-mono-cname">${esc(model.actor?.name)}</div>
            ${model.roll?.fortune ? `<div class="glsr-mono-cfort">${esc(tr(`GLSR.fortune.${model.roll.fortune}`))}</div>` : ""}
            <div class="glsr-mono-crow">
              <span class="glsr-mono-ctotal"><span>${esc(tr("GLSR.label.mod"))}</span><b data-mod-total>${sgn(model.modTotal ?? 0)}</b></span>${opt}
              ${roll}
            </div>
          </div>
        </div>`;
    }
    const dcCell = model.dc?.mode === "never"
      ? `<div class="glsr-mono-cart is-sealed"><span class="glsr-mono-cart-k">${esc(tr("GLSR.dc"))}</span><span class="glsr-mono-cart-v">${SEAL}</span></div>`
      : cfg.against
      ? `<div class="glsr-mono-cart is-vs"><span class="glsr-mono-cart-k">${esc(tr("GLSR.label.against"))}</span><span class="glsr-mono-cart-v glsr-mono-vs">${esc(cfg.statLabel)}</span></div>`
      : !g.hasDc
        ? `<div class="glsr-mono-cart is-none"><span class="glsr-mono-cart-k">${esc(tr("GLSR.label.noDc"))}</span><span class="glsr-mono-cart-v">—</span></div>`
        : sealedDc()
          ? `<div class="glsr-mono-cart is-sealed"><span class="glsr-mono-cart-k">${esc(tr("GLSR.dc"))}</span><span class="glsr-mono-cart-v">${SEAL}<b class="glsr-mono-cart-num" style="clip-path:inset(0 100% 0 0)">${dcText()}</b><i class="glsr-mono-cart-scan"></i></span></div>`
          : `<div class="glsr-mono-cart"><span class="glsr-mono-cart-k">${esc(tr("GLSR.dc"))}</span><span class="glsr-mono-cart-v"><b class="glsr-mono-cart-num">${dcText()}</b></span></div>`;
    return `
      <div class="glsr-mono-plinth" style="${box}height:${f1(g.plinthH)}px">
        <div class="glsr-mono-plinth-glass"></div>
        <div class="glsr-mono-mods" style="grid-template-columns:repeat(${Math.max(1, mods.length)},1fr)">
          ${mods.map((m, i) => `<button type="button" class="glsr-mono-mod${m.optional ? " is-optional" : ""}" data-mod="${i}" data-kind="${esc(m.kind)}">
            <span class="glsr-mono-mod-in"><i class="glsr-mono-mod-line"></i><span class="glsr-mono-mod-v">${sgn(m.value)}</span><span class="glsr-mono-mod-k">${chipLabel(m)}</span></span></button>`).join("")}
        </div>
        <div class="glsr-mono-baserow">
          <div class="glsr-mono-sum"><span class="glsr-mono-sum-k">${esc(tr("GLSR.label.modifier"))}</span><span class="glsr-mono-sum-v" data-mod-total>${sgn(model.modTotal ?? 0)}</span></div>
          ${dcCell}
          ${roll}
        </div>
      </div>`;
  }

  /** The front layer: every word that depends on the result is written at the throw, not here. */
  function buildFront() {
    const motes = Array.from({ length: compact ? 10 : 22 }, (_, k) => `<i class="glsr-mono-mote" style="left:${f1(50 + (jit(k, 4) - 0.5) * 70)}%;--s:${f1(0.6 + jit(k, 5) * 0.9)}"></i>`).join("");
    return `
      <div class="glsr-mono-brackets"><i></i><i></i><i></i><i></i></div>
      <div class="glsr-mono-nat"></div>
      <div class="glsr-mono-shock"></div>
      <div class="glsr-mono-motes">${motes}</div>
      <div class="glsr-mono-degree">
        <div class="glsr-mono-deg-kick"></div>
        <div class="glsr-mono-deg-word"><span></span><span class="glsr-mono-deg-shine" aria-hidden="true"></span></div>
        <div class="glsr-mono-deg-detail"></div>
        <button type="button" class="glsr-mono-reroll" data-action="reroll" hidden>${esc(tr("GLSR.action.reroll"))}</button>
      </div>
      <div class="glsr-mono-sealed">
        <div class="glsr-mono-cart is-sealed"><span class="glsr-mono-cart-v">${SEAL}</span></div>
        <div class="glsr-mono-sealed-title">${esc(tr("GLSR.sealed.title"))}</div>
        <div class="glsr-mono-sealed-note">${esc(tr("GLSR.sealed.note"))}</div>
        <button type="button" class="glsr-mono-reroll" data-action="reroll" hidden>${esc(tr("GLSR.action.reroll"))}</button>
      </div>
      <div class="glsr-mono-flyers"></div>
      <div class="glsr-mono-fmarks">
        <div class="glsr-mono-fmark is-kept"><span>${esc(tr("GLSR.dice.kept"))}</span></div>
        <div class="glsr-mono-fmark is-dropped"><span></span></div>
      </div>`;
  }

  function place() {
    setVar("--glsr-mono-u", g.u.toFixed(4));
    setVar("--glsr-mono-size", `${f1(g.size)}px`);
    setVar("--glsr-mono-cham", `${f1(g.cham)}px`);
    setVar("--glsr-mono-die-x", `${f1(g.cx)}px`);
    setVar("--glsr-mono-die-y", `${f1(g.dieY)}px`);
    setVar("--glsr-mono-dx", `${f1(g.dx)}px`);
    setVar("--glsr-mono-dy", `${f1(g.dy)}px`);
    setVar("--glsr-mono-slab-h", `${f1(g.slabH)}px`);
    setVar("--glsr-mono-slab-w", `${f1(g.slabW)}px`);
    setVar("--glsr-mono-deg-y", `${f1(g.dieY + g.size * 0.5 + (compact ? 22 : 36) * g.u)}px`);
    setVar("--glsr-mono-slab-top", `${f1(g.slabTop)}px`);
    setVar("--glsr-mono-plinth-y", `${f1(g.slabBottom)}px`);
    if (compact) setVar("--glsr-mono-degfs", `${f1(Math.min(46 * g.u, g.slabW / 5.2))}px`);
  }

  function setIdle() {
    setVar("--glsr-mono-fy", `${f1(g.slabH + 4)}px`);
    setVar("--glsr-mono-fillk", "0");
    for (const k of ["--glsr-mono-rate", "--glsr-mono-pk", "--glsr-mono-ig", "--glsr-mono-igk", "--glsr-mono-natk", "--glsr-mono-cold", "--glsr-mono-degk", "--glsr-mono-litk"]) setVar(k, "0");
    setVar("--glsr-mono-spin", "0deg");
    setVar("--glsr-mono-py", `${f1(g.slabH + 80)}px`);
    setVar("--glsr-mono-nata", "0deg");
    setVar("--glsr-mono-edgek", "0.5");
    setData("monoReach", "0");
    setData("monoDc", g.hasDc ? (sealedDc() ? "sealed" : "open") : "none");
  }

  /** Band values follow the DC; writing them twice (mount, throw) is harmless. */
  function writeBandValues() {
    if (!g.hasDc || model.dc?.value == null) return;
    monument.querySelectorAll(".glsr-mono-band-value[data-band]").forEach((e) => { e.textContent = String(model.dc.value + Number(e.dataset.band)); });
    monument.querySelectorAll(".glsr-mono-cart-num").forEach((e) => { e.textContent = String(model.dc.value); });
  }

  function build() {
    g = cfg.layoutFn(model);
    monument.innerHTML = buildSlab() + buildBust() + buildPlinth() + `<div class="glsr-mono-shards"></div>`;
    fwrap.innerHTML = buildFront();
    place();
    refs.slab = monument.querySelector(".glsr-mono-slab");
    refs.shards = monument.querySelector(".glsr-mono-shards");
    setIdle();
    writeBandValues();
    monument.querySelectorAll("[data-mod]").forEach((c) => c.classList.toggle("is-off", !model.mods?.[Number(c.dataset.mod)]?.enabled));
    settled = true;
  }

  build();

  /* ── the entrance: the stele rises with weight, its edges catch light,
        the engraving etches in line by line, then the words ── */
  function addArrive(arrive, off = 0, sc = 1) {
    const d = (ms) => off + ms * env.AM * sc;
    const q = (s) => monument.querySelectorAll(s);
    const H = globalThis.innerHeight ?? 900;
    const add = addTo(arrive);
    arrive
      .set(q(".glsr-mono-etch"), { strokeDashoffset: 1 }, 0)
      .set(q(".glsr-mono-mark, .glsr-mono-edge"), { opacity: 0 }, 0)
      .set(q(".glsr-mono-race"), { opacity: 0 }, 0)
      .set(rise, { opacity: 0 }, 0)
      .add(rise, { translateY: [H * 0.62, 0], duration: d(760) - off, ease: "outQuart" }, off)
      .add(rise, { opacity: [0, 1], duration: d(260) - off, ease: "linear" }, off);
    add(q(".glsr-mono-kicker, .glsr-mono-check, .glsr-mono-title, .glsr-mono-fortune, .glsr-mono-actor, .glsr-mono-chead, .glsr-mono-cplinth, .glsr-mono-band, .glsr-mono-mod-in, .glsr-mono-sum, .glsr-mono-cart, .glsr-mono-roll"), { opacity: 0, duration: 1 }, 0);
    if (cfg.ownsBackdrop) arrive.add([...cb.children], { opacity: [0, 1], duration: d(700), ease: "linear" }, 0);
    arrive
      .add(q(".glsr-mono-race"), { strokeDashoffset: [0.55, -0.5], opacity: [{ to: 1, duration: d(120) - off }, { to: 0.35, duration: d(560) - off }], duration: d(680) - off, ease: "inOutQuad" }, d(380))
      .add(q(".glsr-mono-edge"), { opacity: [0, 1], duration: d(380) - off }, d(260))
      .add(q(".glsr-mono-etch"), { strokeDashoffset: [1, 0], duration: d(420) - off, ease: "inOutQuad", delay: anime.stagger(d(14) - off) }, d(460))
      .add(q(".glsr-mono-mark"), { opacity: [0, 1], duration: d(300) - off, delay: anime.stagger(d(40) - off) }, d(760));
    add(q(".glsr-mono-kicker, .glsr-mono-check, .glsr-mono-title, .glsr-mono-fortune, .glsr-mono-chead"), { opacity: [0, 1], translateY: [6, 0], duration: d(380) - off, delay: anime.stagger(d(70) - off) }, d(820));
    add(q(".glsr-mono-check"), { letterSpacing: ["0.42em", "0.16em"], duration: d(520) - off, ease: "outExpo" }, d(860));
    add(q(".glsr-mono-actor"), { opacity: [0, 1], translateY: [10, 0], duration: d(380) - off }, d(900));
    add(q(".glsr-mono-band"), { opacity: [0, 1], duration: d(300) - off, delay: anime.stagger(d(60) - off) }, d(900));
    add(q(".glsr-mono-mod-in"), { opacity: [0, 1], translateY: [8, 0], duration: d(320) - off, delay: anime.stagger(d(45) - off) }, d(940));
    add(q(".glsr-mono-sum, .glsr-mono-cart, .glsr-mono-roll, .glsr-mono-cplinth"), { opacity: [0, 1], translateY: [6, 0], duration: d(320) - off, delay: anime.stagger(d(50) - off) }, d(940));
  }

  /* ── the light, as a function of the seeked time ── */
  let beats = null, steps = [], tl = null, base = null;

  /** A closed form of the tumble's spin, so the scattered light turns with the die at any seek. */
  const spinPhase = (ms) => {
    const T = TUMBLE.duration, W0 = TUMBLE.windup, t = Math.min(ms / 1000 / M, T + TUMBLE.settle);
    let a = 0; const n = 48, h = t / n;
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * h;
      const w = SPIN_PEAK * Math.min(1, s / W0) * (s < T ? 1 - 0.9 * Math.pow(s / T, 0.85) : 0.1 * Math.exp(-(s - T) * TUMBLE.rockDecay));
      a += w * h;
    }
    return a;
  };

  /** The light's height in points of total. Sealed rolls and rolls without a total keep it at rest. */
  function fillValue(ms) {
    const b = beats;
    if (base == null || ms < b.land) return g.lo - 1;
    const start = Math.min(g.lo - 1, base);
    let v = start + (base - start) * outExpo((ms - b.land) / (620 * M));
    steps.forEach((st, i) => { if (b.tally[i] != null) v += st.value * outQuart((ms - b.tally[i]) / (320 * M)); });
    const dt = ms - b.degree, deg = degreeOfModel(model);
    if (dt > 0 && deg === 3) v += (g.hi + 2 - v) * inOutQuart(dt / (900 * M));
    if (dt > 0 && deg === 1) v += (g.lo - 2 - v) * inOutQuart((dt - 380 * M) / (1500 * M));
    if (dt > 0 && deg === 0) v += (g.lo - 2 - v) * outQuart((dt - 160 * M) / (1000 * M));
    if (ms > b.out) v += (g.lo - 2 - v) * clamp01((ms - b.out) / (500 * M));
    return v;
  }

  let lastU = {};
  function frame(msIn, info) {
    if (!beats) return;
    const ms = Math.max(0, msIn);   // a staggered roll that has not left the hand yet sits at its throw
    const b = beats, deg = degreeOfModel(model);
    const v = fillValue(ms);
    const fy = Math.max(-6, Math.min(g.slabH + 4, g.yOf(v) - g.slabTop));
    // Spin energy on a square-root curve: the tumble spends most of its time
    // well under peak rate, and the light should still be turning with it.
    const rate = Math.sqrt(clamp01((info?.rate ?? 0) / SPIN_PEAK));
    const spin = spinPhase(ms);
    const dt = ms - b.degree;
    const degK = deg == null ? 0 : clamp01(dt / (500 * M));
    setVar("--glsr-mono-fy", `${f1(fy)}px`);
    setVar("--glsr-mono-fillk", base != null && ms >= b.land ? "1" : "0");
    setVar("--glsr-mono-rate", rate.toFixed(3));
    setVar("--glsr-mono-spin", `${f1((spin * 180) / Math.PI)}deg`);
    setVar("--glsr-mono-degk", degK.toFixed(3));

    // land: a pulse of light runs up the lattice
    const lp = clamp01((ms - b.land) / (700 * M));
    setVar("--glsr-mono-py", `${f1(g.slabH + 60 - (g.slabH + 160) * outQuart(lp))}px`);
    setVar("--glsr-mono-pk", ms >= b.land && lp < 1 ? (1 - lp * lp).toFixed(3) : "0");

    // natural: a sweep around the sigil
    if (b.natural != null && ms >= b.natural) {
      const nt = (ms - b.natural) / M;
      setVar("--glsr-mono-nata", `${f1(360 * outQuart(nt / 650))}deg`);
      setVar("--glsr-mono-natk", (clamp01(nt / 120) * (1 - clamp01((nt - 650) / 380))).toFixed(3));
    } else { setVar("--glsr-mono-natk", "0"); setVar("--glsr-mono-nata", "0deg"); }

    // degree: ignite (crit success), a calm lighting (success), cold (failure)
    let ig = 0, igk = 0, cold = 0, fall = 0;
    const maxR = Math.hypot(g.slabW / 2 + 40, Math.max(g.dy, g.slabH - g.dy) + 40);
    if (dt >= 0 && deg === 3) { ig = maxR * outQuart(dt / (760 * M)); igk = 1; }
    if (dt >= 0 && deg === 2) { ig = maxR * outQuart(dt / (1500 * M)); igk = 0.42; }
    if (dt >= 0 && deg === 1) cold = clamp01((dt - 200 * M) / (1600 * M));
    if (dt >= 0 && deg === 0) { cold = 0.45 * clamp01(dt / (900 * M)); fall = clamp01((dt - 1400 * M) / (1500 * M)); }
    setVar("--glsr-mono-ig", `${f1(ig)}px`);
    setVar("--glsr-mono-igk", igk.toFixed(3));
    setVar("--glsr-mono-cold", cold.toFixed(3));

    // which registers the light has reached (once they are carved)
    const known = model.dc?.value != null;
    const carved = known && (!sealedDcAtMount || (b.dcReveal != null && ms >= b.dcReveal + 300 * M));
    let reach = 0;
    if (g.hasDc && carved && base != null) reach = v >= g.dc + 9.5 ? 3 : v >= g.dc - 0.5 ? 2 : v >= g.dc - 9.5 ? 1 : 0;
    setData("monoReach", String(reach));
    setData("monoDc", !g.hasDc ? "none" : carved ? "open" : "sealed");

    // how much of the die the light is behind (0 below it, 1 over it)
    const dieLit = base == null ? 0 : clamp01((g.dieY + g.size / 2 - (fy + g.slabTop)) / g.size);
    setVar("--glsr-mono-litk", dieLit.toFixed(3));
    const natK = b.natural != null && ms >= b.natural ? Math.exp(-(ms - b.natural) / (520 * M)) : 0;
    setVar("--glsr-mono-edgek", (0.45 + 0.55 * rate + 0.6 * natK + (dt >= 0 && deg === 3 ? 0.8 : 0)).toFixed(3));

    // racing edge light follows the spin
    const race = monument.querySelector(".glsr-mono-slab .glsr-mono-race");
    if (race) { race.style.strokeDashoffset = (-spin / 9).toFixed(4); race.style.opacity = (ms < b.land ? 0.25 + 0.75 * rate : 0.3 * Math.exp(-(ms - b.land) / 500)).toFixed(3); }

    lastU = {
      uSpin: spin, uFillY: ((globalThis.innerHeight ?? 900) - (fy + g.slabTop)) * Math.min(2, globalThis.devicePixelRatio || 1),
      uFillK: base != null && ms >= b.land ? 1 : 0, uIgnite: clamp01(ig / maxR) * igk, uCold: cold, uFall: fall,
      uOutDur: (b.end - b.out) / 1000, uLit: dieLit,
      uGold: env.GOLD, uCrimson: env.CRIMSON,
    };
    cfg.extend?.frame?.(ms, { b, v, dt, model, g, lastU, deg, base });
  }

  let sealedDcAtMount = sealedDc();

  /** Words that depend on the result, written when the result is known. */
  function writeResult() {
    const fq = (s) => fwrap.querySelector(s);
    const r = model.roll ?? {};
    const deg = degreeOfModel(model);
    const nat = fq(".glsr-mono-nat");
    if (nat) nat.textContent = r.natural === 20 || r.natural === 1 ? fmt("GLSR.natural", { n: r.natural }) : "";
    const drop = fq(".glsr-mono-fmark.is-dropped span");
    if (drop) drop.textContent = r.dropped != null ? fmt("GLSR.dice.dropped", { n: r.dropped }) : "";
    const kick = fq(".glsr-mono-deg-kick"), word = fq(".glsr-mono-deg-word"), detail = fq(".glsr-mono-deg-detail");
    const dg = fq(".glsr-mono-degree");
    let kickText = "", wordText = "", detailText = "";
    if (!model.sealed && r.total != null) {
      if (deg != null) {
        const key = DEGREES[deg];
        kickText = deg === 0 || deg === 3 ? tr("GLSR.kicker.critical") : "";
        wordText = tr(`GLSR.degreeWord.${key}`);
        dg.setAttribute("aria-label", tr(`GLSR.degree.${key}`));
        if (model.dc?.value == null) {
          // dc.mode "never": the GM keeps the DC to themselves for good — a verdict, no comparison
          detailText = fmt("GLSR.detail.total", { total: r.total });
        } else {
        const diff = r.total - model.dc.value;
        const margin = diff === 0 ? tr(compact ? "GLSR.margin.metShort" : "GLSR.margin.met")
          : diff > 0 ? fmt("GLSR.margin.by", { n: diff }) : fmt(compact ? "GLSR.margin.shortShort" : "GLSR.margin.short", { n: -diff });
        detailText = compact ? fmt("GLSR.detail.compact", { total: r.total, margin }) : fmt("GLSR.detail.full", { total: r.total, dc: model.dc.value, margin });
        }
      } else {
        kickText = tr("GLSR.label.total");
        wordText = String(r.total);
        detailText = fmt("GLSR.detail.noDc", { check: model.request?.check ?? "" });
      }
    }
    kick.textContent = kickText; kick.hidden = !kickText;
    word.querySelectorAll("span").forEach((s) => { s.textContent = wordText; });
    detail.textContent = detailText;
    fwrap.querySelectorAll(".glsr-mono-reroll").forEach((b) => { b.hidden = !model.canReroll; });
    // the measurement from the DC line to where the light comes to rest
    monument.querySelector(".glsr-mono-slab .glsr-mono-dim")?.remove();
    if (g.hasDc && deg != null && model.dc?.value != null) {
      const diff = r.total - model.dc.value;
      const yT = g.yOf(r.total) - g.slabTop, yD = g.dcY - g.slabTop;
      const dim = el("div", `glsr-mono-dim ${diff >= 0 ? "is-over" : "is-under"}`, `<i class="glsr-mono-dim-rule"></i><span>${diff >= 0 ? "+" + diff : "−" + Math.abs(diff)}</span>`);
      dim.style.top = `${f1(Math.min(yT, yD))}px`;
      dim.style.height = `${f1(Math.max(2, Math.abs(yD - yT)))}px`;
      monument.querySelector(".glsr-mono-slab .glsr-mono-bands")?.append(dim);
    }
  }

  /* ── the throw ── */
  function throwTimeline(bts, mdl) {
    // A re-throw (a Hero Point) arrives on a landed stele: the director has
    // reverted the old timeline; rebuild the DOM so nothing of the old verdict
    // (shards, a measurement, a cracked slab) survives into the new throw.
    if (beats) { model = mdl; build(); cfg.extend?.rethrow?.(); }
    model = mdl;
    beats = bts;
    const r = model.roll ?? {};
    steps = model.sealed ? [] : (model.mods ?? []).filter((x) => x.enabled && x.value !== 0);
    base = model.sealed || r.total == null ? null : r.total - steps.reduce((a, s) => a + s.value, 0);
    // With a DC the light is read against it; without one it is scaled so the
    // final total comes to rest at the die.
    if (model.dc?.value != null) g.dc = model.dc.value;
    else if (!g.hasDc && r.total != null) g.dc = r.total - 4;
    writeBandValues();
    writeResult();
    const stepIdx = (model.mods ?? []).map((x, i) => (x.enabled && x.value !== 0 ? i : -1)).filter((i) => i >= 0);
    const t = anime.createTimeline({ autoplay: false, defaults: { ease: "outQuart" } });
    tl = t;
    const add = addTo(t);
    const d = (ms) => ms * M;
    const q = (s) => monument.querySelectorAll(s);
    const fq = (s) => fwrap.querySelector(s);
    const b = bts;
    const deg = degreeOfModel(model);

    // the call is answered: the control goes, the plinth settles
    add(q(".glsr-mono-roll"), { opacity: [1, 0], translateY: [0, 6], duration: d(220) }, 0);

    // fortune: mark the pair, then the dropped die breaks away
    if (b.fortune != null) {
      add(fwrap.querySelectorAll(".glsr-mono-fmark"), { opacity: [{ to: 1, duration: d(140) }, { to: 1, duration: d(380) }, { to: 0, duration: d(260) }], scale: [1.25, 1], duration: d(780), ease: "outExpo" }, b.fortune - d(120));
    }

    // natural 20 / natural 1 (only a single d20 has one)
    if (b.natural != null && (r.natural === 20 || r.natural === 1)) {
      const nat20 = r.natural === 20;
      t.add(fq(".glsr-mono-brackets"), { opacity: [{ to: 1, duration: d(90) }, { to: 1, duration: d(760) }, { to: 0, duration: d(260) }], duration: d(1110), ease: "linear" }, b.natural)
        .add(fq(".glsr-mono-brackets"), { scale: nat20 ? [1.7, 1.12] : [1.25, 0.9], duration: d(420), ease: "outExpo" }, b.natural)
        .add(fq(".glsr-mono-nat"), { opacity: [{ to: 1, duration: d(140) }, { to: 1, duration: d(640) }, { to: 0, duration: d(260) }], duration: d(1040), ease: "linear" }, b.natural + d(60))
        .add(fq(".glsr-mono-nat"), { letterSpacing: nat20 ? ["0.9em", "0.42em"] : ["0.1em", "0.32em"], duration: d(700), ease: "outExpo" }, b.natural + d(60));
    }

    // a hidden DC is carved in: the seal splits, the number is cut, the line strikes across
    // a sealed roll never unveils a hidden DC: with the total withheld, the DC alone is still a clue
    if (b.dcReveal != null && model.dc?.value != null && !model.sealed) {
      const R0 = b.dcReveal;
      add(q(".glsr-mono-seal i"), { scaleX: [1, 0], opacity: [1, 0], duration: d(220), ease: "inQuad", delay: anime.stagger(d(30)) }, R0);
      add(q(".glsr-mono-cart-num"), { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"], duration: d(300), ease: "inOutQuad" }, R0 + d(120));
      add(q(".glsr-mono-cart-scan"), { left: ["0%", "100%"], opacity: [{ to: 1, duration: d(40) }, { to: 1, duration: d(220) }, { to: 0, duration: d(80) }], duration: d(340), ease: "inOutQuad" }, R0 + d(100));
      add(q(".glsr-mono-cart:not(.is-vs)"), { scale: [1, 1.08, 1], duration: d(380), ease: "outQuad" }, R0 + d(380));
      add(q(".glsr-mono-band.is-dc .glsr-mono-band-rule"), { scaleX: [0, 1], duration: d(420), ease: "outExpo" }, R0 + d(160));
      add(q(".glsr-mono-band.is-crit .glsr-mono-band-rule, .glsr-mono-band.is-fail .glsr-mono-band-rule"), { scaleX: [0, 1], duration: d(460), ease: "outExpo", delay: anime.stagger(d(70)) }, R0 + d(300));
      add(q(".glsr-mono-band-label, .glsr-mono-band-value"), { opacity: [0, 1], duration: d(300), delay: anime.stagger(d(40)) }, R0 + d(420));
    } else if (sealedDcAtMount && model.dc?.value != null && !model.sealed) {
      // the DC was sealed at mount but the throw names it with no unveiling beat: carve it at once
      add(q(".glsr-mono-band-rule"), { scaleX: [0, 1], duration: d(300), ease: "outExpo" }, 0);
      add(q(".glsr-mono-band-label, .glsr-mono-band-value"), { opacity: [0, 1], duration: d(300) }, 0);
      add(q(".glsr-mono-seal i"), { opacity: [1, 0], duration: d(200) }, 0);
      add(q(".glsr-mono-cart-num"), { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"], duration: d(300) }, 0);
    }

    // the tally: each modifier's light runs up its conduit into the die
    const flyers = fwrap.querySelector(".glsr-mono-flyers");
    flyers.replaceChildren();
    const travel = d(360);
    if (eng.conduits.length) steps.forEach((st, i) => {
      const T = b.tally[i];
      if (T == null) return;
      const k = compact ? i % eng.conduits.length : Math.min(stepIdx[i], eng.conduits.length - 1);
      const chip = compact ? null : q(".glsr-mono-mod")[k];
      const c = eng.conduits[k];
      const x0 = g.slabX + c.base[0], y0 = g.slabTop + c.base[1];
      const fl = el("div", "glsr-mono-flyer", `<i></i><span>${sgn(st.value)}</span>`);
      fl.style.left = `${f1(x0)}px`; fl.style.top = `${f1(y0)}px`;
      flyers.append(fl);
      const tx = g.cx - x0, ty = g.dieY - y0;
      const runner = q(`.glsr-mono-slab .glsr-mono-runner[data-k="${k}"]`);
      if (chip) t.add(chip, { scale: [{ to: 1.12, duration: d(90) }, { to: 1, duration: d(260) }], duration: d(350), ease: "outQuad" }, T - travel)
        .add(chip.querySelector(".glsr-mono-mod-v"), { opacity: [1, 0.32], duration: d(260), ease: "inQuad" }, T - travel + d(80))
        .add(chip.querySelector(".glsr-mono-mod-line"), { opacity: [1, 0.25], scaleY: [1.6, 1], duration: d(420), ease: "outQuad" }, T - travel);
      add(runner, { strokeDashoffset: [0.16, -1.04], duration: travel, ease: "inQuad" }, T - travel);
      add(runner, { opacity: [{ to: 1, duration: d(40) }, { to: 1, duration: travel - d(80) }, { to: 0, duration: d(40) }], duration: travel, ease: "linear" }, T - travel);
      t.add(fl, { translateX: [0, tx], translateY: [0, ty], scale: [1, 0.55], duration: travel, ease: "inQuad" }, T - travel)
        .add(fl, { opacity: [{ to: 1, duration: d(60) }, { to: 1, duration: travel - d(140) }, { to: 0, duration: d(80) }], duration: travel, ease: "linear" }, T - travel);
    });
    if (steps.length && b.tally.length) add(q(".glsr-mono-sum"), { opacity: [1, 0.45], duration: d(300) }, b.tally.at(-1) + d(200));

    // the verdict — or, sealed, a verdict nobody on this screen may read
    const D = b.degree;
    const dg = fq(".glsr-mono-degree");
    const sealedEl = fq(".glsr-mono-sealed");
    let verdictEl = null;
    if (model.sealed) {
      verdictEl = sealedEl;
      t.add(sealedEl, { opacity: [0, 1], duration: d(200), ease: "linear" }, D)
        .add(sealedEl.querySelector(".glsr-mono-sealed-title"), { letterSpacing: ["0.9em", "0.42em"], duration: d(620), ease: "outExpo" }, D)
        .add(sealedEl.querySelectorAll(".glsr-mono-seal i"), { scale: [0.4, 1], opacity: [0, 1], duration: d(320), ease: "outBack(1.6)", delay: anime.stagger(d(60)) }, D + d(80));
    } else if (r.total != null) {
      verdictEl = dg;
      t.add(dg, { opacity: [0, 1], duration: d(160), ease: "linear" }, D)
        .add(dg.querySelector(".glsr-mono-deg-word"), { clipPath: ["inset(-60% 50% -60% 50%)", "inset(-60% -30% -60% -30%)"], translateY: [deg === 1 ? -4 : 10, 0], duration: d(deg === 3 ? 620 : 520), ease: "outExpo" }, D)
        .add(dg.querySelector(".glsr-mono-deg-shine"), { backgroundPosition: ["100% 0", "0% 0"], duration: d(deg === 3 ? 900 : 700), ease: "inOutQuad" }, D + d(120))
        .add(dg.querySelector(".glsr-mono-deg-detail"), { opacity: [0, 1], translateY: [6, 0], duration: d(380) }, D + d(420));
      const kick = dg.querySelector(".glsr-mono-deg-kick");
      if (!kick.hidden) t.add(kick, { opacity: [0, 1], letterSpacing: compact ? ["0.9em", "0.36em"] : ["1.4em", "0.62em"], duration: d(620), ease: "outExpo" }, D + d(60));
      const dimEl = monument.querySelector(".glsr-mono-slab .glsr-mono-dim");
      if (dimEl) t.add(dimEl.querySelector(".glsr-mono-dim-rule"), { scaleY: [0, 1], duration: d(380), ease: "outExpo" }, D + d(260))
        .add(dimEl, { opacity: [0, 1], duration: d(200), ease: "linear" }, D + d(260))
        .add(dimEl.querySelector("span"), { opacity: [0, 1], translateX: [-6, 0], duration: d(300) }, D + d(460));
    }
    if (verdictEl && model.canReroll) add(verdictEl.querySelector(".glsr-mono-reroll"), { opacity: [0, 1], translateY: [6, 0], duration: d(380) }, D + d(900));

    if (deg === 3) {
      t.add(fq(".glsr-mono-shock"), { scale: [0.5, compact ? 3 : 4.2], opacity: [{ to: 1, duration: d(60) }, { to: 0, duration: d(840) }], duration: d(900), ease: "outQuart" }, D)
        .add(fwrap.querySelectorAll(".glsr-mono-mote"), { translateY: [0, (_, k) => -(g.size * (1.6 + jit(k, 6) * 1.6))], opacity: [{ to: 1, duration: d(200) }, { to: 0, duration: d(1600) }], duration: d(1800), ease: "outQuad", delay: anime.stagger(d(55)) }, D + d(120));
      add(q(".glsr-mono-check"), { scale: [1, 1.04, 1], duration: d(700), ease: "outQuad" }, D + d(180));
    }
    if (deg === 2) {
      t.add(fq(".glsr-mono-shock"), { scale: [0.7, 2.6], opacity: [{ to: 0.55, duration: d(80) }, { to: 0, duration: d(1100) }], duration: d(1180), ease: "outQuart" }, D);
    }
    if (deg === 0) crackInto(env, t, { slab: refs.slab, shardsEl: refs.shards, geo: shardGeo, slabX: g.slabX, slabTop: g.slabTop, u: g.u, D });

    cfg.extend?.throw?.(t, { b, d, add, model, g, deg });

    // exit: the stele sinks back into the floor and is gone
    const O = b.out, E = b.end, H = globalThis.innerHeight ?? 900;
    t.add(sink, { translateY: [0, H * 0.55], duration: E - O, ease: "inCubic" }, O)
      .add(sink, { opacity: [1, 0], duration: E - O, ease: "inQuad" }, O);
    if (verdictEl) t.add(verdictEl, { opacity: [1, 0], translateY: [0, 10], duration: (E - O) * 0.7, ease: "inQuad" }, O);
    if (cfg.ownsBackdrop) t.add([...cb.children], { opacity: [1, 0], duration: E - O, ease: "inQuad" }, O);
    return t;
  }

  return {
    wrap, fwrap, monument, sink,
    get g() { return g; }, get beats() { return beats; }, get model() { return model; },
    addArrive, throwTimeline, frame, fillValue,
    uniforms() { return { ...lastU, ...(cfg.extend?.uniforms?.() ?? {}) }; },
    anchor() { return { x: g.cx, y: g.dieY, size: g.size }; },
    lights(ms, info) {
      if (!beats) return {};
      ms = Math.max(0, ms);
      const deg = degreeOfModel(model);
      const dieLit = base == null ? 0 : clamp01((g.dieY + g.size / 2 - g.yOf(fillValue(ms))) / g.size);
      const dt = ms - beats.degree;
      const degFlare = dt >= 0 && deg != null ? 14 * Math.exp(-dt / 600) + 6 : 0;
      const natHot = beats.natural != null && ms >= beats.natural ? Math.exp(-(ms - beats.natural) / 500) : 0;
      let rimI = 4 + 9 * dieLit + degFlare + natHot * 20 + 4 * clamp01((info?.rate ?? 0) / SPIN_PEAK);
      let keyI = 1.6;
      if (dt >= 0 && deg === 1) { rimI *= 1 - 0.6 * clamp01(dt / 1400); keyI = 1.6 - 0.5 * clamp01(dt / 1400); }
      return { rimI, keyI };
    },
    /** A chip was toggled (or a peer's choice arrived) before the throw. */
    update(m) {
      model = m;
      sealedDcAtMount = sealedDc();
      if (beats) return;
      build();
    },
    // Re-lay the stele for a new viewport only while nothing is in flight: the
    // throw timeline holds references to this DOM, and a rebuild mid-roll would
    // orphan every beat still to come.
    relayout() { if (!beats) build(); },
    destroy() { tl?.revert?.(); tl = null; wrap.remove(); fwrap.remove(); },
  };
}

export { seg, poly, circ, f1, clamp01, outQuart, outExpo, jit, geom, shardGeometry };
