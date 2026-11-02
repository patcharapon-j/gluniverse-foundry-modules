// Stream Pacer — markup. Pure: takes a model and a localize function, returns
// HTML strings. Every value that came from a person (a name, a GM's peril text)
// is escaped here and nowhere else, because the band, the HUD and the preview
// all print what this returns.

import { escapeHTML as esc, hex6 } from '../../core/util.mjs';
import { TIMING, LIGHT, STATUS, CALL, MOOD, COUNTDOWN_PRESETS } from './const.js';
import { clockText } from './model.js';

/** Resolve a text ref from the model: { k, d } through `L`, { raw } as-is. */
export function text(ref, L) {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  if ('raw' in ref) return String(ref.raw ?? '');
  return L(ref.k, ref.d);
}

const color = (c) => hex6(typeof c === 'string' ? c.slice(0, 7) : '', '#8e91a0');
const attr = (name, v) => (v === undefined || v === null || v === false ? '' : ` ${name}="${esc(v)}"`);

/** The running text: phrases repeated until one copy fills the plate, then doubled for a seamless loop. */
export function tickerHTML(phrases) {
  const list = phrases.map((p) => p.trim()).filter(Boolean);
  if (!list.length) return '';
  const copy = [];
  let chars = 0;
  for (let i = 0; chars < TIMING.tickerFill || copy.length < list.length; i++) {
    const p = list[i % list.length];
    copy.push(p);
    chars += p.length + 4;
    if (i > 64) break;
  }
  const one = copy.map((p) => `<span class="sp-tick">${esc(p)}</span><i class="sp-tick-sep" aria-hidden="true"></i>`).join('');
  const dur = Math.max(TIMING.tickerMin, chars * TIMING.tickerPerChar);
  return `<div class="sp-ticker" style="--sp-ticker-dur:${dur}ms" aria-hidden="true">`
    + `<div class="sp-ticker-track"><div class="sp-ticker-copy">${one}</div><div class="sp-ticker-copy">${one}</div></div></div>`;
}

function faceHTML(p, L, size = '') {
  const state = L(`STREAM_PACER.State.${p.state}`);
  return `<li class="sp-face sp-state-${esc(p.state)}${size}" style="--sp-face:${color(p.color)}" title="${esc(p.name)} · ${esc(state)}">`
    + `<span class="sp-face-mark">${esc(p.initial)}</span></li>`;
}

function buttonHTML(a, L) {
  const label = L(a.k, a.d);
  const cls = ['sp-btn', `sp-btn-${a.style ?? 'ghost'}`];
  if (a.pressed) cls.push('is-pressed');
  if (a.light) cls.push(`sp-lamp-${a.light}`);
  return `<button type="button" class="${cls.join(' ')}" data-sp-action="${esc(a.id)}"`
    + attr('data-user', a.user) + attr('data-light', a.light) + attr('data-value', a.value) + attr('data-status', a.status)
    + attr('aria-pressed', a.pressed === undefined ? undefined : String(!!a.pressed))
    + ` title="${esc(label)}">`
    + (a.style === 'lamp' ? '<span class="sp-lamp-dot" aria-hidden="true"></span>' : `<i class="${esc(a.icon)}" aria-hidden="true"></i>`)
    + `<span class="sp-btn-label">${esc(label)}</span></button>`;
}

