// The Spellsprite reference bench (tools/fx-reference.mjs writes the page; the spellsprite-craft skill
// says how to use it). Top pane: the shipped engine as it is. Bottom pane: the same compiled Sim (timing,
// area language, hits, shake, hitstop, impact frames) with its generated particles filtered out and the
// pixelfx reference effects (fetched to .reference/pixelfx, never committed) drawn in their place
// through our layers (outline, banded light, floors), so the two are judged on one event at one scale.
// pixelfx is side view: its floor rings read wrong top-down, which is the point of studying, not porting.

import { compile } from "/scripts/features/pf2e-fx/compile.mjs";
import { Layers } from "/scripts/features/pf2e-fx/core/pix.mjs";
import { topView, paintFrame } from "/scripts/features/pf2e-fx/core/frame.mjs";
import { Blit } from "/scripts/features/pf2e-fx/core/blit.mjs";
import { RAMP_HEX, S, css } from "/scripts/features/pf2e-fx/core/palette.mjs";
import { STEP } from "/scripts/features/pf2e-fx/core/sim.mjs";
import { createFx, createFrame, clearFrame } from "/.reference/pixelfx/src/core/index.js";

import * as fireball from "/.reference/pixelfx/src/fx/fire/fireball.js";
import * as bigExplosion from "/.reference/pixelfx/src/fx/explosions/big-explosion.js";
import * as smallExplosion from "/.reference/pixelfx/src/fx/explosions/small-explosion.js";
import * as spellCharge from "/.reference/pixelfx/src/fx/arcane/spell-charge.js";
import * as iceLance from "/.reference/pixelfx/src/fx/ice/ice-lance.js";
import * as iceShatter from "/.reference/pixelfx/src/fx/ice/ice-shatter.js";
import * as frostNova from "/.reference/pixelfx/src/fx/ice/frost-nova.js";
import * as chainLightning from "/.reference/pixelfx/src/fx/lightning/chain-lightning.js";
import * as zapHit from "/.reference/pixelfx/src/fx/lightning/zap-hit.js";
import * as swordSlash from "/.reference/pixelfx/src/fx/melee/sword-slash.js";
import * as critHit from "/.reference/pixelfx/src/fx/impacts/crit-hit.js";
import * as heal from "/.reference/pixelfx/src/fx/holy/heal.js";
import * as burning from "/.reference/pixelfx/src/fx/status/burning.js";

const APS = 26, WA = 340, HA = 176, K = 2;
const P = new URLSearchParams(location.search);

/* ── scenarios: one PF2e event each, as Spellsprite's compiler sees it ───────────────────────────────── */

const SEER = { id: "seri", x: 6.6, y: 6.1, size: 1, h: 1.3, ally: true, body: "#3d6ab0", skin: "#e8c6a6" };
const MEDIC = { id: "ana", x: 9.6, y: 6.4, size: 1, h: 1.2, ally: true, body: "#7a4a8a", skin: "#d8b08c" };
const gob = (id, x, y, body = "#6b5a3a", skin = "#7fa046") => ({ id, x, y, size: 1, h: 1, body, skin });

