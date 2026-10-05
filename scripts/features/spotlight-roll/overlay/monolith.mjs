/**
 * Spotlight Roll · Monolith — the overlay.
 *
 * A tall slab of etched glass rises behind the die and the die floats in front
 * of it, lit through it: a crystal standing stone on its plinth, or a display
 * pane on its mount. The engraving is also the gauge. Light wells up from the
 * plinth as the total climbs, and the degree registers are cut so that THE
 * SUCCESS BAND IS THE DIE: the DC line runs just under it and the critical line
 * just over it. Light has to reach the die to succeed and climb past it to crit.
 *
 *   single    one stele, centre stage
 *   group     a colonnade of compact steles under one lintel, read against
 *             one continuous DC line, summarised once every verdict is in
 *   opposed   the roller's stele turned toward a defender's, whose DC line is
 *             cast across the gap; the verdict lands on both slabs
 *
 * Pure DOM — no game, canvas, foundry, ui or Hooks; the preview page and the
 * check tool import it as is. Contract v2 (see director.mjs): mount(ctx) →
 * { arrive, throwTimeline(beats, model, i), frame(ms, info), uniforms, lights,
 *   dieAnchor(i), update(model, i), after(states), destroy }.
 */
import { FRAGMENT } from "./fragment.mjs";
import {
  clamp01, outQuart, outExpo, f1, seg, poly, circ, geom, shardGeometry,
} from "./geometry.mjs";
import { el, esc, makeEnv, createStele, crackInto, crackSvg, I18N_DYNAMIC } from "./stele.mjs";
import { DEGREES } from "../timeline.mjs";

export { I18N_DYNAMIC };

const onResize = (fn) => { globalThis.addEventListener?.("resize", fn); return () => globalThis.removeEventListener?.("resize", fn); };
const clearRootVars = (root) => { for (const k of [...root.style]) if (k.startsWith("--glsr-mono-")) root.style.removeProperty(k); };

/* ── single: one stele, centre stage ───────────────────────────────────── */

function mountSingle(ctx, env) {
  const { root, anime } = ctx;
  const st = createStele(env, { i: 0, model: ctx.model, variant: "full", layoutFn: (m) => geom(m), rootVars: true, ownsBackdrop: true });
  const arrive = anime.createTimeline({ autoplay: false, defaults: { ease: "outQuart" } });
  st.addArrive(arrive);
  const off = onResize(() => st.relayout());
  return {
    arrive,
    throwTimeline: (b, m) => st.throwTimeline(b, m),
    frame: (ms, info) => st.frame(ms, info),
    uniforms: () => st.uniforms(),
    dieAnchor: () => st.anchor(),
    lights: (ms, info) => st.lights(ms, info),
    update: (m) => st.update(m),
    destroy() { off(); arrive.revert(); st.destroy(); env.cb.remove(); clearRootVars(root); },
  };
}

/* ── group: a colonnade of steles under one lintel and one DC line ─────── */

/** Lay out n compact steles: one row, under a lintel, centred in the frame. */
function colonnadeLayout(n, fortune) {
  const W = globalThis.innerWidth ?? 1600, H = globalThis.innerHeight ?? 900, m = Math.min(W, H);
  const lintelH = Math.max(66, Math.min(112, H * 0.12));
  const lintelTop = Math.round(H * 0.03);
  let slabTop = lintelTop + lintelH + Math.max(8, Math.min(18, H * 0.02));
  const gx = Math.max(8, Math.min(22, W * 0.012));
  const wPer = (W - 32 - (n - 1) * gx) / n;
  // compact stele: slab = 2.725 × die tall (86u head, 26u gap, die, gauge), 1.75 × die wide
  const sizeH = Math.min((H * 0.97 - slabTop - 78) / 2.725, (H * 0.97 - slabTop) / (2.725 + 84 / 212));
  const size = Math.max(52, Math.min(wPer / (fortune ? 2.05 : 1.75), sizeH, Math.max(110, Math.min(280, m * 0.235))));
  const u = size / 212;
  const slabW = 1.75 * size;
  const minGap = fortune ? Math.max(gx, 0.32 * size) : gx;
  const gap = Math.max(minGap, Math.min((W - 32 - n * slabW) / Math.max(1, n - 1), Math.max(gx, W * 0.03)));
  const span = n * slabW + (n - 1) * gap;
  const x0 = (W - span) / 2;
  const plinthH = Math.max(84 * u, 78);
  const slabH = 143 * u + 2.05 * size;
  const bottom = slabTop + slabH + plinthH;
  const shift = Math.max(0, (H * 0.97 - bottom) / 2);   // centre the whole monument in what is left
  slabTop += shift;
  return {
    n, size, u, slabW, gap, span, x0, slabTop, plinthH,
    cxs: Array.from({ length: n }, (_, i) => x0 + slabW / 2 + i * (slabW + gap)),
    lintel: { x: x0 - 14, w: span + 28, y: lintelTop + shift, h: lintelH },
  };
}

