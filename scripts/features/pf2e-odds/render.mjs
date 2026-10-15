/**
 * Drawing a badge model — the d20 strip (design variant C).
 *
 * Pure: no `game`, no `canvas`. Markup is built as strings (escaped) and
 * updated in place with plain DOM calls, so the preview page drives the very
 * same code the line badge, the sheet, the roll dialog and the save prompt do.
 * A preview built on a second copy flatters whichever copy was touched last.
 *
 * Text arrives through `t(key)`, an i18n function the caller supplies. Keys
 * are passed through it; anything that is not a key (a weapon name) comes back
 * from Foundry's localize unchanged.
 *
 * ## The beats
 *
 * `updateBadge` diffs the previous model against the next one instead of
 * re-rendering, because the two things worth watching are changes:
 *
 *   • NARROW — pips that were uncertain become certain. They resolve one at a
 *     time, staggered outward from the boundary that moved, and the headline
 *     counts from the old range to the new.
 *   • COLLAPSE — the range closes to exact. The resolve sweeps the whole strip
 *     and the plate takes a short amber rim.
 *
 * Every duration is a token in CSS; the stagger is TIMING.pipStagger scaled by
 * the motion scale, set as a custom property per pip.
 */

import { escapeHTML } from "../../core/util.mjs";
import { DEGREE_STAMP, TIMING } from "./constants.mjs";

const PIP_COUNT = 20;
const DEGREE = ["cf", "f", "s", "c"];

const ident = (k) => k;

/** "60%", "55–70%" → the number part and the unit, for split typography. */
function headlineParts(text) {
  if (!text) return null;
  const m = String(text).match(/^(\d+)(?:–(\d+))?%$/);
  if (!m) return { a: text, b: null };
  return { a: m[1], b: m[2] ?? null };
}

export function headlineHTML(model) {
  if (!model || model.state === "unknown") return `<span class="glod-pct glod-pct--unknown">???</span>`;
  const p = headlineParts(model.headline);
  if (!p) return `<span class="glod-pct glod-pct--unknown">???</span>`;
  return p.b == null
    ? `<span class="glod-pct"><span class="glod-pct-n">${escapeHTML(p.a)}</span><small>%</small></span>`
    : `<span class="glod-pct"><span class="glod-pct-n">${escapeHTML(p.a)}</span><small>–</small><span class="glod-pct-n">${escapeHTML(p.b)}</span><small>%</small></span>`;
}

/** One pip's attributes: a certain degree, or the two it could still be. */
function pipAttrs(face, unknown) {
  if (unknown) return `data-u="x"`;
  if (face.certain) return `data-d="${DEGREE[face.lo]}"`;
  return `data-u="${DEGREE[face.lo]}-${DEGREE[face.hi]}" style="--glod-lo:var(--glod-${DEGREE[face.lo]});--glod-hi:var(--glod-${DEGREE[face.hi]})"`;
}

export function stripHTML(model, { numbers = true } = {}) {
  const unknown = !model || model.state === "unknown";
  const faces = model?.odds?.faces ?? [];
  const pips = [];
  for (let i = 0; i < PIP_COUNT; i++) {
    const f = faces[i] ?? { lo: 0, hi: 3, certain: false };
    pips.push(`<i class="glod-pip" data-face="${i + 1}" ${pipAttrs(f, unknown)}></i>`);
  }
  const nums = numbers
    ? `<div class="glod-faces" aria-hidden="true">${Array.from({ length: PIP_COUNT }, (_, i) => `<span>${i + 1}</span>`).join("")}</div>`
    : "";
  return `<div class="glod-strip" role="img">${pips.join("")}</div>${nums}`;
}

function chipText(chip, t) {
  const label = t(chip.label);
  if (chip.key === "flat") return `${label} · ${t("GLOD.word.dc")} ${chip.flatDc} · ${Math.round((chip.chance ?? 0) * 100)}%`;
  if (chip.key === "fixed") return `${label} ${chip.value}`;
  if (chip.value == null) return label;
  const v = chip.value > 0 ? `+${chip.value}` : `−${Math.abs(chip.value)}`;
  return `${label} ${v}`;
}

export function chipsHTML(model, t = ident) {
  const chips = model?.chips ?? [];
  if (!chips.length) return "";
  return `<div class="glod-chips">${chips
    .map(
      (c) =>
        `<span class="glod-chip" data-tone="${escapeHTML(c.tone)}">${escapeHTML(chipText(c, t))}</span>`
    )
    .join("")}</div>`;
}

function degreeLine(model, t) {
  if (!model || model.state === "unknown") return `<span class="glod-deg glod-deg--unknown">${escapeHTML(t(model?.side === "mod" ? "GLOD.unseen.attack" : "GLOD.unseen.defence"))}</span>`;
  // Inverted (a save against the viewer's own spell): the headline is the
  // target doing WORSE than a success, and the second figure its critical failure.
  const words = model.invert ? ["GLOD.word.theyFail", "GLOD.word.critFail"] : model.stamps === "check" ? ["GLOD.word.success", "GLOD.word.crit"] : ["GLOD.word.hit", "GLOD.word.crit"];
  const dc = model.dcText ? `<span class="glod-dc">${escapeHTML(t(model.dcLabel ?? "GLOD.word.dc"))} ${escapeHTML(model.dcText)}</span>` : "";
  return `<span class="glod-deg"><b>${escapeHTML(t(words[0]))}</b><em>${escapeHTML(t(words[1]))} ${escapeHTML(model.crit ?? "")}</em>${dc}</span>`;
}