const SCENES = [
  {
    id: "fireball", name: "Fireball", note: "20-ft burst, rank 3 · one critical failure",
    cam: [11.6, 5.6],
    tokens: [SEER, gob("g1", 13.6, 6.0), gob("g2", 12.3, 4.6, "#5a4b36", "#76994a"), gob("g3", 15.0, 7.3, "#634c3a", "#88a84e")],
    spec: { kind: "area", func: "harm", material: "fire", rank: 3, tradition: "arcane", caster: "seri",
      targets: [["g1", "crit"], ["g2", "hit"], ["g3", "hit"]], area: { shape: "burst", x: 13.6, y: 6.0, r: 4 } },
    port(E, A) {
      const fire = fireball.meta.options.palette;
      return [
        A.atToken(spellCharge, E.charge0, E.release, "seri", { palette: fire, mat: "fire", actor: true }),
        A.path(fireball, E.orb, { palette: fire, mat: "fire", radius: 6 }),
        A.ground(bigExplosion, E.land, E.land + 2.6, 13.6, 6.0, { mat: "fire" }),
        ...A.erupt(smallExplosion, E, 13.6, 6.0, 4, 3, { size: 0.42, mat: "fire" }),
      ];
    },
  },
  {
    id: "frost", name: "Ray of Frost", note: "spell attack · hit",
    cam: [10.4, 5.8],
    tokens: [SEER, gob("g1", 13.2, 6.0)],
    spec: { kind: "attack", func: "harm", material: "cold", rank: 2, tradition: "arcane", caster: "seri", targets: [["g1", "hit"]], outcome: "hit" },
    port(E, A) {
      return [
        A.atToken(spellCharge, E.charge0, E.release, "seri", { palette: iceLance.meta.options.palette, mat: "cold", actor: true }),
        A.path(iceLance, E.orb, { mat: "cold", length: 30 }),
        A.atToken(iceShatter, E.hit.g1, E.hit.g1 + 2.6, "g1", { mat: "cold", face: "seri" }),
      ];
    },
  },
  {
    id: "bolt", name: "Lightning Bolt", note: "120-ft line · two targets",
    cam: [10.8, 5.8],
    tokens: [SEER, gob("g1", 10.6, 6.1), gob("g2", 13.9, 6.0, "#5a4b36", "#76994a")],
    spec: { kind: "area", func: "harm", material: "electricity", rank: 3, tradition: "arcane", caster: "seri",
      targets: [["g1", "hit"], ["g2", "hit"]], area: { shape: "line", x: 6.9, y: 6.1, dir: 0, len: 24, width: 1 } },
    port(E, A) {
      return [
        A.atToken(chainLightning, E.charge0 + 0.15, E.charge0 + 1.8, "seri", { mat: "electricity", actor: true, face: "g2" }),
        A.atToken(zapHit, E.hit.g1, E.hit.g1 + 0.9, "g1", { mat: "electricity" }),
        A.atToken(zapHit, E.hit.g2, E.hit.g2 + 0.9, "g2", { mat: "electricity" }),
      ];
    },
  },
  {
    id: "strike", name: "Longsword Strike", note: "melee Strike · critical hit",
    cam: [11.8, 5.6],
    tokens: [{ ...SEER, x: 11.2, y: 6.05 }, gob("g1", 12.4, 6.0)],
    spec: { kind: "strike", func: "harm", material: "kinetic", rank: 1, weapon: { style: "slash" }, caster: "seri", targets: [["g1", "crit"]], outcome: "crit" },
    port(E, A) {
      return [
        A.atToken(swordSlash, E.hit.g1 - 0.2, E.hit.g1 + 0.6, "seri", { mat: "kinetic", actor: true, face: "g1" }),
        A.atToken(critHit, E.hit.g1, E.hit.g1 + 0.9, "g1", { mat: "kinetic", face: "seri" }),
      ];
    },
  },
  {
    id: "frostnova", name: "Frost emanation", note: "15-ft emanation · three targets",
    cam: [9.4, 5.8],
    tokens: [{ ...SEER, x: 9.4 }, gob("g1", 11.4, 6.0), gob("g2", 8.0, 4.3, "#5a4b36", "#76994a"), gob("g3", 10.6, 7.9, "#634c3a", "#88a84e")],
    spec: { kind: "area", func: "harm", material: "cold", rank: 3, tradition: "primal", caster: "seri",
      targets: [["g1", "hit"], ["g2", "hit"], ["g3", "hit"]], area: { shape: "emanation", x: 9.4, y: 6.1, r: 3 } },
    port(E, A) {
      return [A.atToken(frostNova, E.charge0 + 0.1, E.charge0 + 3.4, "seri", { mat: "cold", actor: true, reach: 3 * APS })];
    },
  },
  {
    id: "heal", name: "Heal", note: "vitality, one ally",
    cam: [8.4, 5.8],
    tokens: [SEER, MEDIC],
    spec: { kind: "attack", func: "heal", material: "vitality", rank: 2, tradition: "divine", caster: "seri", targets: [["ana", "hit"]], outcome: "hit" },
    port(E, A) {
      const t = E.hit.ana ?? E.release;
      return [
        A.atToken(spellCharge, E.charge0, E.release, "seri", { palette: heal.meta.options.palette, mat: "vitality", actor: true, face: "ana" }),
        A.atToken(heal, t - 0.1, t + 1.9, "ana", { mat: "vitality", actor: true }),
      ];
    },
  },
  {
    id: "burning", name: "Persistent fire", note: "condition loop on a creature",
    cam: [11.4, 5.6],
    tokens: [gob("g1", 11.4, 6.0)],
    spec: { kind: "condition", func: "harm", material: "fire", rank: 1, caster: null, targets: [["g1", "hit"]], condition: { slug: "persistent-damage", value: 2 } },
    loop: 3.6,
    port(E, A) { return [A.atToken(burning, 0, 3.6, "g1", { mat: "fire", actor: true })]; },
  },
];

