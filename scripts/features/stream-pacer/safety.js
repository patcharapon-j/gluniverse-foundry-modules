// Stream Pacer — the safety desk: the traffic light and the GM's check-in.
//
// Lights are live, private state. They are never written to a document or a
// setting (both reach every client); they ride the suite socket with
// `recipients`, which the SERVER filters, to the active GMs who are not
// safety-exempt, and a GM files a light under the server-attested sender only.
//
// This class is constructed only on a client that is not safety-exempt (see the
// gate in module.js). A client without one draws no lamp, no lane, no frame,
// plays no safety cue and, because the recipients exclude it, receives nothing.

import { LIGHT, LIGHT_RANK } from './const.js';

export class SafetyDesk {
  /**
   * @param {object} o
   * @param {boolean} o.isGM
   * @param {(payload:object, recipients:string[]|null) => void} o.emit
   * @param {() => string[]} o.gmRecipients      active, non-exempt GMs other than me
   * @param {() => string[]} o.playerRecipients  everyone else who may answer
   * @param {(id:string) => boolean} o.isExempt  live: is user X safety-exempt?
   * @param {(id:string) => boolean} o.isGMUser
   * @param {() => number} o.now
   * @param {() => void} o.refresh
   */
  constructor(o) {
    Object.assign(this, { o });
    this.mine = LIGHT.GREEN;
    this.answered = false;
    this.ask = null;
    /** GM board: userId → { light, ask, at } */
    this.lights = {};
    /** The GM's acknowledgement of the raised lights, by signature. */
    this.seen = null;
  }

  snapshot() {
    return { show: true, lights: this.lights, ask: this.ask, mine: this.mine, answered: this.answered, seen: this.seen };
  }

  /* ── a player's side ── */

  setLight(light) {
    if (!(light in LIGHT_RANK)) return;
    this.mine = light;
    if (this.ask) this.answered = true;
    this.announce();
    this.o.refresh();
  }

  /** Tell the GMs where my light stands (on change, and whenever a GM asks). */
  announce() {
    if (this.o.isGM) return;
    const to = this.o.gmRecipients();
    if (!to.length) return;
    this.o.emit({ t: 'light', light: this.mine, ask: this.answered ? this.ask?.id ?? null : null }, to);
  }

  /** The last GM left: nobody can read an answer, so the ask closes here. */
  closeAsk() {
    this.ask = null;
    this.answered = false;
    this.o.refresh();
  }

  /* ── a GM's side ── */

  startAsk(id) {
    this.ask = { id, at: this.o.now() };
    // every GM's board marks the ask, every player is asked
    this.o.emit({ t: 'ask', id: this.ask.id, at: this.ask.at }, [...this.o.playerRecipients(), ...this.o.gmRecipients()]);
    this.o.refresh();
  }

  endAsk() {
    const id = this.ask?.id ?? null;
    this.ask = null;
    this.o.emit({ t: 'askEnd', id }, [...this.o.playerRecipients(), ...this.o.gmRecipients()]);
    this.o.refresh();
  }

  /** The GM has looked at the raised lights. Local: each GM acknowledges for themself. */
  acknowledge(signature) {
    this.seen = signature;
    this.o.refresh();
  }

  /** A late player asked what is going on; tell them only. */
  replyHello(userId) {
    if (!this.o.isGM || !this.ask) return;
    this.o.emit({ t: 'ask', id: this.ask.id, at: this.ask.at }, [userId]);
  }

  /* ── the wire ── */

  /** @returns {boolean} whether the payload was a safety message */
  receive(p, sender) {
    if (!sender) return false;
    const fromGM = this.o.isGMUser(sender);
    switch (p.t) {
      case 'light': {
        if (!this.o.isGM || fromGM || this.o.isExempt(sender)) return true;
        if (!(p.light in LIGHT_RANK)) return true;
        this.lights[sender] = { light: p.light, ask: typeof p.ask === 'string' ? p.ask : null, at: this.o.now() };
        this.o.refresh();
        return true;
      }
      case 'ask': {
        if (!fromGM || typeof p.id !== 'string') return true;
        if (this.ask?.id !== p.id) this.answered = false;
        this.ask = { id: p.id, at: Number(p.at) || this.o.now() };
        this.o.refresh();
        return true;
      }
      case 'askEnd': {
        if (!fromGM) return true;
        if (!p.id || this.ask?.id === p.id) { this.ask = null; this.answered = false; }
        this.o.refresh();
        return true;
      }
      default:
        return false;
    }
  }
}
