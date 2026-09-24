#!/usr/bin/env node
/**
 * GLUniverse Suite — Performance bench.
 *
 *   node tools/perf-bench.mjs [--out=.preview/perf-bench.html] [--seconds=4]
 *   node tools/preview-server.mjs      # then open /.preview/perf-bench.html
 *
 * Writes a page that loads the suite's REAL stylesheets (the tokens, the
 * motion pool and every feature sheet in module.json) and the REAL shared
 * budget, lays a wall of Etched Glass panels carrying the suite's ambient loops
 * over a moving backdrop — a stand-in for the canvas mid-pan, which is the
 * worst case for a backdrop blur — and measures frame intervals at each glass
 * level, with ambient loops running and held. The table it prints is what
 * `data-gl-perf` and the ambient hold buy on the machine that opened it.
 *
 * It is a relative measure: the same page, the same machine, one knob at a
 * time. Driven headless it runs UNCAPPED, so an interval is main-thread cost —
 * which is where held ambient loops show. A backdrop blur's cost is paid on
 * the compositor/GPU thread, which frame intervals cannot see until the GPU is
 * the bottleneck; on a real display that shows up as dropped frames in the
 * overlay, not here. It cannot tell you what a real table costs; the overlay's 30-second
 * benchmark inside a session does that. Serve it — a file:// page does not run
 * its module script. The Browser pane throttles animation frames while hidden,
 * so run it in a visible tab.
 *
 * It drives the page headless and prints the table: through Playwright where it
 * is installed, otherwise through a local Chrome over the DevTools protocol
 * (set CHROME to point at one). With neither it writes the page, says where,
 * and exits 0.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const OUT = arg("out", ".preview/perf-bench.html");
const SECONDS = Number(arg("seconds", 4));

const moduleJson = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
const links = moduleJson.styles.map((s) => `<link rel="stylesheet" href="/${s}">`).join("\n  ");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>GLU Performance bench</title>
  ${links}
  <style>
    body { margin: 0; background: #000; color: var(--gl-text); font-family: var(--gl-tech); overflow: hidden; }
    #backdrop {
      position: fixed; inset: -50%;
      background:
        repeating-linear-gradient(45deg, #1b2a44 0 40px, #0c1322 40px 80px),
        radial-gradient(circle at 30% 40%, #6b86d6 0, transparent 30%);
      will-change: transform;
    }
    #wall { position: fixed; inset: 0; display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; padding: 24px; }
    .bench-panel { height: 120px; padding: 12px; }
    .bench-panel .bench-loop { width: 40px; height: 40px; border-radius: 50%; background: var(--gl-accent);
      animation: gl-breathe var(--gl-breathe) var(--gl-ease-inout) infinite; }
    #report { position: fixed; right: 12px; bottom: 12px; z-index: 10; padding: 10px 14px; white-space: pre; font-size: 12px; }
  </style>
</head>
<body class="gl-type">
  <div id="backdrop"></div>
  <div id="wall"></div>
  <pre id="report" class="gl-glass">running…</pre>
  <script type="module">
    import { FrameWindow } from "/scripts/core/budget.mjs";
    const SECONDS = ${SECONDS};
    const wall = document.getElementById("wall");
    for (let i = 0; i < 36; i++) {
      const p = document.createElement("div");
      p.className = "gl-glass bench-panel";
      p.innerHTML = '<div class="bench-loop"></div>';
      wall.append(p);
    }
    const backdrop = document.getElementById("backdrop");
    let t0 = performance.now();
    // The "pan": the backdrop moves every frame, so every blur re-renders.
    (function pan(now) { backdrop.style.transform = "translate(" + (Math.sin((now - t0) / 700) * 120) + "px," + (Math.cos((now - t0) / 900) * 80) + "px)"; requestAnimationFrame(pan); })(t0);

    const ambient = (run) => {
      for (const a of document.getAnimations()) {
        if (a.effect?.getTiming?.().iterations !== Infinity) continue;
        run ? a.play() : a.pause();
      }
    };
    const measure = (ms) => new Promise((done) => {
      const w = new FrameWindow(4096);
      let last = 0;
      const end = performance.now() + ms;
      (function f(now) {
        if (last) w.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(f); else done(w);
      })(performance.now());
    });
    const rows = [];
    for (const glass of ["full", "light", "none"]) {
      for (const loops of [true, false]) {
        document.documentElement.dataset.glPerf = glass;
        ambient(loops);
        await measure(600); // settle
        const w = await measure(SECONDS * 1000);
        const [p50, p95, p99] = w.percentiles([0.5, 0.95, 0.99]);
        rows.push({ glass, ambient: loops ? "running" : "held", fps: +(1000 / p50).toFixed(1), p50: +p50.toFixed(2), p95: +p95.toFixed(2), p99: +p99.toFixed(2) });
        document.getElementById("report").textContent = rows.map((r) => JSON.stringify(r)).join("\\n");
      }
    }
    window.__perfBench = rows;
    document.getElementById("report").textContent =
      "glass  ambient  fps    p50    p95    p99\\n" +
      rows.map((r) => [r.glass.padEnd(6), r.ambient.padEnd(8), String(r.fps).padEnd(6), String(r.p50).padEnd(6), String(r.p95).padEnd(6), r.p99].join(" ")).join("\\n");
  </script>
</body>
</html>
`;

mkdirSync(dirname(join(ROOT, OUT)), { recursive: true });
writeFileSync(join(ROOT, OUT), html);
console.log(`wrote ${OUT}`);

/* ── Serve the repo root on a free port (both drivers need it) ───────────── */

