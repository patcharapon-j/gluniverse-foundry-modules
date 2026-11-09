/**
 * tools/pf2e-rail-preview.mjs — write a live preview page for the PF2e HUD.
 *
 * The page imports the SHIPPED modules (view.mjs, drive.mjs, shape.mjs) and
 * the shipped stylesheets over a preview server, and draws the rail on a
 * stand-in Foundry screen (map, scene controls, sidebar) from the synthetic
 * models in tools/pf2e-rail-fixtures.mjs. A small host stands in for the
 * Foundry wiring: presses peek, open drawers, step ranks, mark Hero Points,
 * raise the shield, frame the portrait, switch the deck's tabs, count the
 * turn's actions and drive the skill finder; a roll only says what PF2e
 * would have been asked for, and echoes an invented result on the press.
 *
 *   node tools/pf2e-rail-preview.mjs [--out=.preview/pf2e-rail.html] [--pf2e=<system dir>]
 *   node tools/preview-server.mjs        # then open /.preview/pf2e-rail.html
 *
 * SERVE it: a file:// page does not execute its module script.
 *
 * The art is PF2e's own (iconics, spell and condition icons), copied from a
 * local system install into .preview/pf2e-rail-art/ (gitignored). Without an
 * install the rail draws its empty fields.
 *
 *   ?state=martial | prepared | spontaneous | kineticist | companion | dying
 *          | gm | hazard | gm-empty | stress | gm-horde   (default martial)
 *   &w=1920&h=1080   the stand-in screen (default: the window)
 *   &sidebar=0       collapse the sidebar (default open, 300px)
 *   &peek=strike|spell|action        open that peek
 *   &tab=spells|actions|skills|items   the deck's tab
 *   &finder=1&q=tri&group=maneuvers   the skill finder, open
 *   &map=0|1|2   the MAP step   &turn=ignite   play the turn ignition
 *   &light=in|out&lt=0.3   play the rail light (light.mjs), frozen at lt for a still
 *   &echo=<selector>,<total>,<degree 0-3>   a roll echo on that press
 *   &drawer=inventory|effects|rest|macros|ranks
 *   &folded=1  &readonly=1  &bright=1 (a parchment map)
 *   &still=1   no animation, for screenshots
 *   &bench=1   time a full render against the live setters
 *
 * Keys on the page: / the finder (↑↓ Enter 1–3 Esc inside it), N a new turn,
 * E encounter/exploration, H lose 7 HP, J heal 7, T temp HP, P a Hero Point,
 * D dying.
 * `window.__rail` exposes { model, render, drive } for headless use.
 */
