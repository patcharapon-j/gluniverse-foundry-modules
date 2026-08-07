#!/usr/bin/env node
/**
 * Render the Stage lighting shader for real, in a real GPU context.
 *
 * `tools/postfx-check.mjs` pins the maths down without a browser, which is most
 * of the feature — but it cannot compile a line of GLSL, and a shader that fails
 * to compile degrades silently to the CSS fallback rather than erroring. Nor can
 * it show you what any of this *looks* like, which for a lighting effect is the
 * only question that finally matters.
 *
 * So this drives the production modules — `getNormalMap`, `StageGL.prepare`,
 * `StageGL.draw`, `lightPlacement` — in headless Chromium against a synthetic
 * character built to exercise the terms that are hard to reason about: a
 * silhouette for the rim and the spill, a bright panel over a dark one for the
 * interior contours, and a curved edge so the directional gate has somewhere to
 * fall off.
 *
 *   node tools/stage-lighting-preview.mjs                 # verify + write sheet
 *   node tools/stage-lighting-preview.mjs --out=/tmp/x.png
 *
 * Exit code is non-zero if the shader fails to compile or link, so this doubles
 * as the compile check the pure-logic tool cannot do.
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
const OUT = outArg ? outArg.slice("--out=".length) : join(tmpdir(), "gl-stage-lighting.png");

const TYPES = { ".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

const server = createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(req.url.split("?")[0])));
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

/** Four rooms, chosen so the grade has somewhere different to go in each. */
const ROOMS = [
  { name: "dark room, warm lamp high left", ambient: [0.10, 0.09, 0.12], key: [1.0, 0.72, 0.42], centroid: [0.18, 0.16], darkness: 0.55 },
  { name: "green interior, lamp behind", ambient: [0.16, 0.32, 0.24], key: [0.62, 1.0, 0.74], centroid: [0.5, 0.3], darkness: 0.3 },
  { name: "underwater, light from above", ambient: [0.30, 0.52, 0.72], key: [0.78, 0.94, 1.0], centroid: [0.5, 0.06], darkness: 0.15 },
  { name: "sunlit green, lamp high right", ambient: [0.34, 0.42, 0.26], key: [1.0, 0.98, 0.82], centroid: [0.86, 0.12], darkness: 0.0 },
];

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#101014">
<script type="module">
import { StageGL } from "/scripts/features/stage/postfx/gl.mjs";
import { getNormalMap } from "/scripts/features/stage/postfx/normal-map.mjs";
import { lightPlacement, bounceLight, SHADER_STRENGTHS } from "/scripts/features/stage/postfx/index.mjs";

// ── A synthetic character ──
// Not art, but it carries the three things the shader reads: an alpha
// silhouette with curvature, a large tonal split (pale coat over dark shirt) for
// the contour term, and some thin lineart the contour term must NOT latch onto.
// \`rind\` reproduces the asset defect this pass has to survive: a cut-out whose
// silhouette carries a dark outline, either authored or left behind by a matte
// lifted off a black background. A hot core traced along one of those reads as a
// sticker, not as light, so the shader is supposed to back off there.
function buildArt(rind) {
  const c = document.createElement("canvas");
  c.width = 420; c.height = 760;
  const g = c.getContext("2d");

  const body = new Path2D();
  body.moveTo(210, 40);
  body.bezierCurveTo(300, 40, 320, 150, 292, 210);   // head + jaw
  body.bezierCurveTo(400, 260, 400, 520, 380, 740);  // right side
  body.lineTo(40, 740);
  body.bezierCurveTo(20, 520, 20, 260, 128, 210);    // left side
  body.bezierCurveTo(100, 150, 120, 40, 210, 40);
  g.fillStyle = "#4a4550"; g.fill(body);             // dark shirt / base

  g.save(); g.clip(body);
  const coat = new Path2D();                          // pale coat panel — the
  coat.moveTo(40, 300); coat.lineTo(175, 250);        // big tonal edge
  coat.lineTo(150, 740); coat.lineTo(40, 740); g.fillStyle = "#c9c2b4"; g.fill(coat);
  const coat2 = new Path2D();
  coat2.moveTo(380, 300); coat2.lineTo(248, 250);
  coat2.lineTo(272, 740); coat2.lineTo(380, 740); g.fillStyle = "#b6ae9e"; g.fill(coat2);
  g.fillStyle = "#e8e2d6"; g.beginPath(); g.ellipse(210, 130, 62, 74, 0, 0, 7); g.fill(); // face
  g.strokeStyle = "#20202a"; g.lineWidth = 3;         // thin lineart — must not
  g.beginPath(); g.moveTo(185, 120); g.lineTo(205, 120);  // become a highlight
  g.moveTo(228, 120); g.lineTo(248, 120);
  g.moveTo(200, 168); g.lineTo(228, 168); g.stroke();
  g.restore();

  if (rind) {
    // Stroked inside the clip, so the alpha silhouette is identical to the clean
    // figure's and the only difference between the two renders is the colour of
    // the boundary pixels.
    g.save(); g.clip(body);
    g.strokeStyle = "#050508"; g.lineWidth = 7; g.stroke(body);
    g.restore();
  }
  return c.toDataURL("image/png");
}