/** The inside of one lane. Its root element is the band renderer's. */
export function laneInnerHTML(lane, L, now = 0) {
  const label = text(lane.label, L);
  const title = text(lane.title, L);
  const phrases = [title, ...lane.ticker.map((t) => text(t, L))];
  const clock = lane.clock
    ? `<div class="sp-lane-clock" data-sp-clock data-ends="${esc(lane.clock.ends)}">${esc(clockText(Math.ceil((lane.clock.ends - now) / 1000)))}</div>`
    : '';
  const count = lane.count ? `<div class="sp-lane-count">${esc(text(lane.count, L))}</div>` : '';
  const people = lane.people.length
    ? `<ul class="sp-people">${lane.people.slice(0, 8).map((p) => faceHTML(p, L)).join('')}${lane.people.length > 8 ? `<li class="sp-face sp-face-more">+${lane.people.length - 8}</li>` : ''}</ul>`
    : '';
  const actions = lane.actions.length ? `<div class="sp-lane-actions">${lane.actions.map((a) => buttonHTML(a, L)).join('')}</div>` : '';
  const progress = lane.clock && lane.clock.ends > lane.clock.at
    ? `<div class="sp-lane-progress" aria-hidden="true"><i data-sp-progress style="--sp-total:${lane.clock.ends - lane.clock.at}ms"></i></div>`
    : '';
  return `<div class="sp-lane-plate">`
    + `<div class="sp-lane-tag"><i class="${esc(lane.icon)}" aria-hidden="true"></i><span class="sp-lane-label">${esc(label)}</span></div>`
    + `<div class="sp-lane-body"><span class="sp-sr">${esc(title)}</span>${tickerHTML(phrases)}</div>`
    + `<div class="sp-lane-side">${clock}${count}${people}</div>`
    + actions
    + `<i class="sp-lane-sweep" aria-hidden="true"></i>`
    + `</div>${progress}`;
}

/** Class list for a lane's root: tone and state live here so a retone is one class swap. */
export function laneClass(lane) {
  return ['sp-lane', `sp-tone-${lane.tone}`, `sp-kind-${lane.kind}`,
    lane.call ? `sp-call-${lane.call}` : '', lane.urgent ? 'is-urgent' : '', lane.calm ? 'is-calm' : '']
    .filter(Boolean).join(' ');
}

/** What a lane would draw, minus the clock, for change detection. */
export function laneSignature(lane, L) {
  return JSON.stringify([laneClass(lane), laneInnerHTML({ ...lane, clock: lane.clock ? { ...lane.clock } : null }, L, lane.clock?.at ?? 0)]);
}

/* ── HUD ────────────────────────────────────────────────────────────────── */

const icon = (cls) => `<i class="${cls}" aria-hidden="true"></i>`;

function hudButton({ action, label, iconCls, pressed = false, extra = '', cls = '' }, L) {
  const t = L(label);
  return `<button type="button" class="sp-hud-btn ${cls}${pressed ? ' is-pressed' : ''}" data-sp-action="${action}"${extra}`
    + `${pressed ? ' aria-pressed="true"' : ''} title="${esc(t)}">${icon(iconCls)}<span>${esc(t)}</span></button>`;
}

/** An icon-only toggle: the label lives in the tooltip and the accessible name. */
function iconToggle({ action, label, iconCls, pressed }, L) {
  const t = L(label);
  return `<button type="button" class="sp-hud-icon${pressed ? ' is-on' : ''}" data-sp-action="${action}" aria-pressed="${!!pressed}" title="${esc(t)}" aria-label="${esc(t)}">${icon(iconCls)}</button>`;
}