function mountGroup(ctx, env, req) {
  const { root, back, anime } = ctx;
  const { t, f } = env;
  const n = req.rolls.length;
  const shared = req.sharedDc ?? { value: req.rolls[0].dc?.value ?? null, mode: req.rolls[0].dc?.mode ?? "none" };
  const fortune = req.rolls.some((r) => r.roll?.fortune);
  const hasDc = shared.value != null || shared.mode === "hidden";
  const hidden = hasDc && (shared.mode === "hidden" || shared.value == null);
  let L = colonnadeLayout(n, fortune);
  const layoutFor = (i) => (m) => geom(m, { compact: true, size: L.size, cx: L.cxs[i], slabTop: L.slabTop, slabW: L.slabW, plinthW: L.slabW, plinthH: L.plinthH, dc: shared.value ?? undefined });

  // the shared architecture sits behind every stele
  const arch = el("div", "glsr-mono-arch");
  back.append(arch);
  const steles = req.rolls.map((m, i) => createStele(env, { i, model: m, variant: "compact", layoutFn: layoutFor(i), rootVars: false, ownsBackdrop: false }));
  const rq = req.rolls[0].request ?? {};

  function buildArch() {
    const g0 = steles[0].g, lt = L.lintel;
    arch.innerHTML = `
      <div class="glsr-mono-lintel" style="left:${f1(lt.x)}px;top:${f1(lt.y)}px;width:${f1(lt.w)}px;height:${f1(lt.h)}px">
        <div class="glsr-mono-plinth-glass"></div>
        <div class="glsr-mono-lintel-in">
          <div class="glsr-mono-lintel-title">
            <div class="glsr-mono-kicker">${esc(f("GLSR.group.rollers", { kind: rq.kind ?? "", n }))}</div>
            <div class="glsr-mono-check">${esc(rq.check)}</div>
            ${rq.title ? `<div class="glsr-mono-title">${esc(rq.title)}</div>` : ""}
          </div>
          <div class="glsr-mono-summary"><b></b><span></span></div>
          ${!hasDc ? (shared.mode === "never" ? `<div class="glsr-mono-cart is-sealed"><span class="glsr-mono-cart-k">${esc(t("GLSR.dc"))}</span><span class="glsr-mono-cart-v"><b class="glsr-mono-seal"><i></i><i></i><i></i></b></span></div>` : `<div class="glsr-mono-cart is-none"><span class="glsr-mono-cart-k">${esc(t("GLSR.label.noDc"))}</span><span class="glsr-mono-cart-v">—</span></div>`)
            : `<div class="glsr-mono-cart${hidden ? " is-sealed" : ""}"><span class="glsr-mono-cart-k">${esc(t("GLSR.dc"))}</span><span class="glsr-mono-cart-v">${hidden ? `<b class="glsr-mono-seal"><i></i><i></i><i></i></b>` : ""}<b class="glsr-mono-cart-num"${hidden ? ' style="clip-path:inset(0 100% 0 0)"' : ""}>${shared.value ?? ""}</b></span></div>`}
        </div>
      </div>
      ${!hasDc ? "" : `<div class="glsr-mono-sline" style="left:${f1(L.x0 - 10)}px;top:${f1(g0.dcY)}px;width:${f1(L.span + 20)}px"><i${hidden ? ' style="transform:scaleX(0)"' : ""}></i></div>`}`;
    // root vars feed the CSS-only backdrop, centred on the colonnade
    const s = root.style;
    s.setProperty("--glsr-mono-die-x", `${f1((globalThis.innerWidth ?? 1600) / 2)}px`);
    s.setProperty("--glsr-mono-die-y", `${f1(g0.dieY)}px`);
    s.setProperty("--glsr-mono-size", `${f1(Math.min(L.span / 3, g0.size * 2.2))}px`);
    s.setProperty("--glsr-mono-slab-w", `${f1(L.span)}px`);
    s.setProperty("--glsr-mono-plinth-y", `${f1(g0.slabBottom)}px`);
    s.setProperty("--glsr-mono-u", g0.u.toFixed(4));
  }
  buildArch();

  const arrive = anime.createTimeline({ autoplay: false, defaults: { ease: "outQuart" } });
  {
    const lintel = arch.querySelector(".glsr-mono-lintel");
    arrive.set(arch.querySelectorAll(".glsr-mono-lintel-in > *"), { opacity: 0 }, 0)
      .add(lintel, { translateY: [-40, 0], opacity: [0, 1], duration: 520 * env.AM, ease: "outQuart" }, 0)
      .add(arch.querySelectorAll(".glsr-mono-lintel-in > :not(.glsr-mono-summary)"), { opacity: [0, 1], translateY: [6, 0], duration: 380, delay: anime.stagger(80) }, 360)
      .add([...env.cb.children], { opacity: [0, 1], duration: 700 * env.AM, ease: "linear" }, 0);
    const sline = arch.querySelector(".glsr-mono-sline i");
    if (sline && !hidden) arrive.add(sline, { scaleX: [0, 1], duration: 520, ease: "outExpo" }, 820);
    const stag = Math.min(70, 300 / Math.max(1, n - 1));
    steles.forEach((st, i) => st.addArrive(arrive, 120 + i * stag, 0.74));
  }

  let groupOut = 0;
  const natOf = (m) => (m.sealed ? 0 : m.roll?.natural === 20 ? 1 : m.roll?.natural === 1 ? -1 : 0);

  /** Shared state, written straight from the clock every frame. */
  function after(states) {
    const live = states.filter((s) => s.ms != null && steles[s.index]?.beats).map((s) => ({ ...s, b: steles[s.index].beats, m: steles[s.index].model }));
    // the shared DC is uncovered the first time any roll reaches its unveiling
    if (hidden) {
      const named = live.find((s) => s.m.dc?.value != null);
      const num = arch.querySelector(".glsr-mono-cart-num");
      if (named && num && !num.textContent) num.textContent = String(named.m.dc.value);
      const rv = live.reduce((a, s) => Math.max(a, s.b.dcReveal != null && s.m.dc?.value != null ? s.ms - s.b.dcReveal : -Infinity), -Infinity);
      const k = (x) => clamp01(x / (300 * env.M));
      arch.querySelectorAll(".glsr-mono-seal i").forEach((e) => { e.style.transform = `scaleX(${1 - k(rv)})`; e.style.opacity = String(1 - k(rv)); });
      if (num) num.style.clipPath = `inset(0 ${f1(100 * (1 - outQuart(k(rv - 120 * env.M))))}% 0 0)`;
      const sl = arch.querySelector(".glsr-mono-sline i");
      if (sl) sl.style.transform = `scaleX(${outExpo((rv - 160 * env.M) / (520 * env.M)).toFixed(4)})`;
    }
    // once every roll has reached its verdict, the lintel says how the group fared
    const sum = arch.querySelector(".glsr-mono-summary");
    const reached = live.length === n && live.every((s) => s.ms >= s.b.degree);
    if (reached && sum) {
      const tSince = Math.min(...live.map((s) => s.ms - s.b.degree));
      const c = [0, 0, 0, 0]; let sealed = 0, known = 0;
      for (const s of live) {
        if (s.m.sealed || s.m.degree == null) { if (s.m.sealed) sealed++; continue; }
        c[s.m.degree]++; known++;
      }
      const ok = c[2] + c[3];
      sum.querySelector("b").textContent = known ? f("GLSR.summary.succeed", { ok, n: known }) : "";
      const parts = [3, 2, 1, 0].filter((k) => c[k]).map((k) => f(`GLSR.summary.count.${DEGREES[k]}`, { n: c[k] }));
      if (sealed) parts.push(f("GLSR.summary.sealed", { n: sealed }));
      sum.querySelector("span").textContent = parts.join(" · ");
      const p = clamp01((tSince - 300 * env.M) / (600 * env.M));
      sum.style.opacity = String(p);
      sum.style.letterSpacing = `${(0.6 - 0.3 * outExpo(p)).toFixed(3)}em`;
      sum.dataset.tone = ok * 2 >= Math.max(1, known) ? "good" : "poor";
    } else if (sum) sum.style.opacity = "0";
    // the lintel and the shared line leave with the last stele
    const allOut = live.length === n && live.every((s) => s.ms >= s.b.out);
    groupOut = allOut ? clamp01(Math.min(...live.map((s) => (s.ms - s.b.out) / Math.max(1, s.b.end - s.b.out)))) : 0;
    if (allOut) {
      arch.style.opacity = String(1 - groupOut);
      arch.style.transform = `translateY(${f1((globalThis.innerHeight ?? 900) * 0.3 * groupOut * groupOut)}px)`;
      for (const c of env.cb.children) c.style.opacity = String(1 - groupOut);
    } else if (arch.style.opacity) { arch.style.opacity = ""; arch.style.transform = ""; }
  }

  const off = onResize(() => { if (steles.every((s) => !s.beats)) { L = colonnadeLayout(n, fortune); steles.forEach((s) => s.relayout()); buildArch(); } });

  return {
    arrive,
    throwTimeline: (b, m, i = 0) => steles[i].throwTimeline(b, m),
    frame: (ms, info) => steles[info.index ?? 0].frame(ms, info),
    uniforms: (ms, info) => ({
      ...steles[info.index ?? 0].uniforms(), uPalS: env.SUCCESS, uPalF: env.FAIL, uGrpOut: groupOut,
      uGrpNat: Array.from({ length: 8 }, (_, k) => (steles[k] ? natOf(steles[k].model) : 0)),
    }),
    lights: (ms, info) => steles[info.index ?? 0].lights(ms, info),
    dieAnchor: (i = 0) => steles[i].anchor(),
    update: (m, i = 0) => steles[i].update(m),
    after,
    destroy() { off(); arrive.revert(); steles.forEach((s) => s.destroy()); arch.remove(); env.cb.remove(); clearRootVars(root); },
  };
}

