#!/usr/bin/env node
/**
 * tools/fx-canvas-preview.mjs — the SHIPPED 2D host (host-2d.mjs) and Director
 * on real PIXI 7, over a stand-in for Foundry's canvas (a stage, a primary
 * group, an interface group, tokens with meshes). It proves what the Node check
 * cannot: textures upload, sampling is nearest, layers sit where they should,
 * token reactions move the real mesh and give it back.
 *
 *   node tools/fx-canvas-preview.mjs && node tools/preview-server.mjs 8990
 *   then /.preview/fx-canvas.html?fx=all&zoom=1&floor=dark
 *
 * Params: fx (burst|strike|cone|line|condition|all), mat, zoom, floor
 * (dark|bright), loop (1 replays every 3 s). `window.__fx` exposes the
 * Director and the host; `#err` lists any error.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, ".preview/fx-canvas.html");

const html = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><title>Spellsprite canvas host</title>
<style>html,body{margin:0;background:#0b0a0f;color:#ccd;font:12px system-ui}#err{position:fixed;left:8px;bottom:8px;color:#ff8080;white-space:pre-wrap}</style>
<script src="https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js"></script>
</head><body><div id="err"></div>
<script type="module">
const err = (e) => { document.getElementById("err").textContent += (e?.stack ?? e) + "\n"; };
window.addEventListener("error", (e) => err(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => err(e.reason));
try {
const P = new URLSearchParams(location.search);
const zoom = Number(P.get("zoom") ?? 1), floor = P.get("floor") ?? "dark", which = P.get("fx") ?? "all", mat = P.get("mat") ?? "fire";
const W = 1100, H = 640, G = 100;
const app = new PIXI.Application({ width: W, height: H, background: 0x000000, antialias: false });
document.body.prepend(app.view);

/* ── a stand-in for Foundry's canvas ── */
const stage = app.stage;
stage.scale.set(zoom);
stage.pivot.set(600, 380);
stage.position.set(W / 2, H / 2);
const primary = new PIXI.Container(); primary.sortableChildren = true;
const iface = new PIXI.Container(); iface.sortableChildren = true;
stage.addChild(primary, iface);

const map = document.createElement("canvas"); map.width = 1400; map.height = 900;
const mc = map.getContext("2d");
const bright = floor === "bright";
mc.fillStyle = bright ? "#d8c9a3" : "#24222b"; mc.fillRect(0, 0, 1400, 900);
for (let i = 0; i < 260; i++) { mc.fillStyle = bright ? "rgba(120,90,50,0.08)" : "rgba(255,255,255,0.025)"; mc.fillRect((i * 97) % 1400, (i * 53) % 900, 40 + (i % 5) * 20, 30 + (i % 7) * 10); }
mc.strokeStyle = bright ? "rgba(80,60,30,0.25)" : "rgba(255,255,255,0.07)";
for (let x = 0; x <= 1400; x += G) { mc.beginPath(); mc.moveTo(x + 0.5, 0); mc.lineTo(x + 0.5, 900); mc.stroke(); }
for (let y = 0; y <= 900; y += G) { mc.beginPath(); mc.moveTo(0, y + 0.5); mc.lineTo(1400, y + 0.5); mc.stroke(); }
const background = new PIXI.Sprite(PIXI.Texture.from(map)); background.zIndex = 0;
primary.addChild(background);
primary.background = background;

