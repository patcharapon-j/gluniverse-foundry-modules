#!/usr/bin/env node
/**
 * Compile and measure the PF2e Ultimates token shaders in a real GL context.
 *
 * The three overlay shaders (gel body, gel energy, token ring) draw everything
 * in the quad's UV space, so how large a feature lands on screen depends on how
 * many device pixels the quad happens to cover — which changes with the scene's
 * grid size and the canvas zoom. Written unfiltered, a rim like
 * `exp(-|r - R| * 145.0)` is a comfortable 1.4px on a 200px quad and 0.3px on a
 * 45px one (a medium token's ring on a grid-50 map, zoomed out over a big
 * scene), at which point it stops being a rim and starts crawling between pixel
 * centres every frame. That is the aliasing this checks for, and no diff can
 * show you it is gone.
 *
 *   node tools/ultimate-overlay-check.mjs
 *   node tools/ultimate-overlay-check.mjs --sheet=/tmp/ult.png
 *
 * For each shader and each quad size it renders three things:
 *   - unfiltered (uTexel 0 — exactly what the shader did before the fix),
 *   - filtered   (uTexel 1/size — what it does now),
 *   - a ground truth: the unfiltered shader supersampled 8x8 and box-averaged
 *     down, i.e. what each pixel genuinely *should* show.
 * and reports, against that truth, the error of each; plus temporal flicker
 * (frame to frame) and jitter (under a half-pixel pan), which are what the eye
 * actually reads as "buzzing".
 *
 * Exit code is non-zero if a shader fails to compile or link, if the filtering
 * is not inert at uTexel 0 (it must degrade to the original look, not to a
 * blank quad), if it visibly changes the look when there IS room for the
 * detail, or if it fails to reduce the error and the flicker when there is not.
 */

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sheetArg = process.argv.find((a) => a.startsWith("--sheet="));
// Outside the repo by default: this package ships as its own source tree, so a
// generated PNG left in tools/ would be installed into every world.
const SHEET = sheetArg ? sheetArg.slice("--sheet=".length) : join(tmpdir(), "gl-ultimate-overlay.png");

const TYPES = { ".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };
const PAGE_ROUTE = "/__ultimate-overlay-check";

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<script type="module">
import {
  VERTEX_SHADER, SCALE_PRELUDE,
  MATERIAL_FRAGMENT_SHADER, FRAGMENT_SHADER, RING_FRAGMENT_SHADER,
} from "/scripts/features/pf2e-ultimates/token-overlay.mjs";

const SHADERS = [
  { key: "gel body",   src: MATERIAL_FRAGMENT_SHADER, icon: true },
  { key: "gel energy", src: FRAGMENT_SHADER,          icon: true },
  { key: "token ring", src: RING_FRAGMENT_SHADER,     icon: false },
];

/* Quad widths in device pixels. The overlay sizes its ring at 1.5x the token
   and its gel at ~28px of world space, so these span "zoomed in on a grid-100
   map" down to "grid-50 map, zoomed out", which is where the report came from. */
const SIZES = [512, 150, 75, 40, 24];
const SS = 8;              // supersampling factor for the ground truth
const SS_MAX = 1600;       // …capped, so the 512px cell does not ask for 4096^2
const FRAMES = 6;          // frames sampled for the shimmer measure
const SEED = 37.5;
const COLOR = [0.369, 0.918, 1.0];   // the feature's default #5eeaff

const canvas = document.createElement("canvas");
const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true })
  ?? canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true });
const problems = [];

function compile(type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, "precision highp float;\\n" + src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    problems.push(label + " compile failed: " + gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

function link(fragment, label) {
  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER, label + " vertex");
  const fs = compile(gl.FRAGMENT_SHADER, fragment, label + " fragment");
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    problems.push(label + " link failed: " + gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

/* A synthetic glyph in the shape the real icon mask has: opaque white on a
   transparent field, 256px and mipmapped, so the alpha-threshold path is
   exercised the same way a Font Awesome star exercises it. */
function iconTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? 44 : 104;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = 128 + Math.cos(angle) * radius;
    const y = 128 + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1]), gl.STATIC_DRAW);
const index = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

const TEX = iconTexture();

/**
 * Draw one frame and read it back. The size is the quad width in device pixels,
 * texel is the value handed to the shader (0 = the unfiltered original), and
 * jitter is a subpixel pan, which is how a shimmering feature gives itself away.
 */
