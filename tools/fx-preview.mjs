/**
 * tools/fx-preview.mjs — write the Spellsprite preview page, drawn by the
 * SHIPPED engine (compile, sim, shapes, frame, blit) imported over the preview
 * server, so what you judge is what Foundry runs.
 *
 *   node tools/fx-preview.mjs [--out=.preview/fx.html]
 *   node tools/preview-server.mjs 8990        # then open /.preview/fx.html
 *
 * SERVE it: a file:// page does not execute its module script.
 *
 * Two views:
 *   ?view=stage   one effect, top-down and Diorama side by side, animated
 *   ?view=sheet   a contact sheet: every material × every delivery, as stills
 *   stage params: kind func mat outcome rank style shape cond cval seed seek zoom floor,
 *                 the look axes delivery motif flavor props (comma list), arch (archetypes/rules.mjs), and slug (the item slug an archetype may read, e.g. charm)
 *                 rider (a Strike's rider archetype: grab|trip|shove|rend) and riderslug (its slug, e.g. constrict),
 *                 csize / tsize (the caster's / first target's footprint in squares: 2 Large, 3 Huge, 4 Gargantuan)
 *
 * Stage params: kind (attack|save|area|strike|auto|self|condition|tick), func,
 *   mat, outcome (crit|hit|miss|neutral), rank, style (weapon style), shape
 *   (burst|cone|line|emanation), cond (condition slug), hue, flourish, floor
 *   (dungeon|parchment), zoom, seek (freeze at t seconds), seed, speed, layers (debug: flat,stand,light).
 * Sheet params: rows=materials|functions|strikes|conditions, cols (comma list
 *   of column ids), seek (override every cell), floor, only (comma materials).
 *
 * `window.__fx` exposes the modules and the live sims for headless use.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/fx.html");

const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Spellsprite preview</title>
<style>
  :root { --bg: #0d0e12; --panel: #14161c; --line: #262a34; --ink: #e6e8ee; --dim: #9aa1ae; --accent: #ffb04a; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); font: 13px/1.45 system-ui, sans-serif; }
  main { padding: 14px 16px 40px; }
  h1 { font-size: 16px; margin: 0 0 8px; font-weight: 650; }
  .bar { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; margin-bottom: 10px; color: var(--dim); }
  .bar a { color: var(--ink); text-decoration: none; border: 1px solid var(--line); border-radius: 4px; padding: 2px 7px; }
  .bar a.on { border-color: var(--accent); }
  .stage { display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  figcaption { padding: 6px 10px; border-bottom: 1px solid var(--line); color: var(--dim); display: flex; justify-content: space-between; gap: 8px; }
  canvas { display: block; image-rendering: pixelated; }
  .cue { margin: 10px 0; color: var(--dim); }
  .sheet { display: grid; gap: 6px; }
  .sheet .h { color: var(--dim); font-size: 11px; align-self: end; padding: 2px; }
  .sheet .rh { color: var(--ink); font-size: 12px; align-self: center; }
  .sheet canvas { border: 1px solid var(--line); border-radius: 3px; }
  #err { white-space: pre-wrap; color: #ff9a8a; }
</style></head>
<body><main>
<h1>Spellsprite preview</h1>
<div class="bar" id="bar"></div>
<div id="root"></div>
<div class="cue" id="cue"></div>
<p id="err" hidden></p>
</main>
<script type="module">
const $ = (id) => document.getElementById(id);
const fail = (e) => { const el = $("err"); el.hidden = false; el.textContent += String(e?.stack ?? e) + "\n"; };
window.addEventListener("error", (e) => fail(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => fail(e.reason));

const base = "/scripts/features/pf2e-fx/";
const [{ compile }, { Layers }, { topView, sideView, paintFrame }, { Blit }, C, { RAMP, S, css }, { STEP }] = await Promise.all([
  import(base + "compile.mjs"), import(base + "core/pix.mjs"), import(base + "core/frame.mjs"),
  import(base + "core/blit.mjs"), import(base + "constants.mjs"), import(base + "core/palette.mjs"), import(base + "core/sim.mjs"),
]);
const P = new URLSearchParams(location.search);
const view = P.get("view") || "stage";
const floor = P.get("floor") || "dungeon", bright = floor === "parchment";
const num = (k, d) => (P.has(k) ? Number(P.get(k)) : d);

/* ── scene ── */
const CASTER = { id: "seri", x: 7, y: 6.1, size: 1, h: 1.3, ally: true, body: "#3d6ab0", skin: "#e8c6a6" };
const FOES = [
  { id: "g1", x: 12.4, y: 6.0, size: 1, h: 1, body: "#6b5a3a", skin: "#7fa046" },
  { id: "g2", x: 12.05, y: 4.75, size: 1, h: 1, body: "#5a4b36", skin: "#76994a" },
  { id: "g3", x: 13.5, y: 7.2, size: 1, h: 1, body: "#634c3a", skin: "#88a84e" },
];
const CAM = { x: num("camx", 10.2), y: num("camy", 6.0) };

