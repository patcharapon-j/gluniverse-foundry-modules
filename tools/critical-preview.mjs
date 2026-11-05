#!/usr/bin/env node
/**
 * Critical: a browser-backed look at the cut-in and its two config windows.
 *
 * Nothing here is a copy of the feature. The cut-in is played by the shipped
 * beat sheet (`motion.mjs`) through the shipped seam (`cut-in.mjs`) under the
 * shipped stylesheet, on the DOM path the video cut-in takes (a `<video>` whose
 * poster stands in for a clip). The still-image path is PIXI in a live session
 * and applies the same frame to a sprite. The windows are the real templates,
 * localised from the real language file.
 *
 * Usage: node tools/critical-preview.mjs [--out=.preview/critical.html]
 *        node tools/preview-server.mjs
 *        /.preview/critical.html               every frame
 *        /.preview/critical.html?only=pc-hold   one frame
 *        ...&seek=500                           freeze every cut-in at 500 ms
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/critical.html");

const LANG = JSON.parse(readFileSync(join(ROOT, "lang/critical.en.json"), "utf8"));
const t = (key, data) => {
  const s = key.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), LANG);
  const str = typeof s === "string" ? s : key;
  return data ? str.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m)) : str;
};

/**
 * The subset of Handlebars the two templates use: {{#if}}, {{#unless}},
 * {{#each}} over objects, {{localize "k"}}, {{localize this.label}}, {{path}}.
 */
