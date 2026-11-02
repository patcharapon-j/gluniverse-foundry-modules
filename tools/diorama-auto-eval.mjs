#!/usr/bin/env node
/**
 * Diorama Auto setup, measured against a hand-made layout.
 *
 *   node tools/diorama-auto-eval.mjs [--image=<map>] [--layout=<layout.json>] [--cols=N --rows=N] [--distance=5]
 *                                    [--light=auto|N|NE|…] [--scale=1] [--step=2.5] [--no-heights] [--ascii] [--runs=3]
 *
 * Defaults to the Czepeku Lion Garden: the image in the dio-scratch world and
 * the map-setup skill's example layout, which a human judged excellent. The
 * image is decoded by ffmpeg to raw RGB on stdout (nothing is written), drawn
 * onto the editor's sampling canvas size with an area filter, and averaged per
 * sub-cell exactly as editor/sample.mjs does (samplePlan + blockAverage). The
 * Auto setup in HEAD (`git show`) and the working copy both run on those same
 * colours; the layout compiled by terrain/layout.mjs is the truth.
 *
 * Without --layout, or when the layout file does not exist, it prints what the
 * new Auto setup decided for the image (a sanity check for other maps).
 *
 * Metrics (sub-cells inside the map):
 *   class      share whose class (void / water / floor, stairs counting as floor) matches
 *   water IoU  overlap of the water masks
 *   MAE raw    mean |height error|, ft, as drafted
 *   MAE align  the same after the best constant offset (the median difference): the
 *              datum is a choice, the relief is the reading
 *   ≤2.5 ft    share within 2.5 ft after that offset
 *   corr       Pearson correlation of the heights
 *   bound F1   level boundaries (a ≥ 2.5 ft step between neighbouring sub-cells),
 *              matched within one sub-cell
 *   ordered    share of the truth's level boundaries whose predicted step has the same sign
 *
 * Read-only: prints to stdout.
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = (rel) => pathToFileURL(resolve(root, rel)).href;
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, ...v] = a.slice(2).split("=");
  return [k, v.length ? v.join("=") : true];
}));

const DEFAULT_IMAGE = "C:/Users/frostnoxia/dio-scratch/Data/worlds/dio-test/maps/lion-garden.jpg";
const DEFAULT_LAYOUT = ".claude/skills/diorama-map-setup/examples/lion-garden.json";
const image = args.image ?? DEFAULT_IMAGE;
const layoutPath = args.layout === undefined ? (args.image ? null : resolve(root, DEFAULT_LAYOUT)) : resolve(root, String(args.layout));

const { SUB, KIND } = await import(url("scripts/features/diorama/constants.mjs"));
const { compileLayout } = await import(url("scripts/features/diorama/terrain/layout.mjs"));
const { samplePlan, blockAverage } = await import(url("scripts/features/diorama/editor/sample.mjs")).catch(async () => {
  // sample.mjs imports the store, which is pure; this fallback only guards an odd checkout.
  throw new Error("could not import editor/sample.mjs");
});
const NEW = await import(url("scripts/features/diorama/editor/auto-setup.mjs"));

/** The Auto setup in HEAD, imported from its source with its imports made absolute. */
async function oldAutoSetup() {
  const r = spawnSync("git", ["show", "HEAD:scripts/features/diorama/editor/auto-setup.mjs"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  const src = r.stdout.replace(/from "\.\.\/([^"]+)"/g, (_m, p) => `from "${url(`scripts/features/diorama/${p}`)}"`);
  return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
}

/* ── the image ─────────────────────────────────────────────────────── */

function decode(p) {
  if (!existsSync(p)) { console.error(`no image at ${p}`); process.exit(2); }
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", p], { encoding: "utf8" });
  if (probe.status !== 0) { console.error("ffprobe failed (is ffmpeg on PATH?)"); process.exit(2); }
  const [W, H] = probe.stdout.trim().split(",").map(Number);
  const dec = spawnSync("ffmpeg", ["-v", "error", "-i", p, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: W * H * 3 + 1024 });
  if (dec.status !== 0 || dec.stdout.length < W * H * 3) { console.error("ffmpeg could not decode the image"); process.exit(2); }
  return { data: dec.stdout, W, H };
}

/** Area-filtered resample of RGB W×H to w×h (what drawImage with high smoothing approximates). */
function resample({ data, W, H }, w, h) {
  const out = new Uint8Array(w * h * 3);
  const fx = W / w, fy = H / h;
  for (let y = 0; y < h; y++) {
    const ya = y * fy, yb = ya + fy;
    for (let x = 0; x < w; x++) {
      const xa = x * fx, xb = xa + fx;
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = Math.floor(ya); sy < Math.min(H, Math.ceil(yb)); sy++) {
        const wy = Math.min(yb, sy + 1) - Math.max(ya, sy);
        for (let sx = Math.floor(xa); sx < Math.min(W, Math.ceil(xb)); sx++) {
          const wgt = wy * (Math.min(xb, sx + 1) - Math.max(xa, sx));
          const o = (sy * W + sx) * 3;
          r += data[o] * wgt; g += data[o + 1] * wgt; b += data[o + 2] * wgt; a += wgt;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a;
    }
  }
  return out;
}

/* ── metrics ───────────────────────────────────────────────────────── */

const classOf = (t, k) => {
  const kind = t.kind[k] & 0x0f;
  return kind === KIND.VOID ? 0 : kind === KIND.WATER ? 1 : 2;
};

function metrics(pred, truth, distance) {
  const ftPerQ = distance / 4;
  const n = truth.h.length, sw = truth.sw, sh = truth.sh;
  let same = 0, wI = 0, wU = 0;
  const diffs = [];
  const confusion = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];       // [truth][pred]: void, water, floor
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, m = 0;
  for (let k = 0; k < n; k++) {
    const a = classOf(pred, k), b = classOf(truth, k);
    confusion[b][a]++;
    if (a === b) same++;
    if (a === 1 || b === 1) { wU++; if (a === 1 && b === 1) wI++; }
    if (a === 0 || b === 0) continue;
    const x = pred.h[k] * ftPerQ, y = truth.h[k] * ftPerQ;
    diffs.push(y - x);
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; m++;
  }
  const sorted = diffs.slice().sort((p, q) => p - q);
  const off = sorted.length ? sorted[sorted.length >> 1] : 0;
  let raw = 0, al = 0, within = 0;
  for (const d of diffs) { raw += Math.abs(d); al += Math.abs(d - off); if (Math.abs(d - off) <= 2.5 + 1e-9) within++; }
  const vx = sxx / m - (sx / m) ** 2, vy = syy / m - (sy / m) ** 2;
  const corr = vx > 1e-9 && vy > 1e-9 ? (sxy / m - (sx / m) * (sy / m)) / Math.sqrt(vx * vy) : 0;

  // Level boundaries: edges between 4-neighbours with a ≥ 2.5 ft step.
  const stepQ = 2.5 / ftPerQ - 1e-9;
  const solid = (t, k) => (t.kind[k] & 0x0f) !== KIND.VOID;
  const edges = (t) => {
    const E = [];          // [x2, y2] doubled coordinates of the edge midpoint
    for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
      const k = si * sw + sj;
      if (!solid(t, k)) continue;
      if (sj + 1 < sw && solid(t, k + 1) && Math.abs(t.h[k] - t.h[k + 1]) >= stepQ) E.push([2 * sj + 2, 2 * si + 1, k, k + 1]);
      if (si + 1 < sh && solid(t, k + sw) && Math.abs(t.h[k] - t.h[k + sw]) >= stepQ) E.push([2 * sj + 1, 2 * si + 2, k, k + sw]);
    }
    return E;
  };
  const P = edges(pred), T = edges(truth);
  const grid = (E) => { const s = new Set(); for (const [x, y] of E) s.add(`${x},${y}`); return s; };
  const near = (set, x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (set.has(`${x + dx},${y + dy}`)) return true;
    return false;
  };
  const gP = grid(P), gT = grid(T);
  const tp = P.filter(([x, y]) => near(gT, x, y)).length;
  const rc = T.filter(([x, y]) => near(gP, x, y)).length;
  const prec = P.length ? tp / P.length : 0, rec = T.length ? rc / T.length : 0;
  const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  // Ordering: the predicted step across each truth boundary (one sub-cell either side, to forgive a sub-cell's offset).
  let ordered = 0;
  for (const [, , a, b] of T) {
    const dt = truth.h[b] - truth.h[a];
    const d = b - a;                                   // 1 (east) or sw (south)
    const pa = Math.max(0, a - d) === a - d && solid(pred, a - d) ? (pred.h[a] + pred.h[a - d]) / 2 : pred.h[a];
    const pb = b + d < n && solid(pred, b + d) ? (pred.h[b] + pred.h[b + d]) / 2 : pred.h[b];
    const dp = pb - pa;
    if (Math.sign(dp) === Math.sign(dt) && Math.abs(dp) >= 1) ordered++;
  }
  // Stairs: squares holding a flight, matched within one square; direction agreement on the matches.
  const stairCells = (t) => {
    const s = new Map();
    for (let i = 0; i < t.rows; i++) for (let j = 0; j < t.cols; j++) {
      for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) {
        const si = i * SUB + a, sj = j * SUB + b;
        if (t.kindAt(si, sj) === KIND.STAIRS) { s.set(`${i},${j}`, t.dirAt(si, sj)); a = b = SUB; }
      }
    }
    return s;
  };
  const sP = stairCells(pred), sT = stairCells(truth);
  const match = (from, to) => {
    let hit = 0, dirOk = 0;
    for (const [key, dir] of from) {
      const [i, j] = key.split(",").map(Number);
      let found = null;
      for (let di = -1; di <= 1 && found === null; di++) for (let dj = -1; dj <= 1 && found === null; dj++) if (to.has(`${i + di},${j + dj}`)) found = to.get(`${i + di},${j + dj}`);
      if (found !== null) { hit++; if (found === dir) dirOk++; }
    }
    return { hit, dirOk };
  };
  const mp = match(sP, sT), mt = match(sT, sP);
  const stairs = { prec: sP.size ? mp.hit / sP.size : 0, rec: sT.size ? mt.hit / sT.size : 0, dir: mp.hit ? mp.dirOk / mp.hit : 0 };
  return {
    stairs,
    class: same / n, waterIoU: wU ? wI / wU : 1, maeRaw: m ? raw / m : 0, maeAligned: m ? al / m : 0,
    within: m ? within / m : 0, corr, f1, prec, rec, ordered: T.length ? ordered / T.length : 0, confusion,
    levels: new Set(Array.from(pred.h)).size,
  };
}