function specFrom(o) {
  const kind = o.kind ?? "attack", out = o.outcome ?? "hit";
  const strike = kind === "strike";
  const caster = strikeCaster(o);
  const shape = o.shape ?? "burst";
  let targets = foes(o).map((T, i) => ({ ...T, outcome: i === 0 ? out : out === "crit" ? "hit" : out }));
  if (kind === "attack" || kind === "strike" || kind === "tick" || kind === "condition" || kind === "auto") targets = targets.slice(0, 1);
  if (kind === "self") targets = [];
  let area = null;
  if (kind === "area") {
    if (shape === "cone") area = { shape, x: 7.3, y: 6.1, dir: 0, len: 6 };
    else if (shape === "line") area = { shape, x: 7.3, y: 6.1, dir: 0, len: 12, width: 1 };
    else if (shape === "emanation") area = { shape, x: caster.x, y: caster.y, r: 3 };
    else area = { shape, x: 12.6, y: 6.0, r: 1.2 + (o.rank ?? 5) * 0.1 };
  }
  return {
    id: "preview", seed: o.seed ?? 7, kind, func: o.func ?? "harm", material: o.mat ?? "fire", outcome: out,
    rank: o.rank ?? 5, tradition: o.tradition ?? "arcane", weapon: { style: o.style ?? "slash" },
    caster: kind === "condition" || kind === "tick" ? null : caster, targets, area,
    condition: kind === "condition" ? { slug: o.cond ?? "persistent-damage", value: o.cval ?? 1 } : null,
    look: o.hue != null || o.flourish ? { hue: o.hue ?? null, flourish: o.flourish ?? null } : null,
    delivery: o.delivery ?? null, motif: o.motif ?? null, flavor: o.flavor ?? null, props: o.props ?? [], arch: o.arch ?? null, slug: o.slug ?? null,
    rider: o.rider ? { arch: o.rider, slug: o.riderslug ?? o.rider } : null,
  };
}

/* csize / tsize: the first foe takes the target's footprint, and a Strike's caster stands just off its edge */
const foes = (o) => FOES.map((T, i) => (i === 0 && o.tsize ? { ...T, size: o.tsize, h: T.h * o.tsize } : T));
function strikeCaster(o) {
  if (o.kind !== "strike") return o.csize ? { ...CASTER, size: o.csize, h: CASTER.h * o.csize } : CASTER;
  const cs = o.csize ?? 1, T = foes(o)[0];
  return { ...CASTER, size: cs, h: CASTER.h * cs, x: T.x - (cs + (T.size ?? 1)) / 2 - 0.1, y: 6.05 };
}

/* ── views: a top-down canvas and a Diorama-like side canvas ── */
function makeViews(canvas, kind, k, w, h) {
  const aps = 26, wa = Math.ceil(w / k), ha = Math.ceil(h / k);
  if (kind === "top") {
    const ox = Math.round(wa / 2 - CAM.x * aps), oy = Math.round(ha / 2 - CAM.y * aps);
    return { kind, k, aps, wa, ha, v: topView({ ox, oy, aps, lod: k < 2 }), proj: (x, y, z = 0) => [(ox + x * aps) * k, (oy + y * aps - z * aps * 0.2) * k], sq: 1, lift: 0.2 };
  }
  const sq = 0.52, ax = Math.round(wa / 2), ay = Math.round(ha / 2 + 0.4 * aps);
  const v = sideView({ cx: CAM.x, cy: CAM.y, rx: 1, ry: 0, ax, ay, aps, sq, lod: k < 2 });
  return { kind: "dio", k, aps, wa, ha, v, proj: (x, y, z = 0) => { const [a, b] = v.ap(x, y, z); return [a * k, b * k]; }, sq, lift: 1 };
}

