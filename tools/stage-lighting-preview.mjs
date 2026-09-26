#!/usr/bin/env node
/**
 * Render the Stage character grade for real, in a real GPU context.
 *
 * `tools/postfx-check.mjs` pins the grade's rules down against the JavaScript
 * reference (`shadePixel`), but it cannot compile a line of GLSL — and a shader
 * that fails to compile degrades silently to the CSS fallback rather than
 * erroring. Nor can it show that the GLSL agrees with the reference it claims to
 * transcribe. This does both:
 *
 *   - compiles and links the production shader through the production StageGL;
 *   - asserts every dial neutral returns the art untouched, and master
 *     intensity 0 returns it untouched whatever the dials say;
 *   - renders every layer and dial at a test value and compares the GPU's
 *     pixels with `shadePixel` on the same input and position, pixel for pixel;
 *   - writes a contact sheet, one tile per test.
 *
 *   node tools/stage-lighting-preview.mjs                 # verify + write sheet
 *   node tools/stage-lighting-preview.mjs --out=/tmp/x.png
 *
 * Exit code is non-zero on any failure. Needs Playwright; without it this
 * prints SKIP and exits 0.
 */

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
// Outside the repo by default: this package ships as its own source tree, so a
// generated PNG left in tools/ would be installed into every world.
const OUT = outArg ? outArg.slice("--out=".length) : join(tmpdir(), "gl-stage-grade.png");

