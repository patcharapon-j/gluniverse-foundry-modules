/**
 * Combat Intro — contact sheet for the Aegis Fallen backdrop.
 *
 * Writes .preview/combat-intro-aegis.html, a page that compiles the REAL program
 * (backdrop.mjs's PRELUDE + skinDeclarations + skins/aegis.mjs's fragment) in a
 * WebGL2 context, drives it with the skin's own `write()` and draws every beat
 * into one sheet. Compile/link errors are printed into `.err` on the page.
 *
 *   node tools/combat-intro-aegis-sheet.mjs                 write the page only
 *   node tools/combat-intro-aegis-sheet.mjs --shot=.preview/aegis-sheet.png
 *        also serve the repo and capture it with headless Chrome (swiftshader)
 *   node tools/combat-intro-aegis-sheet.mjs --dump          print the page's error/timing panel
 *   node tools/combat-intro-aegis-sheet.mjs --dump --gpu --query="w=1920&h=1080&bench=60"
 *        time every beat at 1080p on the real GPU (ms/frame, averaged over 60 draws)
 *
 * Serve it yourself otherwise: `node tools/preview-server.mjs`, then
 * /.preview/combat-intro-aegis.html (a file:// page does not run module scripts).
 * Page params (pass through --query=...): w=480&h=270 cell size, only=3,14 cell indices,
 * cols=2, shed=misprint,embers, time=12.3.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = join(ROOT, ".preview/combat-intro-aegis.html");
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}`))?.split("=")[1] ?? (process.argv.includes(`--${k}`) ? "" : null);

const PAGE = /* html */ `<!doctype html>
<meta charset="utf-8">
<title>Aegis backdrop sheet</title>
<style>
  body { margin: 0; background: #050303; color: #ffb4a8; font: 12px/1.3 "JetBrains Mono", monospace; }
  .err { white-space: pre-wrap; color: #f6c01e; padding: 8px; }
  canvas#sheet { display: block; }
</style>
<div class="err" id="err"></div>
<canvas id="sheet"></canvas>
<script type="module">
import skin from "../scripts/features/combat-intro/skins/aegis.mjs";
import { fragmentSource } from "../scripts/features/combat-intro/backdrop.mjs";

const q = new URLSearchParams(location.search);
const W = Number(q.get("w") || 480), H = Number(q.get("h") || 270);
const shed = new Set((q.get("shed") || "").split(",").filter(Boolean));
const TIME = Number(q.get("time") || 17.3);
const err = document.getElementById("err");
const log = (s) => { err.textContent += s + "\\n"; };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const PAL = { uAccent: hex("#ff3b2f"), uHot: hex("#ffb4a8"), uInk: hex("#0a0606"), uWarn: hex("#f6c01e") };

// Anchors, as fractions of the cell; converted to drawing-buffer px.
const ROSTER = [[.16,.30,.11,0],[.16,.47,.11,0],[.16,.64,.11,0],[.16,.81,.11,0],[.84,.36,.11,0],[.84,.58,.11,0],[.84,.78,.11,0]];
const TABLE = [[.2,.36,.16,2],[.4,.36,.16,1],[.6,.36,.16,2],[.8,.36,.16,0],[.3,.78,.08,2],[.42,.78,.08,2],[.54,.78,.08,1],[.66,.78,.08,0]];
const SORTED = [[.25,.2,.12,2],[.55,.34,.12,2],[.35,.48,.12,2],[.7,.62,.12,2],[.45,.76,.12,2]];

const CELLS = [
  ["intro","boot",.3,ROSTER], ["intro","boot",.85,ROSTER],
  ["intro","roster",.2,ROSTER], ["intro","roster",.5,ROSTER], ["intro","roster",.86,ROSTER],
  ["intro","title",.12,ROSTER], ["intro","title",.4,ROSTER], ["intro","title",.8,ROSTER],
  ["intro","threat",.35,ROSTER,4], ["intro","threat",.9,ROSTER,1],
  ["intro","out",.2,[]], ["intro","out",.45,[]], ["intro","out",.7,[]], ["intro","out",.92,[]],
  ["rolling","",0,TABLE], ["rolling","",0,TABLE,-1,true],
  ["sorting","hold",.5,SORTED], ["sorting","move",.5,SORTED],
  ["handoff","collapse",.45,SORTED], ["handoff","collapse",.95,SORTED], ["handoff","dock",.25,SORTED], ["handoff","dock",.85,SORTED],
];
const ONLY = (q.get("only") || "").split(",").filter(Boolean).map(Number);
const PICK = ONLY.length ? CELLS.filter((_, i) => ONLY.includes(i)) : CELLS;
const COLS = Number(q.get("cols") || (ONLY.length ? 1 : 4));
const ROWS = Math.ceil(PICK.length / COLS);

const gl = new OffscreenCanvas(W, H).getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true });
if (!gl) { log("NO WEBGL2"); throw new Error("no webgl2"); }
const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) log("COMPILE " + gl.getShaderInfoLog(s)); return s; };
const prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, "#version 300 es\\nin vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}"));
gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fragmentSource(skin)));
gl.bindAttribLocation(prog, 0, "aPos");
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) log("LINK " + gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

// Every declared skin uniform must be live in the program.
for (const { name } of skin.uniforms) if (!gl.getUniformLocation(prog, name)) log("UNUSED/OPTIMISED OUT " + name);

const set = (name, v) => {
  const loc = gl.getUniformLocation(prog, name);
  if (!loc) return;
  if (typeof v === "number") gl.uniform1f(loc, v);
  else if (v.length === 2) gl.uniform2fv(loc, v);
  else if (v.length === 3) gl.uniform3fv(loc, v);
  else gl.uniform4fv(loc, v);
};

const sheet = document.getElementById("sheet");
sheet.width = W * COLS; sheet.height = H * ROWS;
const ctx = sheet.getContext("2d");
const PHASE = { intro: 0, rolling: 1, sorting: 2, handoff: 3 };
let totalMs = 0;
PICK.forEach(([phase, beat, t, anchors, severity = 2, flare = false], i) => {
  const u = {};
  const fx = new Float32Array(48).fill(-1);
  if (flare) { fx[1] = .05; fx[9] = .25; fx[17] = .02; }
  skin.write(u, { phase, beatName: beat, beat, beatT: t, phaseT: t, time: TIME, severity, anchorFx: fx, allows: (n) => !shed.has(n) });
  for (const [k, v] of Object.entries(u)) set(k, v);
  for (const [k, v] of Object.entries(PAL)) set(k, v);
  set("uRes", [W, H]); set("uTime", TIME); set("uPhase", PHASE[phase]); set("uBeat", 0); set("uBeatT", t); set("uPhaseT", t);
  set("uShed", 0); set("uIntensity", 1);
  const a = new Float32Array(48);
  anchors.forEach(([x, y, s, w], k) => a.set([x * W, y * H, s * H, w], k * 4));
  gl.uniform4fv(gl.getUniformLocation(prog, "uAnchors"), a);
  set("uAnchorN", anchors.length);
  gl.viewport(0, 0, W, H);
  const t0 = performance.now();
  const reps = Number(q.get("bench") || 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  if (reps > 1) {
    const b0 = performance.now();
    for (let r = 0; r < reps; r++) gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    log(phase + "." + beat + " t=" + t + ": " + ((performance.now() - b0) / reps).toFixed(2) + " ms/frame");
  }
  totalMs += performance.now() - t0;
  const x = (i % COLS) * W, y = Math.floor(i / COLS) * H;
  ctx.drawImage(gl.canvas, x, y);
  ctx.fillStyle = "#f6c01e"; ctx.fillText(phase + (beat ? "." + beat : "") + " t=" + t + (flare ? " +flare" : ""), x + 6, y + 14);
  ctx.strokeStyle = "#3a1f1f"; ctx.strokeRect(x + .5, y + .5, W - 1, H - 1);
});
log("OK " + PICK.length + " cells, avg " + (totalMs / PICK.length).toFixed(1) + " ms/cell (swiftshader, " + W + "x" + H + ")");
document.title = "done";
</script>
`;

