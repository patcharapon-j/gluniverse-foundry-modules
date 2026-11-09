/**
 * Driving a drawn rail. Each setter touches only the nodes whose state
 * changed, so a Hit Point lost restyles one meter and nothing else on the
 * rail lays out. Values only: what a value is, is shape.mjs's call.
 *
 * DOM, but no `game`: the preview page drives these exactly as Foundry will.
 * `framePlinth` is the one gesture that lives here, because it moves a
 * picture and reports three numbers; what those numbers are written to is
 * the host's business.
 */
import { LOW_HEALTH_AT, TIMING } from "./const.mjs";
import { scaledMs } from "../../core/theme.mjs";

const frac = (v, max) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);

/* A motion token, read off the element so the user's motion tier (which
   scales every `--gl-d-*`) reaches the JS-driven tweens too. */
export function token(el, name, fallback) {
  const v = el ? getComputedStyle(el).getPropertyValue(name).trim() : "";
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith("ms") ? n : n * 1000) : fallback;
}

/* Count a numeral from what it shows to `to` over the swift beat, easing
   out, so a number that moves is seen to move. */
const tweens = new WeakMap();
function countTo(node, to) {
  const from = parseInt(node.textContent, 10);
  cancelAnimationFrame(tweens.get(node));
  if (!Number.isFinite(from) || from === to) { node.textContent = to; return; }
  const dur = token(node, "--gl-d-swift", 340);
  if (dur <= 0) { node.textContent = to; return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
    node.textContent = Math.round(from + (to - from) * e);
    if (k < 1) tweens.set(node, requestAnimationFrame(step));
  };
  tweens.set(node, requestAnimationFrame(step));
}

/** Drive a meter (`[data-meter]`) to `{ value, max, temp }`. A loss leaves
 *  the chip trail (`--gph-was` drains after the fill, by its transition's
 *  delay); a gain has none, and the fill sweeps up from green instead. */
export function setMeter(el, m) {
  if (!el || !m) return;
  const max = +el.dataset.max || m.max;
  const was = parseFloat(el.style.getPropertyValue("--gph-v")) || 0;
  const v = frac(m.value, max);
  if (v > was + 1e-4) {
    el.removeAttribute("data-heal"); void el.offsetWidth; el.setAttribute("data-heal", "");
    clearTimeout(el._gphHeal); el._gphHeal = setTimeout(() => el.removeAttribute("data-heal"), token(el, "--gl-d-glide", 540));
  }
  el.style.setProperty("--gph-v", v.toFixed(4));
  el.style.setProperty("--gph-was", v.toFixed(4));
  el.style.setProperty("--gph-tmp", frac(m.temp ?? 0, max).toFixed(4));
  if (el.dataset.meter === "hp") el.toggleAttribute("data-state", max > 0 && m.value / max <= LOW_HEALTH_AT);
  if (el.hasAttribute("data-state")) el.dataset.state = "low";
  for (const n of el.querySelectorAll("[data-v]")) countTo(n, m.value);
  const tmp = el.querySelector("[data-tmp]");
  if (tmp) {
    tmp.hidden = !m.temp;
    tmp.textContent = tmp.textContent.replace(/\d+/, String(m.temp ?? 0));
  }
  el.querySelector(".gph-bar")?.setAttribute("aria-valuenow", m.value);
}

/** Drive the Hero Point gems. Lighting one is an event, so the gem that
 *  changes plays its landing. */
export function setHero(rail, cur) {
  const gems = [...rail.querySelectorAll(".gph-gem")];
  if (!gems.length) return;
  const moving = [];
  gems.forEach((g, i) => {
    const on = i < cur;
    if (g.classList.contains("on") === on) return;
    g.classList.remove("land", "drop");
    moving.push([g, on]);
  });
  if (moving.length) void rail.offsetWidth;
  for (const [g, on] of moving) {
    g.classList.toggle("on", on);
    g.classList.add(on ? "land" : "drop");
    g.setAttribute("aria-pressed", String(on));
  }
  const sr = rail.querySelector("[data-hero-n]");
  if (sr) sr.textContent = sr.textContent.replace(/\d+/, String(cur));
}