const TYPES = { ".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

/**
 * Each test is a partial grade laid over the neutral one, so it exercises one
 * layer (or one dial) at a time. Values are large enough to see and, for the
 * basic dials, small enough to stay clear of the gamut walls on most of the
 * swatch.
 */
const TESTS = [
  { label: "exposure +1", grade: { basic: { exposure: 1 } } },
  { label: "exposure -1", grade: { basic: { exposure: -1 } } },
  { label: "brightness +40", grade: { basic: { brightness: 40 } } },
  { label: "gamma 1.8", grade: { basic: { gamma: 1.8 } } },
  { label: "contrast +50", grade: { basic: { contrast: 50 } } },
  { label: "contrast -50", grade: { basic: { contrast: -50 } } },
  { label: "saturation +60", grade: { basic: { saturation: 60 } } },
  { label: "saturation -100", grade: { basic: { saturation: -100 } } },
  { label: "hue +90", grade: { basic: { hue: 90 } } },
  { label: "basic, everything", grade: { basic: { exposure: 0.4, brightness: 10, gamma: 1.2, contrast: 25, saturation: 30, hue: -40 } } },
  { label: "gradient, light right", grade: { light: { angle: 0, softness: 50 }, gradient: { amount: 80, color: "#ffd9a0" } } },
  { label: "gradient, light above-left", grade: { light: { angle: 135, softness: 70 }, gradient: { amount: 80, color: "#a8c8ff" } } },
  { label: "wash, blue room", grade: { wash: { amount: 70, color: "#3050c0" }, skin: { guard: 0 } } },
  { label: "wash, blue, skin guarded", grade: { wash: { amount: 70, color: "#3050c0" }, skin: { guard: 100 } } },
  { label: "darkness 0.6 at dial 65", grade: { wash: { darkness: 65 } }, darkness: 0.6 },
  { label: "rim, light right", grade: { light: { angle: 0 }, rim: { amount: 100, width: 40, softness: 40, color: "#fff0d8" } } },
  { label: "rim, light above-left", grade: { light: { angle: 135 }, rim: { amount: 100, width: 60, softness: 20, color: "#b0d0ff" } } },
  { label: "back shadow, light right", grade: { light: { angle: 0, softness: 60 }, backShadow: { amount: 80 } } },
  { label: "glow, tight", grade: { glow: { amount: 100, radius: 0, threshold: 55 } } },
  { label: "glow, wide", grade: { glow: { amount: 100, radius: 100, threshold: 55 } } },
  { label: "default grade, warm room", grade: { light: { angle: 120, softness: 70 }, gradient: { amount: 35, color: "#ffc891" }, wash: { amount: 30, darkness: 65, color: "#8a6a50" }, rim: { amount: 60, width: 30, softness: 40, color: "#ffe4c8" }, backShadow: { amount: 35 }, skin: { guard: 50 } }, darkness: 0.2 },
];

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#101014">
<script type="module">
import { StageGL } from "/scripts/features/stage/postfx/gl.mjs";
import { stackParams, shadeFragment, normalizeGrade, NEUTRAL_GRADE, DEFAULT_TRIM, bloomPyramid, sampleImage } from "/scripts/features/stage/postfx/grade-model.mjs";

const TESTS = ${JSON.stringify(TESTS)};

// ── A synthetic character ──
// A silhouette carrying the colours a grade has to get right: a skin tone,
// saturated primaries, a grey ramp from black to white, and deep shadow.
function buildArt() {
  const c = document.createElement("canvas");
  c.width = 360; c.height = 640;
  const g = c.getContext("2d");
  const body = new Path2D();
  body.moveTo(180, 30);
  body.bezierCurveTo(260, 30, 280, 130, 252, 190);
  body.bezierCurveTo(350, 230, 350, 460, 336, 620);
  body.lineTo(24, 620);
  body.bezierCurveTo(10, 460, 10, 230, 108, 190);
  body.bezierCurveTo(80, 130, 100, 30, 180, 30);
  g.save(); g.clip(body);
  g.fillStyle = "#4a4550"; g.fillRect(0, 0, 360, 640);
  g.fillStyle = "#e9c3a8"; g.beginPath(); g.ellipse(180, 120, 58, 70, 0, 0, 7); g.fill(); // skin
  const sw = ["#d23a2c", "#3aa84a", "#2c5fd2", "#e8c440", "#8a3ab8", "#1c1c22"];
  sw.forEach((col, i) => { g.fillStyle = col; g.fillRect(40 + i * 48, 250, 44, 90); });
  for (let i = 0; i < 12; i++) {                        // grey ramp, 0 → 255
    const v = Math.round((i / 11) * 255);
    g.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
    g.fillRect(30 + i * 25, 370, 25, 80);
  }
  const grad = g.createLinearGradient(30, 0, 330, 0);   // a smooth hue sweep
  grad.addColorStop(0, "#b85a4a"); grad.addColorStop(0.5, "#5a9a8a"); grad.addColorStop(1, "#7a5ab8");
  g.fillStyle = grad; g.fillRect(30, 470, 300, 120);
  g.restore();
  return c.toDataURL("image/png");
}

window.run = async () => {
  const src = buildArt();
  let lostCount = 0;
  // 8-bit bloom, so the finished pyramid can be read back and compared.
  const gl = new StageGL({ onLost: () => lostCount++, bloomFormat: "u8" });
  if (!gl.isSupported()) return { error: "no WebGL in this browser" };

  // Headless Chromium's software GPU resets once shortly after the first
  // context in a page is made, which loses that context. Real GPUs reset too,
  // and StageGL is built to rebuild on the next prepare — so this waits out the
  // reset and then exercises exactly that recovery path.
  let prepared = await gl.prepare(src);
  if (!prepared) return { error: "StageGL.prepare returned null (shader failed to compile or link?)" };
  await new Promise((r) => setTimeout(r, 1000));
  if (gl._lost) {
    prepared = await gl.prepare(src);
    if (!prepared) return { error: "StageGL did not rebuild after losing its context" };
  }

  const paramsFor = (test) => stackParams(
    normalizeGrade(test.grade ?? {}, NEUTRAL_GRADE),
    test.trim ?? DEFAULT_TRIM,
    { aspect: prepared.art.width / prepared.art.height, darkness: test.darkness ?? 0 },
  );
  const shoot = (test, intensity = 1) => {
    const out = gl.draw(prepared, { intensity, ...paramsFor(test) });
    if (!out) throw new Error("draw returned null mid-run (context lost again?)");
    const bloom = paramsFor(test).glowAmount > 0 ? gl.readBloom() : null;
    const c = document.createElement("canvas");
    c.width = out.width; c.height = out.height;
    const g2 = c.getContext("2d");
    g2.drawImage(out, 0, 0);
    return { canvas: c, data: g2.getImageData(0, 0, c.width, c.height).data, bloom };
  };

  const first = shoot({ grade: {} });
  const W = first.canvas.width, H = first.canvas.height;
  const ref = document.createElement("canvas");
  ref.width = W; ref.height = H;
  const rg = ref.getContext("2d");
  const img = new Image(); img.src = src; await img.decode();
  rg.drawImage(img, 0, 0, W, H);
  const artPx = rg.getImageData(0, 0, W, H).data;

  // Opaque pixels only: premultiplied edges round differently through the two
  // paths and say nothing about the grade.
  // Every other pixel on both axes: the reference runs in page JavaScript, and
  // a quarter of the frame is far more than enough to catch a transcription.
  const drift = (px, expect) => {
    let worst = 0, sum = 0, n = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const p = (y * W + x) * 4;
      if (artPx[p + 3] < 250) continue;
      const e = expect ? expect(p, x, y) : [artPx[p], artPx[p + 1], artPx[p + 2]];
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(px[p + k] - e[k]);
        worst = Math.max(worst, d); sum += d; n++;
      }
    }
    return { worst, mean: n ? sum / n : 0 };
  };

  const neutral = drift(first.data);
  const zero = drift(shoot(TESTS[TESTS.length - 1], 0).data);

  // The shader samples at pixel centres; so does the reference.
  // The art sampled the way the GPU samples its texture: premultiplied,
  // bilinear between texel centres, clamped at the edges.
  const texel = (x, y) => {
    const i = (y * W + x) * 4;
    const a = artPx[i + 3] / 255;
    return [artPx[i] / 255 * a, artPx[i + 1] / 255 * a, artPx[i + 2] / 255 * a, a];
  };
  const sample = (u, v) => {
    const tx = Math.min(Math.max(u * W - 0.5, 0), W - 1);
    const ty = Math.min(Math.max(v * H - 0.5, 0), H - 1);
    const x0 = Math.floor(tx), y0 = Math.floor(ty);
    const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
    const fx = tx - x0, fy = ty - y0;
    const a = texel(x0, y0), b = texel(x1, y0), c = texel(x0, y1), d = texel(x1, y1);
    return a.map((_, k) => (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy);
  };
  // The main pass is compared given the GPU's own bloom (read back), so a
  // difference points at the main pass; the pyramid is compared on its own.
  let bloomNow = null;
  const bloomAt = (u, v) => (bloomNow ? sampleImage(bloomNow, u, v) : [0, 0, 0, 0]);
  const fragmentAt = (test, x, y, intensity = 1) =>
    shadeFragment(texel(x, y), [(x + 0.5) / W, (y + 0.5) / H], paramsFor(test), sample, intensity, bloomAt);
  const artImage = { width: W, height: H, data: new Float32Array(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) artImage.data.set(texel(x, y), (y * W + x) * 4);
  const bloomDrift = (gpu, test) => {
    const cpu = bloomPyramid(artImage, paramsFor(test));
    let worst = 0;
    for (let i = 0; i < cpu.data.length; i++) worst = Math.max(worst, Math.abs(cpu.data[i] - gpu.data[i]) * 255);
    return { worst: Math.round(worst), size: gpu.width + "x" + gpu.height, cpuSize: cpu.width + "x" + cpu.height };
  };
  const reference = (test) => (i, x, y) => {
    const f = fragmentAt(test, x, y);
    const a = Math.max(f[3], 1e-6);
    return [f[0] / a, f[1] / a, f[2] / a].map((v) => Math.round(Math.min(v, 1) * 255));
  };
  // Coverage everywhere, including outside the art, where only the glow draws.
  const alphaDrift = (px, test) => {
    let worst = 0;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const i = (y * W + x) * 4;
      worst = Math.max(worst, Math.abs(px[i + 3] - Math.round(fragmentAt(test, x, y)[3] * 255)));
    }
    return worst;
  };

  const dials = [];
  const tiles = [{ label: "original", canvas: first.canvas }];
  for (const t of TESTS) {
    const shot = shoot(t);
    bloomNow = shot.bloom;
    dials.push({
      label: t.label,
      ...drift(shot.data, reference(t)),
      moved: drift(shot.data).mean,
      alpha: alphaDrift(shot.data, t),
      bloom: shot.bloom ? bloomDrift(shot.bloom, t) : null,
    });
    bloomNow = null;
    tiles.push({ label: t.label, canvas: shot.canvas });
  }

  // Contact sheet: one tile per dial, labelled.
  const TW = 180, TH = Math.round((H / W) * TW), COLS = 6;
  const rows = Math.ceil(tiles.length / COLS);
  const sheet = document.createElement("canvas");
  sheet.width = COLS * TW; sheet.height = rows * (TH + 22);
  const sg = sheet.getContext("2d");
  sg.fillStyle = "#101014"; sg.fillRect(0, 0, sheet.width, sheet.height);
  sg.font = "12px sans-serif"; sg.fillStyle = "#d8d8e0";
  tiles.forEach((t, i) => {
    const x = (i % COLS) * TW, y = Math.floor(i / COLS) * (TH + 22);
    sg.drawImage(t.canvas, x, y + 18, TW, TH);
    sg.fillText(t.label, x + 6, y + 13);
  });

  return { png: sheet.toDataURL("image/png"), neutral, zero, dials };
};
</script></body>`;

const server = createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/__preview.html") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(PAGE);
  }
  const path = normalize(join(ROOT, decodeURIComponent(url)));
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
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// Playwright is a dev convenience, not a dependency — the repo has no
// package.json and Foundry consumes the source directly. Resolve it wherever it
// happens to live (local install, or the global root) rather than pinning one.
const { createRequire } = await import("node:module");
const require_ = createRequire(import.meta.url);
const { dirname: _dirname, join: _join } = await import("node:path");
// The node-relative and %APPDATA% entries are where npm puts a global install on
// Windows and under nvm; without them this printed SKIP on the box most of this
// repo is written on — a check that proves nothing while reporting success.
const _nodeDir = _dirname(process.execPath);
const GLOBAL_ROOTS = [
  "/opt/node22/lib/node_modules",
  "/usr/lib/node_modules",
  "/usr/local/lib/node_modules",
  _join(_nodeDir, "node_modules"),
  _join(_nodeDir, "..", "lib", "node_modules"),
  ...(process.env.APPDATA ? [_join(process.env.APPDATA, "npm", "node_modules")] : []),
].filter(Boolean);
let playwrightPath;
try {
  playwrightPath = require_.resolve("playwright", { paths: [ROOT, ...GLOBAL_ROOTS] });
} catch {
  console.log("SKIP  playwright is not installed — cannot compile the shader without a browser");
  console.log("      npm i -g playwright");
  server.close();
  process.exit(0);
}
// Via a file:// URL: a bare absolute path is read as the scheme "c:" on Windows.
const { pathToFileURL } = await import("node:url");
const pw = await import(pathToFileURL(playwrightPath).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
});
const page = await browser.newPage();
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error" || /shader|program/i.test(m.text())) problems.push(m.text());
});
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(`${ORIGIN}/__preview.html`);
try {
  await page.waitForFunction(() => typeof window.run === "function", null, { timeout: 15000 });
} catch {
  for (const p of problems) console.log("  browser:", p);
  console.log("FAIL  the preview module never finished loading (see above)");
  await browser.close();
  server.close();
  process.exit(1);
}
const result = await page.evaluate(() => window.run()).catch((e) => ({ error: String(e.message || e) }));
await browser.close();
server.close();

for (const p of problems) console.log("  browser:", p);
if (result.error) {
  console.log(`FAIL  ${result.error}`);
  process.exit(1);
}

await writeFile(OUT, Buffer.from(result.png.split(",")[1], "base64"));

let failed = 0;
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "  ok  " : "FAIL  "}${label}${extra ? "  → " + extra : ""}`);
  if (!cond) failed++;
};

