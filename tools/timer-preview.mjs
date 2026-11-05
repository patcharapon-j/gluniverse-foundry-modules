/**
 * tools/timer-preview.mjs — write a live preview page for the Timer.
 *
 * The page imports the SHIPPED modules (view.mjs, hud.mjs, state.mjs, the
 * motion) and the shipped stylesheets over a preview server, with a small
 * stand-in for `game` (the HUD reads the user, the pause and the setting), and
 * feeds them states shaped exactly like the world setting. The plate, the GM
 * strip and the panel are the files Foundry loads, at shipping size.
 *
 *   node tools/timer-preview.mjs [--out=.preview/timer.html]
 *   node tools/preview-server.mjs        # then open /.preview/timer.html
 *
 * SERVE it: a file:// page does not execute its module script.
 *
 *   ?scene=sheet     every state at once, each on its own stand-in table (default)
 *   ?scene=calm      4:32 left, running
 *   ?scene=urgent    the last minute: amber, SS.cc
 *   ?scene=critical  the last ten: red, knocking once a second
 *   ?scene=paused    held at 2:15 (steel)
 *   ?scene=expired   time up
 *   ?scene=gm        the GM's plate with its strip; the strip works
 *   ?scene=panel     the GM's create / exact-set window
 *   ?scene=moments   a 16 s run that plays every moment once: the arrival
 *                    wipe, the flare into amber and red, the knocks and the hit
 *   &gm=1            any single scene as the GM (with the strip)
 *   &freeze=1        hold the clock and the drain still, for screenshots
 *
 * `window.__timer` exposes { set(scene), hud } for headless use.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/timer.html");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Timer preview</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/timer.css">
<style>
  html, body { margin: 0; min-height: 100%; background: #0b0d0c; font-family: "Signika", system-ui, sans-serif; color: #ccc; }
  /* a stand-in table: a dim map under a grid, Foundry's controls and sidebar */
  .table { position: relative; overflow: hidden; height: 100vh; transform: translateZ(0); }
  .map { position: absolute; inset: 0; background:
    linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 70px 70px,
    linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 70px 70px,
    radial-gradient(40% 50% at 30% 60%, #2a3324, transparent 70%),
    radial-gradient(35% 40% at 70% 35%, #3a3022, transparent 70%),
    radial-gradient(60% 60% at 50% 50%, #1c211b, #0b0d0c); }
  .table.is-bright .map { background:
    radial-gradient(40% 50% at 40% 20%, #d9c7a0, transparent 70%),
    radial-gradient(35% 40% at 60% 10%, #c4b48c, transparent 70%),
    linear-gradient(#a8956c, #6d5c3e); }
  .controls { position: absolute; left: 10px; top: 80px; display: flex; flex-direction: column; gap: 6px; }
  .controls i { width: 36px; height: 36px; display: grid; place-items: center; background: #1b1b1fd9; border: 1px solid #ffffff1a; border-radius: 5px; color: #c9c9d0; font-size: 15px; }
  .sidebar { position: absolute; right: 0; top: 0; bottom: 0; width: 300px; background: #121214e6; border-left: 1px solid #ffffff14; }
  .label { position: absolute; left: 60px; bottom: 10px; font: 12px/1 monospace; color: #8a8a90; }
  body.is-sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px; background: #000; }
  body.is-sheet .table { height: 220px; }
  body.is-sheet .sidebar { width: 120px; }
  .panel-host { position: absolute; left: 50%; top: 120px; translate: -50% 0; width: 340px; }
  .panel-host .window-header { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; }
  .panel-host .window-header .window-title { flex: 1; margin: 0; }
  #err { position: fixed; left: 8px; bottom: 8px; color: #ff6b6b; font: 12px monospace; white-space: pre; z-index: 999; }
</style></head>
<body>
<pre id="err"></pre>
<script type="module">
const report = (e) => { document.getElementById('err').textContent += (e?.stack ?? e) + '\\n'; };
window.addEventListener('error', (e) => report(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => report(e.reason));
const q = new URLSearchParams(location.search);
const scene = q.get('scene') || 'sheet';
const freeze = q.get('freeze') === '1';
const gmParam = q.get('gm') === '1';
try {
  const lang = await (await fetch('/lang/timer.en.json')).json();
  const localize = (k) => lang[k] ?? k;
  const values = new Map([['timer.sound', false]]);
  const huds = [];
  // the stand-in for Foundry: the HUD reads the user, the pause and the setting
  globalThis.game = {
    user: { isGM: false, id: 'preview' }, paused: false,
    i18n: { localize, format: localize },
    settings: {
      get: (_id, k) => values.get(k),
      set: async (_id, k, v) => { values.set(k, v); if (k === 'timer.state') for (const h of huds) h.onState({ ...v }); return v; },
    },
  };
  globalThis.ui = { notifications: { warn: console.warn } };
  const { TimerHUD } = await import('/scripts/features/timer/hud.mjs');
  const { DEFAULT_STATE } = await import('/scripts/features/timer/state.mjs');
  const T0 = 2_000_000_000_000;
  const now = () => (freeze ? T0 : Date.now());

  const STATES = {
    calm: () => ({ running: true, remainingMs: 272_000, totalMs: 600_000 }),
    urgent: () => ({ running: true, remainingMs: 42_380, totalMs: 300_000 }),
    critical: () => ({ running: true, remainingMs: 7_420, totalMs: 300_000 }),
    paused: () => ({ running: false, remainingMs: 135_000, totalMs: 300_000 }),
    expired: () => ({ running: false, expired: true, remainingMs: 0, totalMs: 300_000 }),
  };
  const stateOf = (name) => ({ ...DEFAULT_STATE, active: true, anchor: now(), ...(STATES[name] ?? STATES.calm)() });

  function table(label, { bright = false } = {}) {
    const t = document.createElement('div');
    t.className = 'table' + (bright ? ' is-bright' : '');
    t.innerHTML = '<div class="map"></div><div class="controls"><i class="fa-solid fa-user"></i><i class="fa-solid fa-ruler"></i><i class="fa-solid fa-lightbulb"></i></div><div class="sidebar"></div><span class="label"></span>';
    t.querySelector('.label').textContent = label;
    document.body.appendChild(t);
    return t;
  }
  function mount(host, gm, state) {
    game.user.isGM = gm;
    const hud = new TimerHUD.constructor();
    hud.now = now;
    hud.mount(host);
    huds.push(hud);
    hud.onState(state);
    return hud;
  }
  if (freeze) {
    // a still: the drain holds where the state put it
    const s = document.createElement('style');
    s.textContent = '#gltimer-hud .gltimer-drain i { animation-play-state: paused !important; }';
    document.head.appendChild(s);
  }

  async function renderPanel(host, active) {
    const src = await (await fetch('/templates/timer/panel.hbs')).text();
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const render = (s, ctx) => s
      .replace(/{{#each (\\w+)}}([\\s\\S]*?){{\\/each}}/g, (_, k, body) => (ctx[k] ?? []).map((item) => render(body, { ...ctx, this: item })).join(''))
      .replace(/{{#if (\\w+)}}([\\s\\S]*?)(?:{{else}}([\\s\\S]*?))?{{\\/if}}/g, (_, k, a, b = '') => (ctx[k] ? render(a, ctx) : render(b, ctx)))
      .replace(/{{localize "([^"]+)"}}/g, (_, k) => esc(localize(k)))
      .replace(/{{([\\w.]+)}}/g, (_, k) => esc(k.split('.').reduce((v, p) => v?.[p], ctx)));
    const presets = [{ m: 1, s: 0, label: '1:00' }, { m: 3, s: 0, label: '3:00' }, { m: 5, s: 0, label: '5:00' }, { m: 10, s: 0, label: '10:00' }];
    const app = document.createElement('div');
    app.className = 'application gltimer-panel gl-type panel-host';
    app.innerHTML = '<header class="window-header"><i class="window-icon fa-solid fa-stopwatch"></i><h1 class="window-title"></h1><i class="fa-solid fa-xmark"></i></header><section class="window-content"></section>';
    app.querySelector('.window-title').textContent = localize('GLTIMER.panel.title');
    app.querySelector('.window-content').innerHTML = render(src, { active, curM: active ? 2 : 5, curS: active ? 15 : 0, presets });
    host.appendChild(app);
  }

  if (scene === 'sheet') {
    document.body.classList.add('is-sheet');
    for (const name of Object.keys(STATES)) mount(table(name), false, stateOf(name));
    mount(table('gm · urgent'), true, stateOf('urgent'));
    mount(table('bright map · critical', { bright: true }), false, stateOf('critical'));
    mount(table('bright map · gm calm', { bright: true }), true, stateOf('calm'));
    // each plate shows its own state: none of them writes the shared setting
    game.user.isGM = false;
  } else if (scene === 'panel') {
    const t = table('panel');
    await renderPanel(t, q.get('active') === '1');
  } else if (scene === 'moments') {
    const t = table('moments');
    const hud = mount(t, gmParam, { ...DEFAULT_STATE });
    const run = () => {
      game.settings.set('', 'timer.state', { ...DEFAULT_STATE, active: true, running: true, remainingMs: 61_500, totalMs: 75_000, anchor: Date.now() - 49_000 });
    };
    run();
    setInterval(run, 16_000);
    window.__timer = { hud };
  } else if (scene === 'gm') {
    const t = table('gm');
    const state = stateOf('urgent');
    values.set('timer.state', state);
    mount(t, true, state);
  } else {
    const t = table(scene, { bright: q.get('bright') === '1' });
    const state = stateOf(scene);
    values.set('timer.state', state);
    mount(t, gmParam, state);
  }
  window.__timer = { ...(window.__timer ?? {}), huds, set: (name) => { for (const h of huds) h.onState(stateOf(name)); } };
} catch (e) { report(e); }
</script>
</body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log("wrote " + OUT);