const ROOMS = ${JSON.stringify(ROOMS)};

window.run = async () => {
  const src = buildArt(false);
  const normal = await getNormalMap(src);
  if (!normal) return { error: "normal-map prepass returned null" };

  const gl = new StageGL();
  if (!gl.isSupported()) return { error: "no WebGL in this browser" };
  const prepared = await gl.prepare(src, normal);
  if (!prepared) return { error: "prepare() returned null — shader compile/link or texture upload failed" };

  const rindSrc = buildArt(true);
  const rindNormal = await getNormalMap(rindSrc);
  const rindPrepared = rindNormal ? await gl.prepare(rindSrc, rindNormal) : null;
  if (!rindPrepared) return { error: "prepare() returned null for the dark-rind figure" };

  const strip = document.createElement("canvas");
  const tileW = 300, tileH = 543;
  // A 2x crop of the head and shoulder under each tile. The rim core is a few
  // pixels wide by design, and at tile scale a crisp line and a soft band are
  // indistinguishable — which is the whole thing being judged here.
  // The third row is the same crop of the matted figure, so the sheet answers
  // the question the numbers can only score: does an asset with its own black
  // outline still get a halo drawn round it.
  const detailH = 300;
  strip.width = tileW * ROOMS.length; strip.height = tileH + detailH * 2;
  const sg = strip.getContext("2d");
  sg.imageSmoothingEnabled = false;

  for (let i = 0; i < ROOMS.length; i++) {
    const room = ROOMS[i];
    const place = lightPlacement(room.centroid, 0.5, normal.figure,
                                 normal.width / normal.height, 16 / 9);
    const params = {
      ...place,
      // The real bounce, not a copy of the ambient — the shadow-side colour
      // separation is a big part of what the figure ends up looking like.
      ambient: room.ambient, bounce: bounceLight(room.ambient, room.key), key: room.key,
      // The GM dial's default, so this is the picture a world actually gets.
      shadowColor: [0.06, 0.08, 0.14], intensity: 0.6,
      ...SHADER_STRENGTHS,
      exposure: Math.pow(1 - room.darkness * 0.65, 2.2),
      night: room.darkness * room.darkness * 0.55, shadow: 0, lift: 0,
    };
    const out = gl.draw(prepared, params);
    if (!out) return { error: "draw() returned null at room " + i };

    // Paint the room behind it, so the spill has something to spill onto.
    const px = (c) => "rgb(" + c.map((v) => Math.round(v * 255)).join(",") + ")";
    const room_ = px(room.ambient.map((v) => v * 0.55));
    sg.fillStyle = room_;
    sg.fillRect(i * tileW, 0, tileW, tileH);
    sg.drawImage(out, i * tileW, 0, tileW, tileH);

    // Detail: the top-left quarter of the figure, at native pixels.
    sg.fillStyle = room_;
    sg.fillRect(i * tileW, tileH, tileW, detailH);
    sg.drawImage(out, 0, 0, tileW, detailH, i * tileW, tileH, tileW, detailH);

    sg.fillStyle = "rgba(255,255,255,0.75)";
    sg.font = "13px system-ui, sans-serif";
    sg.fillText(room.name, i * tileW + 10, tileH - 12);

    // Same crop, same light, art with a black rind round its silhouette.
    const rindOut = gl.draw(rindPrepared, params);
    if (!rindOut) return { error: "draw() returned null for the dark-rind figure" };
    sg.fillStyle = room_;
    sg.fillRect(i * tileW, tileH + detailH, tileW, detailH);
    sg.drawImage(rindOut, 0, 0, tileW, detailH, i * tileW, tileH + detailH, tileW, detailH);
    sg.fillStyle = "rgba(255,255,255,0.6)";
    sg.fillText("same art, black rind", i * tileW + 10, tileH + detailH + 20);
  }

  // ── Assertions ──
  const BASE = {
    ambient: [0.12, 0.11, 0.14], bounce: [0.1, 0.12, 0.18], key: [1.0, 0.95, 0.88],
    shadowColor: [0.06, 0.08, 0.14], ...SHADER_STRENGTHS,
    exposure: 0.5, night: 0, shadow: 0, lift: 0,
  };
  const shoot = (centroid, intensity, target = prepared) => {
    const place = lightPlacement(centroid, 0.5, normal.figure,
                                 normal.width / normal.height, 16 / 9);
    const out = gl.draw(target, { ...BASE, ...place, intensity });
    // Copy out immediately — the canvas is shared and the next draw owns it.
    const c = document.createElement("canvas");
    c.width = out.width; c.height = out.height;
    const g2 = c.getContext("2d");
    g2.drawImage(out, 0, 0);
    return g2.getImageData(0, 0, c.width, c.height);
  };

  const W = gl.canvas.width, H = gl.canvas.height;
  const artRef = document.createElement("canvas");
  artRef.width = W; artRef.height = H;
  const arg = artRef.getContext("2d");
  const img0 = new Image(); img0.src = src; await img0.decode();
  arg.drawImage(img0, 0, 0, W, H);
  const artPx = arg.getImageData(0, 0, W, H).data;

  // Strength 0 must be the original pixels, exactly. The rim core and the spill
  // are now added *past* the dial's crossfade, which is precisely the change
  // that could break this.
  const off = shoot([0.5, 0.15], 0).data;
  let maxDelta = 0;
  for (let p = 0; p < off.length; p += 4) {
    if (artPx[p + 3] < 250) continue;              // premultiplied edges round
    for (let k = 0; k < 3; k++) maxDelta = Math.max(maxDelta, Math.abs(off[p + k] - artPx[p + k]));
  }

  // Where the rim lands. Walk each row of the silhouette, take a band just
  // inside the left and right extremes, and average its luminance.
  const bandLuma = (px, side) => {
    let sum = 0, n = 0;
    for (let y = 0; y < H; y += 2) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < W; x++) if (artPx[(y * W + x) * 4 + 3] > 200) { if (x0 < 0) x0 = x; x1 = x; }
      if (x0 < 0 || x1 - x0 < 24) continue;
      for (let d = 2; d < 10; d++) {
        const x = side === "left" ? x0 + d : x1 - d;
        const p = (y * W + x) * 4;
        sum += (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
        n++;
      }
    }
    return n ? sum / n : 0;
  };

  const fromLeft = shoot([0.02, 0.5], 0.6).data;
  const fromRight = shoot([0.98, 0.5], 0.6).data;
  const peak = (px) => {
    let m = 0;
    for (let p = 0; p < px.length; p += 4) {
      if (px[p + 3] < 200) continue;
      m = Math.max(m, (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255);
    }
    return m;
  };

  const rim = {
    zeroDelta: maxDelta,
    leftLampLeftBand: bandLuma(fromLeft, "left"),
    leftLampRightBand: bandLuma(fromLeft, "right"),
    rightLampLeftBand: bandLuma(fromRight, "left"),
    rightLampRightBand: bandLuma(fromRight, "right"),
    peakLuma: peak(fromLeft),
  };

  // Alpha outside the silhouette proves the spill is being drawn at all.
  const probe = document.createElement("canvas");
  probe.width = gl.canvas.width; probe.height = gl.canvas.height;
  const pg = probe.getContext("2d");
  pg.drawImage(gl.canvas, 0, 0);
  const pd = pg.getImageData(0, 0, probe.width, probe.height).data;
  const artProbe = document.createElement("canvas");
  artProbe.width = probe.width; artProbe.height = probe.height;
  const ag = artProbe.getContext("2d");
  const img = new Image(); img.src = src; await img.decode();
  ag.drawImage(img, 0, 0, probe.width, probe.height);
  const ad = ag.getImageData(0, 0, probe.width, probe.height).data;

  let spillPixels = 0, spillPeak = 0, insidePixels = 0;
  for (let p = 0; p < pd.length; p += 4) {
    if (ad[p + 3] > 8) { insidePixels++; continue; }
    if (pd[p + 3] > 2) { spillPixels++; spillPeak = Math.max(spillPeak, pd[p + 3]); }
  }
  // ── The dark-rind case ──
  // Same silhouette, same lamp, same strengths; only the colour of the boundary
  // pixels differs. Tracing a hot core along an asset's own black outline is the
  // halo the guard exists to prevent, so the matted figure has to come out
  // visibly cooler at the edge than the clean one — while the clean one keeps
  // every property asserted above.
  const edgePeak = (px, side) => {
    let sum = 0, n = 0;
    for (let y = 0; y < H; y += 2) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < W; x++) if (artPx[(y * W + x) * 4 + 3] > 200) { if (x0 < 0) x0 = x; x1 = x; }
      if (x0 < 0 || x1 - x0 < 24) continue;
      let m = 0;
      // A narrow band straddling the outline: the core and the hot end of the
      // spill both live in it, and which texel they peak on moves with the
      // curvature. Kept narrow deliberately — reach a few texels further in and
      // the maximum finds the character's own lit body, which is bright on any
      // figure and would swamp the thing being measured.
      //
      // Weighted by coverage, because getImageData hands back *unassociated*
      // colour: the faintest breath of spill reads as pure white at alpha 3, and
      // an unweighted maximum over this band measures the spill's hue rather
      // than its brightness — which is to say, nothing at all.
      for (let d = -3; d < 3; d++) {
        const x = side === "left" ? x0 + d : x1 - d;
        if (x < 0 || x >= W) continue;
        const p = (y * W + x) * 4;
        const l = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
        m = Math.max(m, l * (px[p + 3] / 255));
      }
      sum += m; n++;
    }
    return n ? sum / n : 0;
  };
  const cleanEdge = edgePeak(fromLeft, "left");
  const rindEdge = edgePeak(shoot([0.02, 0.5], 0.6, rindPrepared).data, "left");

  return {
    png: strip.toDataURL("image/png"),
    spillPixels, spillPeak, insidePixels, cleanEdge, rindEdge, ...rim,
  };
};
</script></body>`;

server.on("request", () => {});
const pageRoute = "/__preview.html";
const origHandler = server.listeners("request")[0];
server.removeAllListeners("request");
server.on("request", async (req, res) => {
  if (req.url.split("?")[0] === pageRoute) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(PAGE);
  }
  return origHandler(req, res);
});

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
  console.log("SKIP  playwright is not installed — cannot compile the shader without a browser");
  console.log("      npm i -g playwright   (Chromium is already present in this image)");
  server.close();
  process.exit(0);
}
// CommonJS package — the named export lands on `default` through the ESM shim.
const pw = await import(playwrightPath);
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

await page.goto(`${ORIGIN}${pageRoute}`);
// The page is a module; `load` can fire before its import graph has settled.
try {
  await page.waitForFunction(() => typeof window.run === "function", null, { timeout: 15000 });
} catch {
  for (const p of problems) console.log("  browser:", p);
  console.log("FAIL  the preview module never finished loading (see above)");
  await browser.close();
  server.close();
  process.exit(1);
}
const result = await page.evaluate(() => window.run());
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
ok(result.spillPixels > 0, "light spills past the silhouette", `${result.spillPixels} px outside the alpha`);
ok(
  result.spillPixels > result.insidePixels * 0.02,
  "…far enough out to read as a glow",
  `${((result.spillPixels / result.insidePixels) * 100).toFixed(1)}% of the figure's area`
);
ok(result.spillPeak > 40, "…and bright enough to see", `peak alpha ${result.spillPeak}/255`);

const f = (v) => v.toFixed(3);
ok(
  result.zeroDelta <= 1,
  "strength 0 returns the original pixels untouched",
  `worst channel drift ${result.zeroDelta}/255`
);
ok(
  result.leftLampLeftBand > result.leftLampRightBand * 1.15,
  "a lamp on the left rims the left edge",
  `${f(result.leftLampLeftBand)} vs ${f(result.leftLampRightBand)}`
);
ok(
  result.rightLampRightBand > result.rightLampLeftBand * 1.15,
  "…and a lamp on the right rims the right edge",
  `${f(result.rightLampRightBand)} vs ${f(result.rightLampLeftBand)}`
);
ok(
  result.peakLuma > 0.85,
  "the rim core reaches near-white at the default strength",
  `peak luminance ${f(result.peakLuma)}`
);
ok(
  result.rindEdge < result.cleanEdge * 0.70,
  "the rim stands down on art with its own dark outline",
  `edge peak ${f(result.rindEdge)} vs ${f(result.cleanEdge)} on the clean cut-out`
);

console.log(`\nwrote ${OUT}`);
process.exit(failed ? 1 : 0);