function specOf(sc, seed) {
  const tok = Object.fromEntries(sc.tokens.map((t) => [t.id, t]));
  const s = sc.spec;
  return {
    id: "cmp", seed, kind: s.kind, func: s.func, material: s.material, rank: s.rank, tradition: s.tradition ?? "arcane",
    outcome: s.outcome ?? s.targets[0]?.[1] ?? "hit", weapon: s.weapon ?? { style: "slash" },
    caster: s.caster ? tok[s.caster] : null, area: s.area ?? null, condition: s.condition ?? null,
    targets: s.targets.map(([id, outcome]) => ({ ...tok[id], outcome })),
  };
}

/* ── reading a Sim's timeline: it is seeded, so a dry run is the exact take that will play ───────────── */

function harvest(spec) {
  const s = compile(spec), E = { charge0: null, release: null, land: null, hit: {}, orb: null, zone: null };
  const add = s.add.bind(s), tracked = [];
  s.add = (p) => {
    const r = add(p);
    if (p.k === "glyph" && E.charge0 == null) E.charge0 = s.t;
    if (p.k === "orb" && p.glow && !E.orb) { E.orb = { t0: s.t, pts: [] }; tracked.push(p); }
    if (p.k === "orb" && !p.glow && E.release == null) E.release = s.t + p.life;
    if (p.k === "shock" && E.land == null) E.land = s.t;
    return r;
  };
  for (let i = 0; i < 120 * 9 && !s.done; i++) {
    s.step(STEP);
    for (const p of tracked) if (s.parts.includes(p)) E.orb.pts.push([s.t, p.x, p.y, p.z]);
  }
  for (const [id, h] of Object.entries(s.hits)) E.hit[id] = h.at;
  E.charge0 ??= 0; E.release ??= E.orb?.t0 ?? E.charge0 + 0.4; E.land ??= E.orb ? E.orb.pts.at(-1)[0] : E.release;
  return E;
}

/* ── placing pixelfx effects in our world ───────────────────────────────────────────────────────────── */

// a creature's silhouette as pixelfx reads it (o.actor): our top-down token disc, feet at the disc's bottom
function actorFor(t) {
  const r = Math.round(0.43 * APS), d = 2 * r, data = new Uint8Array(d * d), pixels = new Uint32Array(d * d);
  const hx = (h) => { const n = parseInt(h.slice(1), 16); return (255 << 24 | (n & 255) << 16 | (n >> 8 & 255) << 8 | n >> 16) >>> 0; };
  const body = hx(t.body), skin = hx(t.skin);
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const dx = x + 0.5 - r, dy = y + 0.5 - r; if (dx * dx + dy * dy > r * r) continue;
    data[y * d + x] = 1; pixels[y * d + x] = dx * dx + (dy + r * 0.3) ** 2 < (r * 0.35) ** 2 ? skin : body;
  }
  return { mask: { w: d, h: d, data }, pixels, x: -r, y: -d, w: d, h: d, k: 2, head: [0, -d], chest: [0, -r] };
}

