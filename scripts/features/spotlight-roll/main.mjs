/**
 * Spotlight Roll — the Foundry half.
 *
 * Three roles, one file:
 *
 *   STAGE      every client. Owns the overlay root, the warmed backdrop, the DSN
 *              die host and one Director per open request, and runs the frame
 *              loop only while something is on screen.
 *   CONDUCTOR  the active GM. Opens requests, probes each slot's chips through
 *              PF2e, ROLLS every slot (so a hidden DC and a blind result never
 *              leave the GM's client), sends each result only to the users
 *              entitled to it, and posts PF2e's own held card when the degree
 *              lands.
 *   CHANNEL    players → GM intents (toggle a chip, throw, Hero Point reroll)
 *              ride the suite socket addressed to the GM, and are trusted only
 *              by the SERVER-attested sender id, never a payload field.
 *
 * The request itself (`dr.active`) is a world setting every client receives;
 * it never carries a result or a DC the players may not see (request-model.mjs).
 */
import { SUITE_ID, warn, err } from "../../core/const.mjs";
import { onSocket, emitSocket } from "../../core/socket.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { Surfaces } from "../../core/gl-surfaces.mjs";
import { Budget } from "../../core/budget.mjs";
import { createTimeline, animate, stagger, eases, createTimer } from "../../core/motion.mjs";
import { motionScale, cssVar } from "../../core/theme.mjs";
import { FEATURE_ID, SETTINGS, MSG, CUE_LEAD_MS, DSN_ID, DSN_MIN_MAJOR } from "./constants.mjs";
import { normalizeRequest, normalizeResult, viewRequest, viewModel, formulaDice } from "./request-model.mjs";
import { Director, SHED_ORDER, diceSpecOf } from "./director.mjs";
import { Backdrop } from "./backdrop.mjs";
import { scheduleBeats } from "./timeline.mjs";
import { installCheckWrapper, probeSlot, rollSlot, postHeld, heroReroll, heroPoints, defenderDc } from "./pf2e-roll.mjs";

const T = (k) => game.i18n.localize(k);
const F = (k, d) => game.i18n.format(k, d);
const I18N = { t: T, f: F };

/* ══════════════════════════════════════════════════════════════════════
   STAGE — every client
   ══════════════════════════════════════════════════════════════════════ */

const stage = {
  root: null, layers: null, backdrop: null, dice: null, overlay: null,
  surface: null, ladder: null, director: null, raf: 0, paused: false,
  reqId: null, results: [], seqs: [], warming: null,
};

async function loadOverlay() {
  if (!stage.overlay) stage.overlay = (await import("./overlay/monolith.mjs")).default;
  return stage.overlay;
}

function buildRoot() {
  if (stage.root) return;
  const root = document.createElement("div");
  root.className = "glsr gl-type";
  root.dataset.phase = "idle";
  root.hidden = true;
  root.innerHTML = `<canvas class="glsr-bg"></canvas><div class="glsr-cssbg"></div><div class="glsr-back"></div><div class="glsr-dice"></div><div class="glsr-front"></div><div class="glsr-gm" hidden></div>`;
  document.body.append(root);
  stage.root = root;
  stage.layers = {
    bg: root.querySelector(".glsr-bg"), cssbg: root.querySelector(".glsr-cssbg"), back: root.querySelector(".glsr-back"),
    dice: root.querySelector(".glsr-dice"), front: root.querySelector(".glsr-front"), gm: root.querySelector(".glsr-gm"),
  };
  root.addEventListener("click", onRootClick);
  addEventListener("keydown", onKey);
}

/**
 * Compile and warm the backdrop at idle, long before anyone throws. Memoised:
 * a request that arrives before the idle callback fired simply starts it now
 * and waits for it, rather than mounting without a backdrop for its lifetime.
 */
function warmBackdrop() {
  stage.warming ??= doWarm().catch((e) => warn("spotlight-roll: warm-up failed", e));
  return stage.warming;
}