/** Drive the shield press: its HP and whether it is raised. */
export function setShield(rail, s, raisedLabel, raiseLabel) {
  const b = rail.querySelector(".gph-shd");
  if (!b || !s) return;
  b.querySelector("[data-v]").textContent = s.hp;
  if (b.dataset.state === "broken" || b.dataset.state === "destroyed") return;
  b.setAttribute("aria-pressed", String(s.raised));
  if (s.raised) b.dataset.state = "raised"; else delete b.dataset.state;
  const em = b.querySelector("em");
  if (em && raisedLabel && raiseLabel) em.textContent = s.raised ? raisedLabel : raiseLabel;
}

/** Drive a foe card's Hit Point line. */
export function setFoe(rail, id, [v, max]) {
  const card = rail.querySelector(`[data-foe="${CSS.escape(id)}"]`);
  if (!card) return;
  card.style.setProperty("--gph-f", frac(v, max).toFixed(4));
  card.toggleAttribute("data-low", max > 0 && v / max <= LOW_HEALTH_AT);
}

/** Drive a party seat. The ring is a dash, so a change of length is one
 *  property and composites; the sentence a screen reader gets moves with it. */
export function setSeat(rail, id, { hp, temp = 0, hero }) {
  const seat = rail.querySelector(`[data-seat="${CSS.escape(id)}"]`);
  if (!seat) return;
  if (hp) {
    seat.style.setProperty("--gph-f", frac(hp[0], hp[1]).toFixed(4));
    seat.style.setProperty("--gph-tf", frac(temp, hp[1]).toFixed(4));
    seat.toggleAttribute("data-low", hp[1] > 0 && hp[0] / hp[1] <= LOW_HEALTH_AT);
    const v = seat.querySelector("[data-v]");
    if (v) v.textContent = hp[0];
  }
  if (hero != null) seat.querySelectorAll(".gph-shero i").forEach((g, i) => g.classList.toggle("on", i < hero));
  const label = seat.getAttribute("aria-label") ?? "";
  if (hp) seat.setAttribute("aria-label", label.replace(/\d+(?=\s*\/\s*\d+|\s+of\s+\d+)/, String(hp[0])));
}

/** Drive the folded rail's Hit Point numeral on the plinth. */
export function setFoldHp(rail, hp) {
  const b = rail.querySelector("[data-fold-hp] b");
  if (b && hp) countTo(b, hp[0]);
}

/** Damage is felt the way a Hero Point is: when Hit Points are lost the
 *  figure takes the hit, a short recoil and a red pass up from its foot. */
export function flinch(rail) {
  const p = rail.querySelector("[data-plinth]");
  if (!p) return;
  p.classList.remove("is-hit"); void p.offsetWidth; p.classList.add("is-hit");
}

/** Drive the turn bar: the actions left, the reaction, the MAP step. A
 *  diamond going out plays its drain; the strikes' marker slides on its own
 *  (`--gph-map` is registered and transitioned). */
export function setEcon(rail, econ, map) {
  const root = rail.closest(".gph") ?? rail;
  if (map != null) {
    root.dataset.map = String(map);
    root.style.setProperty("--gph-map", String(map));
    const n = root.querySelector("[data-map-n]");
    if (n) n.textContent = ["0", "−5", "−10"][map] ?? n.textContent;
  }
  if (!econ) return;
  const bar = root.querySelector("[data-turnbar]");
  if (!bar) return;
  bar.dataset.left = String(econ.left);
  for (const p of bar.querySelectorAll(".gph-pip")) {
    const on = p.dataset.pip === "r" ? econ.reaction : +p.dataset.pip < econ.left;
    if (p.classList.contains("on") === on) continue;
    p.classList.toggle("on", on);
    p.setAttribute("aria-pressed", String(on));
    if (!on) { p.classList.remove("is-drain"); void p.offsetWidth; p.classList.add("is-drain"); }
  }
}

/** The turn comes round: the edge sweeps and the diamonds light in turn. */
export function ignite(rail) {
  const bar = (rail.closest(".gph") ?? rail).querySelector("[data-turnbar]");
  if (!bar) return;
  bar.classList.remove("is-igniting"); void bar.offsetWidth; bar.classList.add("is-igniting");
  clearTimeout(bar._gphIgnite);
  bar._gphIgnite = setTimeout(() => bar.classList.remove("is-igniting"), token(bar, "--gl-d-cinematic", 1200));
}

/** The roll echo: the press that rolled shows the total on the degree's
 *  tone (0 critical failure … 3 critical success), then lets go. Only for a
 *  roll this viewer can see: the host decides that, never this. */
