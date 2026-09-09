#!/usr/bin/env node
/**
 * Boss Creatures — visual preview generator.
 *
 * Writes a page that renders the boss cards and the boss sheet panel against
 * the REAL stylesheets, and compiles the REAL FX_FRAG_TYRANT in a real WebGL
 * context. Both halves matter and for different reasons.
 *
 * The CSS half, because a boss's whole claim is that it is bigger and more
 * elaborate than the cards around it, and that is a claim about a *rail* — it
 * cannot be judged from a boss card on its own, only from one standing next to
 * the ordinary cards it is meant to out-measure. The page therefore renders a
 * mixed rail rather than a gallery of bosses.
 *
 * The shader half, because a fragment shader that fails to compile degrades to
 * nothing drawn rather than erroring: the card renders perfectly, the canvas
 * stays transparent, and the effect is simply absent. This page reports the
 * compile log instead of swallowing it.
 *
 *   node tools/boss-preview.mjs --out=.preview/boss.html
 *   node tools/preview-server.mjs 8951
 *
 * SERVE IT. A file:// page does not execute its module script, so opening the
 * output directly gives you cards with no liquid in them and no error either.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const { FX_FRAG_TYRANT } = await import(new URL("scripts/features/initiative/gl.mjs", ROOT).href);
const { ACTIVE_SHADER_PALETTE } = await import(new URL("scripts/features/initiative/constants.mjs", ROOT).href);

const P = ACTIVE_SHADER_PALETTE;
for (const key of ["tyrantBase", "tyrantMid", "tyrantHot"]) {
  if (!P?.[key]) throw new Error(`ACTIVE_SHADER_PALETTE.${key} is missing — the preview would paint black`);
}

// A stand-in portrait. Deliberately a flat silhouette rather than real art: the
// question this page answers is how much of the liquid the mask lets through,
// and a busy photograph hides the answer under its own detail.
const PORTRAIT =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E" +
  "%3Crect width='64' height='64' fill='%23243040'/%3E%3Ccircle cx='32' cy='24' r='11' fill='%234a5b73'/%3E" +
  "%3Cpath d='M10 62c0-13 10-22 22-22s22 9 22 22z' fill='%234a5b73'/%3E%3C/svg%3E";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Boss Creatures — review surface</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/initiative.css">
<link rel="stylesheet" href="/styles/pf2e-variant-rules-boss.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
  body {
    margin: 0;
    padding: 24px;
    background: var(--gl-ink-0);
    color: var(--gl-text);
    font-family: var(--gl-tech);
    display: grid;
    grid-template-columns: 420px 1fr;
    gap: 32px;
    align-items: start;
  }
  h2 {
    margin: 0 0 12px;
    font-family: var(--gl-display);
    font-size: 11px;
    letter-spacing: .18em;
    text-transform: uppercase;
    color: var(--gl-text-faint);
  }
  /* Stands in for PF2e's own sheet surface, which is where the panel lands. */
  .sheet-stub { padding: 16px; border-radius: var(--gl-cut); background: var(--gl-surface); }
  /* Stands in for the rail. The width is the shipping one; the boss overhang is
     only legible against a column the ordinary cards exactly fill. */
  .rail-stub { display: grid; gap: 5px; width: 260px; }
  .gl-btn {
    padding: 4px 10px; border: 1px solid var(--gl-edge); border-radius: var(--gl-cut-xs);
    background: var(--gl-surface-raised); color: var(--gl-text);
    font-family: var(--gl-tech); font-size: 10px; cursor: pointer;
  }
  .gl-btn-accent { border-color: var(--gl-accent); color: var(--gl-accent); }
  #status {
    grid-column: 1 / -1; order: -1; padding: 8px 12px;
    border-left: 3px solid var(--gl-accent); background: var(--gl-surface);
    font-size: 12px; white-space: pre-wrap;
  }
  #status.bad { border-left-color: var(--gl-peril, #e5484d); color: var(--gl-peril, #e5484d); }
  /* The liquid on its own, magnified. At rail size it is a few hundred pixels
     behind a portrait; this is where you can actually see what it is doing. */
  .zoom { width: 520px; height: 150px; display: block; image-rendering: pixelated; }