function render(program, size, { texel, time, jitter = 0, hasIcon }) {
  canvas.width = canvas.height = size;
  gl.viewport(0, 0, size, size);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  const stride = 16;
  const pos = gl.getAttribLocation(program, "aVertexPosition");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, stride, 0);
  const uvs = gl.getAttribLocation(program, "aUvs");
  gl.enableVertexAttribArray(uvs);
  gl.vertexAttribPointer(uvs, 2, gl.FLOAT, false, stride, 8);

  const j = jitter / size;
  const set = (name, value) => {
    const loc = gl.getUniformLocation(program, name);
    if (loc) value(loc);
  };
  // Column-major, matching PIXI's mat3 upload: pan by the jitter, then map the
  // unit quad onto the whole viewport.
  set("translationMatrix", (l) => gl.uniformMatrix3fv(l, false, new Float32Array([1, 0, 0, 0, 1, 0, j, j, 1])));
  set("projectionMatrix", (l) => gl.uniformMatrix3fv(l, false, new Float32Array([2, 0, 0, 0, 2, 0, -1, -1, 1])));
  set("uTime", (l) => gl.uniform1f(l, time));
  set("uSeed", (l) => gl.uniform1f(l, SEED));
  set("uTexel", (l) => gl.uniform1f(l, texel));
  set("uColor", (l) => gl.uniform3fv(l, new Float32Array(COLOR)));
  if (hasIcon) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, TEX);
    set("uIcon", (l) => gl.uniform1i(l, 0));
  }

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** Box-average an SSxSS supersampled render down to the target size. */
function downsample(pixels, size, factor) {
  const out = new Uint8Array(size * size * 4);
  const wide = size * factor;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * wide + x * factor + sx) * 4;
          acc[0] += pixels[i]; acc[1] += pixels[i + 1]; acc[2] += pixels[i + 2]; acc[3] += pixels[i + 3];
        }
      }
      const n = factor * factor;
      const o = (y * size + x) * 4;
      out[o] = acc[0] / n; out[o + 1] = acc[1] / n; out[o + 2] = acc[2] / n; out[o + 3] = acc[3] / n;
    }
  }
  return out;
}

/** RMS difference over the three colour channels, in 0-255 units. */
function rms(a, b) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; sum += d * d; n++; }
  }
  return Math.sqrt(sum / n);
}

function maxDelta(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a[i + c] - b[i + c]));
  }
  return worst;
}

/** Per-pixel change from one image to the next. */
function delta(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = b[i] - a[i];
  return out;
}

/** RMS difference between two difference images, in 0-255 units. */
function rmsDelta(a, b) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; sum += d * d; n++; }
  }
  return Math.sqrt(sum / n);
}

/**
 * Movement the pixel should not be showing. Measuring raw frame-to-frame change
 * would be measuring the effect's own animation — these shaders breathe and
 * flicker on purpose — so compare each frame's change against the change the
 * supersampled truth makes over the same step. What is left is shimmer.
 */
function shimmer(frames, truthFrames) {
  let total = 0;
  for (let f = 1; f < frames.length; f++) {
    total += rmsDelta(delta(frames[f - 1], frames[f]), delta(truthFrames[f - 1], truthFrames[f]));
  }
  return total / (frames.length - 1);
}

/* The prelude promises that at uTexel 0 every clamp is inert, so a shader that
   never receives the uniform keeps its original look instead of going blank.
   Check that against the raw expressions rather than trusting the reading. */