export function echo(button, { total, degree, word = "" }) {
  if (!button) return;
  button.querySelector(":scope > .gph-echo")?.remove();
  const e = document.createElement("span");
  e.className = "gph-echo";
  e.setAttribute("aria-hidden", "true");
  if (degree != null) e.dataset.degree = String(degree);
  e.append(String(total));
  if (word) { const i = document.createElement("i"); i.textContent = word; e.append(i); }
  button.setAttribute("data-echo", "");
  button.append(e);
  e.addEventListener("animationend", () => { e.remove(); if (!button.querySelector(".gph-echo")) button.removeAttribute("data-echo"); }, { once: true });
}

/** After the deck is redrawn on another tab, let its marker travel from the
 *  tab it left and the new pane rise in. */
export function travelTab(rail, from) {
  const tabs = (rail.closest(".gph") ?? rail).querySelector(".gph-tabs");
  if (!tabs || from == null) return;
  const to = tabs.style.getPropertyValue("--gph-tab");
  if (String(from) === to) return;
  tabs.style.setProperty("--gph-tab", String(from));
  void tabs.offsetWidth;
  tabs.style.setProperty("--gph-tab", to);
  tabs.parentElement.querySelector(".gph-pane")?.classList.add("is-swapped");
}

/** A spell is cast: its card leaves the hand upward. Resolves when it has,
 *  so the host redraws the hand after, not under, the card. */
export function castCard(card) {
  const held = card?.closest(".gph-held");
  if (!held) return Promise.resolve();
  return new Promise((done) => {
    held.classList.add("is-cast");
    held.addEventListener("animationend", () => done(), { once: true });
    setTimeout(done, token(held, "--gl-d-glide", 540) + 100);
  });
}

/** The finder's selection, redrawn on another chip, slides there from where
 *  it was: a ring travels the gap on the tap beat while the chip's own
 *  outline waits. `from` is the old chip's rect (getBoundingClientRect). */
export function slideSel(finder, from, zoom = 1) {
  const to = finder?.querySelector(".gph-fa.is-sel");
  if (!to || !from) return;
  const fr = finder.getBoundingClientRect(), tr = to.getBoundingClientRect();
  if (Math.abs(tr.top - from.top) < 1 && Math.abs(tr.left - from.left) < 1) return;
  const box = (r) => ({ left: `${(r.left - fr.left) / zoom}px`, top: `${(r.top - fr.top) / zoom}px`, width: `${r.width / zoom}px`, height: `${r.height / zoom}px` });
  const ring = document.createElement("i");
  ring.className = "gph-selring";
  Object.assign(ring.style, box(tr));
  finder.append(ring);
  finder.classList.add("is-sliding");
  const done = () => { ring.remove(); finder.classList.remove("is-sliding"); };
  const a = ring.animate?.([box(from), box(tr)], { duration: token(finder, "--gl-d-tap", 120), easing: getComputedStyle(finder).getPropertyValue("--gl-ease").trim() || "ease-out" });
  if (a) a.onfinish = a.oncancel = done; else done();
}

/** Drive everything `liveOf` returned. */
export function drive(rail, live, labels = {}) {
  if (live.hero != null) setHero(rail, live.hero);
  if (live.frame !== undefined) setFrame(rail.querySelector("[data-plinth]"), live.frame ?? FRAME0);
  if (live.foldHp) setFoldHp(rail, live.foldHp);
  if (live.hp) setMeter(rail.querySelector('.gph-life [data-meter="hp"], .gph-npct [data-meter="hp"]'), live.hp);
  if (live.sp) setMeter(rail.querySelector('[data-meter="sp"]'), live.sp);
  if (live.shield) setShield(rail, live.shield, labels.raised, labels.raise);
  if (live.econ || live.map != null) setEcon(rail, live.econ, live.map);
  for (const [id, hp] of Object.entries(live.foes ?? {})) setFoe(rail, id, hp);
  for (const [id, s] of Object.entries(live.seats ?? {})) setSeat(rail, id, s);
}

/* ── framing the portrait ─────────────────────────────────────────
   Drag pans, the wheel zooms multiplicatively, a double-click puts it back,
   and Enter, Escape or a press anywhere off the plinth puts the gesture
   down. Each finished drag, each settled zoom and the exit report the frame
   through `onCommit`, so a picture placed and then left is still saved. The
   offsets are percent of the figure's own box (translate percentages), so a
   pixel of pointer is a pixel of picture at any zoom. */