</style>
</head>
<body>
<div id="status">compiling…</div>

<div>
  <h2>NPC sheet — Supreme boss</h2>
  <div class="sheet-stub" id="panel-supreme"></div>
  <h2 style="margin-top:28px">NPC sheet — unmarked</h2>
  <div class="sheet-stub" id="panel-none"></div>
</div>

<div>
  <h2>Initiative rail — a boss among ordinary cards</h2>
  <div class="rail-stub gluni-initiative gluni-initiative--right" id="rail"></div>
  <h2 style="margin-top:28px">The liquid, 2&times; and unmasked</h2>
  <canvas class="zoom" id="zoom"></canvas>
</div>

<script type="module">
const C = "glvr-boss";
const PORTRAIT = ${JSON.stringify(PORTRAIT)};
const TYRANT = ${JSON.stringify(FX_FRAG_TYRANT)};
const PAL = ${JSON.stringify({ base: P.tyrantBase, mid: P.tyrantMid, hot: P.tyrantHot })};

const stat = (label, value) => \`<div class="\${C}-stat">
  <span class="\${C}-stat-label">\${label}</span><span class="\${C}-stat-value">\${value}</span></div>\`;

document.getElementById("panel-supreme").innerHTML = \`
<section class="\${C}-panel" data-tier="supreme" data-state="boss">
  <header class="\${C}-head">
    <span class="\${C}-title">Boss Creature</span>
    <span class="\${C}-tier">Supreme</span>
    <button type="button" class="\${C}-unmark"><i class="fa-solid fa-xmark"></i></button>
  </header>
  <div class="\${C}-stats">
    \${stat("Boss level", "12")}\${stat("Hit Points", "284 / 284")}\${stat("Boss DC", "29")}
    \${stat("Boss modifier", "+19")}\${stat("Turns per round", "3")}\${stat("XP value", "3x")}
    \${stat("Base level", "8")}
  </div>
  <section class="\${C}-group \${C}-live">
    <header class="\${C}-group-head"><span>Trigger now</span>
      <span class="\${C}-penalty">Defences -2 until its next initial turn</span></header>
    <ul class="\${C}-list">
      <li class="\${C}-row"><span class="\${C}-row-name">Weakness</span>
        <span class="\${C}-row-note">struck with cold iron</span>
        <button type="button" class="gl-btn \${C}-fire" disabled>Spent this round</button></li>
      <li class="\${C}-row"><span class="\${C}-row-name">Critical hit or failed save</span>
        <span class="\${C}-row-note"></span>
        <button type="button" class="gl-btn \${C}-fire">Trigger now</button></li>
      <li class="\${C}-row"><span class="\${C}-row-name">Protective</span>
        <span class="\${C}-row-note">its brood is attacked</span>
        <button type="button" class="gl-btn \${C}-fire">Trigger now</button></li>
    </ul>
    <p class="\${C}-note">Telegraphed: Grasping Appendages</p>
    <div class="\${C}-add">
      <select class="\${C}-pick-telegraph"><option>Grasping Appendages</option></select>
      <input type="text" class="\${C}-telegraph-target" value="the cleric">
      <button type="button" class="gl-btn gl-btn-accent">Telegraph</button>
      <button type="button" class="gl-btn">Clear telegraph</button>
    </div>
  </section>
  <section class="\${C}-group">
    <header class="\${C}-group-head"><span>Boss Abilities</span><span class="\${C}-count">3 of 3</span></header>
    <ul class="\${C}-list">
      <li class="\${C}-row"><span class="\${C}-row-name">Grasping Appendages</span>
        <span class="\${C}-row-cost">3 actions</span>
        <button type="button" class="\${C}-drop"><i class="fa-solid fa-xmark"></i></button></li>
      <li class="\${C}-row"><span class="\${C}-row-name">Impenetrable</span>
        <span class="\${C}-row-cost">passive</span>
        <button type="button" class="\${C}-drop"><i class="fa-solid fa-xmark"></i></button></li>
      <li class="\${C}-row"><span class="\${C}-row-name">Reactive Slam</span>
        <span class="\${C}-row-cost">free action</span>
        <button type="button" class="\${C}-drop"><i class="fa-solid fa-xmark"></i></button></li>
    </ul>
    <p class="\${C}-note">A boss carries at most 3 Boss Abilities.</p>
  </section>
  <section class="\${C}-group">
    <header class="\${C}-group-head"><span>Downfalls</span></header>
    <ul class="\${C}-list">
      <li class="\${C}-row"><span class="\${C}-row-name">Weakness</span>
        <input type="text" value="struck with cold iron">
        <button type="button" class="\${C}-drop-downfall"><i class="fa-solid fa-xmark"></i></button></li>
      <li class="\${C}-row"><span class="\${C}-row-name">Critical hit or failed save</span>
        <input type="text" value="" placeholder="e.g. struck by an auditory effect">
        <button type="button" class="\${C}-drop-downfall"><i class="fa-solid fa-xmark"></i></button></li>
      <li class="\${C}-row"><span class="\${C}-row-name">Protective</span>
        <input type="text" value="its brood is attacked">
        <button type="button" class="\${C}-drop-downfall"><i class="fa-solid fa-xmark"></i></button></li>
    </ul>
    <p class="\${C}-note is-good">3 downfall(s), matching its abilities.</p>
    <div class="\${C}-add">
      <select class="\${C}-pick-trigger"><option>Action</option></select>
      <button type="button" class="gl-btn gl-btn-accent">Add downfall</button>
    </div>
  </section>
  <div class="\${C}-actions">
    <button type="button" class="gl-btn \${C}-mark">Greater</button>
  </div>
</section>\`;

document.getElementById("panel-none").innerHTML = \`
<section class="\${C}-panel" data-state="none">
  <header class="\${C}-head"><span class="\${C}-title">Boss Creature</span></header>
  <p class="\${C}-empty">This creature is not a boss.</p>
  <div class="\${C}-actions">
    <button type="button" class="gl-btn \${C}-mark">Greater</button>
    <button type="button" class="gl-btn \${C}-mark">Supreme</button>
  </div>
</section>\`;

// The real card markup, transcribed from gluniverse-initiative.mjs. \`fx\` adds
// the dread canvas with its shipping class, so the CSS decides where it stacks.
const card = ({ name, cls, tags, init, fx }) => \`
<article class="gluni-card \${cls}">
  <div class="gluni-card-surface">
    <div class="gluni-card-accent" aria-hidden="true"></div>
    <div class="gluni-card-spec" aria-hidden="true"></div>
    <div class="gluni-card-bracket" aria-hidden="true"></div>
    <div class="gluni-card-portrait-wrap">
      <img class="gluni-card-portrait" src="\${PORTRAIT}" alt="">
      <div class="gluni-card-glass" aria-hidden="true"></div>
    </div>
    \${fx ? \`<canvas class="gluni-card-portrait-fx gluni-card-portrait-fx--dread" data-fx="dread" data-fx-intensity="\${fx}" aria-hidden="true"></canvas>\` : ""}
    <div class="gluni-card-content">
      <div class="gluni-card-kicker">\${tags}</div>
      <h3>\${name}</h3>
    </div>
    <span class="gluni-initiative-badge">\${init}</span>
  </div>
</article>\`;

const bossTag = \`<span class="gluni-boss-tag">BOSS</span>\`;
const turnTag = (i, n) => \`<span class="gluni-boss-tag gluni-boss-tag--turn">Turn \${i} of \${n}</span>\`;

document.getElementById("rail").innerHTML = [
  card({ name: "Ashen Tyrant", cls: "gluni-card--hostile gluni-card--boss gluni-card--boss-supreme",
         tags: bossTag, init: "20", fx: 1.45 }),
  card({ name: "Seri Voss", cls: "gluni-card--friendly", tags: "", init: "18" }),
  card({ name: "Ashen Tyrant", cls: "gluni-card--hostile gluni-card--boss gluni-card--boss-supreme gluni-card--boss-extra",
         tags: bossTag + turnTag(2, 3), init: "16.5", fx: 0.87 }),
  card({ name: "Brack", cls: "gluni-card--hostile", tags: "", init: "15" }),
  card({ name: "Ondine", cls: "gluni-card--friendly", tags: "", init: "12" }),
  card({ name: "Warden Kel", cls: "gluni-card--hostile gluni-card--boss gluni-card--boss-greater",
         tags: bossTag, init: "9", fx: 1 }),
  card({ name: "Toll-Keeper", cls: "gluni-card--hostile", tags: "", init: "7" })
].join("");

/*
 * The shader, in a raw WebGL1 context.
 *
 * WebGL1 on purpose: PIXI authors its filters in GLSL ES 1.00 and transpiles
 * them if it happens to be running on a WebGL2 context, so ES 1.00 is the
 * source of truth and a WebGL1 compile is the faithful test of it. The vertex
 * shader reproduces PIXI's filter contract — vTextureCoord across 0..1 of the
 * quad with y increasing DOWNWARD, which is texture space, not clip space. Get
 * that backwards and the liquid settles upward and nothing says so.
 */
const VERT = \`attribute vec2 aPos;
varying vec2 vTextureCoord;
void main(void){
  vTextureCoord = vec2(aPos.x*0.5+0.5, 0.5-aPos.y*0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}\`;

const status = document.getElementById("status");
const fail = (msg) => { status.className = "bad"; status.textContent = msg; };

function makeProgram(gl) {
  const compile = (type, src, label) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(label + " did not compile:\\n" + gl.getShaderInfoLog(sh));
    }
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT, "preview vertex shader"));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, "precision highp float;\\n" + TYRANT, "FX_FRAG_TYRANT"));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link failed:\\n" + gl.getProgramInfoLog(prog));
  return prog;
}

const targets = [...document.querySelectorAll(".gluni-card-portrait-fx--dread")]
  .map((cv) => ({ cv, intensity: Number(cv.dataset.fxIntensity) || 1, zoom: 1 }));
targets.push({ cv: document.getElementById("zoom"), intensity: 1.45, zoom: 2 });

let gl, prog, loc;
try {
  const host = document.createElement("canvas");
  gl = host.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) throw new Error("no WebGL context — this page cannot judge the effect");
  prog = makeProgram(gl);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  loc = Object.fromEntries(["uTime","uSeed","uAspect","uIntensity","uTyrantBase","uTyrantMid","uTyrantHot"]
    .map((n) => [n, gl.getUniformLocation(prog, n)]));
  for (const [n, v] of [["uTyrantBase", PAL.base], ["uTyrantMid", PAL.mid], ["uTyrantHot", PAL.hot]]) {
    if (loc[n] === null) throw new Error(n + " is declared nowhere in FX_FRAG_TYRANT — the palette is not reaching the shader");
  }
  status.textContent = "FX_FRAG_TYRANT compiled and linked. " + targets.length + " surfaces running.";
} catch (err) {
  fail(String(err.message || err));
}

if (gl && prog) {
  const t0 = performance.now();
  const seeds = targets.map(() => Math.random() * 100);
  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    targets.forEach((target, i) => {
      const { cv, intensity, zoom } = target;
      const w = Math.max(1, Math.round(cv.clientWidth / zoom));
      const h = Math.max(1, Math.round(cv.clientHeight / zoom));
      if (!cv.clientWidth) return;
      if (gl.canvas.width !== w || gl.canvas.height !== h) { gl.canvas.width = w; gl.canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(loc.uTime, t);
      gl.uniform1f(loc.uSeed, seeds[i]);
      gl.uniform1f(loc.uAspect, w / h);
      gl.uniform1f(loc.uIntensity, intensity);
      gl.uniform3fv(loc.uTyrantBase, PAL.base);
      gl.uniform3fv(loc.uTyrantMid, PAL.mid);
      gl.uniform3fv(loc.uTyrantHot, PAL.hot);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(gl.canvas, 0, 0);
    });
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
</script>
</body>
</html>
`;

const out = flag("out") || ".preview/boss.html";
const path = fileURLToPath(new URL(out, ROOT));
await mkdir(dirname(path), { recursive: true });
await writeFile(path, html);
console.log(`boss preview → ${out}\nserve it: node tools/preview-server.mjs 8951`);