ok(!problems.some((p) => /compile failed|link failed/i.test(p)), "the shader compiles and links");
ok(result.neutral.worst <= 1, "every dial neutral returns the art untouched", `worst channel drift ${result.neutral.worst}/255`);
ok(result.zero.worst <= 1, "master intensity 0 returns the art untouched, whatever the dials say", `worst ${result.zero.worst}/255`);

// float32 on the GPU against float64 in the reference, both rounded to 8 bits:
// a couple of steps at the worst pixel is arithmetic, a mean above half a step
// is a transcription error.
for (const d of result.dials) {
  ok(
    d.worst <= 3 && d.mean <= 0.5,
    `GLSL matches shadePixel: ${d.label}`,
    `worst ${d.worst}/255, mean ${d.mean.toFixed(3)}`
  );
  ok(d.moved > 1, `…and the dial visibly moves the picture`, `mean change ${d.moved.toFixed(2)}/255`);
  ok(d.alpha <= 2, `…and its coverage matches, outside the art included`, `worst ${d.alpha}/255`);
  if (d.bloom) {
    // Four 8-bit render targets deep, so a few steps of rounding is expected.
    ok(d.bloom.size === d.bloom.cpuSize && d.bloom.worst <= 6, `…and the GPU bloom pyramid matches bloomPyramid`, `${d.bloom.size}, worst ${d.bloom.worst}/255`);
  }
}

console.log(`\ncontact sheet: ${OUT}`);
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