function recipeKit(sc) {
  const tok = Object.fromEntries(sc.tokens.map((t) => [t.id, t]));
  const R = 0.43;
  return {
    // at a creature: origin on the floor at its feet (the bottom of the token disc)
    atToken(mod, t0, t1, id, o = {}) {
      const t = tok[id], f = o.face ? tok[o.face] : null;
      return { mod, t0, t1, o, at: () => [t.x, t.y + R, 0], flip: f ? f.x < t.x : false, actor: o.actor ? actorFor(t) : null, token: id };
    },
    ground(mod, t0, t1, x, y, o = {}) { return { mod, t0, t1, o, at: () => [x, y, 0] }; },
    // flies the projectile along the exact path our Sim's projectile took
    path(mod, orb, o = {}) {
      if (!orb || orb.pts.length < 2) return null;
      const pts = orb.pts, t0 = pts[0][0], t1 = pts.at(-1)[0];
      const at = (T) => { let i = pts.findIndex((p) => p[0] >= T); if (i <= 0) i = i < 0 ? pts.length - 1 : 1; const a = pts[i - 1], b = pts[i], u = Math.min(1, Math.max(0, (T - a[0]) / (b[0] - a[0] || 1))); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u]; };
      return { mod, t0, t1, o, at, cut: true, aim: true };
    },
    // eruptions scattered through an area, timed to our shock wave reaching them
    erupt(mod, E, cx, cy, r, n, o = {}) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + 0.7, d = r * (0.35 + 0.55 * ((i * 0.618) % 1));
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8;
        out.push({ mod, t0: E.land + 0.08 + (d / r) * 0.28, t1: E.land + 1.6, o: { ...o, seed: 20 + i }, at: () => [x, y, 0] });
      }
      return out;
    },
  };
}

/* ── one comparison pane ────────────────────────────────────────────────────────────────────────────── */

const KEEP = new Set(["zone", "shock"]);   // our area language stays: it shows exactly where the area is