async function doWarm() {
  buildRoot();
  const overlay = await loadOverlay();
  if (game.settings.get(SUITE_ID, SETTINGS.cssOnly)) return;
  stage.backdrop = new Backdrop(stage.layers.bg);
  const ok = await stage.backdrop.compile(overlay.fragment);
  if (!ok) warn(`spotlight-roll: backdrop unavailable (${stage.backdrop.report}); the CSS backdrop carries the spotlight.`, stage.backdrop.error ?? "");
  stage.surface = Surfaces.register({
    id: FEATURE_ID,
    // No element: the root is a full-screen layer that is only shown while it
    // has something to show, and an observer on it reports "off screen" from
    // the moment it was registered hidden — which paused the very spotlight it
    // was guarding. Page visibility (the policy's pauseHidden) still applies.
    element: () => null,
    pause: () => { stage.paused = true; },
    resume: () => { stage.paused = false; },
    release: () => stage.backdrop?.release(),
    restore: async () => {
      const fresh = document.createElement("canvas");
      fresh.className = "glsr-bg";
      stage.layers.bg.replaceWith(fresh);
      stage.layers.bg = fresh;
      await stage.backdrop.restore(fresh);
    },
  });
}

async function diceHost() {
  if (stage.dice) return stage.dice;
  const { DsnDiceHost } = await import("./dsn-host.mjs");
  const host = new DsnDiceHost({ container: stage.layers.dice });
  if (!(await host.init())) throw new Error("Dice So Nice could not host the spotlight dice");
  stage.dice = host;
  return host;
}

function palette() {
  const probe = (name) => {
    const el = document.createElement("i");
    el.style.color = `var(${name})`;
    stage.root.append(el);
    const m = getComputedStyle(el).color.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
    el.remove();
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  };
  return { accent: probe("--gl-accent"), gold: probe("--glsr-gold"), success: probe("--glsr-success"), fail: probe("--glsr-fail"), crimson: probe("--glsr-crimson") };
}

const gmView = () => (game.user.isGM ? { dcValue: conductor.private?.dcValue ?? null, mayReroll: () => true } : { mayReroll: (i) => mayActOnSlot(game.user, currentRequest()?.slots[i]) });

function currentRequest() {
  return normalizeRequest(game.settings.get(SUITE_ID, SETTINGS.active));
}

/** Server time → this client's performance clock. */
const localAt = (serverAt) => performance.now() + (serverAt - game.time.serverTime);

async function showRequest(req) {
  buildRoot();
  if (stage.director && stage.reqId === req.id) return;
  teardown();
  stage.reqId = req.id;
  stage.results = [];
  stage.seqs = [];
  const overlay = await loadOverlay();
  await warmBackdrop();
  if (stage.reqId !== req.id) return;
  let host;
  try { host = await diceHost(); } catch (e) { err("spotlight-roll:", e); ui.notifications?.warn(T("GLSR.warn.noDice")); return; }
  const specs = req.slots.map((s) => diceSpecOf({ diceSpec: s.diceSpec, roll: { fortune: req.fortune === "none" ? null : req.fortune } }).map((faces) => ({ faces, userId: s.appearanceUserId, actorUuid: s.actorUuid })));
  stage.root.hidden = false;
  stage.ladder ??= Budget.ladder(FEATURE_ID, SHED_ORDER);
  const director = new Director({
    root: stage.root, layers: stage.layers, overlay, dice: host, backdrop: stage.backdrop, ladder: stage.ladder,
    i18n: I18N, palette: palette(), motion: motionScale(stage.root) || 1,
    cssOnly: !!game.settings.get(SUITE_ID, SETTINGS.cssOnly),
    mayAct: (i) => mayActOnSlot(game.user, currentRequest()?.slots[i]),
    onEnd: () => onDirectorEnd(req.id),
  });
  stage.director = director;
  await director.mount(viewRequest(req, [], I18N, gmView()), { anime: { createTimeline, animate, stagger, eases, createTimer }, diceSpecs: specs });
  if (stage.director !== director) return;
  renderGmBar(req);
  loop();
  // A client that arrives mid-request asks the GM for what it may see.
  if (req.slots.some((s) => s.throw) && !game.user.isGM) emitSocket(FEATURE_ID, { type: MSG.sync, reqId: req.id }, { recipients: gmIds() });
  if (game.user.isGM) for (const [i, r] of conductor.results.entries()) if (r) applyResult(r.forGM);
}

