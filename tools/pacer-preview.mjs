/**
 * tools/pacer-preview.mjs — write a live preview page for Stream Pacer.
 *
 * The page imports the SHIPPED modules (model.js, render.js, band.js, hud.js)
 * and the shipped stylesheets over a preview server, and feeds them snapshots
 * shaped exactly like the controller's. Nothing on the page is a lookalike: the
 * lanes, the HUD and the Dire Peril splash are the files Foundry loads.
 *
 *   node tools/pacer-preview.mjs [--out=.preview/pacer.html]
 *   node tools/preview-server.mjs        # then open /.preview/pacer.html
 *
 * SERVE it: a file:// page does not execute its module script.
 *
 *   ?scene=gm        the GM mid-countdown: a red light, two hands, a hold
 *   ?scene=ready     the GM's ready check, half answered
 *   ?scene=player    a player asked by name to wrap up, during a campfire
 *   ?scene=checkin   a player's private check-in, over Dire Peril
 *   ?scene=peril     the Dire Peril splash (capture ~1.4s in)
 *   ?scene=calm      the GM after everyone saw it: lanes at rest; Rue left with a hand up
 *   &live=1          lanes arrive one by one, so the motion can be watched
 *
 * `window.__pacer` exposes { set(scene), snapshot, band, hud } for headless use.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/pacer.html");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Stream Pacer preview</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/stream-pacer.css">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0d0c; font-family: "Signika", system-ui, sans-serif; }
  /* a stand-in table: a dim map under a grid, Foundry's controls, sidebar and hotbar */
  #map { position: fixed; inset: 0; background:
    linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 70px 70px,
    linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 70px 70px,
    radial-gradient(40% 50% at 30% 60%, #2a3324, transparent 70%),
    radial-gradient(35% 40% at 70% 35%, #3a3022, transparent 70%),
    radial-gradient(60% 60% at 50% 50%, #1c211b, #0b0d0c); }
  #map::after { content: ""; position: absolute; left: 34%; top: 46%; width: 70px; height: 70px; border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #c9a86a, #5a4120); box-shadow: 0 0 0 3px #e9d9a8, 0 6px 18px #000a; }
  #controls { position: fixed; left: 10px; top: 80px; display: flex; flex-direction: column; gap: 6px; }
  #controls i { width: 36px; height: 36px; display: grid; place-items: center; background: #1b1b1fd9; border: 1px solid #ffffff1a; border-radius: 5px; color: #c9c9d0; font-size: 15px; }
  #sidebar { position: fixed; right: 0; top: 0; bottom: 0; width: 300px; background: #121214e6; border-left: 1px solid #ffffff14; }
  #sidebar .tabs { height: 36px; border-bottom: 1px solid #ffffff14; }
  #sidebar .msg { margin: 10px; height: 64px; background: #ffffff0a; border-radius: 4px; }
  #hotbar { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; }
  #hotbar i { width: 46px; height: 46px; background: #1b1b1fd9; border: 1px solid #ffffff1a; border-radius: 4px; }
  #players { position: fixed; left: 10px; bottom: 10px; width: 180px; height: 92px; background: #1b1b1fd9; border: 1px solid #ffffff14; border-radius: 5px; }
  #err { position: fixed; left: 8px; bottom: 120px; color: #ff6b6b; font: 12px monospace; white-space: pre; }
</style></head>
<body>
<div id="map"></div>
<div id="controls"><i class="fa-solid fa-user"></i><i class="fa-solid fa-ruler"></i><i class="fa-solid fa-lightbulb"></i><i class="fa-solid fa-music"></i></div>
<div id="sidebar"><div class="tabs"></div><div class="msg"></div><div class="msg"></div><div class="msg"></div></div>
<div id="players"></div>
<div id="hotbar">${'<i></i>'.repeat(10)}</div>
<pre id="err"></pre>
<script type="module">
const report = (e) => { document.getElementById('err').textContent += (e?.stack ?? e) + '\\n'; };
window.addEventListener('error', (e) => report(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => report(e.reason));
try {
  const M = await import('/scripts/features/stream-pacer/model.js');
  const R = await import('/scripts/features/stream-pacer/render.js');
  const { SignalBand, playPerilSplash } = await import('/scripts/features/stream-pacer/band.js');
  const { PacerHud } = await import('/scripts/features/stream-pacer/hud.js');
  const lang = await (await fetch('/lang/stream-pacer.en.json')).json();
  const L = (key, data) => {
    const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), lang);
    if (typeof v !== 'string') return key;
    return data ? v.replace(/\\{(\\w+)\\}/g, (_, k) => (k in data ? data[k] : '{' + k + '}')) : v;
  };

  const T0 = 1_000_000;
  let clock = T0;
  const P = (status, at = 0, extra = {}) => ({ status, at, ...extra });
  const people = [
    { id: 'gm', name: 'Patch', isGM: true, active: true, color: '#e0e0e8' },
    { id: 'seri', name: 'Seri', active: true, color: '#ff5d73' },
    { id: 'ash', name: 'Ash', active: true, color: '#3fb8a9' },
    { id: 'kai', name: 'Kai', active: true, color: '#4f8df0' },
    { id: 'mo', name: 'Morwen', active: true, color: '#f2b53a' },
    { id: 'rue', name: 'Rue', active: false, color: '#b06cff' }
  ];
  const marks = { seri: 3, ash: 1, kai: 2, mo: 0, rue: 1 };
  const users = (over = {}) => people.map((u) => ({ ...u, pacer: over[u.id] ?? null }));

  const SCENES = {
    gm: () => ({
      me: { id: 'gm', isGM: true },
      users: users({
        seri: P('hand', T0 - 40000, { seen: { call: 'cd', ack: true } }),
        ash: P('hold', T0 - 20000, { seen: { call: 'cd', ack: false } }),
        mo: P('hand', T0 - 9000)
      }),
      call: { id: 'cd', kind: 'countdown', at: T0 - 78000, ends: T0 + 42000 },
      presence: { kai: 'away', mo: 'idle' },
      safety: { show: true, lights: { kai: { light: 'red' }, ash: { light: 'yellow' } } }
    }),
    ready: () => ({
      me: { id: 'gm', isGM: true },
      users: users({
        seri: P('engaged', 0, { answer: { call: 'rc', value: 'ready' } }),
        ash: P('engaged', 0, { answer: { call: 'rc', value: 'ready' } }),
        kai: P('engaged', 0, { answer: { call: 'rc', value: 'wait' } })
      }),
      call: { id: 'rc', kind: 'ready', at: T0 - 8000 },
      presence: { mo: 'away' },
      safety: { show: true, lights: {} }
    }),
    player: () => ({
      me: { id: 'seri', isGM: false },
      users: users({ seri: P('hand', T0 - 30000) }),
      call: { id: 'wr', kind: 'wrap', at: T0 - 2000, targets: ['seri'] },
      mood: { id: 'cf', kind: 'campfire', at: T0 - 600000 },
      safety: { show: true, mine: 'green' }
    }),
    checkin: () => ({
      me: { id: 'ash', isGM: false },
      users: users({ ash: P('hold', T0 - 5000) }),
      mood: { id: 'pr', kind: 'peril', at: T0 - 30000 },
      call: { id: 'rc2', kind: 'ready', at: T0 - 3000 },
      safety: { show: true, mine: 'yellow', ask: { id: 'ask1', at: T0 - 1000 }, answered: false }
    }),
    peril: () => ({
      me: { id: 'kai', isGM: false },
      users: users(),
      mood: { id: 'pr', kind: 'peril', at: T0 },
      safety: { show: true }
    }),
    calm: () => ({
      me: { id: 'gm', isGM: true },
      users: users({
        seri: P('engaged', 0, { seen: { call: 'w2', ack: true } }),
        ash: P('engaged', 0, { seen: { call: 'w2', ack: true } }),
        kai: P('engaged', 0, { seen: { call: 'w2', ack: false } }),
        mo: P('hold', T0 - 1000, { seen: { call: 'w2', ack: true } }),
        rue: P('hand', T0 - 90000)
      }),
      call: { id: 'w2', kind: 'wrap', at: T0 - 30000 },
      mood: { id: 'cf', kind: 'campfire', at: T0 - 600000 },
      safety: { show: true, lights: {} }
    })
  };

  const params = new URLSearchParams(location.search);
  let scene = params.get('scene') ?? 'gm';
  const snapshot = () => M.normalizeSnapshot({
    now: clock,
    spotlight: { marks },
    presence: {},
    text: { perilTag: '', perilSubtitle: '' },
    call: null, mood: null,
    ...SCENES[scene]()
  });

  const band = new SignalBand({ L, onAction: (a, d) => console.log('action', a, { ...d }) });
  const hud = new PacerHud({ L, onAction: (a, d) => console.log('hud', a, { ...d }), position: { left: 70, top: 190 } });

  const draw = (limit = Infinity) => {
    const s = snapshot();
    band.update(M.lanes(s).slice(0, limit), s.now);
    hud.update(M.hudModel(s, { desktop: 'off', sound: true }));
  };

  const set = (name) => {
    scene = name;
    if (name === 'peril') {
      playPerilSplash({ html: R.perilHTML({ dire: L('STREAM_PACER.Peril.Dire'), peril: L('STREAM_PACER.Peril.Peril'), subtitle: L('STREAM_PACER.Peril.Subtitle') }) });
    }
    if (params.get('live')) {
      let n = 0;
      const step = () => { draw(++n); if (n < 6) setTimeout(step, 900); };
      step();
    } else draw();
  };
  set(scene);
  setInterval(() => { clock += 1000; band.tick(clock); }, 1000);
  window.__pacer = { set, snapshot, band, hud, M, R };
} catch (e) { report(e); }
</script>
</body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`wrote ${OUT}`);