/* ── run ───────────────────────────────────────────────────────────── */

const img = decode(image);
let layout = null;
if (layoutPath && existsSync(layoutPath)) layout = JSON.parse(readFileSync(layoutPath, "utf8"));
const cols = Number(args.cols ?? layout?.map?.cols ?? Math.round(img.W / 100));
const rows = Number(args.rows ?? layout?.map?.rows ?? Math.round(img.H / 100));
const distance = Number(args.distance ?? 5);
const plan = samplePlan(cols, rows);
const fineData = resample(img, plan.cw, plan.ch);
const colours = blockAverage(fineData, plan.cw, plan.ch, 3, plan.w, plan.h, plan.px);
const fine = { data: fineData, w: plan.cw, h: plan.ch, px: plan.px };
const options = {
  heights: !args["no-heights"],
  light: args.light ?? "auto",
  faces: args.faces ?? "none",
  heightScale: args.scale !== undefined ? Number(args.scale) : undefined,
  step: args.step !== undefined ? Number(args.step) : undefined,
};
const input = { colours, fine, cols, rows, walls: [], gridSize: 100, distance, options };

console.log(`image ${image} (${img.W}×${img.H}), grid ${cols}×${rows} at ${distance} ft, fine raster ${plan.cw}×${plan.ch} (${plan.px} px per sub-cell)`);

