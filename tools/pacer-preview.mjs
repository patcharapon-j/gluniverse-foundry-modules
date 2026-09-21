/**
 * tools/pacer-preview.mjs — write a live preview page for the Stream Pacer
 * signal panels (wrap-up, countdown, ready check, campfire arrival).
 *
 * The page imports the SHIPPED modules — PacerManager, PacerOverlay,
 * DossierCard, CampfireOverlay — and the shipped stylesheets, over a stubbed
 * `game`, so what it shows is the real arrival, dock and ready-check flow
 * rather than a lookalike. The signal cues are the real Web Audio synth too
 * (click anything once so the browser lets the page make sound).
 *
 *   node tools/pacer-preview.mjs --out=.preview/pacer.html
 *   node tools/preview-server.mjs        # then open /.preview/pacer.html
 *
 * SERVE it: a file:// page does not execute its module script. Append
 * `?role=player` for a player's screen (answer buttons, cues, the "You're
 * ready" pill) and `?role=gm` (the default) for the GM's tally card.
 *
 * `window.__pacer` exposes the drivers (soft, countdown, ready, cancel,
 * campfire, answer, safety) for headless use.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/pacer.html");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pacer preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/stream-pacer.css">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0e140f; }
  /* A stand-in scene: grid over a dim map, a sidebar, a hotbar. */
  #fake-map { position: fixed; inset: 0; background:
    linear-gradient(#ffffff0a 1px, transparent 1px) 0 0 / 60px 60px,
    linear-gradient(90deg, #ffffff0a 1px, transparent 1px) 0 0 / 60px 60px,
    radial-gradient(ellipse at 35% 40%, #33472f, #172016 60%, #0e140f); }
  #fake-sidebar { position: fixed; top: 0; right: 0; bottom: 0; width: 300px; background: #0d1016; border-left: 1px solid #222; }
  #fake-hotbar { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); width: 520px; height: 50px; background: #0d1016; border: 1px solid #222; }
  #drive { position: fixed; bottom: 70px; left: 8px; z-index: 200; display: flex; flex-wrap: wrap; gap: 4px; max-width: 520px;
    font: 12px system-ui; }
  #drive button { font: inherit; padding: 4px 8px; cursor: pointer; }
  #drive b { color: #ddd; padding: 4px; }
</style></head>
<body>
<div id="fake-map"></div><div id="fake-sidebar"></div><div id="fake-hotbar"></div>
<div id="drive"></div>
<script type="module">
const role = new URLSearchParams(location.search).get('role') === 'player' ? 'player' : 'gm';
const lang = await (await fetch('/lang/stream-pacer.en.json')).json();
const lookup = (k) => k.split('.').reduce((o, p) => o?.[p], lang);

const settings = {
  'sp.exemptUsers': [], 'sp.perilExemptUsers': [], 'sp.safetyExemptUsers': [],
  'sp.cueAudioEnabled': true, 'sp.cueAudioVolume': 0.6,
  'sp.handRaiseAudioEnabled': true, 'sp.handRaiseAudioVolume': 0.6,
  'sp.defaultCountdown': 15, 'sp.pacerState': null
};
const users = [
  { id: 'gm', name: 'Gamemaster', isGM: true, active: true },
  { id: 'p1', name: 'Kaia Morrow', isGM: false, active: true },
  { id: 'p2', name: 'Mirel Ashdown', isGM: false, active: true },
  { id: 'p3', name: 'Rook', isGM: false, active: true },
  { id: 'p4', name: 'Juno Vale', isGM: false, active: true }
];
users.get = (id) => users.find(u => u.id === id);
const me = role === 'gm' ? users[0] : users[1];

globalThis.game = {
  user: me,
  users,
  settings: { get: (_ns, key) => settings[key], set: async (_ns, key, v) => { settings[key] = v; } },
  i18n: {
    localize: (k) => lookup(k) ?? k,
    format: (k, d) => String(lookup(k) ?? k).replace(/\\{(\\w+)\\}/g, (_, n) => d?.[n] ?? '')
  },
  socket: { emit() {}, on() {} }
};
globalThis.foundry = {
  utils: { randomID: () => Math.random().toString(36).slice(2, 12) },
  // settings.js reads these at module scope for its config windows.
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} }, handlebars: { renderTemplate: async (path, ctx) => {
    // The campfire bar template, with the little Handlebars it uses.
    let t = await (await fetch('/' + path.replace(/^modules\\/[^/]+\\//, ''))).text();
    t = t.replace(/\\{\\{!--[\\s\\S]*?--\\}\\}/g, '');
    for (let i = 0; i < 4; i++) t = t.replace(/\\{\\{#if (\\w+)\\}\\}((?:(?!\\{\\{#if)[\\s\\S])*?)\\{\\{\\/if\\}\\}/g, (_, k, body) => ctx[k] ? body : '');
    return t.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => ctx[k] ?? '');
  } } }
};

const { PacerManager } = await import('/scripts/features/stream-pacer/PacerManager.js');
const { PacerOverlay } = await import('/scripts/features/stream-pacer/PacerOverlay.js');
const { CampfireOverlay } = await import('/scripts/features/stream-pacer/CampfireOverlay.js');
const { CueAudio } = await import('/scripts/features/stream-pacer/CueAudio.js');
const { PLAYER_STATUS } = await import('/scripts/features/stream-pacer/settings.js');

PacerManager.onAllReady(() => CueAudio.playAllReady());
new PacerOverlay().initialize();
new CampfireOverlay().initialize();

// A GM drives the manager directly; a player's screen receives what a GM sent.
const drive = {
  soft: () => role === 'gm' ? PacerManager.activateSoftSignal() : PacerManager.receiveGmSoftSignal(),
  countdown: (s = 15) => role === 'gm' ? PacerManager.startCountdown(s) : PacerManager.receiveGmHardCountdown(Date.now() + s * 1000),
  ready: () => role === 'gm' ? PacerManager.startReadyCheck() : PacerManager.receiveGmReadyCheck(foundry.utils.randomID()),
  cancel: () => role === 'gm' ? PacerManager.cancelSignal() : PacerManager.receiveGmCancelSignal(),
  campfire: (s = 0) => role === 'gm' ? PacerManager.declareCampfire(s || null) : PacerManager.receiveCampfireDeclare(s ? Date.now() + s * 1000 : null),
  campfireOff: () => role === 'gm' ? PacerManager.dismissCampfire() : PacerManager.receiveCampfireDismiss(),
  answer: (id, status) => PacerManager.receivePlayerStatusChange(id, PLAYER_STATUS[status] ?? status),
  late: (sig) => PacerManager.receiveSyncState({ gmSignal: sig, readyCheckId: 'late', countdownEnd: Date.now() + 40000, playerStates: {} }),
  safety: () => document.body.classList.toggle('sp-safety-request')
};
window.__pacer = drive;

const bar = document.getElementById('drive');
const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; bar.appendChild(b); };
const tag = document.createElement('b'); tag.textContent = role.toUpperCase(); bar.appendChild(tag);
add('Wrap-up', drive.soft);
add('Countdown 15s', () => drive.countdown(15));
add('Ready check', drive.ready);
add('Cancel', drive.cancel);
add('Campfire', () => drive.campfire(0));
add('Campfire 90s', () => drive.campfire(90));
add('End campfire', drive.campfireOff);
for (const u of users.filter(u => !u.isGM && u.id !== me.id)) {
  add(u.name.split(' ')[0] + ' ready', () => drive.answer(u.id, 'READY'));
  add(u.name.split(' ')[0] + ' hand', () => drive.answer(u.id, 'HAND_RAISED'));
}
add('Late join (countdown)', () => drive.late('countdown'));
add('Toggle safety banner', drive.safety);
add(role === 'gm' ? 'View as player' : 'View as GM', () => { location.search = role === 'gm' ? '?role=player' : '?role=gm'; });

// ?demo=<scenario> sets a scene up on load, for headless contact sheets
// (chrome --headless --screenshot --virtual-time-budget=… lets the timers run).
const demo = new URLSearchParams(location.search).get('demo');
if (demo) {
  bar.style.display = 'none';
  const scenarios = {
    ready: () => drive.ready(),
    answered: () => { drive.ready(); PacerManager.setPlayerStatus(me.id, PLAYER_STATUS.READY); },
    hand: () => { drive.ready(); PacerManager.setPlayerStatus(me.id, PLAYER_STATUS.HAND_RAISED); },
    tally: () => { drive.ready(); drive.answer('p1', 'READY'); drive.answer('p3', 'HAND_RAISED'); },
    allready: () => { drive.ready(); for (const id of ['p1', 'p2', 'p3', 'p4']) drive.answer(id, 'READY'); },
    soft: () => drive.soft(),
    countdown: () => drive.countdown(75),
    critical: () => drive.countdown(9),
    campfire: () => drive.campfire(90),
    safety: () => { drive.safety(); drive.ready(); }
  };
  scenarios[demo]?.();
}
</script>
</body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`wrote ${OUT}`);