class Pane {
  constructor(canvas, ported) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.ported = ported;
    canvas.width = WA * K; canvas.height = HA * K;
    this.L = new Layers(WA, HA); this.B = new Blit(); this.frame = createFrame(WA, HA);
    this.smooth = document.createElement("canvas"); this.smooth.width = WA; this.smooth.height = HA;
    this.sctx = this.smooth.getContext("2d"); this.simg = this.sctx.createImageData(WA, HA);
  }

  load(sc, seed, E) {
    this.sc = sc; this.sim = compile(specOf(sc, seed)); this.lastT = 0; this.live = [];
    this.tracks = this.ported ? sc.port(E, recipeKit(sc)).filter(Boolean).map((t, i) => ({ ...t, i, state: 0 })) : [];
    this.view = topView({ ox: Math.round(WA / 2 - sc.cam[0] * APS), oy: Math.round(HA / 2 - sc.cam[1] * APS), aps: APS, key: "cmp" });
  }

  step(opts) {
    const s = this.sim;
    if (this.sc.loop && s.t >= this.sc.loop && !s.stopped) s.stop();
    s.step(STEP);
    if (!this.ported) return;
    const dt = s.t - this.lastT; this.lastT = s.t;
    for (const tr of this.tracks) {
      if (tr.state === 0 && s.t >= tr.t0) {
        const pal = opts.palette === "ours" ? RAMP_HEX[tr.o.mat] : tr.o.palette;
        const o = { seed: 3 + tr.i, ...tr.o, ...(pal ? { palette: pal } : {}), ...(tr.actor ? { actor: tr.actor } : {}) };
        delete o.mat; delete o.face;
        tr.fx = createFx(tr.mod, o); tr.state = 1;
      }
      if (tr.state === 1) {
        if (dt > 0) tr.fx.update(dt);
        if (s.t >= tr.t1) { if (tr.cut) tr.state = 2; else tr.fx.stop(); }
        if (tr.fx.done()) tr.state = 2;
      }
    }
  }

  get done() { return this.sim.done && this.tracks.every((t) => t.state === 2 || (t.state === 0 && t.t0 > 30)); }

  paintPorted(opts) {
    const s = this.sim, v = this.view, F = clearFrame(this.frame), L = this.L;
    for (const tr of this.tracks) {
      if (tr.state !== 1) continue;
      const T = s.t, [x, y, z] = tr.at(T), [px, py] = v.ap(x, y, z);
      let ang = 0;
      if (tr.aim) { const [ax, ay] = v.ap(...tr.at(Math.max(tr.t0, T - 0.03))), [bx, by] = v.ap(...tr.at(T + 0.03)); ang = Math.atan2(by - ay, bx - ax); }
      tr.fx.options.x = px; tr.fx.options.y = py; tr.fx.options.angle = ang; tr.fx.options.flip = !!tr.flip;
      tr.fx.draw(F, "back"); tr.fx.draw(F, "front");
    }
    // their colour into our stand layer, flagged as a shape so bright floors outline it
    const C = F.color, Lt = F.light, st = L.stand;
    for (let i = 0, n = WA * HA; i < n; i++) {
      const c = C[i]; if (!c) continue;
      const x = i % WA, y = (i / WA) | 0, a = c >>> 24;
      if (a === 255) { st.col[i] = c; st.flag[i] = 1; st.box.grow(x, y); }
      else st.mix(x, y, [c & 255, (c >>> 8) & 255, (c >>> 16) & 255], a / 255);
    }
    st.outline(opts.bright ? 1 : 2);
    if (opts.light === "banded") {
      const lit = L.light.lit;
      for (let i = 0, n = WA * HA; i < n; i++) {
        const l = Lt[i] & 0xffffff; if (!l) continue;
        lit[i * 3] += (l & 255) * 1.15; lit[i * 3 + 1] += ((l >>> 8) & 255) * 1.15; lit[i * 3 + 2] += ((l >>> 16) & 255) * 1.15;
        L.light.box.grow(i % WA, (i / WA) | 0);
      }
    } else {
      const d = this.simg.data;
      for (let i = 0, n = WA * HA; i < n; i++) {
        const l = Lt[i] & 0xffffff, j = i * 4; if (!l) { d[j + 3] = 0; continue; }
        const r = l & 255, g = (l >>> 8) & 255, b = (l >>> 16) & 255, m = Math.max(r, g, b);
        d[j] = (r / m) * 255; d[j + 1] = (g / m) * 255; d[j + 2] = (b / m) * 255; d[j + 3] = m;
      }
      this.sctx.putImageData(this.simg, 0, 0);
    }
  }

  // their light reaching a creature: lights our tokens the way our own lights do
  lightAt(t) {
    const own = this.ported ? null : this.sim.lightAt(t.x, t.y);
    if (!this.ported) return own;
    const [cx, cy] = this.view.ap(t.x, t.y, 0), Lt = this.frame.light;
    let r = 0, g = 0, b = 0, n = 0, dx = 0, dy = 0;
    for (let oy = -14; oy <= 14; oy += 4) for (let ox = -14; ox <= 14; ox += 4) {
      const x = Math.round(cx + ox), y = Math.round(cy + oy); if (x < 0 || y < 0 || x >= WA || y >= HA) continue;
      const l = Lt[y * WA + x]; n++;
      if (!l) continue;
      const lr = l & 255, lg = (l >>> 8) & 255, lb = (l >>> 16) & 255, w = Math.max(lr, lg, lb) / 255;
      r += lr; g += lg; b += lb; dx += ox * w; dy += oy * w;
    }
    const m = Math.max(r, g, b); if (!n || m / n < 6) return null;
    return { c: [(r / m) * 255, (g / m) * 255, (b / m) * 255], k: Math.min(1, (m / n / 255) * 2.2), dx, dy };
  }

  draw(opts) {
    const { ctx, sim, L, B } = this, bright = opts.bright, k = K;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    const shake = sim.shake > 0.3 ? sim.shake : 0, now = performance.now();
    const shx = Math.round(Math.sin(now * 0.09) * shake) * k, shy = Math.round(Math.cos(now * 0.071) * shake * 0.6) * k;
    drawMap(ctx, this.view, bright, this.sc.cam);
    paintFrame([sim], this.view, L, this.ported ? { bright, filter: (p) => KEEP.has(p.k) } : { bright });
    if (this.ported) this.paintPorted(opts);
    B.update(L, bright);
    ctx.translate(shx, shy);
    B.draw(ctx, "flat", k);
    drawTokens(ctx, this, this.sc.tokens, null, bright);
    const smooth = this.ported && opts.light === "smooth";
    const light = () => { if (smooth) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalCompositeOperation = bright ? "source-over" : "lighter"; ctx.globalAlpha = bright ? 0.55 : 1; ctx.drawImage(this.smooth, 0, 0, WA * k, HA * k); ctx.restore(); } else B.draw(ctx, "light", k, 0, 0, bright ? "source-over" : "lighter"); };
    if (bright) light();
    B.draw(ctx, "stand", k);
    if (!bright) light();
    if (sim.impact > 0) {
      const first = sim.impact > 1 / 12;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = first ? "#000" : "#fff"; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.translate(shx, shy);
      drawTokens(ctx, this, this.sc.tokens, first ? "#fff" : "#000", bright);
      ctx.filter = first ? "brightness(0) invert(1)" : "brightness(0)";
      B.draw(ctx, "flat", k); B.draw(ctx, "stand", k);
      ctx.filter = "none";
    }
  }
}