async function serve() {
  const { createServer } = await import("node:http");
  const { readFile } = await import("node:fs/promises");
  const { extname, normalize } = await import("node:path");
  const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".ttf": "font/ttf" };
  const server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(ROOT, rel));
      res.writeHead(200, { "content-type": TYPES[extname(rel)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server;
}

const TIMEOUT_MS = (SECONDS + 1) * 6 * 1000 + 30000;

function printTable(rows) {
  console.table(rows);
  const base = rows.find((r) => r.glass === "full" && r.ambient === "running");
  const best = rows.find((r) => r.glass === "none" && r.ambient === "held");
  if (base && best) console.log(`p95 ${base.p95} ms → ${best.p95} ms from glass "full"/loops running to glass "none"/loops held.`);
}

/* ── Driver 1: Playwright, where installed ─────────────────────────────── */

async function viaPlaywright(url) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null;
  }
  const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(url);
    await page.waitForFunction(() => Array.isArray(window.__perfBench), null, { timeout: TIMEOUT_MS });
    return await page.evaluate(() => window.__perfBench);
  } finally {
    await browser.close();
  }
}

/* ── Driver 2: a local Chrome over the DevTools protocol ─────────────────
   Real-time headless Chrome, not --virtual-time-budget: virtual time makes
   every frame interval a fiction, which is the one thing this tool measures. */

const CHROME_PATHS = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

async function viaChrome(url) {
  const { existsSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { spawn } = await import("node:child_process");
  const bin = CHROME_PATHS.find((p) => existsSync(p));
  if (!bin || typeof WebSocket !== "function") return null;
  const profile = mkdtempSync(join(tmpdir(), "glperf-bench-"));
  const chrome = spawn(bin, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--window-size=1600,900", "--no-first-run", "--no-default-browser-check",
    // Unlocked: at a vsync-capped 60 every row reads 16.7 ms however much work
    // it did, and the table says nothing. Uncapped, the interval IS the cost.
    "--disable-gpu-vsync", "--disable-frame-rate-limit",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const wsUrl = await new Promise((res, rej) => {
      let buf = "";
      const timer = setTimeout(() => rej(new Error("Chrome did not start")), 15000);
      chrome.stderr.on("data", (d) => {
        buf += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) { clearTimeout(timer); res(m[1]); }
      });
    });
    const port = new URL(wsUrl).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
    await send("Page.enable");
    await send("Page.navigate", { url });
    const until = Date.now() + TIMEOUT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      const out = await send("Runtime.evaluate", { expression: "JSON.stringify(window.__perfBench ?? null)", returnByValue: true });
      const rows = JSON.parse(out.result?.result?.value ?? "null");
      if (rows) { ws.close(); return rows; }
    }
    throw new Error("the bench page did not finish");
  } finally {
    chrome.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still holds it */ }
  }
}

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/${OUT}`;
try {
  const rows = (await viaPlaywright(url)) ?? (await viaChrome(url));
  if (rows) printTable(rows);
  else console.log(`Neither Playwright nor a local Chrome was found — serve the repo (node tools/preview-server.mjs) and open /${OUT} in a visible tab.`);
} finally {
  server.close();
}