await mkdir(join(ROOT, ".preview"), { recursive: true });
await writeFile(OUT, PAGE);
console.log("wrote " + OUT);

const shot = arg("shot");
const dump = arg("dump") != null;
if (shot == null && !dump) process.exit(0);

const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { "content-type": TYPES[extname(rel)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const query = process.argv.find((a) => a.startsWith("--query="))?.slice(8) ?? "";
const url = `http://127.0.0.1:${port}/.preview/combat-intro-aegis.html${query ? "?" + query : ""}`;
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!CHROME) { console.log("SKIP  no Chrome found"); server.close(); process.exit(0); }
const base = ["--headless=new", ...(arg("gpu") != null ? ["--use-angle=metal", "--enable-gpu"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]), "--hide-scrollbars", "--virtual-time-budget=15000", "--disable-gpu-sandbox"];
const run = (extra) => new Promise((res) => {
  // spawn asynchronously so this process keeps serving while Chrome loads the page
  import("node:child_process").then(({ spawn }) => {
    const p = spawn(CHROME, [...base, ...extra, url]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => res(out));
  });
});
if (dump) {
  const dom = await run(["--dump-dom"]);
  console.log((dom.match(/<div class="err" id="err">([\s\S]*?)<\/div>/) || [, "(no panel)"])[1]);
}
if (shot != null) {
  const file = join(ROOT, shot || ".preview/aegis-sheet.png");
  await run([`--screenshot=${file}`, "--window-size=" + (arg("size") || "1920,1700")]);
  console.log("shot " + file);
}
server.close();