/* ── the board and the creatures (the fx preview's own stand-ins) ───────────────────────────────────── */

function proj(v, x, y, z = 0) { const [a, b] = v.ap(x, y, z); return [a * K, b * K]; }

function drawMap(ctx, v, bright, cam) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const quad = (x0, y0, x1, y1, fill) => { const [ax, ay] = proj(v, x0, y0), [bx, by] = proj(v, x1, y1); ctx.fillStyle = fill; ctx.fillRect(Math.round(ax), Math.round(ay), Math.round(bx - ax), Math.round(by - ay)); };
  ctx.fillStyle = bright ? "#dccaa0" : "#17181d"; ctx.fillRect(0, 0, W, H);
  let r = 11; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const x0 = Math.floor(cam[0] - 8), y0 = Math.floor(cam[1] - 5);
  for (let y = y0; y < y0 + 10; y += 0.5) for (let x = x0; x < x0 + 16; x += 0.5) {
    const b = rnd();
    if (bright) { if (b < 0.4) quad(x + 0.04, y + 0.04, x + 0.46, y + 0.46, "rgba(130,95,50," + (0.04 + b * 0.12) + ")"); }
    else { const t = 33 + b * 14; quad(x + 0.03, y + 0.03, x + 0.47, y + 0.47, "rgb(" + (t | 0) + "," + ((t + 2) | 0) + "," + ((t + 9) | 0) + ")"); }
  }
  ctx.strokeStyle = bright ? "rgba(80,55,30,0.35)" : "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
  for (let x = x0; x <= x0 + 16; x++) { const [ax] = proj(v, x, 0); ctx.beginPath(); ctx.moveTo(ax + 0.5, 0); ctx.lineTo(ax + 0.5, H); ctx.stroke(); }
  for (let y = y0; y <= y0 + 10; y++) { const [, ay] = proj(v, 0, y); ctx.beginPath(); ctx.moveTo(0, ay + 0.5); ctx.lineTo(W, ay + 0.5); ctx.stroke(); }
}