function drawMap(ctx, V) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const quad = (x0, y0, x1, y1, z, fill) => { const [ax, ay] = V.proj(x0, y0, z), [bx, by] = V.proj(x1, y1, z); ctx.fillStyle = fill; ctx.fillRect(Math.round(ax), Math.round(ay), Math.round(bx - ax), Math.round(by - ay)); };
  ctx.fillStyle = bright ? "#2a2118" : "#07080a"; ctx.fillRect(0, 0, W, H);
  quad(0, 2, 22, 12, 0, bright ? "#dccaa0" : "#17181d");
  let r = 11;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let y = 2; y < 12; y += 0.5) for (let x = 0; x < 22; x += 0.5) {
    const b = rnd();
    if (bright) { if (b < 0.4) quad(x + 0.04, y + 0.04, x + 0.46, y + 0.46, 0, "rgba(130,95,50," + (0.04 + b * 0.12) + ")"); }
    else { const t = 33 + b * 14; quad(x + 0.03, y + 0.03, x + 0.47, y + 0.47, 0, "rgb(" + (t | 0) + "," + ((t + 2) | 0) + "," + ((t + 9) | 0) + ")"); }
  }
  ctx.strokeStyle = bright ? "rgba(80,55,30,0.35)" : "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
  for (let x = 0; x <= 22; x++) { const [ax, ay] = V.proj(x, 2, 0), [bx, by] = V.proj(x, 12, 0); ctx.beginPath(); ctx.moveTo(ax + 0.5, ay); ctx.lineTo(bx + 0.5, by); ctx.stroke(); }
  for (let y = 2; y <= 12; y++) { const [ax, ay] = V.proj(0, y, 0), [bx, by] = V.proj(22, y, 0); ctx.beginPath(); ctx.moveTo(ax, ay + 0.5); ctx.lineTo(bx, by + 0.5); ctx.stroke(); }
}

function figure(c, h, w) {
  c.beginPath();
  c.rect(-w * 0.3, -h * 0.38, w * 0.22, h * 0.38); c.rect(w * 0.08, -h * 0.38, w * 0.22, h * 0.38);
  c.moveTo(-w * 0.46, -h * 0.32); c.lineTo(w * 0.46, -h * 0.32); c.lineTo(w * 0.34, -h * 0.74); c.lineTo(-w * 0.34, -h * 0.74); c.closePath();
  c.moveTo(w * 0.25, -h * 0.86); c.arc(0, -h * 0.86, w * 0.25, 0, Math.PI * 2);
}

function drawTokens(ctx, V, sim, tokens, sil) {
  const G = V.aps * V.k;
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
    const L = sil || sim.shed.has("tokenLight") ? null : sim.lightAt(t.x, t.y), ring = t.ally ? "#5fb0ff" : "#e05a50";
    ctx.save();
    if (V.kind === "top") {
      const [sx, sy] = V.proj(t.x + kx, t.y + ky, 0), r = 0.43 * G * (t.size ?? 1);
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
    } else {
      const [bx, by] = V.proj(t.x, t.y, 0);
      if (!sil) { ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(bx, by, 0.4 * G * (t.size ?? 1), 0.4 * G * V.sq * (t.size ?? 1), 0, 0, Math.PI * 2); ctx.stroke(); }
      const [fx, fy] = V.proj(t.x + kx, t.y + ky, 0), hh = t.h * G, w = 0.5 * G * (t.size ?? 1);
      ctx.translate(fx, fy - 2); ctx.scale(1 + (1 - sqz) * 0.7, sqz);
      figure(ctx, hh, w);
      if (sil) { ctx.fillStyle = sil; ctx.fill(); ctx.restore(); continue; }
      ctx.fillStyle = t.body; ctx.fill();
      ctx.fillStyle = t.skin; ctx.beginPath(); ctx.arc(0, -hh * 0.86, w * 0.25, 0, Math.PI * 2); ctx.fill();
      if (L) { figure(ctx, hh, w); ctx.save(); ctx.clip(); ctx.globalCompositeOperation = bright ? "source-over" : "lighter"; ctx.fillStyle = css(L.c, L.k * (bright ? 0.2 : 0.35)); ctx.fillRect(-w, -hh * 1.2, 2 * w, hh * 1.3); ctx.restore(); }
      if (flash) { figure(ctx, hh, w); ctx.fillStyle = flash; ctx.fill(); }
      figure(ctx, hh, w); ctx.lineWidth = 2; ctx.strokeStyle = "#08080b"; ctx.stroke();
    }
    ctx.restore();
  }
}