function applyResult(raw) {
  const res = normalizeResult(raw);
  const req = currentRequest();
  if (!res || !req || res.reqId !== req.id || !stage.director) return;
  if ((stage.seqs[res.slot] ?? -1) >= res.seq) return;
  stage.seqs[res.slot] = res.seq;
  stage.results[res.slot] = res.sealed ? null : res;
  const model = viewModel(req, res.slot, res.sealed ? null : res, I18N, gmView());
  if (res.sealed) model.sealed = true;
  stage.director.throw(res.slot, model, { seed: res.seed, at: localAt(res.at) });
}

function teardown() {
  cancelAnimationFrame(stage.raf);
  stage.raf = 0;
  stage.director?.destroy();
  stage.director = null;
  stage.reqId = null;
  if (stage.root) { stage.root.hidden = true; stage.layers.gm.hidden = true; stage.layers.gm.replaceChildren(); }
}

function loop() {
  cancelAnimationFrame(stage.raf);
  const step = () => {
    if (!stage.director) return;
    stage.raf = requestAnimationFrame(step);
    if (stage.paused) return;
    stage.surface?.use?.();
    try {
      stage.director.frame({ width: innerWidth, height: innerHeight, dpr: Math.min(2, devicePixelRatio || 1) });
    } catch (e) {
      err("spotlight-roll: frame failed", e);
      teardown();
    }
  };
  stage.raf = requestAnimationFrame(step);
}

function onDirectorEnd(reqId) {
  teardown();
  // A beat of grace, so a screen a few frames behind finishes its own exit.
  if (game.user === game.users.activeGM) setTimeout(() => conductor.finish(reqId), 1500);
}

/* ── input ─────────────────────────────────────────────────────────── */

function slotOf(el) {
  const host = el?.closest?.("[data-roll]");
  return host ? Number(host.dataset.roll) : 0;
}

function onRootClick(e) {
  const req = currentRequest();
  if (!req || !stage.director) return;
  const gmBtn = e.target.closest("[data-gm]");
  if (gmBtn && game.user.isGM) {
    if (gmBtn.dataset.gm === "rest") conductor.throwRest();
    if (gmBtn.dataset.gm === "close") conductor.close();
    return;
  }
  const i = slotOf(e.target);
  const slot = req.slots[i];
  const chip = e.target.closest("[data-mod]");
  if (chip && slot && !slot.throw) {
    const mod = slot.mods[Number(chip.dataset.mod)];
    if (mod && mayActOnSlot(game.user, slot)) intent({ op: "toggle", slot: i, slug: mod.slug, on: !mod.enabled });
    return;
  }
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "throw" && slot && !slot.throw && mayActOnSlot(game.user, slot)) {
    stage.director.charge?.(i);
    intent({ op: "throw", slot: i });
  }
  if (action === "reroll" && mayActOnSlot(game.user, slot)) intent({ op: "reroll", slot: i });
}

function onKey(e) {
  if (e.key !== "Escape" || !stage.director) return;
  if (game.user.isGM) return;            // the GM closes for everyone from the bar
  if (!game.settings.get(SUITE_ID, SETTINGS.allowDismiss)) return;
  stage.director.dismiss();
}

function intent(payload) {
  const req = currentRequest();
  if (!req) return;
  const msg = { type: MSG.intent, reqId: req.id, ...payload };
  if (game.user.isGM) conductor.onIntent(msg, game.user.id);
  else emitSocket(FEATURE_ID, msg, { recipients: gmIds() });
}

const gmIds = () => game.users.filter((u) => u.isGM && u.active).map((u) => u.id);