const PROBE = SCALE_PRELUDE + \`
varying vec2 vTextureCoord;
uniform float uTime;
uniform float uSeed;
uniform vec3 uColor;
void main(void) {
  vec2 uv = vTextureCoord - vec2(0.5);
  float r = length(uv);
  float d = 0.0;
  d = max(d, abs(glFalloff(r - 0.335, 145.0) - exp(-abs(r - 0.335) * 145.0)));
  d = max(d, abs(glGauss(r - 0.196, 43.0) - exp(-pow((r - 0.196) * 43.0, 2.0))));
  d = max(d, abs(glPoint(r, 22.0) - exp(-abs(r) * 22.0)));
  d = max(d, abs(glSpot(r, 18.166) - exp(-r * r * 330.0)));
  d = max(d, abs(glEdge(0.30, 0.335, r) - smoothstep(0.30, 0.335, r)));
  d = max(d, abs(glEdge(0.19, 0.04, r) - smoothstep(0.19, 0.04, r)));
  d = max(d, abs(glDetail(0.011) - 1.0));
  d = max(d, abs(glMask(r * 2.0, 0.10, 0.62) - smoothstep(0.10, 0.62, r * 2.0)));
  float n = fract(sin(uv.x * 91.7 + uv.y * 33.1) * 4371.3);
  d = max(d, abs(glRidge(n, 0.020, 0.077) - pow(1.0 - abs(2.0 * n - 1.0), 2.4)));
  d = max(d, abs(glLobe(sin(r * 30.0), 18.0, 0.045) - pow(max(0.0, sin(r * 30.0)), 18.0)));
  gl_FragColor = vec4(vec3(d * 200.0), 1.0);
}\`;

window.run = () => {
  if (!gl) return { error: "no WebGL context" };
  const probeProgram = link(PROBE, "prelude probe");
  const programs = SHADERS.map((s) => ({ ...s, program: link(s.src, s.key) }));
  if (!probeProgram || programs.some((p) => !p.program)) return { error: "shaders did not build", problems };

  const probe = render(probeProgram, 128, { texel: 0, time: 3.1, hasIcon: false });
  let inertDrift = 0;
  for (let i = 0; i < probe.length; i += 4) inertDrift = Math.max(inertDrift, probe[i]);

  const results = [];
  const sheet = [];
  for (const { key, program, icon } of programs) {
    for (const size of SIZES) {
      const factor = Math.max(2, Math.min(SS, Math.floor(SS_MAX / size)));
      const draw = (texel, time, jitter) => render(program, size, { texel, time, jitter, hasIcon: icon });
      const truth = (time, jitter) =>
        downsample(render(program, size * factor, { texel: 0, time, jitter: jitter * factor, hasIcon: icon }), size, factor);

      const framesTruth = [];
      const framesBefore = [];
      const framesAfter = [];
      for (let f = 0; f < FRAMES; f++) {
        const time = 3.1 + f / 60;
        framesTruth.push(truth(time, 0));
        framesBefore.push(draw(0, time, 0));
        framesAfter.push(draw(1 / size, time, 0));
      }

      // Half a pixel of pan: the same comparison in space rather than time.
      const panTruth = delta(framesTruth[0], truth(3.1, 0.5));
      const panBefore = delta(framesBefore[0], draw(0, 3.1, 0.5));
      const panAfter = delta(framesAfter[0], draw(1 / size, 3.1, 0.5));

      results.push({
        key, size, factor,
        errorBefore: rms(framesBefore[0], framesTruth[0]),
        errorAfter: rms(framesAfter[0], framesTruth[0]),
        shimmerBefore: shimmer(framesBefore, framesTruth),
        shimmerAfter: shimmer(framesAfter, framesTruth),
        jitterBefore: rmsDelta(panBefore, panTruth),
        jitterAfter: rmsDelta(panAfter, panTruth),
        drift: maxDelta(framesBefore[0], framesAfter[0]),
      });
      sheet.push({
        key, size,
        before: Array.from(framesBefore[0]),
        after: Array.from(framesAfter[0]),
        truth: Array.from(framesTruth[0]),
      });
    }
  }
  return { problems, inertDrift, results, sheet };
};
</script></body>`;

const origin = await (async () => {
  const server = createServer(async (req, res) => {
    const route = req.url.split("?")[0];
    if (route === PAGE_ROUTE) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(PAGE);
    }
    const path = normalize(join(ROOT, decodeURIComponent(route)));
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  globalThis.__server = server;
  return `http://127.0.0.1:${server.address().port}`;
})();

// Playwright is a dev convenience, not a dependency — the repo has no
// package.json and Foundry consumes the source directly. Resolve it wherever it
// happens to live (local install, or the global root) rather than pinning one.
const { createRequire } = await import("node:module");
const require_ = createRequire(import.meta.url);
const GLOBAL_ROOTS = ["/opt/node22/lib/node_modules", "/usr/lib/node_modules", "/usr/local/lib/node_modules"];
let playwrightPath;
try {
  playwrightPath = require_.resolve("playwright", { paths: [ROOT, ...GLOBAL_ROOTS] });
} catch {
  console.log("SKIP  playwright is not installed — cannot compile the shaders without a browser");
  console.log("      npm i -g playwright   (Chromium is already present in this image)");
  globalThis.__server.close();
  process.exit(0);
}
const pw = await import(playwrightPath);
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
});
const page = await browser.newPage();
const consoleProblems = [];
page.on("console", (m) => { if (m.type() === "error") consoleProblems.push(m.text()); });
page.on("pageerror", (e) => consoleProblems.push(String(e)));

await page.goto(`${origin}${PAGE_ROUTE}`);
try {
  await page.waitForFunction(() => typeof window.run === "function", null, { timeout: 20000 });
} catch {
  for (const p of consoleProblems) console.log("  browser:", p);
  console.log("FAIL  the check page never finished loading (see above)");
  await browser.close();
  globalThis.__server.close();
  process.exit(1);
}
const result = await page.evaluate(() => window.run());