/** One full frame of one view: map, decals, creatures, light, standing shapes, impact frames. */
function drawView(ctx, V, sims, tokens, now, L, B) {
  const k = V.k;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  const shake = Math.max(0, ...sims.map((s) => (s.shake > 0.3 ? s.shake : 0)));
  const shx = Math.round(Math.sin(now * 0.09) * shake) * k, shy = Math.round(Math.cos(now * 0.071) * shake * 0.6) * k;
  drawMap(ctx, V);
  // layers=flat,stand,light (debug): paint only those, to find which layer a wash comes from
  const only = P.get("layers")?.split(",");
  paintFrame(sims, V.v, L, { bright, light: !only || only.includes("light"), filter: only ? (p) => !p.k || only.includes(p.layer === "flat" ? "flat" : "stand") : null });
  B.update(L, bright);
  ctx.translate(shx, shy);
  B.draw(ctx, "flat", k);
  for (const s of sims) drawTokens(ctx, V, s, tokens);
  if (bright) B.draw(ctx, "light", k);
  B.draw(ctx, "stand", k);
  if (!bright) B.draw(ctx, "light", k, 0, 0, "lighter");
  const imp = sims.find((s) => s.impact > 0);
  if (imp) {
    const first = imp.impact > 1 / 12;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = first ? "#000" : "#fff"; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.translate(shx, shy);
    drawTokens(ctx, V, imp, tokens, first ? "#fff" : "#000");
    ctx.filter = first ? "brightness(0) invert(1)" : "brightness(0)";
    B.draw(ctx, "flat", k); B.draw(ctx, "stand", k);
    ctx.filter = "none";
  }
}