/** May this user throw / toggle / reroll for this slot? GMs always; else the actor's owner. */
function mayActOnSlot(user, slot) {
  if (!user || !slot) return false;
  if (user.isGM) return true;
  if (slot.userId === user.id) return true;
  const actor = fromUuidSync(slot.actorUuid);
  return !!actor?.testUserPermission?.(user, "OWNER");
}

/** The GM's control strip: throw everyone still waiting, close for all. */
function renderGmBar(req) {
  const bar = stage.layers.gm;
  if (!game.user.isGM) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `
    <button type="button" class="gl-btn glsr-gm-btn" data-gm="rest"><i class="fa-solid fa-dice-d20"></i> ${T("GLSR.gm.throwRest")}</button>
    <button type="button" class="gl-btn glsr-gm-btn" data-gm="close"><i class="fa-solid fa-xmark"></i> ${T("GLSR.gm.close")}</button>`;
}

/* ══════════════════════════════════════════════════════════════════════
   CONDUCTOR — the active GM
   ══════════════════════════════════════════════════════════════════════ */

const conductor = {
  /** The GM-only half of the open request: the DC, the toggles, the held cards. */
  private: null,
  results: [],

  save() {
    try { localStorage.setItem(`${SUITE_ID}.dr.private`, JSON.stringify({ ...this.private, held: undefined })); } catch { /* storage may be blocked */ }
  },
  restore(reqId) {
    try {
      const raw = JSON.parse(localStorage.getItem(`${SUITE_ID}.dr.private`) ?? "null");
      if (raw?.reqId === reqId) this.private = { ...raw, held: [] };
    } catch { /* ignore */ }
  },

  /**
   * Open a spotlight.
   * @param {object} spec  { layout, check:{kind,slug,label,formula,traits}, title, dc:{value,mode},
   *                         audience, fortune, bonus, rollers:[{actor, token}], defender:{actor, statistic} }
   */
  async open(spec) {
    if (!game.user.isGM) throw new Error("only a GM can open a spotlight");
    if (currentRequest() && !currentRequest().closed) await this.close({ immediate: true });
    const reqId = foundry.utils.randomID();
    const defender = spec.layout === "opposed" && spec.defender?.actor ? spec.defender : null;
    const dcValue = defender ? defenderDc(defender.actor, defender.statistic) : (Number.isFinite(spec.dc?.value) ? spec.dc.value : null);
    const internal = {
      check: spec.check, fortune: spec.fortune ?? "none", bonus: Number(spec.bonus) || 0, title: spec.title ?? "", dcValue,
    };
    const formulaFaces = spec.check.kind === "formula" ? formulaDice(spec.check.formula) : null;
    if (spec.check.kind === "formula" && !formulaFaces) throw new Error(T("GLSR.warn.formula"));
    const slots = [];
    for (const r of spec.rollers.slice(0, 6)) {
      const actor = r.actor;
      const owner = game.users.find((u) => !u.isGM && u.character?.id === actor.id) ?? game.users.find((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
      const probe = await probeSlot(actor, internal, { defender: defender?.actor }).catch((e) => { warn("spotlight-roll: probe failed", e); return null; });
      slots.push({
        actorUuid: actor.uuid, tokenUuid: r.token?.document?.uuid ?? r.token?.uuid ?? null,
        name: r.token?.name ?? actor.name, title: actorTitle(actor), img: actor.img,
        userId: owner?.id ?? null, appearanceUserId: owner?.id ?? game.user.id,
        mods: probe?.mods ?? [], diceSpec: formulaFaces ?? (internal.fortune !== "none" ? [20, 20] : [20]),
        throw: null,
      });
    }
    this.private = { reqId, dcValue, toggles: slots.map(() => ({})), held: [], seq: slots.map(() => 0), audience: spec.audience ?? "all", messages: [] };
    this.results = [];
    this.save();
    const dcMode = spec.dc?.mode ?? "shown";
    const request = {
      id: reqId, createdAt: game.time.serverTime, layout: spec.layout, title: spec.title ?? "",
      check: { kind: spec.check.kind, slug: spec.check.slug ?? "", label: spec.check.label ?? "", formula: spec.check.formula ?? null, traits: spec.check.traits ?? [] },
      dc: { mode: dcMode, value: dcMode === "shown" ? dcValue : null, has: dcValue != null },
      audience: spec.audience ?? "all", fortune: internal.fortune, bonus: internal.bonus,
      defender: defender ? { name: defender.token?.name ?? defender.actor.name, title: actorTitle(defender.actor), img: defender.actor.img, statistic: statLabel(defender.actor, defender.statistic) } : null,
      slots, closed: false,
    };
    this.internal = internal;
    this.defender = defender;
    await game.settings.set(SUITE_ID, SETTINGS.active, request);
    return reqId;
  },

  async writeSlot(i, patch) {
    const req = currentRequest();
    if (!req) return;
    req.slots[i] = { ...req.slots[i], ...patch };
    await game.settings.set(SUITE_ID, SETTINGS.active, req);
  },

  async onIntent(msg, attested) {
    if (game.user !== game.users.activeGM) return;
    const req = currentRequest();
    if (!req || msg.reqId !== req.id || req.closed) return;
    const user = game.users.get(attested);
    const i = Number(msg.slot);
    const slot = req.slots[i];
    if (!slot || !mayActOnSlot(user, slot)) return;
    if (!this.private || this.private.reqId !== req.id) this.restore(req.id);
    if (!this.private) return;
    const actor = await fromUuid(slot.actorUuid);
    if (!actor) return;
    switch (msg.op) {
      case "toggle": {
        if (slot.throw) return;
        this.private.toggles[i] = { ...this.private.toggles[i], [String(msg.slug)]: !!msg.on };
        this.save();
        const probe = await probeSlot(actor, this.internalFor(req), { toggles: this.private.toggles[i], defender: this.defender?.actor });
        if (probe) await this.writeSlot(i, { mods: probe.mods });
        return;
      }
      case "throw": return this.resolve(i, actor);
      case "reroll": return this.reroll(i, actor);
    }
  },

  internalFor(req) {
    return this.internal ?? { check: req.check, fortune: req.fortune, bonus: req.bonus, title: req.title, dcValue: this.private?.dcValue ?? req.dc.value };
  },

  async resolve(i, actor, rolled = null) {
    const req = currentRequest();
    const slot = req?.slots[i];
    if (!slot || (slot.throw && !rolled)) return;
    let out;
    try {
      out = rolled ?? await rollSlot(actor, this.internalFor(req), { toggles: this.private.toggles[i], defender: this.defender?.actor });
    } catch (e) {
      err("spotlight-roll: roll failed", e);
      ui.notifications?.error(F("GLSR.warn.rollFailed", { name: slot.name }));
      return;
    }
    const seq = (this.private.seq[i] = (this.private.seq[i] ?? 0) + 1);
    const at = game.time.serverTime + CUE_LEAD_MS;
    const seed = Math.floor(Math.random() * 1e9);
    const canReroll = !!out.rerollable && heroPoints(actor) > 0;
    const full = { reqId: req.id, slot: i, seq, at, seed, sealed: false, ...out.result, canReroll };
    const sealed = { reqId: req.id, slot: i, seq, at, seed, sealed: true };
    this.private.held[i] = out.held;
    this.results[i] = { forGM: full };
    // Who may see it: everyone, the roller (and GMs), or GMs alone.
    const others = game.users.filter((u) => u.active && u.id !== game.user.id);
    const entitled = (u) => u.isGM || req.audience === "all" || (req.audience === "roller" && u.id === slot.userId);
    const yes = others.filter(entitled).map((u) => u.id), no = others.filter((u) => !entitled(u)).map((u) => u.id);
    if (yes.length) emitSocket(FEATURE_ID, { type: MSG.throw, result: full }, { recipients: yes });
    if (no.length) emitSocket(FEATURE_ID, { type: MSG.throw, result: sealed }, { recipients: no });
    applyResult(full);
    await this.writeSlot(i, { throw: { at, seed, seq } });
    // Post PF2e's own card the moment the degree lands on screen.
    const steps = (out.result.mods ?? []).filter((m) => m.enabled && m.value !== 0).length;
    const beats = scheduleBeats({ mods: steps, natural: out.result.roll.natural, dcHidden: req.dc.mode === "hidden" && req.dc.has, fortune: req.fortune !== "none", crit: out.result.degree === 0 || out.result.degree === 3, scale: motionScale(stage.root) || 1 });
    const wait = Math.max(0, at + beats.degree - game.time.serverTime);
    setTimeout(() => this.post(req.id, i, seq), wait);
    // The request is normally cleared when the GM's own screen finishes it, but
    // a GM whose tab is in the background draws no frames and would never get
    // there; this clears it on the clock instead.
    setTimeout(() => this.maybeFinish(req.id), Math.max(0, at + beats.end - game.time.serverTime) + 2500);
  },

  maybeFinish(reqId) {
    const req = currentRequest();
    if (!req || req.id !== reqId || req.slots.some((s) => !s.throw)) return;
    if (stage.director && !document.hidden) return;   // a visible screen finishes it itself
    this.finish(reqId);
  },

  async post(reqId, i, seq) {
    if (!this.private || this.private.reqId !== reqId || this.private.seq[i] !== seq) return;
    const req = currentRequest();
    const held = this.private.held[i];
    if (!held || !req) return;
    this.private.held[i] = null;
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    const slot = req.slots[i];
    const audience = { whisper: [], blind: false };
    if (req.audience === "roller") audience.whisper = [...new Set([...gms, ...(slot.userId ? [slot.userId] : [])])];
    if (req.audience === "gm") { audience.whisper = gms; audience.blind = true; }
    try {
      const msg = await postHeld(held, { ...audience, reqId, slot: i });
      if (msg) this.private.messages[i] = msg.id;
    } catch (e) {
      err("spotlight-roll: could not post the check", e);
    }
  },

  async reroll(i, actor) {
    const req = currentRequest();
    const messageId = this.private?.messages?.[i];
    const message = messageId ? game.messages.get(messageId) : null;
    if (!req || !message || heroPoints(actor) <= 0) return;
    const out = await heroReroll(message);
    if (!out) return;
    await this.resolve(i, actor, { ...out, rerollable: false });
  },

  async throwRest() {
    const req = currentRequest();
    if (!req) return;
    for (const [i, s] of req.slots.entries()) {
      if (s.throw) continue;
      const actor = await fromUuid(s.actorUuid);
      if (actor) await this.resolve(i, actor);
    }
  },

  /** Answer a late client with what it may see of each thrown slot. */
  sync(attested) {
    const req = currentRequest();
    const user = game.users.get(attested);
    if (!req || !user) return;
    for (const [i, r] of this.results.entries()) {
      if (!r) continue;
      const entitled = user.isGM || req.audience === "all" || (req.audience === "roller" && user.id === req.slots[i].userId);
      const res = entitled ? r.forGM : { reqId: req.id, slot: i, seq: r.forGM.seq, at: r.forGM.at, seed: r.forGM.seed, sealed: true };
      emitSocket(FEATURE_ID, { type: MSG.throw, result: res }, { recipients: [user.id] });
    }
  },

  async close({ immediate = false } = {}) {
    const req = currentRequest();
    if (!req) return;
    // Post anything still held, so closing early never loses a roll.
    for (const i of req.slots.keys()) if (this.private?.held?.[i]) await this.post(req.id, i, this.private.seq[i]);
    if (immediate) return game.settings.set(SUITE_ID, SETTINGS.active, null);
    await game.settings.set(SUITE_ID, SETTINGS.active, { ...req, closed: true });
  },

  async finish(reqId) {
    const req = currentRequest();
    if (req?.id === reqId) await game.settings.set(SUITE_ID, SETTINGS.active, null);
  },
};

function actorTitle(actor) {
  const level = actor.system?.details?.level?.value;
  const cls = actor.class?.name ?? actor.system?.details?.class?.name ?? "";
  if (actor.type === "character") return [level != null ? F("GLSR.actor.level", { level }) : "", cls].filter(Boolean).join(" · ");
  return level != null ? F("GLSR.actor.creature", { level }) : "";
}

function statLabel(actor, slug) {
  const stat = actor?.saves?.[slug] ?? (slug === "perception" ? actor?.perception : null) ?? actor?.skills?.[slug];
  return stat?.label ?? slug;
}

/* ══════════════════════════════════════════════════════════════════════
   Lifecycle
   ══════════════════════════════════════════════════════════════════════ */

export function registerSettings() {
  const s = (key, data) => game.settings.register(SUITE_ID, key, data);
  s(SETTINGS.active, { scope: "world", config: false, type: Object, default: null, onChange: onRequestChanged });
  s(SETTINGS.allowDismiss, { name: "GLSR.settings.allowDismiss.name", hint: "GLSR.settings.allowDismiss.hint", scope: "world", config: true, type: Boolean, default: true });
  s(SETTINGS.cssOnly, { name: "GLSR.settings.cssOnly.name", hint: "GLSR.settings.cssOnly.hint", scope: "client", config: true, type: Boolean, default: false, requiresReload: true });
}

let readyDone = false;

function onRequestChanged() {
  if (!readyDone) return;
  const req = currentRequest();
  if (!req) { teardown(); return; }
  if (req.closed) { stage.director?.dismiss(); return; }
  if (stage.reqId !== req.id) { showRequest(req); return; }
  // Same request: chips may have changed on unthrown slots.
  for (const [i, s] of req.slots.entries()) {
    if (s.throw) continue;
    stage.director?.update(i, viewModel(req, i, null, I18N, gmView()));
  }
}

export function onInit() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const group = ensureSuiteGroup(controls);
    if (!group) return;
    group.tools["glsr-request"] = { name: "glsr-request", title: "GLSR.controls.request", icon: "fa-solid fa-dice-d20", button: true, order: 40, onChange: openBuilder };
  });
  Hooks.on("renderSceneControls", (_app, html) => bindSuiteToolClicks(html, { "glsr-request": openBuilder }));
}