import { copyFile, mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { STATES, PEEKS, DRAWER_BODIES } from "./pf2e-rail-fixtures.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = resolve(ROOT, arg("out") ?? ".preview/pf2e-rail.html");
const ART_DIR = resolve(ROOT, ".preview/pf2e-rail-art");
const PF2E = arg("pf2e") ?? [
  join(homedir(), ".local/share/FoundryVTT/Data/systems/pf2e"),
  join(process.env.LOCALAPPDATA ?? "", "FoundryVTT/Data/systems/pf2e"),
  join(homedir(), "Library/Application Support/FoundryVTT/Data/systems/pf2e"),
].find(Boolean);

/* Every art path the fixtures can ask for: run each builder with a recorder. */
const wanted = new Set();
const record = (p) => { wanted.add(p); return p; };
const tStub = (k) => k;
const V = new Proxy({}, { get: () => () => "" });
for (const build of Object.values(STATES)) {
  const m = build(record);
  for (const d of Object.values(DRAWER_BODIES)) d(V, tStub, record, m);
}
for (const p of Object.values(PEEKS)) p(record, tStub);

const have = [];
for (const rel of wanted) {
  const src = join(PF2E, "icons", rel);
  try {
    await access(src);
    await mkdir(dirname(join(ART_DIR, rel)), { recursive: true });
    await copyFile(src, join(ART_DIR, rel));
    have.push(rel);
  } catch { /* not in this install: the rail draws the empty field */ }
}
console.log(`art: ${have.length}/${wanted.size} from ${PF2E}`);

const LANG = await readFile(resolve(ROOT, "lang/pf2e-rail.en.json"), "utf8");

/* Static imports and inlined strings: the rail is drawn while the module
   evaluates, before the load event, so a headless `--screenshot` (which
   fires on load and does not wait for a top-level await) sees it. */
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>PF2e HUD preview</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/pf2e-rail.css">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; font-family: "Signika", system-ui, sans-serif; }
  /* the stand-in Foundry screen: a map under a grid, the scene controls, the sidebar */
  .screen { position: relative; overflow: hidden; }
  .map { position: absolute; inset: 0; background:
    linear-gradient(rgb(255 255 255 / 0.04) 1px, transparent 1px) 0 0 / 100px 100px,
    linear-gradient(90deg, rgb(255 255 255 / 0.04) 1px, transparent 1px) 0 0 / 100px 100px,
    radial-gradient(30% 40% at 30% 40%, #3b4a33, transparent 70%),
    radial-gradient(35% 40% at 68% 30%, #4a3b28, transparent 70%),
    radial-gradient(40% 35% at 50% 85%, #2d3a40, transparent 70%),
    radial-gradient(70% 70% at 50% 50%, #20261e, #0d100c); }
  .screen.is-bright .map { background:
    linear-gradient(rgb(0 0 0 / 0.06) 1px, transparent 1px) 0 0 / 100px 100px,
    linear-gradient(90deg, rgb(0 0 0 / 0.06) 1px, transparent 1px) 0 0 / 100px 100px,
    radial-gradient(40% 50% at 40% 30%, #e3d3ad, transparent 70%), linear-gradient(#c9b58b, #9c865d); }
  .controls { position: absolute; left: 10px; top: 10px; display: flex; flex-direction: column; gap: 5px; }
  .controls i { width: 34px; height: 34px; background: #16161bdd; border: 1px solid #ffffff1c; border-radius: 4px; }
  .sidebar { position: absolute; right: 0; top: 0; bottom: 0; width: 300px; background: #111114f0; border-left: 1px solid #ffffff14; }
  .sidebar::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 34px; background: #1a1a1f; border-bottom: 1px solid #ffffff12; }
  .screen.no-sidebar .sidebar { width: 34px; }
  #interface { position: absolute; inset: 0; pointer-events: none; }
  .toast { position: absolute; left: 50%; top: 16px; translate: -50% 0; padding: 7px 12px; font: 600 12px/1 "Google Sans Flex", sans-serif;
    color: #f4f4f7; background: #0a0b11; box-shadow: inset 0 0 0 1px #ffffff29; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.on { opacity: 1; }
  #err { position: fixed; left: 8px; top: 8px; color: #ff6b6b; font: 12px monospace; white-space: pre; z-index: 999; }
  #bench { position: fixed; right: 320px; top: 10px; color: #f4f4f7; font: 12px/1.5 monospace; background: #000c; padding: 8px 10px; z-index: 999; white-space: pre; }
</style></head>
<body>
<pre id="err"></pre>
<div class="screen" id="screen"><div class="map"></div><div class="controls"><i></i><i></i><i></i><i></i><i></i></div><div class="sidebar"></div><div id="interface"></div><div class="toast" id="toast"></div></div>
<script type="module">
import * as V from '/scripts/features/pf2e-rail/view.mjs';
import * as D from '/scripts/features/pf2e-rail/drive.mjs';
import * as S from '/scripts/features/pf2e-rail/shape.mjs';
import { RailLight, downOf, relight } from '/scripts/features/pf2e-rail/light.mjs';
import { TIMING } from '/scripts/features/pf2e-rail/const.mjs';
import * as K from '/scripts/features/pf2e-rail/skill-actions.mjs';
import * as G from '/scripts/core/pf2e-degree.mjs';
import { STATES, PEEKS, DRAWER_BODIES } from '/tools/pf2e-rail-fixtures.mjs';
const report = (e) => { document.getElementById('err').textContent += (e?.stack ?? e) + '\\n'; };
window.addEventListener('error', (e) => report(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => report(e.reason));
const q = new URLSearchParams(location.search);
const HAVE = new Set(${JSON.stringify(have)});
const art = (p) => (HAVE.has(p) ? '/.preview/pf2e-rail-art/' + p : null);
try {
  const lang = ${LANG};
  const t = (k, d) => { let s = lang[k] ?? k; if (d) for (const [a, b] of Object.entries(d)) s = s.replaceAll('{' + a + '}', b); return s; };

  const screen = document.getElementById('screen');
  const W = +q.get('w') || innerWidth, H = +q.get('h') || innerHeight;
  Object.assign(screen.style, { width: W + 'px', height: H + 'px' });
  if (q.get('sidebar') === '0') screen.classList.add('no-sidebar');
  if (q.get('bright') === '1') screen.classList.add('is-bright');
  if (q.get('still') === '1') { const s = document.createElement('style'); s.textContent = '.gph *, .gph *::before, .gph *::after, .gph { animation: none !important; transition: none !important; }'; document.head.appendChild(s); }
  const host = document.getElementById('interface');
  const gutter = () => (q.get('sidebar') === '0' ? 34 : 300) + 12;

  const stateName = q.get('state') || 'martial';
  let model = STATES[stateName](art);
  if (q.get('folded') === '1') model.folded = true;
  if (q.get('readonly') === '1') model.readonly = true;
  if (q.get('tab') && model.deck) model.deck = { ...model.deck, tab: q.get('tab') };
  if (q.get('map') && model.turnbar) model.turnbar = { ...model.turnbar, map: +q.get('map') };
  let open = { drawer: q.get('drawer'), peek: q.get('peek') };
  /* the finder's own state: open, what is typed, the group, the selection */
  let fs = { open: q.get('finder') === '1', query: q.get('q') ?? '', group: 'all', sel: +(q.get('sel') ?? 0), settled: false, expanded: [] };
  let prev = null;

  const toast = (msg) => { const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 1600); };

  /* The finder and the Skills tab, built from the fixture's inputs by the
     shipped pure module, exactly as the Foundry host will. */
  const mapNow = () => model.turnbar?.map ?? 0;
  function finder(query = fs.query, group = fs.group) {
    if (!model.sk) return null;
    return { ...K.finderModel({ ...model.sk, query, group, sel: fs.sel, mode: model.mode, map: mapNow(), t }), expanded: fs.expanded };
  }
  function compose() {
    const o = { ...model, util: { ...(model.util ?? {}), open: open.drawer } };
    if (o.deck && model.sk) {
      const all = finder('', 'all');
      o.deck = { ...o.deck, skills: { ...o.deck.skills, target: all.target, suggested: K.suggested(all, { mode: model.mode }) } };
      o.deck.tabs = o.deck.tabs.map((x) => (x.key === 'skills' ? { ...x, count: all.actions.length } : x));
    }
    if (fs.open && model.sk) o.overlay = V.FINDER(finder(), t);
    else if (open.drawer && DRAWER_BODIES[open.drawer]) o.overlay = V.DRAWER(DRAWER_BODIES[open.drawer](V, t, art, model));
    return o;
  }
  const light = new RailLight();
  function render({ arrive = false } = {}) {
    host.innerHTML = V.RAIL(compose(), t);
    const root = host.firstElementChild;
    light.attach(root);
    root.style.setProperty('--gph-gutter-r', gutter() + 'px');
    if (arrive) { root.classList.add('is-arriving'); setTimeout(() => root.classList.remove('is-arriving'), 900); }
    if (open.drawer && !fs.open) D.placeDrawer(root);
    if (open.peek) showPeek(open.peek);
    if (fs.open) settleFinder(root);
    prev = model;
    return root;
  }
  /* The host's one decision: values are driven, anything else redraws. */
  function update(next) {
    const root = host.firstElementChild, was = downOf(model);
    if (prev && S.shapeOf(prev) === S.shapeOf(next)) {
      D.drive(root, S.liveOf(next), { raised: t('GLRAIL.shield.raised'), raise: t('GLRAIL.shield.raise') });
      if (S.tookHit(prev.vitals ?? prev.creature, next.vitals ?? next.creature)) D.flinch(root);
      model = next; prev = next;
    } else { model = next; render(); }
    const pass = relight(was, downOf(next));
    if (pass) light.play(host.firstElementChild, pass);
  }

  /* ── the finder ── typing redraws the panel only, and keeps the caret */
  function settleFinder(root) {
    const f = root.querySelector('[data-finder]');
    if (!f) return;
    if (fs.settled) f.setAttribute('data-settled', '');
    else setTimeout(() => { fs.settled = true; f.setAttribute('data-settled', ''); }, 900);
    const input = f.querySelector('[data-find]');
    if (input && q.get('still') !== '1') { input.focus(); const n = input.value.length; input.setSelectionRange(n, n); }
    f.querySelector('.gph-fa.is-sel')?.scrollIntoView({ block: 'nearest' });
  }
  function redrawFinder({ slide = false, pinned = null, opened = null } = {}) {
    const root = host.firstElementChild, old = root.querySelector('[data-finder]');
    if (!old) return render();
    const from = slide ? old.querySelector('.gph-fa.is-sel')?.getBoundingClientRect() : null;
    const scroll = old.querySelector('.gph-results')?.scrollTop ?? 0;
    old.insertAdjacentHTML('afterend', V.FINDER(finder(), t));
    old.remove();
    const f = root.querySelector('[data-finder]');
    f.querySelector('.gph-results').scrollTop = scroll;
    settleFinder(root);
    if (from) D.slideSel(f, from);
    if (pinned) f.querySelector('[data-skill-action="' + pinned + '"]')?.classList.add('is-pinning');
    if (opened) f.querySelectorAll('.gph-scol').forEach((c) => { if (c.querySelector('[data-check="skill:' + opened + '"], [data-check="' + opened + '"]') || (opened === 'untrained' && c.classList.contains('is-untrained'))) c.classList.add('is-opening'); });
  }
  function openFinder(query = '') { fs = { ...fs, open: true, query, group: 'all', sel: 0, settled: false, expanded: [] }; open.drawer = null; open.peek = null; render(); }
  function closeFinder() {
    const f = host.querySelector('[data-finder]');
    fs.open = false;
    if (!f) return;
    f.classList.add('is-closing');
    setTimeout(() => render(), 130);
  }
  const shownCards = () => [...host.querySelectorAll('[data-finder] .gph-fa')];
  function togglePin(id) { const m = clone(model), p = new Set(m.sk.pins); p.has(id) ? p.delete(id) : p.add(id); m.sk.pins = [...p]; model = m; fs.settled = true; redrawFinder({ pinned: p.has(id) ? id : null }); toast('ph.pins ← ' + JSON.stringify(m.sk.pins)); }

  /* ── a roll ── the toast names the PF2e call; the echo shows a made-up
     result on the press, as the chat message would hand it back. */
  const WORDS = ['Crit fail', 'Failure', 'Success', 'Critical'];
  function roll(button, mod, dc, call) {
    toast(call);
    const nat = 1 + Math.floor(Math.random() * 20), total = nat + mod;
    const degree = dc == null ? null : G.degreeOf(total, dc, nat);
    setTimeout(() => D.echo(button, { total, degree, word: degree == null ? '' : WORDS[degree] }), 260);
  }
  const parseMod = (s) => parseInt(String(s).replace('−', '-'), 10) || 0;
  /* a costed press drains its diamonds; an attack advances the MAP step */
  function spend(cost, attack) {
    if (model.mode !== 'encounter' || !model.turnbar?.mine) return;
    const m = clone(model), e = m.turnbar.economy;
    if (cost === 'r') e.reaction = false;
    else if (/^[123]$/.test(String(cost))) e.spent = Math.min(e.max, e.spent + +cost);
    if (attack) m.turnbar.map = Math.min(2, (m.turnbar.map ?? 0) + 1);
    update(m);
  }
  function newTurn() {
    if (!model.turnbar || model.mode !== 'encounter') return;
    const m = clone(model);
    m.turnbar = { ...m.turnbar, mine: true, map: 0, economy: { ...m.turnbar.economy, spent: 0, reaction: true } };
    model = m; render();
    D.ignite(host.firstElementChild);
    light.play(host.firstElementChild, 'in');
  }
  function rollSkillAction(id, variant) {
    const a = finder('', 'all').actions.find((x) => x.id === id);
    if (!a) return;
    if (a.locked) { toast(t('GLRAIL.prof.1') + ' only'); return; }
    const b = host.querySelector('[data-finder] [data-skill-action="' + id + '"]') ?? host.querySelector('[data-skill-action="' + id + '"]');
    const mod = a.skill.mod - (a.attack ? (variant ?? mapNow()) * 5 : 0);
    const dc = typeof a.vs?.dc === 'number' ? a.vs.dc : null;
    roll(b, mod, a.secret ? null : dc, 'game.pf2e.actions.get("' + a.slug + '").use({ statistic: "' + a.skill.slug + '"' + (a.attack ? ', multipleAttackPenalty: ' + (variant ?? mapNow()) : '') + ' })');
    spend(a.cost, a.attack);
  }

  /* peeks: a fixture peek by name */
  function showPeek(kind, anchorEl) {
    const root = host.firstElementChild;
    root.querySelector('.gph-peek')?.remove();
    root.querySelectorAll('.is-peek').forEach((x) => x.classList.remove('is-peek'));
    const p = PEEKS[kind]?.(art, t);
    if (!p) return;
    const anchor = anchorEl ?? root.querySelector(p.anchor);
    if (!anchor) return;
    root.insertAdjacentHTML('beforeend', V.PEEK(p.model, t));
    const peek = root.querySelector('.gph-peek');
    (anchor.closest('.gph-held') ?? anchor.closest('.gph-row') ?? anchor).classList.add('is-peek');
    D.placePeek(root, anchor, peek);
    open.peek = kind;
  }
  function closePeek() {
    const root = host.firstElementChild, peek = root?.querySelector('.gph-peek');
    if (!peek) return;
    root.querySelectorAll('.is-peek').forEach((x) => x.classList.remove('is-peek'));
    peek.classList.add('is-closing'); setTimeout(() => peek.remove(), 160);
    open.peek = null;
  }
  const deny = (el) => { el.classList.remove('is-denied'); void el.offsetWidth; el.classList.add('is-denied'); };

  const clone = (o) => structuredClone(o);
  host.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || model.readonly && !b.matches('[data-drawer],[data-act="fold"]')) return;
    const d = b.dataset;
    if (d.act === 'fold') { model = { ...model, folded: !model.folded }; render(); return; }
    if (d.act === 'close') { if (fs.open) closeFinder(); else { open.drawer = null; render(); } return; }
    if (d.act === 'frame') { const p = host.querySelector('[data-plinth]'); D.framePlinth(p, model.plinth.frame, { onCommit: (f) => { model.plinth.frame = f; toast('ph.frame ← ' + JSON.stringify(f)); } }); return; }
    if (d.hero) { const n = +d.hero, m = clone(model); m.plinth.hero[0] = m.plinth.hero[0] === n ? n - 1 : n; update(m); return; }
    if (d.pip != null) { const m = clone(model), e2 = m.turnbar.economy; if (d.pip === 'r') e2.reaction = !e2.reaction; else { const i = +d.pip, left = e2.max - e2.spent; e2.spent = e2.max - (i < left ? i : i + 1); } update(m); return; }
    if (d.explore) { const m = clone(model); m.turnbar.activities.forEach((x) => { x.on = x.id === d.explore ? !x.on : false; }); model = m; render(); toast('actor.update({ "system.exploration": [...] })'); return; }
    if (d.act === 'raise') { if (b.getAttribute('aria-disabled') === 'true') return deny(b); const m = clone(model); m.vitals.shield.raised = !m.vitals.shield.raised; update(m); toast('game.pf2e.actions.raiseAShield'); spend(1); return; }
    if (d.tab) { if (d.tab === model.deck.tab) return; const from = model.deck.tabs.findIndex((x) => x.key === model.deck.tab); model = { ...model, deck: { ...model.deck, tab: d.tab } }; render(); D.travelTab(host.firstElementChild, from); return; }
    if (d.act === 'expand') { const tab = model.deck.tab; if (tab === 'skills') openFinder(''); else { open.drawer = tab === 'items' ? 'inventory' : 'effects'; render(); } return; }
    if (d.act === 'finder') { openFinder(''); return; }
    if (d.drawer) { if (d.drawer === 'sheet') { toast('actor.sheet.render(true)'); return; } fs.open = false; open.drawer = open.drawer === d.drawer ? null : d.drawer; open.peek = null; render(); return; }
    if (d.act === 'ranks') { open.drawer = open.drawer === 'ranks' ? null : 'ranks'; render(); return; }
    const sp = model.deck?.spells;
    if (d.rankStep) { const i = sp.ranks.findIndex((r) => r.key === sp.rank), j = Math.max(0, Math.min(sp.ranks.length - 1, i + +d.rankStep)); if (i === j) return; model = { ...model, deck: { ...model.deck, spells: { ...sp, rank: sp.ranks[j].key } } }; render(); return; }
    if (d.row?.startsWith('rank:')) { const k = d.row.slice(5); model = { ...model, deck: { ...model.deck, spells: { ...sp, rank: /^\\d+$/.test(k) ? +k : k } } }; open.drawer = null; render(); return; }
    if (d.foe) { model = { ...model, foes: { ...model.foes, selected: d.foe } }; render(); toast('token.control()'); return; }
    if (d.act === 'expand-col') { fs = { ...fs, expanded: [...fs.expanded, d.col], settled: true }; redrawFinder({ opened: d.col }); return; }
    if (d.skillAction) { rollSkillAction(d.skillAction, d.variant != null ? +d.variant : undefined); return; }
    if (d.variant != null && d.strike) {
      const row = b.closest('.gph-stk, .gph-nstk');
      if (b.getAttribute('aria-disabled') === 'true') return deny(row);
      roll(b, parseMod(b.textContent), model.sk?.target ? 17 : null, 'strike.variants[' + d.variant + '].roll({ event })');
      spend(1, true); return;
    }
    if (d.dmg) { toast('strike.damage({ event })'); return; }
    if (d.crit) { toast('strike.critical({ event })'); return; }
    if (d.act === 'peek-strike') { open.peek === 'strike' ? closePeek() : showPeek('strike', b); return; }
    if (d.check) { const mod = parseMod(b.querySelector('b, em:last-child')?.textContent); roll(b, mod, null, d.check.startsWith('skill:') ? 'actor.skills.' + d.check.slice(6) + '.roll({ event })' : 'actor.' + (d.check === 'perception' ? 'perception' : 'saves.' + d.check) + '.roll({ event })'); return; }
    if (d.toggle) { const m = clone(model); const g = m.deck.actions.toggles.find((x) => x.id === d.toggle); g.on = !g.on; model = m; render(); toast('actor.toggleRollOption(…)'); return; }
    if (d.item) { const m = clone(model), it = m.deck.items.list.find((x) => x.id === d.item); if (!it.qty) return deny(b); it.qty -= 1; toast('consumable.consume()'); spend(it.cost); model = m; render(); return; }
    if (d.action || d.stance) { open.peek === 'action' ? closePeek() : showPeek('action', b); return; }
    if (d.spell) { const c = b; D.castCard(c).then(() => { const m = clone(model); const card = m.deck.spells.cards.find((x) => x.id === d.spell); if (/^[1-9]$/.test(String(card.rank))) card.spent = true; model = m; render(); }); toast('entry.cast(spell, { rank })'); spend(+(b.dataset.cost ?? 0)); return; }
    if (d.pa) { toast(d.pa === 'cast' ? 'entry.cast(spell, { rank })' : d.pa === 'post' ? 'item.toMessage()' : d.pa); closePeek(); return; }
  });
  /* typing in the Skills tab opens the finder with what was typed; typing
     in the finder narrows it */
  host.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-find]'); if (!inp) return;
    if (!fs.open) { openFinder(inp.value); return; }
    fs = { ...fs, query: inp.value, sel: 0, settled: true }; redrawFinder();
  });
  /* right-click a finder action to pin it */
  host.addEventListener('contextmenu', (e) => { const c = e.target.closest('[data-finder] .gph-fa'); if (!c) return; e.preventDefault(); togglePin(c.dataset.skillAction); });
  /* the hover peek: rest 140ms to open, leave for 250ms to close */
  let peekT = 0;
  host.addEventListener('pointerover', (e) => {
    const c = e.target.closest('[data-spell]'); if (!c || fs.open) return;
    clearTimeout(peekT); peekT = setTimeout(() => showPeek('spell', c), TIMING.peekOpen);
  });
  host.addEventListener('pointerout', (e) => {
    if (!e.target.closest('[data-spell], .gph-peek')) return;
    clearTimeout(peekT); peekT = setTimeout(() => { if (!host.querySelector('.gph-peek:hover, [data-spell]:hover')) closePeek(); }, TIMING.peekClose);
  });
  document.addEventListener('keydown', (e) => {
    const inField = e.target.closest?.('[data-find]');
    if (fs.open) {
      const cards = shownCards();
      if (e.key === 'Escape') { e.preventDefault(); closeFinder(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); fs.sel = Math.max(0, Math.min(cards.length - 1, fs.sel + (e.key === 'ArrowDown' ? 1 : -1))); fs.settled = true; redrawFinder({ slide: true }); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { if (inField && e.target.value) return; e.preventDefault(); const cols = [...host.querySelectorAll('[data-finder] .gph-scol')]; const at = cols.findIndex((c) => c.contains(cards[fs.sel])); const to = cols[Math.max(0, Math.min(cols.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)))]; const first = to?.querySelector('.gph-fa'); if (first) { fs.sel = +first.dataset.k; fs.settled = true; redrawFinder({ slide: true }); } return; }
      if (e.key === 'Enter') { e.preventDefault(); const c = cards[fs.sel]; if (c) rollSkillAction(c.dataset.skillAction); return; }
      if (/^[123]$/.test(e.key) && (!inField || !e.target.value)) { const c = cards[fs.sel]; if (c?.hasAttribute('data-attack')) { e.preventDefault(); rollSkillAction(c.dataset.skillAction, +e.key - 1); } return; }
      if ((e.key === 'p' || e.key === 'P') && (!inField || !e.target.value)) { const c = cards[fs.sel]; if (c) { e.preventDefault(); togglePin(c.dataset.skillAction); } return; }
      return;
    }
    if (inField) return;
    if (e.key === '/') { e.preventDefault(); openFinder(''); return; }
    if (e.key === 'Escape') { closePeek(); if (open.drawer) { open.drawer = null; render(); } return; }
    if (e.key === 'n') { newTurn(); return; }
    if (e.key === 'e' && model.turnbar) { const m = clone(model), enc = m.mode !== 'encounter'; m.mode = enc ? 'encounter' : 'exploration'; m.turnbar = enc ? { mode: 'encounter', mine: false, current: 'Kyra', economy: { max: 3, spent: 0, reaction: true }, map: 0 } : { mode: 'exploration', activities: [{ id: 'search', name: 'Search', on: true }, { id: 'avoid-notice', name: 'Avoid Notice' }, { id: 'scout', name: 'Scout' }] }; model = m; render(); return; }
    const m = clone(model), hp = m.vitals?.hp ?? m.creature?.hp; if (!hp) return;
    if (e.key === 'h') { const dmg = 7, soak = Math.min(hp.temp ?? 0, dmg); hp.temp = (hp.temp ?? 0) - soak; hp.value = Math.max(0, hp.value - (dmg - soak)); if (m.plinth.hp) m.plinth.hp[0] = hp.value; update(m); }
    if (e.key === 'j') { hp.value = Math.min(hp.max, hp.value + 7); if (m.plinth.hp) m.plinth.hp[0] = hp.value; update(m); }
    if (e.key === 't') { hp.temp = (hp.temp ?? 0) ? 0 : 8; update(m); }
    if (e.key === 'p' && m.plinth.hero) { m.plinth.hero[0] = (m.plinth.hero[0] + 1) % (m.plinth.hero[1] + 1); update(m); }
    if (e.key === 'd') { m.plinth.dying = m.plinth.dying ? null : { value: 1, max: 4 }; update(m); }
  });

  render({ arrive: q.get('still') !== '1' });
  if (q.get('turn') === 'ignite') newTurn();
  if (q.get('light')) { light.ensure(); light.play(host.firstElementChild, q.get('light')); if (q.get('lt')) light.seek(+q.get('lt')); }
  if (q.get('echo')) { const [sel, total, degree] = q.get('echo').split(','); const el = host.querySelector(sel); if (el) D.echo(el, { total, degree: +degree, word: WORDS[+degree] }); }
  window.__rail = { get model() { return model; }, render, update, V, D, S, K, t, openFinder, newTurn, light };

  if (q.get('bench') === '1') {
    const N = 60, o = compose();
    let t0 = performance.now();
    for (let i = 0; i < N; i++) { host.innerHTML = V.RAIL(o, t); void host.offsetHeight; }
    const full = (performance.now() - t0) / N;
    const root = render();
    t0 = performance.now();
    for (let i = 0; i < N; i++) { D.setMeter(root.querySelector('[data-meter="hp"]'), { value: 20 + (i % 40), max: o.vitals?.hp?.max ?? 50, temp: i % 7 }); void root.offsetHeight; }
    const meter = (performance.now() - t0) / N;
    t0 = performance.now();
    for (let i = 0; i < N; i++) { D.setHero(root, i % 4); void root.offsetHeight; }
    const hero = (performance.now() - t0) / N;
    document.body.insertAdjacentHTML('beforeend', '<div id="bench">full render  ' + full.toFixed(2) + ' ms\\nsetMeter     ' + meter.toFixed(3) + ' ms\\nsetHero      ' + hero.toFixed(3) + ' ms\\n(each with a forced layout)</div>');
  }
} catch (e) { report(e); }
</script>
</body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log("wrote " + OUT);