export const FRAME0 = Object.freeze({ x: 0, y: 0, scale: 1 });
const r2 = (n) => Math.round(n * 100) / 100;

export function setFrame(plinth, f) {
  if (!plinth) return;
  plinth.style.setProperty("--fdx", String(+f.x || 0));
  plinth.style.setProperty("--fdy", String(+f.y || 0));
  plinth.style.setProperty("--fz", String(+f.scale || 1));
}

export function framePlinth(plinth, start, { onCommit, onExit } = {}) {
  let f = { ...FRAME0, ...(start ?? {}) };
  let wheelT = 0;
  let endDrag = null;
  const fig = plinth.querySelector(".gph-fig") ?? plinth;
  const commit = () => { clearTimeout(wheelT); wheelT = 0; onCommit?.({ ...f }); };
  plinth.setAttribute("data-framing", "");
  setFrame(plinth, f);

  const down = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault(); e.stopPropagation();
    const r = fig.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY, from = { ...f };
    const move = (ev) => {
      f = { ...from, x: r2(from.x + ((ev.clientX - x0) / r.width) * 100), y: r2(from.y + ((ev.clientY - y0) / r.height) * 100) };
      setFrame(plinth, f);
    };
    const up = () => {
      plinth.removeEventListener("pointermove", move);
      plinth.removeEventListener("pointerup", up);
      plinth.removeEventListener("pointercancel", up);
      if (plinth.hasPointerCapture?.(e.pointerId)) plinth.releasePointerCapture(e.pointerId);
      endDrag = null;
      commit();
    };
    endDrag = up;
    plinth.setPointerCapture?.(e.pointerId);
    plinth.addEventListener("pointermove", move);
    plinth.addEventListener("pointerup", up);
    plinth.addEventListener("pointercancel", up);
  };
  const wheel = (e) => {
    e.preventDefault(); e.stopPropagation();
    f = { ...f, scale: Math.round(Math.min(8, Math.max(0.1, f.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) * 1000) / 1000 };
    setFrame(plinth, f);
    clearTimeout(wheelT); wheelT = setTimeout(commit, TIMING.frameSettle);
  };
  const reset = (e) => { e.preventDefault(); f = { ...FRAME0 }; setFrame(plinth, f); commit(); };
  const key = (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(); } };
  const outside = (e) => { if (!plinth.contains(e.target)) stop(); };

  plinth.addEventListener("pointerdown", down);
  plinth.addEventListener("wheel", wheel, { passive: false });
  plinth.addEventListener("dblclick", reset);
  document.addEventListener("keydown", key, true);
  document.addEventListener("pointerdown", outside, true);

  let live = true;
  function stop() {
    if (!live) return;
    live = false;
    plinth.removeEventListener("pointerdown", down);
    plinth.removeEventListener("wheel", wheel);
    plinth.removeEventListener("dblclick", reset);
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("pointerdown", outside, true);
    plinth.removeAttribute("data-framing");
    if (endDrag) endDrag();
    else if (wheelT) commit();
    onExit?.({ ...f });
  }
  return stop;
}

/* ── placing a drawer and a peek ──────────────────────────────────
   Both are measured at the moment they open, in the rail's own unscaled
   pixels (`zoom` is Foundry's Interface Scale, or the preview's fit). A
   drawer stands over the tiles that opened it; a peek over the thing it is a
   peek of, held inside the rail's width. */
export function placeDrawer(root, zoom = 1) {
  const nav = root?.querySelector(".gph-util") ?? root?.querySelector(".gph-deck");
  if (!nav) return;
  const rr = root.getBoundingClientRect(), nr = nav.getBoundingClientRect();
  root.style.setProperty("--gph-drawer-r", `${Math.max(0, Math.round((rr.right - nr.right) / zoom))}px`);
}

