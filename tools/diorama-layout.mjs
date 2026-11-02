#!/usr/bin/env node
/**
 * Diorama layouts outside Foundry: the map-setup skill's two tools.
 *
 *   node tools/diorama-layout.mjs grid  --image=<map> (--cols=N | --grid=<image px per square>) [--crop=r0:r1,c0:c1] [--out=.preview/dio-grid.html]
 *     A page of the map with every square outlined and numbered (row, column),
 *     so a model reading it can name squares instead of guessing pixels.
 *
 *   node tools/diorama-layout.mjs check <layout.json> --cols=N --rows=N [--image=<map>] [--crop=…] [--out=.preview/dio-layout.html]
 *     Compiles the layout exactly as Foundry will (terrain/layout.mjs), prints
 *     every problem and a per-square height map, and with --image draws the
 *     compiled terrain over the art: layer colour, height in feet, stair arrows.
 *     Exit code 1 on any error.
 *
 * Pages are self-contained (the image is inlined, the script is classic), so
 * they open from file:// as well as from tools/preview-server.mjs.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { compileLayout } = await import(pathToFileURL(resolve(root, "scripts/features/diorama/terrain/layout.mjs")).href);
const { SUB, KIND, KIND_KEYS } = await import(pathToFileURL(resolve(root, "scripts/features/diorama/constants.mjs")).href);
const { resolveProps, footprintCorners } = await import(pathToFileURL(resolve(root, "scripts/features/diorama/terrain/props.mjs")).href);

const [cmd, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => {
  const [k, ...v] = a.slice(2).split("=");
  return [k, v.length ? v.join("=") : true];
}));
const positional = rest.filter((a) => !a.startsWith("--"));

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" };

function usage(msg) {
  if (msg) console.error(msg);
  console.error("usage:\n  node tools/diorama-layout.mjs grid --image=<map> (--cols=N | --grid=<px>) [--crop=r0:r1,c0:c1] [--out=…]\n"
    + "  node tools/diorama-layout.mjs check <layout.json> --cols=N --rows=N [--distance=5] [--image=<map>] [--crop=…] [--out=…]");
  process.exit(2);
}

function crop() {
  if (!args.crop) return null;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(args.crop));
  if (!m) usage("--crop must look like 10:30,0:20 (rows, then columns)");
  return { r0: +m[1], r1: +m[2], c0: +m[3], c1: +m[4] };
}

function imageData(p) {
  const mime = MIME[extname(p).toLowerCase()];
  if (!mime) usage(`unsupported image type: ${p}`);
  return `data:${mime};base64,${readFileSync(p).toString("base64")}`;
}

function writePage(out, title, payload) {
  const file = resolve(root, out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, PAGE.replace("%TITLE%", title).replace("%DATA%", JSON.stringify(payload).replace(/</g, "\\u003c")));
  console.log(`wrote ${file}`);
}

function main() {
if (cmd === "grid") {
  if (!args.image || !(args.grid || args.cols)) usage("grid needs --image and --grid (image px per square) or --cols");
  writePage(args.out || ".preview/dio-grid.html", "Diorama grid", {
    mode: "grid", image: imageData(resolve(String(args.image))), grid: Number(args.grid) || 0, cols: Number(args.cols) || 0, crop: crop(),
  });
} else if (cmd === "check") {
  const file = positional[0];
  if (!file) usage("check needs a layout file");
  const cols = Number(args.cols), rows = Number(args.rows);
  if (!(cols > 0 && rows > 0)) usage("check needs --cols and --rows (the map's size in squares)");
  let layout;
  try { layout = JSON.parse(readFileSync(resolve(String(file)), "utf8")); } catch (e) {
    console.error(`✗ ${file} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  const res = compileLayout(layout, { cols, rows, distance: Number(args.distance) || 5 });
  for (const e of res.errors) console.log(`✗ ${e}`);
  for (const w of res.warnings) console.log(`! ${w}`);
  if (!res.terrain) { console.log(`\n${res.errors.length} problems, nothing compiled.`); process.exit(1); }
  const t = res.terrain;
  const ft = (q) => (q / 4) * (Number(args.distance) || 5);
  // One character per square: its highest sub-square, as a height band.
  const tops = [...new Set(t.distinctTops())];
  const glyphs = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  console.log(`\nHeights (ft) by glyph: ${tops.map((q, i) => `${glyphs[i] ?? "?"}=${ft(q)}`).join("  ")}   ~ water  # stairs  space void`);
  console.log(`     ${Array.from({ length: cols }, (_, c) => (c % 10 === 0 ? String(c / 10 % 10) : " ")).join("")}`);
  console.log(`     ${Array.from({ length: cols }, (_, c) => String(c % 10)).join("")}`);
  for (let i = 0; i < rows; i++) {
    let line = "";
    for (let j = 0; j < cols; j++) {
      if ([0, 1].every((a) => [0, 1].every((b) => t.isVoid(i * SUB + a, j * SUB + b)))) { line += " "; continue; }
      if (t.cellHasKind(i, j, KIND.STAIRS) || t.cellHasKind(i, j, KIND.RAMP)) { line += "#"; continue; }
      if (t.cellHasKind(i, j, KIND.WATER)) { line += "~"; continue; }
      line += glyphs[tops.indexOf(t.cellTop(i, j))] ?? "?";
    }
    console.log(`${String(i).padStart(4)} ${line}`);
  }
  // Props stand on the compiled ground (no offset here: map squares are canvas squares).
  const props = res.props ? resolveProps(t, res.props).props : [];
  if (props.length) {
    console.log(`\nProps (centre [row, col], base and top in ft; * solid, ? GM only):`);
    for (const p of props) {
      console.log(`  ${p.solid && !p.hidden ? "*" : p.hidden ? "?" : " "} ${p.shape.padEnd(8)} [${p.y}, ${p.x}]  ${ft(p.baseQ)} → ${ft(p.topQ)} ft  ${p.label || p.id}`);
    }
  }
  console.log(`\n✓ compiled: ${t.cols}×${t.rows} squares, ${t.palette.length} palette entries, ${props.length} props, ${res.tokens.length} tokens, ${res.warnings.length} warnings.`);
  if (args.image) {
    writePage(args.out || ".preview/dio-layout.html", `Diorama layout: ${layout.name ?? file}`, {
      mode: "layout", image: imageData(resolve(String(args.image))), grid: Number(args.grid) || 0, cols, crop: crop(),
      distance: Number(args.distance) || 5, sub: SUB, kinds: KIND, kindNames: KIND_KEYS,
      terrain: { cols: t.cols, rows: t.rows, h: [...t.h], layer: [...t.layer], kind: [...t.kind], palette: t.palette },
      tokens: res.tokens,
      props: props.map((p) => ({
        shape: p.shape, label: p.label, x: p.x, y: p.y, top: ft(p.topQ), solid: p.solid, hidden: p.hidden,
        corners: footprintCorners(p),
      })),
    });
  }
} else {
  usage();
}
}

/* The page: draws the (cropped) map at a readable scale, then the grid, then
   in layout mode the terrain. Classic script, so file:// runs it. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>%TITLE%</title>
<style>
  html,body{margin:0;background:#0b0f17;color:#dfe7f2;font:12px system-ui,sans-serif}
  #legend{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 12px;background:#0b0f17e6}
  #legend span{display:inline-flex;align-items:center;gap:5px}
  #legend i{width:12px;height:12px;border-radius:2px;display:inline-block}
  canvas{display:block;margin:0 12px 12px}
</style></head><body><div id="legend"></div><canvas id="c"></canvas>
<script>
const D = %DATA%;
const img = new Image();
img.onload = () => {
  // Image px per square: given, or the image width over the map's columns (an
  // exported map is rarely at the scene's own resolution).
  const G = D.grid || img.width / D.cols, mapCols = Math.round(img.width / G), mapRows = Math.round(img.height / G);
  const cr = D.crop || { r0: 0, r1: mapRows, c0: 0, c1: mapCols };
  const nC = cr.c1 - cr.c0, nR = cr.r1 - cr.r0;
  const cell = Math.max(18, Math.min(64, Math.floor(1800 / Math.max(nC, nR / 0.6))));
  const M = 26;                                   // margin for the row / column numbers
  const cv = document.getElementById("c"), x = cv.getContext("2d");
  cv.width = nC * cell + M; cv.height = nR * cell + M;
  x.fillStyle = "#0b0f17"; x.fillRect(0, 0, cv.width, cv.height);
  x.imageSmoothingQuality = "high";
  x.drawImage(img, cr.c0 * G, cr.r0 * G, nC * G, nR * G, M, M, nC * cell, nR * cell);
  const X = (c) => M + (c - cr.c0) * cell, Y = (r) => M + (r - cr.r0) * cell;
  const legend = document.getElementById("legend");
  if (D.mode === "layout") {
    const T = D.terrain, S = D.sub, ft = (q) => +(q / 4 * D.distance).toFixed(2);
    const at = (si, sj) => si * T.cols * S + sj;
    for (let si = Math.floor(cr.r0 * S); si < Math.ceil(cr.r1 * S); si++) for (let sj = Math.floor(cr.c0 * S); sj < Math.ceil(cr.c1 * S); sj++) {
      const k = at(si, sj), p = T.palette[T.layer[k]], kind = T.kind[k] & 15;
      if (!p) continue;
      x.globalAlpha = kind === D.kinds.VOID ? 0.75 : 0.42;
      x.fillStyle = kind === D.kinds.VOID ? "#000" : p.color;
      x.fillRect(X(sj / S), Y(si / S), cell / S, cell / S);
      if (kind === D.kinds.STAIRS || kind === D.kinds.RAMP) {
        const d = (T.kind[k] >> 4) & 3, cx = X((sj + .5) / S), cy = Y((si + .5) / S), r = cell / S * .32;
        const v = [[0,-1],[1,0],[0,1],[-1,0]][d];
        x.globalAlpha = 1; x.strokeStyle = "#fff"; x.lineWidth = 1.5; x.beginPath();
        x.moveTo(cx - v[0]*r, cy - v[1]*r); x.lineTo(cx + v[0]*r, cy + v[1]*r);
        x.lineTo(cx + v[0]*r*.2 - v[1]*r*.6, cy + v[1]*r*.2 + v[0]*r*.6); x.stroke();
      }
    }
    x.globalAlpha = 1;
    // Height per square: its highest sub-square, in feet.
    x.font = "600 " + Math.max(9, cell * 0.3) + "px system-ui"; x.textAlign = "center"; x.textBaseline = "middle";
    for (let r = Math.floor(cr.r0); r < cr.r1; r++) for (let c = Math.floor(cr.c0); c < cr.c1; c++) {
      let top = -Infinity, any = false;
      for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
        const k = at(r * S + a, c * S + b);
        if ((T.kind[k] & 15) === D.kinds.VOID) continue;
        any = true; top = Math.max(top, T.h[k]);
      }
      if (!any) continue;
      const s = String(ft(top));
      x.lineWidth = 3; x.strokeStyle = "#000c"; x.strokeText(s, X(c + .5), Y(r + .5));
      x.fillStyle = "#fff"; x.fillText(s, X(c + .5), Y(r + .5));
    }
    // Props: the footprint (solid amber, scenery dashed, GM-only violet), its front
    // edge doubled, and the top in feet in a tag at the centre.
    for (const p of D.props || []) {
      const hue = p.hidden ? "#b497ff" : p.solid ? "#ffd24a" : "#5fdb92";
      x.globalAlpha = 0.22; x.fillStyle = hue; x.beginPath();
      p.corners.forEach(([cx, cy], i) => (i ? x.lineTo(X(cx), Y(cy)) : x.moveTo(X(cx), Y(cy))));
      x.closePath(); x.fill();
      x.globalAlpha = 1; x.strokeStyle = hue; x.lineWidth = 2; x.setLineDash(p.solid && !p.hidden ? [] : [5, 4]); x.stroke();
      x.setLineDash([]); x.lineWidth = 4; x.beginPath();
      x.moveTo(X(p.corners[2][0]), Y(p.corners[2][1])); x.lineTo(X(p.corners[3][0]), Y(p.corners[3][1])); x.stroke();
      const s = p.shape + " " + p.top;
      x.font = "600 " + Math.max(9, cell * .24) + "px system-ui"; x.textAlign = "center"; x.textBaseline = "middle";
      const w = x.measureText(s).width + 8;
      x.fillStyle = "#0b0f17e0"; x.fillRect(X(p.x) - w / 2, Y(p.y) - cell * .17, w, cell * .34);
      x.fillStyle = hue; x.fillText(s, X(p.x), Y(p.y));
    }
    for (const t of D.tokens || []) {
      x.strokeStyle = "#ff4fd8"; x.lineWidth = 2; x.strokeRect(X(t.j) + 2, Y(t.i) + 2, cell - 4, cell - 4);
      x.fillStyle = "#ff4fd8"; x.font = "600 " + Math.max(9, cell * .24) + "px system-ui"; x.fillText(t.name || t.id, X(t.j + .5), Y(t.i) - 6 + cell);
    }
    legend.innerHTML = T.palette.map((p) => '<span><i style="background:' + p.color + '"></i>' + p.name + " · " + ft(p.h) + " ft · " + D.kindNames[p.kind] + "</span>").join("")
      + "<span>numbers = top of each square in ft · arrows point down the stairs</span>"
      + ((D.props || []).length ? '<span><i style="background:#ffd24a"></i>solid prop</span><span><i style="background:#5fdb92"></i>scenery</span>'
        + '<span><i style="background:#b497ff"></i>GM only</span><span>props: shape and top in ft, thick edge = front</span>' : "");
  } else {
    legend.innerHTML = "<span>Squares are numbered (row, column) from the map's top-left corner. Every 5th line is brighter.</span>";
  }
  // Grid and numbers.
  for (let c = Math.ceil(cr.c0); c <= cr.c1; c++) {
    x.strokeStyle = c % 5 === 0 ? "#ffffffcc" : "#ffffff55"; x.lineWidth = c % 5 === 0 ? 1.5 : 1;
    x.beginPath(); x.moveTo(X(c), M); x.lineTo(X(c), cv.height); x.stroke();
  }
  for (let r = Math.ceil(cr.r0); r <= cr.r1; r++) {
    x.strokeStyle = r % 5 === 0 ? "#ffffffcc" : "#ffffff55"; x.lineWidth = r % 5 === 0 ? 1.5 : 1;
    x.beginPath(); x.moveTo(M, Y(r)); x.lineTo(cv.width, Y(r)); x.stroke();
  }
  x.fillStyle = "#dfe7f2"; x.font = "11px system-ui"; x.textAlign = "center"; x.textBaseline = "middle";
  for (let c = Math.ceil(cr.c0); c < cr.c1; c++) x.fillText(c, X(c + .5), M / 2);
  for (let r = Math.ceil(cr.r0); r < cr.r1; r++) x.fillText(r, M / 2, Y(r + .5));
  if (D.mode === "grid") {
    x.font = Math.max(8, cell * .22) + "px system-ui"; x.fillStyle = "#ffffffaa";
    for (let r = Math.ceil(cr.r0); r < cr.r1; r++) for (let c = Math.ceil(cr.c0); c < cr.c1; c++) {
      x.lineWidth = 3; x.strokeStyle = "#0009"; x.strokeText(r + "," + c, X(c + .5), Y(r + .5));
      x.fillText(r + "," + c, X(c + .5), Y(r + .5));
    }
  }
  document.title += " · " + mapCols + "×" + mapRows + " squares";
};
img.src = D.image;
</script></body></html>`;

main();