let sheetPng = null;
if (!result.error) {
  sheetPng = await page.evaluate((sheet) => {
    const CELL = 96;
    const PAD = 26;
    const cols = [...new Set(sheet.map((s) => s.size))];
    const rows = [...new Set(sheet.map((s) => s.key))];
    const variants = ["before", "after", "truth"];
    const c = document.createElement("canvas");
    c.width = PAD * 2 + 90 + cols.length * (CELL * 3 + 18);
    c.height = PAD * 2 + 40 + rows.length * (CELL + 34);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = "12px monospace";
    ctx.imageSmoothingEnabled = false;
    cols.forEach((size, i) => {
      ctx.fillStyle = "#8fa3b8";
      ctx.fillText(`${size}px quad   before / after / truth`, PAD + 90 + i * (CELL * 3 + 18), PAD + 14);
    });
    rows.forEach((key, r) => {
      const y = PAD + 40 + r * (CELL + 34);
      ctx.fillStyle = "#8fa3b8";
      ctx.fillText(key, PAD, y + CELL / 2);
      cols.forEach((size, i) => {
        const cell = sheet.find((s) => s.key === key && s.size === size);
        variants.forEach((variant, v) => {
          const img = new ImageData(new Uint8ClampedArray(cell[variant]), size, size);
          const tmp = document.createElement("canvas");
          tmp.width = tmp.height = size;
          tmp.getContext("2d").putImageData(img, 0, 0);
          const x = PAD + 90 + i * (CELL * 3 + 18) + v * (CELL + 4);
          // GL reads bottom-up; flip so the sheet matches what the canvas shows.
          ctx.save();
          ctx.translate(x, y + CELL);
          ctx.scale(1, -1);
          ctx.drawImage(tmp, 0, 0, CELL, CELL);
          ctx.restore();
        });
      });
    });
    return c.toDataURL("image/png");
  }, result.sheet);
}

await browser.close();
globalThis.__server.close();

for (const p of consoleProblems) console.log("  browser:", p);
for (const p of result.problems ?? []) console.log("  gl:", p);

if (result.error) {
  console.log(`FAIL  ${result.error}`);
  process.exit(1);
}

let failed = 0;
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "  ok  " : "FAIL  "}${label}${extra ? "  → " + extra : ""}`);
  if (!cond) failed++;
};
const f = (v) => v.toFixed(2);

console.log("PF2e Ultimates — token overlay shaders\n");
ok(true, "all three shaders compile and link");
ok(result.inertDrift === 0, "at uTexel 0 the filtering is inert", `worst helper drift ${result.inertDrift}/200 units`);

console.log("  Every number is an error against a box-filtered ground truth, in 0-255 rms:");
console.log("  what the pixel shows, how it moves between frames, how it moves under a pan.\n");
console.log("  shader       quad   ss   still            per frame        half-px pan");
for (const r of result.results) {
  console.log(
    `  ${r.key.padEnd(11)}  ${String(r.size).padStart(4)}  ${String(r.factor).padStart(2)}x  `
    + `${f(r.errorBefore).padStart(6)} → ${f(r.errorAfter).padStart(6)}   `
    + `${f(r.shimmerBefore).padStart(6)} → ${f(r.shimmerAfter).padStart(6)}   `
    + `${f(r.jitterBefore).padStart(6)} → ${f(r.jitterAfter).padStart(6)}`
  );
}
console.log("");

// Where there is room for the detail, the filtering must not be visible: the
// point is to fix the small sizes, not to restyle the effect.
for (const r of result.results.filter((x) => x.size === 512)) {
  ok(r.drift <= 6, `${r.key}: unchanged where there is room for it`, `worst channel drift ${r.drift}/255 at 512px`);
}

// The filtering may not push a still frame meaningfully further from the truth.
// A few percent is allowed and expected: spreading a sub-pixel band over a
// slightly wider one buys most of the temporal win below, and a still frame is
// not what anyone complained about.
for (const r of result.results) {
  ok(
    r.errorAfter <= r.errorBefore * 1.15,
    `${r.key} @ ${r.size}px: no further from what the pixel should show`,
    `${f(r.errorBefore)} → ${f(r.errorAfter)} rms`
  );
}

// And where the quad is too small for the detail, the shimmer has to actually
// go: movement that the truth does not make is the thing being reported.
for (const r of result.results.filter((x) => x.size <= 75)) {
  // The gel body is all but static — only its caustics drift — so its shimmer
  // sits on the measurement floor and a ratio there would assert nothing.
  if (r.shimmerBefore > 0.5) {
    ok(
      r.shimmerAfter < r.shimmerBefore * 0.75,
      `${r.key} @ ${r.size}px: shimmers less between frames`,
      `${f(r.shimmerBefore)} → ${f(r.shimmerAfter)} rms/frame`
    );
  }
  ok(
    r.jitterAfter < r.jitterBefore * 0.85,
    `${r.key} @ ${r.size}px: steadier under a half-pixel pan`,
    `${f(r.jitterBefore)} → ${f(r.jitterAfter)} rms`
  );
}

if (sheetPng) {
  await writeFile(SHEET, Buffer.from(sheetPng.split(",")[1], "base64"));
  console.log(`\n  sheet → ${SHEET}`);
}

console.log(failed ? `\n${failed} problem(s)` : "\nno problems");
process.exit(failed ? 1 : 0);