export function placePeek(root, anchor, peek, zoom = 1) {
  if (!root || !anchor || !peek) return;
  const rr = root.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
  const w = peek.offsetWidth || 280;
  const x = Math.max(0, Math.min(rr.width / zoom - w, ((ar.left + ar.right) / 2 - rr.left) / zoom - w / 2));
  /* It stands clear of its plate and of anything risen over the plate under
     it (the turn bar on the strikes), never on top of them. */
  let top = Math.min(ar.top, anchor.closest(".gph-pl")?.getBoundingClientRect().top ?? ar.top);
  const bar = root.querySelector("[data-turnbar]")?.getBoundingClientRect();
  const px0 = rr.left + x * zoom, px1 = px0 + w * zoom;
  if (bar && bar.right > px0 && bar.left < px1) top = Math.min(top, bar.top);
  peek.style.setProperty("--gph-peek-x", `${Math.round(x)}px`);
  peek.style.setProperty("--gph-peek-y", `${Math.round((rr.bottom - top) / zoom + 8)}px`);
}

/* ── the moments (moments.mjs decides; these play) ────────────────
   Each restarts a class whose CSS animation is the moment and takes it off
   once that animation has had its length, so the next one plays from the
   start. The lengths are the CSS's own tokens, scaled by the motion tier. */
function restart(el, cls, ms) {
  if (!el) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  el._gphMoment ??= {};
  clearTimeout(el._gphMoment[cls]);
  el._gphMoment[cls] = setTimeout(() => el.classList.remove(cls), ms);
}
const rootOf = (rail) => rail?.closest?.(".gph") ?? rail;

/** You are up next: the turn bar knocks once, and its tag pops. */
export function callUp(rail) {
  const root = rootOf(rail);
  restart(root?.querySelector("[data-turnbar]"), "is-calling", scaledMs(920, root));
}

/** A creature's turn, on the GM's rail: its card rises out of the hand. */
export function callCard(rail, id) {
  const root = rootOf(rail);
  restart(root?.querySelector(`[data-foe="${CSS.escape(String(id))}"]`), "is-called", scaledMs(920, root));
}

/** A Hero Point is spent: the gem that went out cracks, and where a roll was
 *  just echoed (`at`, the press a reroll answers) its light streaks there. */
export function spendHero(rail, { from, to }, at = null) {
  const root = rootOf(rail);
  const gems = [...(root?.querySelectorAll(".gph-gem") ?? [])];
  const gem = gems[Math.min(from, gems.length) - 1];
  if (!gem || to >= from) return;
  gem.classList.remove("drop");
  restart(gem, "crack", scaledMs(620, root));
  if (!at?.isConnected || !root.contains(at)) return;
  const rr = root.getBoundingClientRect(), z = rr.width / (root.offsetWidth || rr.width) || 1;
  const a = gem.getBoundingClientRect(), b = at.getBoundingClientRect();
  const x0 = (a.left + a.width / 2 - rr.left) / z, y0 = (a.top + a.height / 2 - rr.top) / z;
  const x1 = (b.left + b.width / 2 - rr.left) / z, y1 = (b.top + b.height / 2 - rr.top) / z;
  const dur = scaledMs(540, root);
  const land = () => restart(at, "is-heroic", scaledMs(620, root));
  if (!dur || !globalThis.Element?.prototype.animate) { land(); return; }
  const s = document.createElement("i");
  s.className = "gph-streak";
  s.setAttribute("aria-hidden", "true");
  Object.assign(s.style, { left: `${x0}px`, top: `${y0}px`, width: `${Math.hypot(x1 - x0, y1 - y0)}px`, transform: `rotate(${Math.atan2(y1 - y0, x1 - x0)}rad)` });
  root.append(s);
  const easing = getComputedStyle(root).getPropertyValue("--gl-ease").trim() || "ease-out";
  const run = s.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 55%)", offset: 0.6 }, { clipPath: "inset(0 0 0 100%)" }], { duration: dur, easing, fill: "forwards" });
  setTimeout(land, dur * 0.5);
  run.onfinish = run.oncancel = () => s.remove();
}

/** A dying bead moves. One put out (a success, a heal) exhales pale; one lit
 *  (a failure, a hit while dying) burns red, and the rail's edges flicker. */
export function dyingBeat(rail, { from, to }) {
  const root = rootOf(rail);
  const beads = [...(root?.querySelectorAll(".gph-dying .gph-beads i") ?? [])];
  const ms = scaledMs(620, root);
  const [lo, hi] = to > from ? [from, to] : [to, from];
  for (let i = lo; i < hi && i < beads.length; i++) {
    beads[i].style.setProperty("--k", String(to > from ? i - lo : hi - 1 - i));
    restart(beads[i], to > from ? "is-burn" : "is-exhale", ms + 4 * scaledMs(70, root));
  }
  if (to > from) restart(root, "is-flicker", ms);
}