function headerHTML(vm, L, chip) {
  const sound = iconToggle({ action: 'sound', label: vm.sound ? 'STREAM_PACER.Hud.SoundOn' : 'STREAM_PACER.Hud.SoundOff', iconCls: vm.sound ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark', pressed: vm.sound }, L);
  const desktop = vm.gm || vm.desktop === 'unsupported' ? ''
    : iconToggle({
      action: 'desktop',
      label: vm.desktop === 'on' ? 'STREAM_PACER.Hud.DesktopOn' : vm.desktop === 'blocked' ? 'STREAM_PACER.Hud.DesktopBlocked' : 'STREAM_PACER.Hud.DesktopOff',
      iconCls: vm.desktop === 'on' ? 'fa-solid fa-bell' : 'fa-regular fa-bell-slash',
      pressed: vm.desktop === 'on'
    }, L);
  return `<header class="sp-hud-head" data-sp-drag>`
    + `<span class="sp-hud-mark" aria-hidden="true"></span>`
    + `<span class="sp-hud-title">${esc(L('STREAM_PACER.Hud.Title'))}</span>`
    + (chip ?? '')
    + sound + desktop
    + `<button type="button" class="sp-hud-icon" data-sp-action="collapse" title="${esc(L(vm.collapsed ? 'STREAM_PACER.Hud.Expand' : 'STREAM_PACER.Hud.Collapse'))}">`
    + icon(vm.collapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up') + `</button></header>`;
}

function rowHTML(r, L, vm) {
  const status = r.status === STATUS.HAND
    ? `<span class="sp-chip sp-chip-hand" title="${esc(L('STREAM_PACER.Status.hand'))}">${icon('fa-solid fa-hand')}${r.handPos || ''}</span>`
    : r.status === STATUS.HOLD
      ? `<span class="sp-chip sp-chip-hold" title="${esc(L('STREAM_PACER.Status.hold'))}">${icon('fa-solid fa-hourglass-half')}</span>`
      : '';
  const reach = r.reach
    ? `<span class="sp-reach sp-reach-${r.reach}" title="${esc(L(`STREAM_PACER.State.${r.reach}`))}">${icon(REACH_ICON[r.reach])}</span>`
    : `<span class="sp-presence sp-presence-${r.presence}" title="${esc(L(`STREAM_PACER.State.${r.presence}`))}"></span>`;
  const light = vm.showSafety && r.light
    ? `<span class="sp-light sp-light-${r.light}" title="${esc(L(`STREAM_PACER.Light.${r.light}`))}"></span>`
    : '';
  const marks = r.pips
    ? r.pips.map((on) => `<i class="sp-pip${on ? ' is-on' : ''}"></i>`).join('')
    : `<span class="sp-marks-n">${r.marks}</span>`;
  const handBtn = r.status === STATUS.HAND
    ? `<button type="button" class="sp-hud-icon sp-row-callon" data-sp-action="call-on" data-user="${esc(r.id)}" title="${esc(L('STREAM_PACER.Action.CallOn', { name: r.name }))}">${icon('fa-solid fa-microphone')}</button>`
    : '';
  return `<li class="sp-row${r.active ? '' : ' is-offline'}${r.quiet ? ' is-quiet' : ''}" data-user="${esc(r.id)}">`
    + `<span class="sp-face sp-face-row" style="--sp-face:${color(r.color)}"><span class="sp-face-mark">${esc(r.initial)}</span></span>`
    + `<span class="sp-row-name">${esc(r.name)}${r.quiet ? `<em class="sp-quiet-tag">${esc(L('STREAM_PACER.Hud.Quiet'))}</em>` : ''}</span>`
    + status + light + reach
    + `<button type="button" class="sp-marks" data-sp-action="mark" data-user="${esc(r.id)}" title="${esc(L('STREAM_PACER.Hud.MarkHint', { n: r.marks }))}">${marks}</button>`
    + `<span class="sp-row-tools">${handBtn}`
    + `<button type="button" class="sp-hud-icon" data-sp-action="nudge" data-user="${esc(r.id)}" title="${esc(L('STREAM_PACER.Action.Nudge', { name: r.name }))}"${r.active ? '' : ' disabled'}>${icon('fa-solid fa-hand-back-fist')}</button>`
    + `<button type="button" class="sp-hud-icon" data-sp-action="wrap-one" data-user="${esc(r.id)}" title="${esc(L('STREAM_PACER.Action.WrapOne', { name: r.name }))}"${r.active ? '' : ' disabled'}>${icon('fa-solid fa-flag-checkered')}</button>`
    + `</span></li>`;
}

const REACH_ICON = {
  offline: 'fa-solid fa-plug-circle-xmark', away: 'fa-solid fa-eye-slash', idle: 'fa-solid fa-moon',
  here: 'fa-regular fa-eye', seen: 'fa-solid fa-eye', ack: 'fa-solid fa-circle-check'
};

function gmBody(vm, L) {
  const call = vm.call?.kind;
  const mood = vm.mood?.kind;
  const presets = COUNTDOWN_PRESETS.map((sec) =>
    `<button type="button" class="sp-seg" data-sp-action="countdown" data-seconds="${sec}" title="${esc(L('STREAM_PACER.Hud.CountdownFor', { m: sec / 60 }))}">${sec / 60}m</button>`).join('');
  // calls and room carry their tone on each button's edge; no section labels
  const end = call
    ? `<button type="button" class="sp-hud-icon sp-hud-end" data-sp-action="end-call" title="${esc(L('STREAM_PACER.Action.EndCall'))}" aria-label="${esc(L('STREAM_PACER.Action.EndCall'))}">${icon('fa-solid fa-xmark')}</button>`
    : '';
  const calls = `<div class="sp-hud-sec sp-hud-calls" role="group" aria-label="${esc(L('STREAM_PACER.Hud.Calls'))}"><div class="sp-hud-grid${call ? ' has-end' : ''}">`
    + hudButton({ action: 'wrap', label: 'STREAM_PACER.Hud.Wrap', iconCls: 'fa-solid fa-flag-checkered', pressed: call === CALL.WRAP, cls: 'sp-tone-amber' }, L)
    + hudButton({ action: 'ready', label: 'STREAM_PACER.Hud.Ready', iconCls: 'fa-solid fa-circle-question', pressed: call === CALL.READY, cls: 'sp-tone-paper' }, L)
    + end
    + `<div class="sp-hud-btn sp-hud-split sp-tone-amber${call === CALL.COUNTDOWN ? ' is-pressed' : ''}">${icon('fa-solid fa-stopwatch')}<span>${esc(L('STREAM_PACER.Hud.Countdown'))}</span><span class="sp-segs">${presets}</span></div>`
    + `</div></div>`;
  const room = `<div class="sp-hud-sec sp-hud-room" role="group" aria-label="${esc(L('STREAM_PACER.Hud.Room'))}"><div class="sp-hud-grid sp-hud-grid-2">`
    + hudButton({ action: 'campfire', label: 'STREAM_PACER.Hud.Campfire', iconCls: 'fa-solid fa-fire', pressed: mood === MOOD.CAMPFIRE, cls: 'sp-tone-ember' }, L)
    + hudButton({ action: 'peril', label: 'STREAM_PACER.Hud.Peril', iconCls: 'fa-solid fa-skull', pressed: mood === MOOD.PERIL, cls: 'sp-tone-red' }, L)
    + `</div></div>`;
  const table = vm.rows.length
    ? `<ul class="sp-rows">${vm.rows.map((r) => rowHTML(r, L, vm)).join('')}</ul>`
    : `<p class="sp-empty">${esc(L('STREAM_PACER.Hud.NoPlayers'))}</p>`;
  const tableSec = `<div class="sp-hud-sec sp-hud-table"><div class="sp-hud-label">${esc(L('STREAM_PACER.Hud.Table'))}`
    + `<span class="sp-hud-hint">${esc(L('STREAM_PACER.Hud.MarksLegend'))}</span></div>${table}</div>`;
  const foot = `<footer class="sp-hud-foot">`
    + (vm.showSafety ? hudButton({ action: vm.ask ? 'end-ask' : 'ask', label: vm.ask ? 'STREAM_PACER.Action.EndCheckIn' : 'STREAM_PACER.Hud.CheckIn', iconCls: 'fa-solid fa-hand-holding-heart', pressed: vm.ask, cls: 'sp-hud-small' }, L) : '')
    + hudButton({ action: 'lower-all', label: 'STREAM_PACER.Hud.ClearHands', iconCls: 'fa-solid fa-hand-point-down', cls: 'sp-hud-small' }, L)
    + hudButton({ action: 'reset-marks', label: 'STREAM_PACER.Hud.ResetMarks', iconCls: 'fa-solid fa-rotate-left', cls: 'sp-hud-small' }, L)
    + `</footer>`;
  return calls + room + tableSec + foot;
}

/**
 * A player's panel is two rows: their status, and their traffic light. The
 * sound and desktop toggles live in the header, and the lamps are dots with the
 * current answer beside them, so the panel sits small over the map all session.
 */
function playerBody(vm, L) {
  const status = `<div class="sp-hud-sec"><div class="sp-hud-grid sp-hud-grid-2">`
    + hudButton({ action: 'status', label: vm.status === STATUS.HAND ? 'STREAM_PACER.Action.Lower' : 'STREAM_PACER.Hud.RaiseHand', iconCls: 'fa-solid fa-hand', pressed: vm.status === STATUS.HAND, extra: ` data-status="${vm.status === STATUS.HAND ? STATUS.ENGAGED : STATUS.HAND}"`, cls: 'sp-tone-paper' }, L)
    + hudButton({ action: 'status', label: vm.status === STATUS.HOLD ? 'STREAM_PACER.Action.ImGood' : 'STREAM_PACER.Hud.NeedTime', iconCls: 'fa-solid fa-hourglass-half', pressed: vm.status === STATUS.HOLD, extra: ` data-status="${vm.status === STATUS.HOLD ? STATUS.ENGAGED : STATUS.HOLD}"`, cls: 'sp-tone-steel' }, L)
    + `</div></div>`;
  const privacy = `${L('STREAM_PACER.Hud.Safety')}: ${L('STREAM_PACER.Hud.SafetyPrivate')}`;
  const lamps = vm.showSafety
    ? `<div class="sp-hud-sec sp-hud-safety"><div class="sp-lamps" role="group" aria-label="${esc(privacy)}">${[LIGHT.GREEN, LIGHT.YELLOW, LIGHT.RED].map((l) => {
      const t = L(`STREAM_PACER.Light.${l}`);
      return `<button type="button" class="sp-lamp sp-lamp-${l}${vm.light === l ? ' is-pressed' : ''}" data-sp-action="light" data-light="${l}" aria-pressed="${vm.light === l}" title="${esc(t)}" aria-label="${esc(t)}">`
        + `<span class="sp-lamp-dot" aria-hidden="true"></span></button>`;
    }).join('')}</div>`
      + `<span class="sp-lamp-now">${esc(L(`STREAM_PACER.Light.${vm.light}`))}</span>`
      + `<i class="fa-solid fa-lock sp-lamp-lock" title="${esc(privacy)}" aria-hidden="true"></i></div>`
    : '';
  return status + lamps;
}

/** The whole HUD. */
export function hudHTML(vm, L) {
  let chip = '';
  if (vm.gm && vm.hands) chip = `<span class="sp-chip sp-chip-hand sp-head-chip">${icon('fa-solid fa-hand')}${vm.hands}</span>`;
  else if (!vm.gm && vm.status === STATUS.HAND) chip = `<span class="sp-chip sp-chip-hand sp-head-chip">${icon('fa-solid fa-hand')}${vm.handPos || ''}</span>`;
  else if (!vm.gm && vm.status === STATUS.HOLD) chip = `<span class="sp-chip sp-chip-hold sp-head-chip">${icon('fa-solid fa-hourglass-half')}</span>`;
  const body = vm.collapsed ? '' : `<div class="sp-hud-body">${vm.gm ? gmBody(vm, L) : playerBody(vm, L)}</div>`;
  return headerHTML(vm, L, chip) + body;
}

/* ── Dire Peril splash ──────────────────────────────────────────────────── */

export function perilHTML({ dire, peril, subtitle }) {
  const word = (w, cls) => `<span class="sp-peril-word ${cls}">${Array.from(w).map((ch, i) =>
    `<span class="sp-peril-ch" style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('')}</span>`;
  return `<div class="sp-peril-veil"></div><div class="sp-peril-cut" aria-hidden="true"></div>`
    + `<div class="sp-peril-type">${word(dire, 'sp-peril-a')}${word(peril, 'sp-peril-b')}`
    + `<span class="sp-peril-sub">${esc(subtitle)}</span></div>`;
}