const runs = Math.max(1, Number(args.runs ?? 3));
let res, best = Infinity;
for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  res = NEW.autoSetupDetailed(input);
  best = Math.min(best, performance.now() - t0);
}
const st = res.stats;
console.log(`new: ${best.toFixed(0)} ms (best of ${runs}); light ${st.light ?? "none"} (confidence ${st.confidence}${st.energy ? `; band energy falling ${Object.entries(st.energy).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ")}` : ""}), ${st.regions} regions, ${st.cues} cue pairs, ${st.stairs} stair sub-cells`);

if (args.ascii) {
  const t = res.terrain;
  const ch = (q) => {
    const ft = (q * distance) / 4;
    if (ft < 0) return "~";
    if (ft === 0) return ".";
    return "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.min(34, Math.floor(ft / 2.5) - 1)] ?? "#";
  };
  console.log("per-square top (2.5 ft per symbol step; . ground, ~ below, S stairs, _ void)");
  for (let i = 0; i < rows; i++) {
    let line = "";
    for (let j = 0; j < cols; j++) {
      line += t.isVoid(i * SUB, j * SUB) ? "_" : t.cellIsStair(i, j) ? "S" : ch(t.cellTop(i, j));
    }
    console.log(`  ${String(i).padStart(3)} ${line}`);
  }
}

if (!layout) {
  const t = res.terrain;
  const hist = new Map();
  for (let k = 0; k < t.h.length; k++) if ((t.kind[k] & 0x0f) !== KIND.VOID) hist.set(t.h[k], (hist.get(t.h[k]) ?? 0) + 1);
  const tot = [...hist.values()].reduce((a, b) => a + b, 0) || 1;
  console.log("height histogram (ft: share of sub-cells):");
  for (const [q, c] of [...hist].sort((a, b) => a[0] - b[0])) console.log(`  ${String((q * distance) / 4).padStart(6)}  ${(100 * c / tot).toFixed(1)}%`);
  let water = 0, vd = 0, stairs = 0;
  for (let k = 0; k < t.kind.length; k++) { const kd = t.kind[k] & 0x0f; if (kd === KIND.WATER) water++; if (kd === KIND.VOID) vd++; if (kd === KIND.STAIRS) stairs++; }
  console.log(`water ${(100 * water / t.kind.length).toFixed(1)}%, void ${(100 * vd / t.kind.length).toFixed(1)}%, stairs ${(100 * stairs / t.kind.length).toFixed(1)}%`);
  process.exit(0);
}

const { terrain: truth, errors } = compileLayout(layout, { cols, rows, distance });
if (!truth) { console.error(`the layout does not compile: ${errors.join("; ")}`); process.exit(2); }
const OLD = await oldAutoSetup();
const rowsOut = [];
if (OLD) rowsOut.push(["old (HEAD)", metrics(OLD.autoSetup({ colours, cols, rows, walls: [], gridSize: 100 }), truth, distance)]);
else console.log("(no git: the old Auto setup is skipped)");
rowsOut.push(["new", metrics(res.terrain, truth, distance)]);
// --also="faces=S;light=SW,faces=S": more rows, each with options a GM could set on top of these.
for (const spec of String(args.also ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
  const extra = Object.fromEntries(spec.split(",").map((kv) => kv.split("=")).map(([k, v]) => [k, v === "false" ? false : v === "true" ? true : Number.isFinite(Number(v)) ? Number(v) : v]));
  const r = NEW.autoSetupDetailed({ ...input, options: { ...options, ...extra } });
  rowsOut.push([`new ${spec}`, metrics(r.terrain, truth, distance)]);
}

const pct = (v) => `${(100 * v).toFixed(1)}%`;
const cols8 = [
  ["class", (m) => pct(m.class)], ["water IoU", (m) => pct(m.waterIoU)], ["MAE raw ft", (m) => m.maeRaw.toFixed(2)],
  ["MAE align ft", (m) => m.maeAligned.toFixed(2)], ["≤2.5 ft", (m) => pct(m.within)], ["corr", (m) => m.corr.toFixed(3)],
  ["bound F1", (m) => `${m.f1.toFixed(3)} (P ${m.prec.toFixed(2)} R ${m.rec.toFixed(2)})`], ["ordered", (m) => pct(m.ordered)],
  ["stairs P/R/dir", (m) => `${m.stairs.prec.toFixed(2)}/${m.stairs.rec.toFixed(2)}/${m.stairs.dir.toFixed(2)}`], ["levels", (m) => String(m.levels)],
];
console.log("");
const nameW = Math.max(12, ...rowsOut.map(([name]) => name.length + 1));
const colW = (h) => (h === "bound F1" ? 24 : h === "stairs P/R/dir" ? 16 : 13);
console.log(["".padEnd(nameW), ...cols8.map(([h]) => h.padStart(colW(h)))].join(""));
for (const [name, m] of rowsOut) console.log([name.padEnd(nameW), ...cols8.map(([h, f]) => f(m).padStart(colW(h)))].join(""));
if (args["water-map"]) {
  const t = res.terrain;
  console.log("\nwater per square (sub-cell majority): W both, + draft only, - truth only");
  for (let i = 0; i < rows; i++) {
    let line = "";
    for (let j = 0; j < cols; j++) {
      let p = 0, q = 0;
      for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) {
        const k = t.idx(i * SUB + a, j * SUB + b);
        if ((t.kind[k] & 0x0f) === KIND.WATER) p++;
        if ((truth.kind[k] & 0x0f) === KIND.WATER) q++;
      }
      line += p > 1 && q > 1 ? "W" : p > 1 ? "+" : q > 1 ? "-" : ".";
    }
    console.log(`  ${String(i).padStart(3)} ${line}`);
  }
}
if (args.confusion) {
  for (const [name, m] of rowsOut) {
    console.log(`\n${name}: sub-cells by truth (rows) and draft (columns): void, water, floor`);
    ["void", "water", "floor"].forEach((c, i) => console.log(`  ${c.padEnd(6)} ${m.confusion[i].map((v) => String(v).padStart(6)).join("")}`));
  }
}