function gmHTML(model, t) {
  const gm = model?.gm;
  if (!gm) return "";
  const truth = gm.truth ? `${Math.round(gm.truth.lo * 100)}%` : "—";
  const theirs = !gm.players ? "???" : gm.playersExact ? t("GLOD.gm.exact") : `${Math.round(gm.players.lo * 100)}–${Math.round(gm.players.hi * 100)}%`;
  const flags = [gm.lie ? t("GLOD.gm.lie") : null, gm.contradiction ? t("GLOD.gm.reset") : null].filter(Boolean);
  return `<div class="glod-gm"><span>${escapeHTML(t("GLOD.gm.true"))} ${escapeHTML(truth)}</span><span>${escapeHTML(t("GLOD.gm.players"))} ${escapeHTML(theirs)}</span>${flags
    .map((f) => `<span class="glod-gm-flag">${escapeHTML(f)}</span>`)
    .join("")}</div>`;
}

/** The plate's heading: action · attack ordinal ›› target. */
function headHTML(model, t, target) {
  const title = [t(model.label), model.sub ? t(model.sub) : ""].filter(Boolean).join(" · ");
  return `<div class="glod-head"><span class="glod-title">${escapeHTML(title)}</span>${target ? `<span class="glod-arrow" aria-hidden="true">››</span><span class="glod-target">${escapeHTML(target)}</span>` : ""}</div>`;
}

/**
 * The full plate.
 * @param {object} model   view-model.mjs `buildModel` output
 * @param {{t?: Function, target?: string, numbers?: boolean, gm?: boolean}} [opts]
 */
export function badgeHTML(model, { t = ident, target = "", numbers = true, gm = true } = {}) {
  if (!model) return "";
  if (model.state === "oor") {
    return `<div class="glod-badge gl-type" data-state="oor"><div class="glod-head">${escapeHTML(t(model.label))}</div><div class="glod-oor">${escapeHTML(t("GLOD.outOfRange"))}</div></div>`;
  }
  const head = headHTML(model, t, target);
  return `<div class="glod-badge gl-type" data-state="${model.state}" data-stamps="${model.stamps}">${head}<div class="glod-row">${headlineHTML(model)}${degreeLine(model, t)}</div>${stripHTML(
    model,
    { numbers }
  )}${chipsHTML(model, t)}${gm ? gmHTML(model, t) : ""}<div class="glod-stamp" aria-live="polite"></div></div>`;
}

/** The collapsed tag a line wears off its roller's turn. */
export function compactHTML(model) {
  if (!model) return "";
  const text = model.state === "oor" ? "—" : model.headline ?? "???";
  return `<div class="glod-tag gl-type" data-state="${model.state}">${escapeHTML(text)}</div>`;
}

/** A sheet button's inline readout: the number and a bar under it. */
export function inlineHTML(model) {
  if (!model || model.state === "oor") return "";
  const lo = model.odds?.headline?.lo ?? 0;
  const hi = model.odds?.headline?.hi ?? 0;
  const text = model.state === "unknown" ? "???" : model.headline;
  return `<span class="glod-inline gl-type" data-state="${model.state}" style="--glod-lo-p:${Math.round(lo * 100)}%;--glod-hi-p:${Math.round(hi * 100)}%"><span class="glod-inline-n">${escapeHTML(text)}</span><span class="glod-inline-bar"></span></span>`;
}

/**
 * The ring and stamp drawn over a landed Dice So Nice d20. Positioned by the
 * caller through --glod-die-x/-y/-r; this is only the mark.
 * @param {{degree: number, stamps?: "attack"|"check"}} landing
 */
export function diceHTML(landing, { t = ident } = {}) {
  if (!landing || !Number.isInteger(landing.degree)) return "";
  const word = (DEGREE_STAMP[landing.stamps] ?? DEGREE_STAMP.attack)[landing.degree];
  const d = DEGREE[landing.degree];
  return `<div class="glod-dice-mark" data-d="${d}"><span class="glod-dice-ring"></span><span class="glod-dice-burst"></span><span class="glod-dice-tick"></span><span class="glod-dice-stamp">${escapeHTML(t(word))}</span></div>`;
}

/* ── in-place updates and the two beats ──────────────────────────────────── */

const pipKey = (p) => p.getAttribute("data-d") ?? `u:${p.getAttribute("data-u")}`;

/**
 * Update a mounted `.glod-badge` to a new model, playing the narrowing beat
 * where pips resolve. Falls back to a re-render when the badge's shape changed.
 *
 * @param {HTMLElement} el     the `.glod-badge`
 * @param {object} prev        the model it was drawn from
 * @param {object} next
 * @param {{t?: Function, target?: string, motion?: number, gm?: boolean}} [opts]
 */