function render(src, ctx) {
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const get = (scope, path) => path.replace(/^this\./, "").split(".").reduce((o, k) => (o == null ? undefined : o[k]), scope);
  let out = src.replace(/\{\{#each ([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, key, body) =>
    (get(ctx, key) ?? []).map((item) => render(body, { ...ctx, ...item })).join(""));
  const block = /\{\{#(if|unless) ([\w.]+)\}\}((?:(?!\{\{#(?:if|unless))[\s\S])*?)\{\{\/\1\}\}/g;
  for (let pass = 0; pass < 6 && block.test(out); pass++) {
    block.lastIndex = 0;
    out = out.replace(block, (_m, kind, key, body) => (Boolean(get(ctx, key)) === (kind === "if") ? body : ""));
  }
  out = out.replace(/\{\{localize "([^"]+)"\}\}/g, (_m, k) => esc(t(k)));
  out = out.replace(/\{\{localize ([\w.]+)\}\}/g, (_m, k) => esc(t(get(ctx, k))));
  out = out.replace(/\{\{([\w.]+)\}\}/g, (_m, k) => esc(get(ctx, k)));
  // Foundry's <file-picker> builds a text input and a browse button inside itself.
  out = out.replace(/<file-picker([^>]*?)name="(\w+)" value="([^"]*)" placeholder="([^"]*)"><\/file-picker>/g, (_m, pre, name, value, ph) =>
    `<file-picker${pre}name="${name}"><input class="image" type="text" value="${value}" placeholder="${ph}">` +
    `<button type="button" class="fa-solid fa-file-import fa-fw icon" aria-label="Browse"></button></file-picker>`);
  return out;
}

const gmTpl = readFileSync(join(ROOT, "templates/critical/gm-config.html"), "utf8");
const actorTpl = readFileSync(join(ROOT, "templates/critical/actor-config.html"), "utf8");

const gmContext = {
  data: { gmAvatar: "worlds/ashfall/art/cut-ins/npc-default.webp", pcCriticalSfx: "worlds/ashfall/sfx/crit-pc.ogg", gmCriticalSfx: "", cinematicDuration: 1000, videoAudioDefault: true },
  durationMin: 600,
  durationMax: 3000,
  videoDurationChoices: [
    { value: "video", label: "GLUC.Settings.VideoDurationModeChoiceVideo", selected: true },
    { value: "fixed", label: "GLUC.Settings.VideoDurationModeChoiceFixed", selected: false },
  ],
};
const actorContext = ({ isNPC, isGM, isVideo, override }) => ({
  isNPC,
  isGM,
  isVideo,
  videoAudioChoices: [
    { value: "default", label: "GLUC.Actor.VideoAudioDefaultOn", selected: true },
    { value: "on", label: "GLUC.Actor.VideoAudioOn", selected: false },
    { value: "off", label: "GLUC.Actor.VideoAudioOff", selected: false },
  ],
  data: { enabled: true, portraitOverride: override, videoAudio: "default" },
});

const frame = (id, label, body) =>
  `<figure class="preview-frame" data-frame="${id}"><figcaption class="preview-label">${label}</figcaption>${body}</figure>`;

const windowFrame = (id, label, cls, title, icon, body, width) =>
  frame(id, label,
    `<form class="application ${cls} preview-window" style="width:${width}px">` +
    `<header class="window-header"><i class="window-icon fa-solid ${icon}"></i><h1 class="window-title">${title}</h1>` +
    `<button type="button" class="header-control icon fa-solid fa-xmark" aria-label="Close"></button></header>` +
    `<section class="window-content">${body}</section></form>`);

/* Stand-in art, drawn inline: geometry only, labelled for what it stands in for. */
const svg = (w, h, body) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const PC_ART = svg(1600, 900,
  `<defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b4a63"/><stop offset="1" stop-color="#141822"/></linearGradient></defs>` +
  `<rect width="1600" height="900" fill="url(#s)"/><polygon points="0,900 520,260 760,520 1020,180 1600,900" fill="#0c0f16"/>` +
  `<circle cx="1180" cy="230" r="90" fill="#d8c79a"/><polygon points="700,900 820,380 900,380 1020,900" fill="#202838"/>` +
  `<text x="60" y="110" font-family="sans-serif" font-size="44" fill="#9aa4b8">PC art · 16:9 stand-in</text>`);
const NPC_ART = svg(800, 1200,
  `<rect width="800" height="1200" fill="#2a1414"/><circle cx="400" cy="420" r="210" fill="#5a2020"/>` +
  `<polygon points="120,1200 400,640 680,1200" fill="#140808"/><circle cx="330" cy="400" r="22" fill="#ffcf80"/><circle cx="470" cy="400" r="22" fill="#ffcf80"/>` +
  `<text x="40" y="80" font-family="sans-serif" font-size="36" fill="#b88a8a">NPC art · 2:3 stand-in</text>`);

const screen = (id, label, { art, seek }) =>
  frame(id, label,
    `<div class="preview-screen" data-art="${art}" ${seek != null ? `data-seek="${seek}"` : ""}>` +
    `<div class="preview-map"></div><div id="gls-critical-overlay"></div></div>`);

const frames = [
  screen("pc-enter", "Cut-in · PC still, entering (80 ms of 1000)", { art: "pc", seek: 80 }),
  screen("pc-hold", "Cut-in · PC still, holding (500 ms)", { art: "pc", seek: 500 }),
  screen("pc-exit", "Cut-in · PC still, leaving (900 ms)", { art: "pc", seek: 900 }),
  screen("npc-hold", "Cut-in · NPC portrait, holding (500 ms)", { art: "npc", seek: 500 }),
  screen("live", "Cut-in · the live beat, looping", { art: "pc" }),
  windowFrame("gm", "GM Configuration · as the GM opens it", "gluc-gm-config", t("GLUC.Settings.MenuName"), "fa-cog", render(gmTpl, gmContext), 520),
  windowFrame("actor-pc", "Critical Cinematic · a PC, opened by its player",
    "gluc-actor-config", t("GLUC.Actor.ModalTitlePC", { name: "Seri Vantor" }), "fa-bolt",
    render(actorTpl, actorContext({ isNPC: false, isGM: false, isVideo: false, override: "" })), 480),
  windowFrame("actor-npc", "Critical Cinematic · an NPC with a video cut-in, opened by the GM",
    "gluc-actor-config", t("GLUC.Actor.ModalTitleNPC", { name: "Ash Wyrm" }), "fa-bolt",
    render(actorTpl, actorContext({ isNPC: true, isGM: true, isVideo: true, override: "worlds/ashfall/art/cut-ins/wyrm.webm" })), 480),
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Critical preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="../styles/gl-fonts.css">
<link rel="stylesheet" href="../styles/gl-tokens.css">
<link rel="stylesheet" href="../styles/gl-motion.css">
<link rel="stylesheet" href="../styles/critical.css">
<style>
  /* Stand-ins for Foundry's frame and canvas. Nothing here styles a gluc- class;
     the overlay is pinned into its screen instead of the viewport. */
  body { margin:0; padding:24px; background:#1b1d22; color:#ddd; font-family:system-ui, sans-serif;
         display:flex; flex-wrap:wrap; gap:28px; align-items:flex-start; }
  body.only { display:block; }
  body.only .preview-frame:not(.is-only) { display:none; }
  .preview-frame { margin:0; display:flex; flex-direction:column; gap:8px; }
  .preview-label { font:600 11px/1 system-ui, sans-serif; letter-spacing:.1em; text-transform:uppercase; color:#8a8d98; }
  .preview-screen { position:relative; width:1280px; height:720px; overflow:hidden; }
  .preview-map { position:absolute; inset:0; background:
      radial-gradient(900px 500px at 30% 40%, #4b5a3a, #26301f 60%, #171c13); }
  .preview-map::after { content:""; position:absolute; inset:0; background-image:
      linear-gradient(#0003 1px, transparent 1px), linear-gradient(90deg, #0003 1px, transparent 1px); background-size:64px 64px; }
  .preview-screen > #gls-critical-overlay { position:absolute; }
  .preview-window { position:relative; display:flex; flex-direction:column; }
  .preview-window .window-header { display:flex; align-items:center; gap:8px; height:34px; padding:0 8px 0 12px; }
  .preview-window .window-title { margin:0; border:0; flex:1; }
  .preview-window .header-control { background:none; border:0; color:inherit; width:24px; height:24px; }
</style></head><body>
${frames.join("\n")}
<script type="module">
  import { createCinematicMotion } from "../scripts/features/critical/motion.mjs";
  import { fitBox, mediaStyle, videoEdges } from "../scripts/features/critical/cut-in.mjs";
  const ART = { pc: { src: ${JSON.stringify(PC_ART)}, w: 1600, h: 900 }, npc: { src: ${JSON.stringify(NPC_ART)}, w: 800, h: 1200 } };
  const DURATION = 1000;
  const q = new URLSearchParams(location.search);
  const only = q.get("only");
  if (only) {
    document.body.classList.add("only");
    document.querySelector('[data-frame="' + only + '"]')?.classList.add("is-only");
  }
  const forced = q.get("seek");
  for (const el of document.querySelectorAll(".preview-screen")) {
    const host = el.querySelector("#gls-critical-overlay");
    const art = ART[el.dataset.art];
    // The same layer runVideoCinematic builds.
    const layer = document.createElement("div");
    layer.className = "gluc-video-layer";
    const backdrop = document.createElement("div");
    backdrop.className = "gluc-video-backdrop";
    const video = document.createElement("video");
    video.className = "gluc-video";
    video.poster = art.src;
    layer.append(backdrop, video);
    host.append(layer);
    const box = fitBox(art.w, art.h, el.clientWidth, el.clientHeight);
    video.style.width = box.w.toFixed(2) + "px";
    video.style.height = box.h.toFixed(2) + "px";
    const motion = createCinematicMotion(DURATION, { edges: videoEdges(DURATION) });
    const paint = (ms) => {
      const f = motion.sample(ms);
      backdrop.style.opacity = String(f.bgAlpha);
      Object.assign(video.style, mediaStyle(f));
    };
    const seek = forced ?? el.dataset.seek;
    if (seek != null) { paint(Number(seek)); continue; }
    const start = performance.now();
    const loop = () => { paint((performance.now() - start) % (DURATION + 600)); requestAnimationFrame(loop); };
    loop();
  }
</script>
</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