/* ── opposed: the roller's stele faces the defender's across the DC ────── */

function mountOpposed(ctx, env, req) {
  const { root, back, anime } = ctx;
  const { t } = env;
  const def = req.defender;
  const model = req.rolls[0];
  // The statistic without its trailing "DC" — the DC is carved under the line.
  const dcWord = t("GLSR.dc").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stat = String(def.statistic ?? "").replace(new RegExp(`\\s*${dcWord}\\s*$`, "i"), "");
  // Everything is measured in die radii so the shader can find the defender
  // from uDie alone: the defender stands 5.2 R to the right of the die.
  const layout = () => {
    const W = globalThis.innerWidth ?? 1600, H = globalThis.innerHeight ?? 900;
    const size = Math.max(110, Math.min(280, Math.min(W, H) * 0.235)), R = size / 2;
    const cx = W / 2 - 2.02 * R;
    return { size, R, cx, dcx: cx + 5.2 * R, dhw: 1.6 * R };
  };
  let O = layout();
  let defU = {};

  /* the defender's stele: no die — a medallion, a name, and their statistic carved large */
  const dw = el("div", "glsr-mono glsr-mono-unit glsr-mono-def");
  dw.dataset.roll = "0";
  const drise = el("div", "glsr-mono-rise"), dsink = el("div", "glsr-mono-sink"), dmon = el("div", "glsr-mono-monument");
  dw.append(drise); drise.append(dsink); dsink.append(dmon);
  let D = null, dgeo = null, dmodel = model;
  const dvar = (k, v) => dw.style.setProperty(k, v);
  const hasDc = () => dmodel.dc?.mode !== "never" && (dmodel.dc?.value != null || def.dc != null || dmodel.dc?.mode === "hidden");
  const hiddenAtMount = () => hasDc() && (dmodel.dc?.mode === "hidden" || (dmodel.dc?.value ?? def.dc) == null);
  const WORDS = ["GLSR.defender.criticalFailure", "GLSR.defender.failure", "GLSR.defender.success", "GLSR.defender.criticalSuccess"];

  const attacker = createStele(env, {
    i: 0, model, variant: "full", rootVars: true, ownsBackdrop: true, against: def, statLabel: stat,
    layoutFn: (m) => { const g = geom(m, { cx: O.cx }); return geom(m, { cx: O.cx, plinthW: g.slabW * 1.2 }); },
    extend: { rethrow: () => buildDef(), throw: defThrow, frame: defFrame, uniforms: () => defU },
  });
  back.append(dw);

  function buildDef() {
    const g = attacker.g, u = g.u;
    const w = 2 * O.dhw, h = g.slabH, x = O.dcx - O.dhw, top = g.slabTop;
    const dy = g.dieY - top, dcY = g.dcY - top, cham = g.cham;
    D = { w, h, x, top, dy, dcY, u, size: g.size };
    // turned so no seam runs straight down through the DC plate under the impact
    dgeo = shardGeometry({ slabW: w, slabH: h, dx: w / 2, dy, size: g.size }, 0.8);
    const i = 9 * u, c = cham + 2 * u, mr = 0.34 * g.size;
    const P = [[w / 2, dy - mr * 1.9], [w / 2 + mr * 1.35, dy], [w / 2, dy + mr * 1.9], [w / 2 - mr * 1.35, dy]];
    // a tall lozenge around the medallion, its own ruler down the face that looks at the roller
    let lines = poly([[i + c * 0.62, i], [w - i - c * 0.62, i], [w - i, i + c * 0.62], [w - i, h - i], [i, h - i], [i, i + c * 0.62]], true);
    lines += poly(P, true) + circ(w / 2, dy, mr * 1.12) + circ(w / 2, dy, mr * 1.22);
    lines += seg([w / 2, dy + mr * 1.9], [w / 2, h - i]) + seg([w / 2, dy - mr * 1.9], [w / 2, dy - mr * 2.6]);
    let marks = "";
    for (let r = g.rSpan[0]; r <= g.rSpan[1]; r++) {
      const y = g.dcY - (r + 0.5) * g.ppu - top;
      if (y < cham + 12 * u || y > h - i - 2) continue;
      marks += seg([i + 4 * u, y], [i + 4 * u + (r % 5 === 0 ? 14 : 6) * u, y]);
    }
    for (const p of P) marks += circ(p[0], p[1], 2.4 * u);
    const all = lines + marks;
    const lit = `<path class="glsr-mono-halo" d="${all}"/><path class="glsr-mono-core" d="${all}"/>`;
    const svg = (cls, inner) => `<svg class="glsr-mono-eng ${cls}" viewBox="0 0 ${f1(w)} ${f1(h)}" width="${f1(w)}" height="${f1(h)}" aria-hidden="true">${inner}</svg>`;
    const out = poly([[cham, 1.5], [w - cham, 1.5], [w - 1.5, cham], [w - 1.5, h - 1.5], [1.5, h - 1.5], [1.5, cham]], true);
    const ph = Math.max(84 * u, 78);
    const hid = hiddenAtMount();
    const dcv = dmodel.dc?.value ?? def.dc ?? "";
    dmon.innerHTML = `
      <div class="glsr-mono-slab glsr-mono-dslab" style="left:${f1(x)}px;top:${f1(top)}px;width:${f1(w)}px;height:${f1(h)}px">
        <div class="glsr-mono-glass"></div>
        <div class="glsr-mono-fill"><i class="glsr-mono-meniscus"></i></div>
        ${svg("is-carved", `<path class="glsr-mono-etch" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="0" d="${lines}"/><path class="glsr-mono-mark" d="${marks}"/>`)}
        ${svg("is-lit", lit)}
        ${svg("is-ignite", lit)}
        <div class="glsr-mono-cold"></div>
        ${svg("is-crackset", crackSvg(dgeo))}
        <header class="glsr-mono-dhead">
          <div class="glsr-mono-kicker">${esc(t("GLSR.label.defendsWith"))}</div>
          <div class="glsr-mono-dstat">${esc(stat)}</div>
        </header>
        <div class="glsr-mono-dmedal" style="top:${f1(dy)}px">${def.actor?.img ? `<img alt="" src="${esc(def.actor.img)}">` : ""}</div>
        ${hasDc() ? `<div class="glsr-mono-dline-in" style="top:${f1(dcY)}px"><i${hid ? ' style="transform:scaleX(0)"' : ""}></i></div>
        <div class="glsr-mono-dcart" style="top:${f1(dcY + 14 * u)}px">
          <span class="glsr-mono-cart-k">${esc(t("GLSR.dc"))}</span>
          <span class="glsr-mono-cart-v">${hid ? `<b class="glsr-mono-seal"><i></i><i></i><i></i></b>` : ""}<b class="glsr-mono-cart-num"${hid ? ' style="clip-path:inset(0 100% 0 0)"' : ""}>${esc(dcv)}</b></span>
        </div>` : ""}
        <div class="glsr-mono-dword" style="top:${f1(dcY + Math.max(64, 92 * u))}px"></div>
        <svg class="glsr-mono-outline" viewBox="0 0 ${f1(w)} ${f1(h + 1)}" width="${f1(w)}" height="${f1(h + 1)}" aria-hidden="true"><path class="glsr-mono-edge" d="${out}"/></svg>
      </div>
      <div class="glsr-mono-plinth is-compact glsr-mono-dplinth" style="left:${f1(x)}px;top:${f1(g.slabBottom)}px;width:${f1(w)}px;min-height:${f1(ph)}px">
        <div class="glsr-mono-plinth-glass"></div>
        <div class="glsr-mono-cplinth"><div class="glsr-mono-cname">${esc(def.actor?.name)}</div><div class="glsr-mono-cfort">${esc(def.actor?.title)}</div></div>
      </div>
      <div class="glsr-mono-shards"></div>`;
    // the DC line is cast FROM the defender across the gap to the roller's slab
    dsink.querySelector(".glsr-mono-cast")?.remove();
    if (hasDc()) {
      const castX = g.slabX + g.slabW;
      const cast = el("div", "glsr-mono-cast");
      cast.style.cssText = `left:${f1(castX)}px;top:${f1(g.dcY)}px;width:${f1(x - castX)}px`;
      cast.innerHTML = `<i${hid ? ' style="transform:scaleX(0)"' : ""}></i>`;
      dsink.append(cast);
    }
    for (const [k, v] of [["--glsr-mono-u", u.toFixed(4)], ["--glsr-mono-cham", `${f1(cham)}px`], ["--glsr-mono-slab-h", `${f1(h)}px`], ["--glsr-mono-slab-w", `${f1(w)}px`],
      ["--glsr-mono-dx", `${f1(w / 2)}px`], ["--glsr-mono-dy", `${f1(dy)}px`], ["--glsr-mono-size", `${f1(g.size)}px`], ["--glsr-mono-ig", "0px"], ["--glsr-mono-igk", "0"], ["--glsr-mono-cold", "0"],
      ["--glsr-mono-pivot-x", `${f1(O.dcx)}px`], ["--glsr-mono-pivot-y", `${f1(g.dieY)}px`]]) dvar(k, v);
    // a DC already shown is already held: the defender's light stands at its line
    dvar("--glsr-mono-fy", `${f1(hid ? h + 4 : dcY)}px`);
    dvar("--glsr-mono-fillk", hid ? "0" : "1");
    dvar("--glsr-mono-dk", hid ? "0.3" : "1");
    defU = {};
  }
  buildDef();

  /** The defender answers on the roller's own clock. */
  function defFrame(ms, { b, v, dt, g, deg, base }) {
    const ppu = g.ppu;
    // held light: the DC line once it is known (rising into place at the unveiling)
    const named = dmodel.dc?.value != null || !hiddenAtMount();
    const known = !named ? 0 : hiddenAtMount() ? (b.dcReveal != null ? clamp01((ms - b.dcReveal - 160 * env.M) / (620 * env.M)) : 1) : 1;
    let fy = D.dcY + (1 - outQuart(known)) * (D.h + 4 - D.dcY);
    // the roller's light pushes it down point for point once it crosses the line
    const over = base == null ? 0 : Math.max(0, v - (g.dc - 0.5));
    if (!(dt >= 0 && deg === 3)) fy += Math.min(over, 12) * ppu * (dt >= 0 && deg != null && deg <= 1 ? 1 - outQuart(dt / (700 * env.M)) : 1);
    let k = 0.3 + 0.7 * known, flare = 0, crackT = -1, fall = 0, cold = 0;
    if (dt >= 0 && deg != null) {
      if (deg === 3) { crackT = dt / 1000; fall = clamp01((dt - 1400 * env.M) / (1500 * env.M)); fy += (D.h - fy) * outQuart((dt - 160 * env.M) / (1000 * env.M)); k = 1 - 0.7 * clamp01(dt / (900 * env.M)); }
      if (deg === 2) { k = 1 - 0.55 * clamp01(dt / (900 * env.M)); cold = 0.6 * clamp01(dt / (1200 * env.M)); fy += 3.5 * ppu * outQuart(dt / (800 * env.M)); }
      if (deg === 1) { k = 1 + 0.5 * Math.exp(-dt / (900 * env.M)); flare = 0.5 * Math.exp(-dt / (1600 * env.M)); }
      if (deg === 0) { k = 1.3 + 0.6 * Math.exp(-dt / (900 * env.M)); flare = 0.4 + 0.8 * Math.exp(-dt / (1200 * env.M)); }
    }
    dvar("--glsr-mono-fy", `${f1(Math.max(-6, Math.min(D.h + 4, fy)))}px`);
    dvar("--glsr-mono-fillk", known > 0 ? "1" : "0");
    dvar("--glsr-mono-dk", k.toFixed(3));
    dvar("--glsr-mono-cold", cold.toFixed(3));
    const igOn = dt >= 0 && (deg === 0 || deg === 1);
    dvar("--glsr-mono-ig", `${f1(igOn ? Math.hypot(D.w, D.h) * outQuart(dt / ((deg === 0 ? 700 : 1400) * env.M)) : 0)}px`);
    dvar("--glsr-mono-igk", igOn ? (deg === 0 ? "1" : "0.5") : "0");
    dw.dataset.monoHeld = over > 0 && !(dt >= 0 && deg >= 2) ? "pushed" : "held";
    defU = { uDefCol: env.DEFENDER, uDefK: k * (deg === 3 && dt >= 0 ? 1 - fall : 1), uDefCrackT: crackT, uDefFall: fall, uDefFlare: flare };
  }

  function defThrow(tl, { b, d, add, model: m, deg }) {
    dmodel = m;
    const slab = dmon.querySelector(".glsr-mono-dslab");
    if (m.dc?.value != null) dmon.querySelectorAll(".glsr-mono-cart-num").forEach((e) => { e.textContent = String(m.dc.value); });
    if (b.dcReveal != null && m.dc?.value != null) {
      const R0 = b.dcReveal;
      add(dmon.querySelectorAll(".glsr-mono-seal i"), { scaleX: [1, 0], opacity: [1, 0], duration: d(220), ease: "inQuad", delay: env.anime.stagger(d(30)) }, R0);
      add(dmon.querySelectorAll(".glsr-mono-cart-num"), { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"], duration: d(300), ease: "inOutQuad" }, R0 + d(120));
      add(dmon.querySelectorAll(".glsr-mono-dline-in i"), { scaleX: [0, 1], duration: d(380), ease: "outExpo" }, R0 + d(140));
      add(dw.querySelectorAll(".glsr-mono-cast i"), { scaleX: [0, 1], duration: d(460), ease: "outExpo" }, R0 + d(300));
      add(dmon.querySelectorAll(".glsr-mono-dcart"), { scale: [1, 1.1, 1], duration: d(380), ease: "outQuad" }, R0 + d(380));
    }
    const Dg = b.degree;
    const word = dmon.querySelector(".glsr-mono-dword");
    word.textContent = deg == null ? "" : t(WORDS[deg]);
    if (deg != null) add(word, { opacity: [0, 1], letterSpacing: ["0.8em", "0.32em"], duration: d(620), ease: "outExpo" }, Dg + d(260));
    if (deg === 3) crackInto(env, tl, { slab, shardsEl: dmon.querySelector(".glsr-mono-shards"), geo: dgeo, slabX: D.x, slabTop: D.top, u: D.u, D: Dg + d(120) });
    if (deg === 0 || deg === 1) add(dmon.querySelectorAll(".glsr-mono-dmedal"), { scale: [1, 1.08, 1], duration: d(deg === 0 ? 700 : 900), ease: "outQuad" }, Dg + d(120));
    if (deg === 2) add(dmon.querySelectorAll(".glsr-mono-dmedal"), { translateY: [0, 6 * D.u], opacity: [1, 0.6], duration: d(900), ease: "outQuad" }, Dg + d(160));
    tl.add(dsink, { translateY: [0, (globalThis.innerHeight ?? 900) * 0.55], duration: b.end - b.out, ease: "inCubic" }, b.out)
      .add(dsink, { opacity: [1, 0], duration: b.end - b.out, ease: "inQuad" }, b.out);
  }

  const arrive = anime.createTimeline({ autoplay: false, defaults: { ease: "outQuart" } });
  attacker.addArrive(arrive);
  const dParts = () => dmon.querySelectorAll(".glsr-mono-dhead, .glsr-mono-dmedal, .glsr-mono-dcart, .glsr-mono-dplinth .glsr-mono-cplinth");
  arrive.set(drise, { opacity: 0 }, 0)
    .set(dParts(), { opacity: 0 }, 0)
    .add(drise, { translateY: [(globalThis.innerHeight ?? 900) * 0.62, 0], duration: 820 * env.AM, ease: "outQuart" }, 140)
    .add(drise, { opacity: [0, 1], duration: 260 * env.AM, ease: "linear" }, 140)
    .add(dParts(), { opacity: [0, 1], translateY: [6, 0], duration: 360, delay: anime.stagger(70) }, 880);
  const castI = dw.querySelectorAll(".glsr-mono-cast i");
  if (!hiddenAtMount() && castI.length) arrive.add(castI, { scaleX: [0, 1], duration: 420, ease: "outExpo" }, 960);

  const off = onResize(() => { if (!attacker.beats) { O = layout(); attacker.relayout(); buildDef(); } });

  return {
    arrive,
    throwTimeline: (b, m) => attacker.throwTimeline(b, m),
    frame: (ms, info) => attacker.frame(ms, info),
    uniforms: () => attacker.uniforms(),
    dieAnchor: () => attacker.anchor(),
    lights: (ms, info) => attacker.lights(ms, info),
    update: (m) => { dmodel = m; attacker.update(m); if (!attacker.beats) buildDef(); },
    destroy() { off(); arrive.revert(); attacker.destroy(); dw.remove(); env.cb.remove(); clearRootVars(root); },
  };
}

/* ── the overlay ───────────────────────────────────────────────────────── */

export default {
  id: "monolith",
  /** An i18n key: the host localises it where it lists overlays. */
  label: "GLSR.direction.monolith",
  fragment: FRAGMENT,

  mount(ctx) {
    const req = ctx.request ?? { layout: "single", rolls: [ctx.model] };
    const env = makeEnv(ctx);
    if (req.layout === "group" && req.rolls.length > 1) return mountGroup(ctx, env, req);
    if (req.layout === "opposed" && req.defender) return mountOpposed(ctx, env, req);
    return mountSingle({ ...ctx, model: req.rolls?.[0] ?? ctx.model }, env);
  },
};