async function openBuilder() {
  const { RequestApp } = await import("./request-app.mjs");
  RequestApp.open({ conductor });
}

export async function onReady() {
  const dsn = game.modules.get(DSN_ID);
  const major = Number(String(dsn?.version ?? "0").split(".")[0]);
  if (!dsn?.active || major < DSN_MIN_MAJOR) {
    warn(`spotlight-roll needs Dice So Nice ${DSN_MIN_MAJOR}.x or newer; it stands down.`);
    return;
  }
  installCheckWrapper();
  onSocket(FEATURE_ID, (payload, _claimed, meta) => {
    if (payload?.type === MSG.throw) return applyResult(payload.result);
    if (!game.user.isGM || !meta?.attested) return;
    if (payload?.type === MSG.intent) return conductor.onIntent(payload, meta.attested);
    if (payload?.type === MSG.sync) return conductor.sync(meta.attested);
  });
  buildRoot();
  const idle = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 1200));
  idle(() => warmBackdrop(), { timeout: 4000 });
  readyDone = true;
  const req = currentRequest();
  if (req && !req.closed) {
    if (game.user.isGM) conductor.restore(req.id);
    showRequest(req);
  }
}

/** Public API: game.modules.get(SUITE_ID).api.features["spotlight-roll"]. */
export const api = {
  /** Open a spotlight (GM). See conductor.open for the spec. */
  request: (spec) => conductor.open(spec),
  close: () => conductor.close(),
  throwRest: () => conductor.throwRest(),
  /** Diagnostics for a live session: what this screen's stage is doing. */
  inspect: () => ({
    reqId: stage.reqId, paused: stage.paused, raf: !!stage.raf, backdrop: stage.backdrop?.report ?? null,
    surface: stage.surface ? { paused: stage.surface._paused, released: stage.surface._released } : null,
    rolls: stage.director?.rolls.map((r) => ({ i: r.i, throwAt: r.throwAt, now: performance.now(), beats: r.beats && { land: r.beats.land, degree: r.beats.degree, end: r.beats.end } })) ?? null,
  }),
};