export function updateBadge(el, prev, next, opts = {}) {
  const t = opts.t ?? ident;
  if (!el || !next || !prev || prev.state === "oor" || next.state === "oor" || prev.stamps !== next.stamps) {
    if (el) el.outerHTML = badgeHTML(next, opts);
    return "replaced";
  }
  const scale = Number.isFinite(opts.motion) ? opts.motion : 1;
  el.dataset.state = next.state;
  el.dataset.stamps = next.stamps;
  // The heading follows the action: a new weapon, the next MAP ordinal, a renamed target.
  const head = el.querySelector(".glod-head");
  if (head) head.outerHTML = headHTML(next, t, opts.target ?? "");

  // Headline: count from the old numbers to the new.
  const row = el.querySelector(".glod-row");
  if (row) {
    const fromNums = [...row.querySelectorAll(".glod-pct-n")].map((n) => Number(n.textContent));
    row.innerHTML = headlineHTML(next) + degreeLine(next, t);
    const to = [...row.querySelectorAll(".glod-pct-n")];
    if (scale > 0 && fromNums.length && to.length) countUp(to, fromNums, TIMING.count * scale);
  }

  // Pips: diff and stagger the ones that changed outward from the moved edge.
  const nextHtml = document.createElement("div");
  nextHtml.innerHTML = stripHTML(next, { numbers: false });
  const fresh = [...nextHtml.querySelectorAll(".glod-pip")];
  const pips = [...el.querySelectorAll(".glod-strip .glod-pip")];
  const moved = [];
  pips.forEach((p, i) => {
    if (fresh[i] && pipKey(p) !== pipKey(fresh[i])) moved.push(i);
  });
  const resolving = prev.state !== "exact" && next.state !== prev.state || moved.length;
  if (moved.length) {
    const centre = moved.reduce((a, b) => a + b, 0) / moved.length;
    const order = [...moved].sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
    order.forEach((i, rank) => {
      const p = pips[i];
      const f = fresh[i];
      for (const a of ["data-d", "data-u", "style"]) {
        if (f.hasAttribute(a)) p.setAttribute(a, f.getAttribute(a));
        else p.removeAttribute(a);
      }
      if (scale > 0) {
        p.style.setProperty("--glod-delay", `${Math.round(rank * TIMING.pipStagger * scale)}ms`);
        p.classList.remove("is-resolving");
        void p.offsetWidth;
        p.classList.add("is-resolving");
      }
    });
  }
  if (resolving && next.state === "exact" && prev.state !== "exact" && scale > 0) {
    el.classList.remove("is-collapsing");
    void el.offsetWidth;
    el.classList.add("is-collapsing");
  }

  // Chips and the GM line simply follow.
  const chips = el.querySelector(".glod-chips");
  const chipsNext = chipsHTML(next, t);
  if (chips) chips.outerHTML = chipsNext || "";
  else if (chipsNext) el.querySelector(".glod-faces, .glod-strip:last-of-type")?.insertAdjacentHTML("afterend", chipsNext);
  const gm = el.querySelector(".glod-gm");
  const gmNext = opts.gm === false ? "" : gmHTML(next, t);
  if (gm) gm.outerHTML = gmNext || "";
  else if (gmNext) el.querySelector(".glod-stamp")?.insertAdjacentHTML("beforebegin", gmNext);
  return moved.length ? "narrowed" : "updated";
}

function countUp(nodes, from, ms) {
  const to = nodes.map((n) => Number(n.textContent));
  const starts = nodes.map((_, i) => (Number.isFinite(from[i]) ? from[i] : from[0] ?? to[i]));
  if (starts.every((s, i) => s === to[i])) return;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    nodes.forEach((n, i) => {
      if (!n.isConnected) return;
      n.textContent = String(Math.round(starts[i] + (to[i] - starts[i]) * e));
    });
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * The landing beat: the face that came up pulses, and the plate shows the
 * degree stamp for TIMING.stampHold. (PR 2 wires it to Dice So Nice; the
 * chat card already carries the face.)
 */
export function playLanding(el, { face, degree, stamps = "attack", t = ident, motion = 1 }) {
  if (!el) return;
  const pip = el.querySelector(`.glod-strip .glod-pip[data-face="${face}"]`);
  if (pip && motion > 0) {
    pip.classList.remove("is-landed");
    void pip.offsetWidth;
    pip.classList.add("is-landed");
  }
  const stamp = el.querySelector(".glod-stamp");
  if (!stamp || !Number.isInteger(degree)) return;
  const keys = DEGREE_STAMP[stamps] ?? DEGREE_STAMP.attack;
  stamp.textContent = t(keys[degree]);
  stamp.dataset.d = DEGREE[degree];
  el.classList.add("is-stamped");
  clearTimeout(el._glodStamp);
  el._glodStamp = setTimeout(() => el.classList.remove("is-stamped"), Math.max(400, TIMING.stampHold * (motion || 1)));
}