/* ── stage ── */
function stage() {
  const o = {
    kind: P.get("kind") ?? "area", func: P.get("func") ?? "harm", mat: P.get("mat") ?? "fire", outcome: P.get("outcome") ?? "hit",
    rank: num("rank", 5), style: P.get("style") ?? "slash", shape: P.get("shape") ?? "burst", cond: P.get("cond") ?? undefined,
    hue: P.has("hue") ? num("hue") : null, flourish: P.get("flourish") ?? null, seed: num("seed", 7), tradition: P.get("tradition") ?? "arcane",
    cval: num("cval", 1),
    // the look axes, so any delivery, motif, flavor or prop can be judged on its own
    delivery: P.get("delivery") ?? null, motif: P.get("motif") ?? null, flavor: P.get("flavor") ?? null, arch: P.get("arch") ?? null, slug: P.get("slug") ?? null,
    rider: P.get("rider") ?? null, riderslug: P.get("riderslug") ?? null, csize: P.has("csize") ? num("csize") : null, tsize: P.has("tsize") ? num("tsize") : null,
    props: P.get("props")?.split(",").filter(Boolean) ?? [],
  };
  const zoom = num("zoom", 1), speed = num("speed", 1), seek = P.has("seek") ? num("seek") : null;
  const W = 640, H = 380;
  const figs = ["top", "side"].map((kind) => {
    const fig = document.createElement("figure"), cap = document.createElement("figcaption"), cv = document.createElement("canvas");
    cap.innerHTML = "<span>" + (kind === "top" ? "Top-down canvas" : "Diorama billboard") + "</span><span>" + floor + "</span>";
    cv.width = W; cv.height = H; fig.append(cap, cv); $("root").append(fig);
    const k = Math.max(1, Math.round(2 * zoom));
    const V = makeViews(cv, kind, k, W, H);
    return { ctx: cv.getContext("2d"), V, L: new Layers(V.wa + 2, V.ha + 2), B: new Blit() };
  });
  $("root").className = "stage";
  let sim, seed = o.seed;
  const tokens = () => [strikeCaster(o), ...foes(o)];
  const restart = () => { sim = compile(specFrom({ ...o, seed: seed++ })); window.__fx.sims = [sim]; $("cue").textContent = sim.M.material + " (" + sim.M.family + ") · " + o.kind + " · " + o.func + " · " + o.outcome + " · rank " + o.rank + " · " + sim.phases.join(" → "); };
  window.__fx = { compile, sims: [], restart };
  restart();
  if (seek != null) while (sim.t < seek) sim.step(STEP);
  let last = performance.now(), acc = 0;
  const frame = (now) => {
    if (seek == null) {
      acc += Math.min(0.05, (now - last) / 1000) * speed; last = now;
      let n = 0; while (acc >= STEP && n++ < 12) { sim.step(STEP); acc -= STEP; }
      if (sim.t > sim.period + 0.6 || (sim.done && sim.t > 0.5)) restart();
    }
    for (const f of figs) drawView(f.ctx, f.V, [sim], tokens(), now, f.L, f.B);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  bar([
    ["kind", ["attack", "area", "save", "strike", "auto", "self", "condition", "tick"]],
    ["mat", C.MATERIALS],
    ["outcome", ["crit", "hit", "miss", "neutral"]],
    ["func", C.FUNCTIONS],
    ["shape", ["burst", "cone", "line", "emanation"]],
    ["style", C.WEAPON_STYLES],
    ["floor", ["dungeon", "parchment"]],
  ]);
}

function bar(groups) {
  for (const [key, vals] of groups) {
    const span = document.createElement("span"); span.textContent = key + ": ";
    for (const v of vals) {
      const a = document.createElement("a"), q = new URLSearchParams(location.search); q.set(key, v); q.delete("seek");
      a.href = "?" + q; a.textContent = v; if (P.get(key) === v) a.className = "on"; span.append(a, " ");
    }
    $("bar").append(span);
  }
}

/* ── sheet ── */
const COLS = {
  "attack-hit": { kind: "attack", outcome: "hit", seek: 0.95 },
  "attack-crit": { kind: "attack", outcome: "crit", seek: 0.9 },
  "attack-miss": { kind: "attack", outcome: "miss", seek: 1.05 },
  burst: { kind: "area", shape: "burst", seek: 1.3 },
  "burst-linger": { kind: "area", shape: "burst", seek: 2.4 },
  cone: { kind: "area", shape: "cone", seek: 0.75 },
  line: { kind: "area", shape: "line", seek: 0.75 },
  emanation: { kind: "area", shape: "emanation", seek: 0.6 },
  strike: { kind: "strike", outcome: "hit", seek: 0.4 },
  condition: { kind: "condition", seek: 2.2 },
  tick: { kind: "tick", seek: 0.25 },
};
async function sheet() {
  const rows = P.get("rows") || "materials";
  const cols = (P.get("cols") || (rows === "materials" ? "attack-hit,attack-crit,burst,burst-linger,cone,line,strike,condition" : "x")).split(",");
  let R;
  if (rows === "materials") R = (P.get("only")?.split(",") ?? C.MATERIALS).map((m) => [m, (c) => ({ ...COLS[c], mat: m })]);
  else if (rows === "functions") R = C.FUNCTIONS.map((f) => [f, (c) => ({ kind: c === "self" ? "self" : "save", func: f, mat: P.get("mat") ?? "holy", seek: num("seek", 0.95) })]);
  else if (rows === "strikes") R = C.WEAPON_STYLES.map((st) => [st, (c) => ({ kind: "strike", style: st, outcome: c, mat: P.get("mat") ?? "kinetic", seek: c === "crit" ? 0.62 : 0.4 })]);
  else if (rows === "conditions") {
    const { CONDITION_SLUGS } = await import(base + "conditions.mjs");
    R = (P.get("only")?.split(",") ?? CONDITION_SLUGS).map((cd) => [cd, () => ({ kind: "condition", cond: cd, mat: P.get("mat") ?? "neutral", cval: num("cval", 2), seek: 2.2 })]);
  }
  const colIds = rows === "functions" ? ["other", "self"] : rows === "strikes" ? ["hit", "crit", "miss"] : rows === "conditions" ? ["loop"] : cols;
  const grid = $("root"); grid.className = "sheet"; grid.style.gridTemplateColumns = "90px repeat(" + colIds.length * 2 + ", max-content)";
  grid.append(Object.assign(document.createElement("div"), { className: "h" }));
  for (const c of colIds) for (const vk of ["top", "side"]) grid.append(Object.assign(document.createElement("div"), { className: "h", textContent: c + " · " + vk }));
  const W = num("cw", 240), H = num("ch", 150), k = num("ck", 1);
  for (const [name, mk] of R) {
    grid.append(Object.assign(document.createElement("div"), { className: "rh", textContent: name }));
    for (const c of colIds) {
      const o = mk(c), t = P.has("seek") ? num("seek") : o.seek ?? 1;
      for (const vk of ["top", "side"]) {
        const cv = document.createElement("canvas"); cv.width = W; cv.height = H; grid.append(cv);
        try {
          const sim = compile(specFrom(o));
          while (sim.t < t) sim.step(STEP);
          const V = makeViews(cv, vk, k, W, H);
          // shrink the scene into the cell: tighter camera
          drawView(cv.getContext("2d"), V, [sim], o.kind === "strike" ? [{ ...CASTER, x: 11.3, y: 6.05 }, ...FOES] : [CASTER, ...FOES], 0, new Layers(V.wa + 2, V.ha + 2), new Blit());
        } catch (e) { fail(name + "/" + c + ": " + (e.stack ?? e)); }
      }
    }
  }
}

try { view === "sheet" ? await sheet() : stage(); } catch (e) { fail(e); }
</script>
</body></html>`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log("wrote " + OUT + "\nserve: node tools/preview-server.mjs 8990, then /.preview/fx.html");
