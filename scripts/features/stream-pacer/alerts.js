// Stream Pacer — reaching someone who is not looking.
//
// A call drawn in the band only works on a screen somebody is watching, and the
// whole reason this feature was remade is the player who has Foundry in a
// background tab when the GM asks them to wrap up. So every arrival goes out on
// up to three channels besides the band, and each is independent of the others:
//
//   sound          the cue file, through Foundry's interface channel
//   desktop alert  a system notification, when the window is not focused and the
//                  player has allowed them (needs https or localhost)
//   title flash    the tab's title alternates until the window gets focus
//
// Presence (here / idle / away) is reported to the GMs so the HUD can say who a
// call has not reached, and "Nudge" can knock on exactly those people.

import { featurePath } from '../../core/const.mjs';
import { FEATURE_ID, MODULE_ID, SOUNDS, TIMING, PRESENCE } from './const.js';

const setting = (key, fallback) => {
  try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
};

export const soundSrc = (cue) => featurePath(FEATURE_ID, `assets/${SOUNDS[cue]}`);

/** Play one cue, if this client wants sound. */
export function playCue(cue) {
  if (!SOUNDS[cue] || !setting('sp.sound', true)) return;
  const volume = Math.max(0, Math.min(1, Number(setting('sp.volume', 0.7)) || 0));
  if (!volume) return;
  try {
    foundry.audio.AudioHelper.play({ src: soundSrc(cue), volume, autoplay: true, loop: false, channel: 'interface' }, false);
  } catch (e) {
    console.warn(`${MODULE_ID} | stream-pacer | could not play ${cue}`, e);
  }
}

/** Desktop notification availability: 'unsupported' | 'blocked' | 'off' | 'on'. */
export function desktopState() {
  if (typeof Notification === 'undefined' || !globalThis.isSecureContext) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && setting('sp.desktopAlerts', false) ? 'on' : 'off';
}

/** Toggle desktop alerts from a click (the only place a permission prompt may open). */
export async function toggleDesktop() {
  const state = desktopState();
  if (state === 'unsupported' || state === 'blocked') return state;
  if (state === 'on') {
    await game.settings.set(MODULE_ID, 'sp.desktopAlerts', false);
    return 'off';
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return desktopState();
  await game.settings.set(MODULE_ID, 'sp.desktopAlerts', true);
  return 'on';
}

export function presenceNow() {
  if (document.hidden) return PRESENCE.AWAY;
  return document.hasFocus() ? PRESENCE.HERE : PRESENCE.IDLE;
}

export class Reach {
  /** @param {{ onPresence: (state:string) => void }} o */
  constructor({ onPresence }) {
    this.onPresence = onPresence;
    this.state = presenceNow();
    this._title = null;
    this._flashTimer = null;
    this._presenceTimer = null;
    this._notes = new Set();
    this._onChange = () => {
      clearTimeout(this._presenceTimer);
      this._presenceTimer = setTimeout(() => {
        const next = presenceNow();
        if (next === PRESENCE.HERE) this.stopFlash();
        if (next === this.state) return;
        this.state = next;
        this.onPresence(next);
      }, TIMING.presenceDebounce);
    };
    document.addEventListener('visibilitychange', this._onChange);
    window.addEventListener('focus', this._onChange);
    window.addEventListener('blur', this._onChange);
  }

  get looking() { return this.state === PRESENCE.HERE; }

  /**
   * Tell someone who may not be looking. Sound always (when on); the desktop
   * alert and the title flash only while the window is not focused.
   */
  alert({ cue, title, body }) {
    if (cue) playCue(cue);
    if (this.looking) return;
    if (setting('sp.titleFlash', true)) this.flash(title);
    if (desktopState() === 'on') {
      try {
        const n = new Notification(title, { body: body ?? '', tag: `${FEATURE_ID}`, renotify: true, silent: true, icon: 'icons/svg/d20-highlight.svg' });
        n.onclick = () => { window.focus(); n.close(); };
        this._notes.add(n);
        n.onclose = () => this._notes.delete(n);
      } catch (e) {
        console.warn(`${MODULE_ID} | stream-pacer | desktop notification failed`, e);
      }
    }
  }

  flash(text) {
    if (this._flashTimer) clearInterval(this._flashTimer);
    if (this._title === null) this._title = document.title;
    let on = false;
    const mark = `● ${text}`;
    this._flashTimer = setInterval(() => {
      on = !on;
      document.title = on ? mark : this._title;
    }, TIMING.titleFlash);
    document.title = mark;
  }

  stopFlash() {
    if (this._flashTimer) clearInterval(this._flashTimer);
    this._flashTimer = null;
    if (this._title !== null) document.title = this._title;
    this._title = null;
    for (const n of this._notes) n.close();
    this._notes.clear();
  }

  destroy() {
    this.stopFlash();
    clearTimeout(this._presenceTimer);
    document.removeEventListener('visibilitychange', this._onChange);
    window.removeEventListener('focus', this._onChange);
    window.removeEventListener('blur', this._onChange);
  }
}
