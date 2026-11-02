#!/usr/bin/env node
/**
 * Targeting lines — a browser-backed look at the line.
 *
 * The page IMPORTS the shipped line (`stream-targets/targeting/target-line.js`)
 * and geometry, and draws them through a small stand-in for the handful of PIXI
 * Graphics calls the line makes, onto a 2D canvas. Nothing about the line is
 * restated here: a preview built on a second copy flatters whichever copy was
 * touched last.
 *
 * Serve it (a file:// page does not run its module script):
 *
 *   node tools/target-line-preview.mjs && node tools/preview-server.mjs 8977
 *   → http://localhost:8977/.preview/target-lines.html
 *
 * URL params: `floor=bright` (a parchment map, where a pale line has to
 * survive), `zoom=0.5..2` (the stage zoom; hairlines stay one device pixel),
 * `freeze=1` (no replay loop), `phase=launch|hold|handoff` (which beat the
 * board settles on).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/target-lines.html");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Targeting lines — preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/pf2e-odds.css">
<style>
  html, body { margin: 0; background: #07080b; color: #b3b5c2; font: 500 12px/1.4 "Google Sans Flex", system-ui, sans-serif; }
  .pv { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
  .pv h2 { margin: 0; font: 700 11px/1 "Google Sans Flex", system-ui; letter-spacing: .14em; text-transform: uppercase; color: #6a6d7c; }
  .stage { position: relative; width: 1380px; height: 640px; overflow: hidden; border-radius: 4px; }
  .stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .err { color: #ff4d5a; font: 600 13px monospace; white-space: pre-wrap; }
</style></head>
<body><div class="pv">
  <h2 id="title">Targeting lines</h2>
  <div class="stage" id="stage"><canvas id="map"></canvas><canvas id="fx"></canvas><div id="badges" class="glod-lines gl-type" style="position:absolute"></div></div>
  <div class="err" id="err"></div>
</div>
<script>
// ── a stand-in for the PIXI calls the line makes ────────────────────────────
(() => {
  class DisplayObject {
    constructor() { this.alpha = 1; this.x = 0; this.y = 0; this.rotation = 0; this.blendMode = 0; this.visible = true; this.destroyed = false; this.parent = null; this.filters = null; }
    destroy() { this.destroyed = true; this.parent?.removeChild(this); }
  }
  class Container extends DisplayObject {
    constructor() { super(); this.children = []; this.sortableChildren = false; this.zIndex = 0; }
    addChild(c) { c.parent = this; this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
    destroy() { for (const c of [...this.children]) c.destroy(); super.destroy(); }
  }
  class Graphics extends DisplayObject {
    constructor() { super(); this.ops = []; }
    clear() { this.ops.length = 0; return this; }
    lineStyle(o, color, alpha) { this.ops.push(["ls", typeof o === "object" ? { ...o } : { width: o ?? 0, color: color ?? 0, alpha: alpha ?? 1 }]); return this; }
    moveTo(x, y) { this.ops.push(["m", x, y]); return this; }
    lineTo(x, y) { this.ops.push(["l", x, y]); return this; }
    arc(x, y, r, a, b) { this.ops.push(["a", x, y, r, a, b]); return this; }
    closePath() { this.ops.push(["z"]); return this; }
    drawCircle(x, y, r) { this.ops.push(["c", x, y, r]); return this; }
    drawPolygon(pts) { const p = Array.isArray(pts) ? pts : [...arguments]; this.ops.push(["poly", p]); return this; }
    beginFill(color, alpha = 1) { this.ops.push(["bf", color, alpha]); return this; }
    endFill() { this.ops.push(["ef"]); return this; }
  }
  class BlurFilter { constructor(strength = 8) { this.strength = strength; this.blendMode = 0; } }
  window.PIXI = { Container, Graphics, BlurFilter, BLEND_MODES: { NORMAL: 0, ADD: 1 }, LINE_CAP: { ROUND: "round", BUTT: "butt" }, LINE_JOIN: { ROUND: "round", MITER: "miter" } };

  const css = (n, a) => "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  function paintGraphics(ctx, g, alpha) {
    let line = null, fill = null, path = null, open = false;
    const flush = () => {
      if (!path) return;
      if (fill) { ctx.fillStyle = css(fill[0], fill[1] * alpha); ctx.fill(path); }
      if (line) { ctx.strokeStyle = css(line.color, line.alpha * alpha); ctx.lineWidth = line.width; ctx.lineCap = line.cap === "butt" ? "butt" : "round"; ctx.lineJoin = line.join === "miter" ? "miter" : "round"; ctx.stroke(path); }
      path = null; open = false;
    };
    for (const op of g.ops) {
      switch (op[0]) {
        case "ls": flush(); line = op[1].width > 0 && op[1].alpha > 0 ? op[1] : null; break;
        case "bf": flush(); fill = [op[1], op[2]]; break;
        case "ef": flush(); fill = null; break;
        case "m": if (!fill) flush(); path ??= new Path2D(); path.moveTo(op[1], op[2]); open = true; break;
        case "l": path ??= new Path2D(); path.lineTo(op[1], op[2]); break;
        case "a": path ??= new Path2D(); path.arc(op[1], op[2], op[3], op[4], op[5]); break;
        case "z": path?.closePath(); break;
        case "c": { if (!fill) flush(); const p = path ?? new Path2D(); p.moveTo(op[1] + op[3], op[2]); p.arc(op[1], op[2], op[3], 0, Math.PI * 2); path = p; if (!fill) flush(); break; }
        case "poly": { if (!fill) flush(); const p = path ?? new Path2D(); const v = op[1]; p.moveTo(v[0], v[1]); for (let i = 2; i < v.length; i += 2) p.lineTo(v[i], v[i + 1]); p.closePath(); path = p; if (!fill) flush(); break; }
      }
    }
    flush();
  }
  /** Draw a display tree; a BlurFilter blurs its container's children as one pass. */
  window.paintTree = function paintTree(ctx, node, alpha = 1) {
    if (!node.visible || node.destroyed) return;
    const a = alpha * node.alpha;
    ctx.save();
    ctx.translate(node.x, node.y);
    ctx.rotate(node.rotation);
    const blur = node.filters?.find((f) => f instanceof BlurFilter);
    if (node.blendMode === 1) ctx.globalCompositeOperation = "lighter";
    if (blur) {
      ctx.filter = "blur(" + (blur.strength * 0.5 * ctx.getTransform().a) + "px)";
      if (blur.blendMode === 1) ctx.globalCompositeOperation = "lighter";
    }
    if (node instanceof Graphics) paintGraphics(ctx, node, a);
    else for (const c of node.children) paintTree(ctx, c, a);
    ctx.restore();
  };
})();
</script>
<script type="module">
const err = (e) => { document.getElementById("err").textContent += String(e?.stack ?? e) + "\\n"; };
window.addEventListener("error", (e) => err(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => err(e.reason));
try {
  const q = new URLSearchParams(location.search);
  const bright = q.get("floor") === "bright";
  const zoom = Math.max(0.3, Math.min(3, Number(q.get("zoom")) || 1));
  const freeze = q.has("freeze");
  const phase = q.get("phase") ?? "hold";
  const DPR = window.devicePixelRatio || 1;
  const W = 1380, H = 640, GRID = 100;

  const lineMod = await import("/scripts/features/stream-targets/targeting/target-line.js");
  const { TargetLine } = lineMod;
  const layers = lineMod.createLineLayers ? lineMod.createLineLayers() : (() => {
    const layer = new PIXI.Container();
    const halo = layer.addChild(new PIXI.Container());
    const blur = new PIXI.BlurFilter(6, 2); blur.blendMode = PIXI.BLEND_MODES.ADD; halo.filters = [blur];
    const core = layer.addChild(new PIXI.Container());
    const glint = layer.addChild(new PIXI.Container());
    return { layer, halo, core, glint };
  })();

  // ── the board: world units, drawn at the stage zoom ──
  const tok = (id, x, y, size, label, side) => ({ id, label, side, document: { id }, center: { x, y }, w: size, h: size, x: x - size / 2, y: y - size / 2, visible: true });
  const T = {
    seri: tok("seri", 260, 470, 100, "SE", 1),
    tavi: tok("tavi", 360, 470, 100, "TA", 1),
    ogre: tok("ogre", 900, 220, 200, "OG", -1),
    gob: tok("gob", 460, 470, 100, "GB", -1),
    hag: tok("hag", 1220, 470, 100, "HA", -1),
    ally: tok("ally", 640, 140, 100, "AL", 1),
  };
  const COLORS = { fh: 0x4db8ff, hf: 0xff4a5c, same: 0x52f5a0, other: 0xffd35c };
  const PAIRS = [
    ["seri", "ogre", COLORS.fh],
    ["seri", "hag", COLORS.fh],
    ["tavi", "gob", COLORS.fh],
    ["ogre", "ally", COLORS.hf],
    ["seri", "seri", COLORS.same],
  ];

  const map = document.getElementById("map");
  const fx = document.getElementById("fx");
  for (const c of [map, fx]) { c.width = W * DPR; c.height = H * DPR; }
  const mctx = map.getContext("2d");
  const fctx = fx.getContext("2d");
  const view = { x: 0, y: 0 };
  const toScreen = (p) => ({ x: (p.x - view.x) * zoom, y: (p.y - view.y) * zoom });
  window.__stage = { zoom, view, toScreen, tokens: T, gridSize: GRID };

  function drawMap() {
    mctx.setTransform(DPR * zoom, 0, 0, DPR * zoom, -view.x * DPR * zoom, -view.y * DPR * zoom);
    const g = mctx.createLinearGradient(0, 0, W / zoom, H / zoom);
    if (bright) { g.addColorStop(0, "#d8cba8"); g.addColorStop(1, "#b9a77d"); }
    else { g.addColorStop(0, "#1d2422"); g.addColorStop(1, "#11151a"); }
    mctx.fillStyle = g; mctx.fillRect(0, 0, W / zoom, H / zoom);
    // a few map shapes, so the line is judged over art rather than a flat fill
    mctx.fillStyle = bright ? "rgba(120,96,60,.25)" : "rgba(80,110,90,.18)";
    for (const [x, y, r] of [[300, 180, 140], [760, 520, 180], [1180, 160, 120], [560, 300, 70]]) { mctx.beginPath(); mctx.arc(x, y, r, 0, 7); mctx.fill(); }
    mctx.strokeStyle = bright ? "rgba(60,40,20,.18)" : "rgba(255,255,255,.05)";
    mctx.lineWidth = 1 / zoom;
    for (let x = 0; x < W / zoom; x += GRID) { mctx.beginPath(); mctx.moveTo(x, 0); mctx.lineTo(x, H / zoom); mctx.stroke(); }
    for (let y = 0; y < H / zoom; y += GRID) { mctx.beginPath(); mctx.moveTo(0, y); mctx.lineTo(W / zoom, y); mctx.stroke(); }
    for (const t of Object.values(T)) {
      const r = t.w / 2 - 6;
      mctx.fillStyle = t.side > 0 ? "#3a4a5e" : "#5e3a3a";
      mctx.beginPath(); mctx.arc(t.center.x, t.center.y, r, 0, 7); mctx.fill();
      mctx.lineWidth = 4; mctx.strokeStyle = t.side > 0 ? "#9fc4e8" : "#e8a39f"; mctx.stroke();
      mctx.fillStyle = "#f4f4f7"; mctx.font = "700 " + Math.round(r * 0.6) + "px 'Google Sans Flex', system-ui"; mctx.textAlign = "center"; mctx.textBaseline = "middle";
      mctx.fillText(t.label, t.center.x, t.center.y + 1);
    }
  }
  drawMap();

  const lines = PAIRS.map(([s, t, color]) => new TargetLine({ sourceId: s, targetId: t, ...layers, layer: layers.core, style: { color, intensity: 1 }, calm: false, onGone: () => {} }));
  window.__lines = lines;
  const launch = () => lines.forEach((l) => { l.state.reach = 0; l.shown = false; l.leaving = false; l.show(); });
  launch();

  function frame() {
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fx.width, fx.height);
    for (const l of lines) l.render({ source: T[l.sourceId], target: T[l.targetId], scale: zoom, gridSize: GRID, resolution: DPR });
    fctx.setTransform(DPR * zoom, 0, 0, DPR * zoom, -view.x * DPR * zoom, -view.y * DPR * zoom);
    paintTree(fctx, layers.layer);
    window.__frame?.();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (phase === "handoff") setTimeout(() => lines[2].retarget("seri"), 900);

  // ── the odds on the line (pf2e-odds), placed by the shipped line-place.mjs ──
  if (q.has("odds")) {
    const { buildModel } = await import("/scripts/features/pf2e-odds/view-model.mjs");
    const R = await import("/scripts/features/pf2e-odds/render.mjs");
    const P = await import("/scripts/features/pf2e-odds/line-place.mjs");
    const EN = {
      "GLOD.attack.first": "1st", "GLOD.attack.second": "2nd", "GLOD.attack.third": "3rd",
      "GLOD.chip.map": "MAP", "GLOD.unseen.attack": "Attack unseen", "GLOD.unseen.defence": "Defence unseen",
      "GLOD.word.hit": "Hit", "GLOD.word.success": "Success", "GLOD.word.crit": "Crit", "GLOD.word.theyFail": "They fail", "GLOD.word.critFail": "Crit fail", "GLOD.word.dc": "DC", "GLOD.word.vs": "vs",
      "GLOD.stat.ac": "AC", "GLOD.gm.true": "True", "GLOD.gm.players": "Players see", "GLOD.gm.exact": "exact",
      "GLOD.stamp.fumble": "Fumble", "GLOD.stamp.miss": "Miss", "GLOD.stamp.hit": "Hit", "GLOD.stamp.crit": "Crit", "GLOD.outOfRange": "Out of range",
    };
    const t = (k) => EN[k] ?? k;
    const gm = q.has("gm");
    const MODS = [{ slug: "multiple-attack-penalty", label: "MAP", value: -5, kind: "untyped", enabled: true }];
    const pc = { rollerIsCreature: false, defenderIsCreature: true, isGM: gm };
    const foe = { rollerIsCreature: true, defenderIsCreature: false, isGM: gm };
    const SPEC = {
      "seri>ogre": { who: pc, mod: 17, mods: MODS, dc: 23, known: { lo: 23, hi: 23 }, label: "Longsword", sub: "GLOD.attack.second", target: "Ogre" },
      "seri>hag": { who: pc, mod: 17, mods: MODS, dc: 25, known: null, label: "Longsword", sub: "GLOD.attack.second", target: "Hag" },
      "tavi>gob": { who: pc, mod: 12, mods: [], dc: 18, known: { lo: 16, hi: 19 }, label: "Shortbow", sub: "GLOD.attack.first", target: "Goblin" },
      "ogre>ally": { who: foe, mod: 15, mods: [], dc: 21, known: { lo: 14, hi: 17 }, label: "Club", sub: "GLOD.attack.first", target: "Aldric" },
    };
    const acting = q.get("acting") ?? "seri";
    const hover = q.get("hover");
    const box = document.getElementById("badges");
    const views = PAIRS.filter(([s, tg]) => s !== tg).map(([s, tg, color]) => {
      const key = s + ">" + tg;
      const sp = SPEC[key];
      const model = buildModel({ probe: { mod: sp.mod, mods: sp.mods, dc: { value: sp.dc, slug: "armor" }, options: [] }, bareDc: sp.dc, who: sp.who, known: sp.known, label: sp.label, sub: sp.sub, dcLabel: "GLOD.stat.ac", playersKnown: gm ? sp.known : undefined });
      const full = s === acting || key === hover;
      const el = document.createElement("div");
      el.className = "glod-line " + (full ? "is-full" : "is-compact");
      el.style.setProperty("--glod-line", P.lineCss(color));
      if (full) el.style.zIndex = "2";
      el.innerHTML = R.compactHTML(model, { t }) + R.badgeHTML(model, { t, target: sp.target, gm });
      box.append(el);
      return { s, tg, el, full, acting: s === acting, hot: key === hover, path: null };
    });
    const place = () => {
      const items = views.map((v) => {
        const a = T[v.s], b = T[v.tg];
        const path = P.linePath({ from: a.center, to: b.center, sourceSize: Math.max(a.w, a.h), targetSize: Math.max(b.w, b.h), gridSize: GRID });
        const tag = v.el.querySelector(".glod-tag").getBoundingClientRect();
        const plate = v.full ? v.el.querySelector(".glod-badge").getBoundingClientRect() : null;
        const at = (share) => { const p = P.tagAnchor(path, share, GRID); const sc = toScreen(p); return { x: sc.x, y: sc.y, nx: p.nx, ny: p.ny }; };
        return { v, at, w: tag.width, h: tag.height, plate: plate ? { w: plate.width, h: plate.height } : null };
      });
      const rank = (v) => (v.hot ? 4 : 0) + (v.acting ? 2 : 0) + (v.full ? 1 : 0);
      items.sort((x, y) => rank(y.v) - rank(x.v));
      const obstacles = Object.values(T).map((tk) => { const c = toScreen(tk.center); const w = tk.w * zoom; return { x: c.x - w / 2, y: c.y - w / 2, w, h: w }; });
      const spots = P.placeLines(items, { w: W, h: H }, { obstacles });
      items.forEach((it, i) => {
        const placed = spots[i];
        if (placed.side) it.v.el.dataset.side = placed.side;
        it.v.el.querySelector(".glod-tag").style.translate = placed.tag.x + "px " + placed.tag.y + "px";
        if (placed.plate) it.v.el.querySelector(".glod-badge").style.translate = placed.plate.x + "px " + placed.plate.y + "px";
      });
    };
    await document.fonts.ready;
    place();
    window.__placeOdds = place;
    if (q.has("land")) setTimeout(() => {
      const ogre = views.find((v) => v.tg === "ogre");
      R.playLanding(ogre.el.querySelector(".glod-badge"), { face: 14, degree: 2, t });
      const gob = views.find((v) => v.tg === "gob");
      R.playTagLanding(gob.el.querySelector(".glod-tag"), { degree: 3, t });
    }, 700);
  }
  if (!freeze) setInterval(() => {
    lines.forEach((l) => l.hide?.());
    setTimeout(launch, 700);
  }, 5200);
  document.getElementById("title").textContent = "Targeting lines — " + (bright ? "bright floor" : "dark floor") + " · zoom " + zoom;
  window.__ready = true;
} catch (e) { err(e); }
</script></body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