function drawTokens(ctx, pane, tokens, sil, bright) {
  const sim = pane.sim, G = APS * K;
  for (const t of [...tokens].sort((a, b) => a.y - b.y)) {
    const hit = sim.hits[t.id]; let kx = 0, ky = 0, sqz = 1, flash = null;
    if (hit) {
      const d = sim.t - hit.at;
      if (d >= 0 && d < 0.7) {
        const fx = t.x - hit.from.x, fy = t.y - hit.from.y, fl = Math.hypot(fx, fy) || 1, kb = 0.12 * Math.min(1.5, hit.k) * Math.exp(-d * 9);
        kx = (fx / fl) * kb; ky = (fy / fl) * kb;
        sqz = 1 - 0.2 * Math.min(1.4, hit.k) * Math.exp(-d * 10) * Math.cos(d * 32);
        const fr = Math.floor(d * 12);
        if (fr < 4) flash = fr === 0 ? "rgba(255,255,255,0.85)" : css(S(hit.R, 0.9), 0.6 * (1 - fr / 4));
      }
    }
    const L = sil ? null : pane.lightAt(t), ring = t.ally ? "#5fb0ff" : "#e05a50";
    ctx.save();
    const [sx, sy] = proj(pane.view, t.x + kx, t.y + ky), r = 0.43 * G;
    ctx.translate(sx, sy); ctx.scale(1 + (1 - sqz) * 0.6, sqz);
    if (sil) { ctx.fillStyle = sil; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); continue; }
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#141218"; ctx.fillRect(-r, -r, 2 * r, 2 * r);
    ctx.fillStyle = t.body; ctx.beginPath(); ctx.ellipse(0, r * 0.62, r * 0.66, r * 0.46, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = t.skin; ctx.beginPath(); ctx.arc(0, -r * 0.16, r * 0.32, 0, Math.PI * 2); ctx.fill();
    if (L) { ctx.globalCompositeOperation = bright ? "source-over" : "lighter"; ctx.fillStyle = css(L.c, L.k * (bright ? 0.2 : 0.35)); ctx.fillRect(-r, -r, 2 * r, 2 * r); ctx.globalCompositeOperation = "source-over"; }
    if (flash) { ctx.fillStyle = flash; ctx.fillRect(-r, -r, 2 * r, 2 * r); }
    ctx.restore();
    ctx.strokeStyle = ring; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    if (L) { const a = Math.atan2(L.dy, L.dx); ctx.strokeStyle = css(L.c, Math.min(1, L.k * 1.4)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r - 2, a - 1.1, a + 1.1); ctx.stroke(); }
    ctx.restore();
  }
}

/* ── the page ───────────────────────────────────────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const opts = { bright: false, light: "banded", palette: "theirs", speed: 1 };
const panes = [new Pane($("ours"), false), new Pane($("port"), true)];
let sc = SCENES[0], seed = 7, acc = 0, rest = 0, last = 0;

function load() {
  const E = harvest(specOf(sc, seed));
  panes.forEach((p) => p.load(sc, seed, E));
  $("note").textContent = sc.note;
  acc = 0; rest = 0;
}

function tabs() {
  $("tabs").innerHTML = SCENES.map((s) => `<button data-id="${s.id}" class="${s === sc ? "on" : ""}">${s.name}</button>`).join("");
  $("tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; sc = SCENES.find((s) => s.id === b.dataset.id); tabs(); load(); };
}
function seg(id, key, parse = (v) => v) {
  const el = $(id);
  el.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; opts[key] = parse(b.dataset.v); [...el.children].forEach((c) => c.classList.toggle("on", c === b)); if (key === "palette") load(); };
}
seg("floor", "bright", (v) => v === "parchment");
seg("light", "light");
seg("pal", "palette");
seg("speed", "speed", Number);
$("again").onclick = () => load();
$("seed").onclick = () => { seed++; load(); };

function frame(now) {
  const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  acc += dt * opts.speed;
  while (acc >= STEP) { acc -= STEP; for (const p of panes) p.step(opts); }
  if (panes.every((p) => p.done)) { rest += dt; if (rest > 0.7) load(); }
  for (const p of panes) p.draw(opts);
  requestAnimationFrame(frame);
}

// stills for headless checks: ?still=<scene>&t=<seconds>
window.__seek = (id, t, o = {}) => {
  Object.assign(opts, o); sc = SCENES.find((s) => s.id === id) ?? sc; load();
  for (let i = 0; i < Math.round(t / STEP); i++) for (const p of panes) p.step(opts);
  for (const p of panes) p.draw(opts);
};

tabs(); load();
// headless stills: ?scene=<id>&seek=<seconds>[&floor=parchment] (headless Chrome starves animation frames)
if (P.has("seek")) { window.__seek(P.get("scene") ?? sc.id, Number(P.get("seek")), { bright: P.get("floor") === "parchment" }); tabs(); }
else requestAnimationFrame(frame);