function tokenTexture(color) {
  const c = document.createElement("canvas"); c.width = c.height = 200; const x = c.getContext("2d");
  x.fillStyle = "#141218"; x.beginPath(); x.arc(100, 100, 92, 0, Math.PI * 2); x.fill();
  x.fillStyle = color; x.beginPath(); x.ellipse(100, 140, 62, 44, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#e8c8a8"; x.beginPath(); x.arc(100, 82, 30, 0, Math.PI * 2); x.fill();
  x.lineWidth = 8; x.strokeStyle = color; x.beginPath(); x.arc(100, 100, 92, 0, Math.PI * 2); x.stroke();
  return PIXI.Texture.from(c);
}
const tokens = new Map();
function addToken(id, sx, sy, color) {
  const mesh = new PIXI.Sprite(tokenTexture(color));
  mesh.anchor.set(0.5); mesh.width = mesh.height = G * 0.92; mesh.position.set(sx * G, sy * G); mesh.zIndex = 700;
  primary.addChild(mesh);
  const t = { id, mesh, visible: true, get center() { return { x: mesh.position.x, y: mesh.position.y }; } };
  tokens.set(id, t);
  return t;
}
const caster = addToken("caster", 3.5, 4.5, "#5fb0ff");
const foe1 = addToken("foe1", 8.5, 3.5, "#e05a50");
const foe2 = addToken("foe2", 9.5, 4.5, "#e05a50");
const foe3 = addToken("foe3", 8.5, 5.5, "#e05a50");

globalThis.foundry = { canvas: { groups: { PrimaryCanvasGroup: { SORT_LAYERS: { TOKENS: 700, TILES: 500 } } } } };
globalThis.canvas = {
  ready: true, app, stage, primary, interface: iface,
  tokens: { get: (id) => tokens.get(id) ?? null, get placeables() { return [...tokens.values()]; } },
  dimensions: { size: G, rect: new PIXI.Rectangle(0, 0, 1400, 900) },
  grid: { size: G },
  scene: { id: "S", getFlag: () => null, background: { src: "map" } },
  environment: { darknessLevel: 0 },
};

const { Director } = await import("/scripts/features/pf2e-fx/director.mjs");
const { Host2D } = await import("/scripts/features/pf2e-fx/host-2d.mjs");
const { Budget } = await import("/scripts/core/budget.mjs");
const SHED = (await import("/scripts/features/pf2e-fx/constants.mjs")).SHED_ORDER;

const director = new Director({
  ladder: Budget.ladder("pf2e-fx", SHED),
  locate: (id) => { const t = tokens.get(id); return t ? { x: t.center.x / G, y: t.center.y / G } : null; },
});
const host = new Host2D(director, { get: (k) => (k === "floor" ? floor : true) });
host.attach();

const sq = (t, outcome = "hit") => ({ id: t.id, x: t.center.x / G, y: t.center.y / G, size: 1, h: 1.3, outcome });
const C = sq(caster);
const SPECS = {
  burst: () => ({ id: "m1", seed: 7, kind: "area", func: "harm", material: mat, rank: 3, outcome: "hit", caster: C,
    targets: [sq(foe1), sq(foe2, "crit"), sq(foe3, "miss")], area: { shape: "burst", x: 9, y: 4.5, r: 2 } }),
  strike: () => ({ id: "m2", seed: 3, kind: "strike", func: "harm", material: "kinetic", accent: mat === "kinetic" ? null : mat, rank: 3,
    outcome: "crit", weapon: { style: "slash" }, caster: { ...sq(foe1), x: 7.5, y: 3.5 }, targets: [sq(foe1, "crit")] }),
  cone: () => ({ id: "m3", seed: 5, kind: "area", func: "harm", material: mat, rank: 4, outcome: "hit", caster: C,
    targets: [sq(foe1), sq(foe2), sq(foe3)], area: { shape: "cone", x: C.x, y: C.y, r: 6, len: 6, dir: 0 } }),
  line: () => ({ id: "m4", seed: 9, kind: "area", func: "harm", material: mat, rank: 4, outcome: "hit", caster: C,
    targets: [sq(foe2)], area: { shape: "line", x: C.x, y: C.y, len: 7, width: 1, dir: 0 } }),
};
function playAll() {
  const list = which === "all" ? ["burst"] : [which];
  for (const k of list) if (SPECS[k]) director.play(SPECS[k](), { sceneId: "S" });
}
if (which === "condition" || which === "all") {
  director.startLoop("foe3:persistent-damage", { id: "c1", seed: 2, kind: "condition", func: "harm", material: mat, rank: 1,
    outcome: "neutral", targets: [sq(foe3)], condition: { slug: "persistent-damage", value: 2 } }, { sceneId: "S" });
  /* the loop follows its creature */
  let t0 = performance.now();
  app.ticker.add(() => { const u = (performance.now() - t0) / 1000; foe3.mesh.position.x = (8.5 + Math.sin(u) * 0.6) * G; });
}
playAll();
if (P.get("loop") !== "0") setInterval(playAll, 3000);
window.__fx = { director, host, app, tokens };

/* Headless Chrome delivers almost no animation frames under a virtual time
   budget: ?seek=<s> steps the shipped Director by hand, paints once through
   the shipped host and renders, for stills. */
if (P.has("seek")) {
  director.paused = true;
  director.sleep();
  app.ticker.stop();
  const seek = Number(P.get("seek")), dt = 1 / 60;
  for (let t = 0; t < seek; t += dt) {
    if (which === "condition" || which === "all") foe3.mesh.position.x = (8.5 + Math.sin(t) * 0.6) * G;
    director.advance(dt);
    try { host.tick(); } catch (e) {
      const d = ["flat", "light", "stand"].map((l) => l + ": canvas " + host.B[l].canvas.width + "x" + host.B[l].canvas.height + " box " + host.B[l].w + "x" + host.B[l].h
        + " base " + host.textures[l].baseTexture.width + "x" + host.textures[l].baseTexture.height + " res " + host.textures[l].baseTexture.resolution
        + " src " + (host.textures[l].baseTexture.resource?.source === host.B[l].canvas));
      throw new Error(e.message + "\n" + d.join("\n"));
    }
  }
  app.render();
}
const stat = document.createElement("div"); stat.id = "stat"; stat.style.cssText = "position:fixed;right:8px;top:8px";
document.body.append(stat);
stat.textContent = director.sims("S").map((e) => e.key + " t=" + e.sim.t.toFixed(2) + " parts=" + e.sim.parts.length).join(" | ");
} catch (e) { err(e); }
</script></body></html>`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log("wrote " + OUT + "\nserve: node tools/preview-server.mjs 8990, then /.preview/fx-canvas.html");
