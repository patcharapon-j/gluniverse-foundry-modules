/**
 * Combat Intro — the Foundry half.
 *
 * Three roles, one file (the same split Spotlight Roll uses):
 *
 *   STAGE      every client. Reads `ci.state` off the viewed Combat, mounts the
 *              overlay, the warmed backdrop and the Dice So Nice host, and runs
 *              the frame loop only while a sequence is on screen.
 *   CONDUCTOR  the active GM. Builds the slots, ROLLS every one through PF2e
 *              (so an NPC's total never leaves the GM's client before the sort),
 *              sends each result only to the users entitled to it, commits the
 *              whole encounter in one batch, posts PF2e's held cards, and steps
 *              the phases on the server clock.
 *   CHANNEL    players → GM intents ride the suite socket addressed to the GMs,
 *              trusted only by the SERVER-attested sender id.
 *
 * The public state is read only through `normalizeState` and holds no totals
 * (state-model.mjs). Every write the conductor makes goes through one queue,
 * which re-reads the flag first, so two rolls landing together cannot clobber
 * each other's throw stamps.
 */
import { SUITE_ID, warn, err } from "../../core/const.mjs";
import { onSocket, emitSocket } from "../../core/socket.mjs";
import { Surfaces } from "../../core/gl-surfaces.mjs";
import { Budget } from "../../core/budget.mjs";
import { Suite } from "../../core/registry.mjs";
import { createTimeline, animate, stagger, eases, createTimer } from "../../core/motion.mjs";
import { motionScale } from "../../core/theme.mjs";
import { FLAGS as INIT_FLAGS, VISIBILITY } from "../initiative/constants.mjs";
import { getDisposition } from "../initiative/util.mjs";
import { isExtraTurn } from "../pf2e-variant-rules/boss/initiative.mjs";
import { bossBadge } from "../pf2e-variant-rules/boss/profile.mjs";
import { frameImages } from "../../core/face-frame.mjs";
import {
  FEATURE_ID, FLAG, SETTINGS, SOUND_PREFIX, SKIN_SETTING, SKINS, DEFAULT_SKIN, DSN_ID, DSN_MIN_MAJOR,
  MSG, CUES, CUE_LEAD_MS, PRIVATE_KEY, HANDOFF_HOOK, ARRIVED_HOOK,
} from "./constants.mjs";
import { INTRO_MS, SORT_MS, HANDOFF_MS, phaseClock, phaseLength, sortReadyAt } from "./timeline.mjs";
import {
  publicSlot, npcGroups, normalizeState, canAdvance, entitled, mayAct, sealResult, normalizeResult,
  normalizeIntent, orderFrom, commitEntries,
} from "./state-model.mjs";
import overlay from "./overlay.mjs";
import {
  installCheckWrapper, postHeld, statisticsOf, defaultStatistic, probeInitiative, rollInitiative,
  commitInitiatives, cardAudience,
} from "./pf2e-init.mjs";

const T = (k) => game.i18n.localize(k);
const F = (k, d) => game.i18n.format(k, d);
const I18N = { t: T, f: F };
const DICE_KEY = "glCombatIntro";
/** Statistics an NPC can be set to from its volley card (the overlay draws the same list). */
const { NPC_STATS } = overlay;

let readyDone = false;
let dsnOk = false;

/* ══════════════════════════════════════════════════════════════════════
   Reading
   ══════════════════════════════════════════════════════════════════════ */

const skinOf = (v) => (SKINS.includes(v) ? v : DEFAULT_SKIN);

function worldSkin() {
  try { return skinOf(game.settings.get(SUITE_ID, SKIN_SETTING)); } catch { return DEFAULT_SKIN; }
}

function readState(combat) {
  if (!combat) return null;
  const state = normalizeState(combat.getFlag(SUITE_ID, FLAG));
  return state && state.combatId === combat.id ? state : null;
}

const gmIds = () => game.users.filter((u) => u.isGM && u.active).map((u) => u.id);
const isConductor = () => !!game.user.isGM && game.user === game.users.activeGM;

function isStreamClient() {
  try { return game.settings.get(SUITE_ID, "stream.streamUserId") === game.user.id; } catch { return false; }
}

function viewer() {
  const role = game.user.isGM ? "gm" : isStreamClient() ? "spectator" : "player";
  return { userId: game.user.id, isGM: game.user.isGM, role };
}

/** Owner test used by `mayAct` for a PC slot whose recorded owner is someone else. */
function owns(user, slot) {
  const actor = slot?.actorUuid ? fromUuidSync(slot.actorUuid) : null;
  return !!actor?.testUserPermission?.(user, "OWNER");
}

/** Server time → this client's performance clock. */
const localAt = (serverAt) => performance.now() + (serverAt - game.time.serverTime);

/* ══════════════════════════════════════════════════════════════════════
   STAGE — every client
   ══════════════════════════════════════════════════════════════════════ */

const stage = {
  root: null, layers: null, mods: null, director: null,
  backdrop: null, backdropSkin: null, surface: null, ladders: new Map(),
  dice: null, sound: null, soundSkin: null,
  raf: 0, paused: false, seqId: null, combatId: null, phase: null,
  seqs: new Map(), handedOff: false, mounting: null,
};

async function loadModules() {
  if (stage.mods) return stage.mods;
  const [director, backdrop, skins, sound] = await Promise.all([
    import("./director.mjs"), import("./backdrop.mjs"), import("./skins/index.mjs"), import("./sound.mjs"),
  ]);
  stage.mods = { director, overlay, backdrop, skins, sound };
  return stage.mods;
}

function buildRoot() {
  if (stage.root) return;
  const { root, layers, close } = overlay.createRoot(document);
  root.dataset.phase = "idle";
  root.dataset.skin = worldSkin();
  root.hidden = true;
  // Always there, for everyone: a full-screen layer must never be able to trap a
  // client, whatever state it was left in (a reload mid-sequence, a lost GM).
  close.title = T("GLCI.close");
  close.setAttribute("aria-label", T("GLCI.close"));
  close.addEventListener("click", (e) => { e.stopPropagation(); closeSequence(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.hidden) closeSequence(); });
  document.body.append(root);
  stage.root = root;
  stage.layers = layers;
}

/**
 * Close the cinematic. Every client may close its own screen; it stays closed
 * for that sequence. A GM also ends it for the table: before the commit that is
 * a cancel, after it the combat starts with the values already written.
 */
function closeSequence() {
  const combat = game.combats.get(stage.combatId) ?? game.combat;
  const state = combat ? readState(combat) : null;
  stage.dismissed = stage.seqId ?? state?.id ?? null;
  teardown();
  dropPresentation();
  if (game.user.isGM && combat && state) conductor.abort(combat, state).catch((e) => err("combat-intro: could not close the sequence", e));
}

/** A timed phase this far past its end is stranded (nobody is conducting it). */
const STRANDED_MS = 8000;
function strandedCheck(combat, state) {
  const { ms, done } = phaseClock(state, game.time.serverTime);
  const len = phaseLength(state.phase);
  return done && len != null && ms > len + STRANDED_MS;
}

/** Compile the skin's backdrop once; a different skin swaps the program on the same surface. */
async function ensureBackdrop(skin) {
  if (game.settings.get(SUITE_ID, SETTINGS.cssOnly)) return null;
  // A sequence that starts while the idle warm-up is still compiling waits for
  // that compile rather than reading "not ok" and staying CSS for its lifetime.
  if (stage.backdropSkin === skin.id && stage.backdropReady) return stage.backdropReady;
  stage.backdropSkin = skin.id;
  stage.backdropReady = compileBackdrop(skin);
  return stage.backdropReady;
}

async function compileBackdrop(skin) {
  const { Backdrop } = stage.mods.backdrop;
  stage.backdrop?.release?.();
  stage.backdrop = new Backdrop(stage.layers.bg);
  let ok = false;
  try { ok = await stage.backdrop.compile(skin); } catch (e) { warn("combat-intro: backdrop compile threw", e); }
  if (!ok) warn(`combat-intro: backdrop unavailable (${stage.backdrop.report ?? "no WebGL2"}); the CSS layer carries the sequence.`);
  stage.surface ??= Surfaces.register({
    id: FEATURE_ID,
    // A full-screen layer shown only while it has something to show: an
    // element observer would report "off screen" from registration and pause
    // the very sequence it guards. Page visibility still applies.
    element: () => null,
    pause: () => { stage.paused = true; },
    resume: () => { stage.paused = false; },
    release: () => stage.backdrop?.release?.(),
    restore: async () => {
      const fresh = document.createElement("canvas");
      fresh.className = "glci-bg";
      stage.layers.bg.replaceWith(fresh);
      stage.layers.bg = fresh;
      await stage.backdrop?.restore?.(fresh);
    },
  });
  return ok ? stage.backdrop : null;
}

/** A host that draws nothing, for a client whose Dice So Nice could not host the dice. */
const INERT_HOST = {
  ok: false,
  async createDice(specs = []) {
    return specs.map((row) => (row ?? []).map((e) => ({ faceCount: Number(e?.faces) || 20, targetFor: () => [0, 0, 0, 1], setPose() {}, relabel() {}, shatter() {}, outer: null })));
  },
  place() {}, resize() {}, render() {}, setLights() {}, clear() {}, dispose() {}, async warm() {},
};

async function diceHost() {
  if (stage.dice) return stage.dice;
  try {
    const { DsnDiceHost } = await import("../spotlight-roll/dsn-host.mjs");
    const host = new DsnDiceHost({ container: stage.layers.dice, key: DICE_KEY });
    if (await host.init()) { stage.dice = host; return host; }
  } catch (e) {
    err("combat-intro: dice host failed", e);
  }
  ui.notifications?.warn(T("GLCI.warn.noDice"));
  stage.dice = INERT_HOST;
  return INERT_HOST;
}

/** The GL palette, read from the SKINNED root so a scoped remap reaches the shader. */
function palette() {
  const probe = (name, fallback) => {
    const el = document.createElement("i");
    el.style.color = `var(${name}, ${fallback})`;
    stage.root.append(el);
    const m = getComputedStyle(el).color.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
    el.remove();
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  };
  return {
    accent: probe("--glci-accent", "var(--gl-accent)"),
    hot: probe("--glci-hot", "white"),
    ink: probe("--glci-ink", "black"),
    warn: probe("--glci-warn", "orange"),
  };
}

function soundFor(skin) {
  if (stage.sound && stage.soundSkin === skin.id) return stage.sound;
  stage.sound?.dispose?.();
  const paths = {};
  for (const cue of CUES) {
    let override = "";
    try { override = String(game.settings.get(SUITE_ID, `${SOUND_PREFIX}${cue}`) ?? "").trim(); } catch { /* unregistered */ }
    const own = skin.sounds?.[cue];
    paths[cue] = override || (own ? `modules/${SUITE_ID}/${own}` : "");
  }
  let volume = 0.8;
  try { volume = Number(game.settings.get(SUITE_ID, SETTINGS.volume)) * (Number(game.settings.get("core", "globalInterfaceVolume")) || 1); } catch { /* defaults */ }
  stage.sound = stage.mods.sound.createSoundPlayer({ paths, volume, enabled: volume > 0 });
  stage.soundSkin = skin.id;
  stage.sound.preload?.();
  return stage.sound;
}

function ladderFor(skin) {
  const order = stage.mods.director.shedOrderFor(skin);
  const key = `${skin.id}:${order.join(",")}`;
  if (!stage.ladders.has(key)) stage.ladders.set(key, Budget.ladder(FEATURE_ID, order));
  return stage.ladders.get(key);
}

/** Where the rail sits, for the handoff to collapse toward. */
function railRect() {
  const el = document.getElementById("gluni-initiative")?.querySelector(".gluni-rail") ?? document.getElementById("gluni-initiative");
  const r = el?.getBoundingClientRect?.();
  return r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

/** Values the sort may print: every client has them once the batch write landed. */
function extrasFor(combat, state) {
  if (!["sorting", "handoff"].includes(state.phase)) return {};
  const totals = new Map();
  for (const s of state.slots) {
    const v = combat.combatants.get(s.combatantId)?.initiative;
    if (Number.isFinite(v)) totals.set(s.id, v);
  }
  return { totals };
}

async function show(combat, state) {
  buildRoot();
  if (stage.dismissed && stage.dismissed === state.id) return;
  // Left behind by a reload or an update mid-sequence: never cover the screen with it.
  if (strandedCheck(combat, state)) {
    teardown();
    if (game.user.isGM && isConductor()) conductor.abort(combat, state).catch((e) => err("combat-intro: could not clear a stranded sequence", e));
    return;
  }
  if (stage.director && stage.seqId === state.id) {
    stage.phase = state.phase;
    stage.director.setState(state, extrasFor(combat, state));
    return;
  }
  if (stage.mounting === state.id) return;
  stage.mounting = state.id;
  try {
    teardown();
    stage.seqId = state.id;
    stage.combatId = combat.id;
    stage.phase = state.phase;
    stage.handedOff = false;
    stage.seqs = new Map();
    const mods = await loadModules();
    const skin = mods.skins.skinFor(state.skin);
    stage.root.dataset.skin = skin.id;
    const backdrop = await ensureBackdrop(skin);
    const dice = await diceHost();
    if (stage.seqId !== state.id) return;
    const ladder = ladderFor(skin);
    stage.root.hidden = false;
    const director = new mods.director.Director({
      root: stage.root, layers: stage.layers, overlay: mods.overlay, dice, backdrop, skin, ladder,
      i18n: I18N, palette, motion: motionScale(stage.root) || 1, cssOnly: !backdrop, sound: soundFor(skin),
      anime: { createTimeline, animate, stagger, eases, createTimer },
      now: () => performance.now(), serverNow: () => game.time.serverTime,
      viewer: viewer(), mayAct: (slot) => mayAct(game.user, slot, { owns }),
      onIntent: (intent) => sendIntent(intent), onGm: (action, payload) => gmAction(action, payload),
      railRect, frameArt, present: (ids) => presentRailCards(combat.id, ids),
    });
    stage.director = director;
    await director.mount(state);
    if (stage.director !== director) return;
    const fresh = readState(combat);
    if (fresh) director.setState(fresh, extrasFor(combat, fresh));
    loop();
    // A client that arrives mid-sequence asks the GM for what it may see.
    if (!game.user.isGM && state.slots.some((s) => s.throw)) emitSocket(FEATURE_ID, { type: MSG.sync, seqId: state.id }, { recipients: gmIds() });
    if (game.user.isGM && conductor.private?.seqId === state.id) {
      for (const full of Object.values(conductor.private.results)) applyResult(full);
    }
  } catch (e) {
    err("combat-intro: could not show the sequence", e);
    teardown();
  } finally {
    if (stage.mounting === state.id) stage.mounting = null;
  }
}

function applyResult(raw) {
  const res = normalizeResult(raw);
  if (!res || res.seqId !== stage.seqId || !stage.director) return;
  if ((stage.seqs.get(res.slotId) ?? -1) >= res.seq) return;
  stage.seqs.set(res.slotId, res.seq);
  stage.director.applyResult(res, localAt(res.at));
}

/**
 * Every portrait the overlay draws is framed on the head in its art, the same
 * locator the rail's cards use. The shots match each box: a band across the face
 * on a PC card, a head on the square volley and roster tiles.
 */
const ART_SHOTS = Object.freeze({
  card: { aspect: 1 / 0.62, headRatio: 0.66, eyeLine: 0.4 },
  square: { aspect: 1, headRatio: 0.62, eyeLine: 0.42 },
});
function frameArt(layers) {
  try {
    frameImages(layers.back, ".glci-card-art > img", ART_SHOTS.card);
    frameImages(layers.back, ".glci-volley-art > img, .glci-rank-art > img", ART_SHOTS.square);
    frameImages(layers.front, ".glci-roster-item > img", ART_SHOTS.square);
  } catch (e) { warn("combat-intro: face framing unavailable", e); }
}

/**
 * The rail's own cards for the sort, rendered by the initiative feature (reached
 * through the suite API, never imported). Null when the rail is not running here,
 * and the director falls back to its own rank tiles.
 */
function presentRailCards(combatId, ids) {
  try {
    const p = game.modules.get(SUITE_ID)?.api?.features?.initiative?.presentCards?.(combatId, ids) ?? null;
    if (p) stage.presentation = p;
    return p;
  } catch (e) { warn("combat-intro: rail cards unavailable", e); return null; }
}

/**
 * After the handoff the presented cards outlive the overlay: they stay exactly
 * where the sort left them until the rail's arrival has primed its own copies on
 * top of them (ARRIVED_HOOK), so there is never a frame with both or neither.
 * A rail that never arrives here (hidden, or the start failed) lets them fade.
 */
function lingerPresentation(combatId) {
  const p = stage.presentation;
  stage.presentation = null;
  if (!p?.layer?.isConnected) return;
  const drop = () => { clearTimeout(timer); Hooks.off(ARRIVED_HOOK, hook); p.layer.remove(); };
  const hook = Hooks.on(ARRIVED_HOOK, (payload) => { if (!payload?.combatId || payload.combatId === combatId) drop(); });
  const timer = setTimeout(() => {
    Hooks.off(ARRIVED_HOOK, hook);
    animate(p.layer, { opacity: [1, 0], duration: 320, ease: "outQuad", onComplete: () => p.layer.remove() });
  }, 4000);
}

function dropPresentation() {
  stage.presentation?.layer?.remove();
  stage.presentation = null;
}

function teardown() {
  cancelAnimationFrame(stage.raf);
  stage.raf = 0;
  // A sequence torn down before its handoff (a cancel, a skin switch) takes its
  // presented cards with it; after the handoff they are the rail's to retire.
  if (!stage.handedOff) dropPresentation();
  try { stage.director?.destroy(); } catch (e) { warn("combat-intro: destroy failed", e); }
  stage.director = null;
  try { stage.dice?.clear?.(); } catch { /* host gone */ }
  stage.seqId = null;
  stage.combatId = null;
  stage.phase = null;
  Budget.claimMotion(FEATURE_ID, false);
  if (stage.root) {
    stage.root.hidden = true;
    stage.root.dataset.phase = "idle";
    delete stage.root.dataset.late;
    // The CSS layer keeps its fixed children (overlay.createRoot); the rest is per sequence.
    for (const k of ["back", "front", "gm"]) stage.layers[k].replaceChildren();
  }
}

function loop() {
  cancelAnimationFrame(stage.raf);
  Budget.claimMotion(FEATURE_ID, true);
  const step = () => {
    if (!stage.director) return;
    stage.raf = requestAnimationFrame(step);
    if (stage.paused) return;
    stage.surface?.use?.();
    try {
      stage.director.frame({ width: innerWidth, height: innerHeight, dpr: Math.min(2, devicePixelRatio || 1) });
      maybeHandOff();
      const combat = game.combats.get(stage.combatId);
      const state = combat && readState(combat);
      if (state && strandedCheck(combat, state)) { show(combat, state); return; }
    } catch (e) {
      err("combat-intro: frame failed", e);
      teardown();
    }
  };
  stage.raf = requestAnimationFrame(step);
}

/**
 * At the end of the handoff every client tells its own rail where the cards
 * ended, so the rail's arrival starts from them. Fired locally, once, on the
 * clock: the GM's startCombat() follows a beat later.
 */
function maybeHandOff() {
  if (stage.handedOff || stage.phase !== "handoff") return;
  const combat = game.combats.get(stage.combatId);
  const state = readState(combat);
  if (!state || state.phase !== "handoff") return;
  if (!phaseClock(state, game.time.serverTime).done) return;
  stage.handedOff = true;
  const cards = stage.director?.handoffRects?.() ?? [];
  stage.director?.releasePresentation?.();
  lingerPresentation(combat.id);
  Hooks.callAll(HANDOFF_HOOK, { combatId: combat.id, late: !!state.late, cards });
}

/* ── input ─────────────────────────────────────────────────────────── */

function sendIntent(intent) {
  const msg = { type: MSG.intent, seqId: stage.seqId, ...intent };
  if (game.user.isGM && isConductor()) conductor.onIntent(msg, game.user.id);
  else emitSocket(FEATURE_ID, msg, { recipients: gmIds() });
}

function gmAction(action, payload = {}) {
  if (!game.user.isGM) return;
  if (!isConductor()) { ui.notifications?.warn(T("GLCI.warn.noGM")); return; }
  conductor.gm(action, payload);
}

/* ══════════════════════════════════════════════════════════════════════
   CONDUCTOR — the active GM
   ══════════════════════════════════════════════════════════════════════ */

const conductor = {
  /**
   * The GM-only half: { seqId, combatId, toggles: {slotId: {slug: bool}},
   * results: {slotId: fullResult}, held: {slotId: messageData}, seq: {slotId: n},
   * hidden: [{ combatantId, actorUuid, statistic }] }
   */
  private: null,
  queue: Promise.resolve(),
  timers: [],

  save() {
    try { localStorage.setItem(PRIVATE_KEY, JSON.stringify(this.private)); } catch { /* storage may be blocked */ }
  },
  restore(seqId) {
    try {
      const raw = JSON.parse(localStorage.getItem(PRIVATE_KEY) ?? "null");
      if (raw?.seqId === seqId) this.private = raw;
    } catch { /* ignore */ }
  },
  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  },
  at(serverAt, fn) {
    this.timers.push(setTimeout(fn, Math.max(0, serverAt - game.time.serverTime)));
  },

  /** Every write: re-read the flag, change it, write it back — one at a time. */
  mutate(combat, fn) {
    this.queue = this.queue.then(async () => {
      const state = readState(combat);
      if (!state) return;
      const next = await fn(structuredClone(state));
      if (next) await combat.update({ [`flags.${SUITE_ID}.${FLAG}`]: next });
    }).catch((e) => err("combat-intro: state write failed", e));
    return this.queue;
  },

  canStart(combat) {
    if (!readyDone || !dsnOk || !Suite.enabled(FEATURE_ID) || !game.user.isGM) return false;
    if (!combat || combat.started || !combat.combatants.size) return false;
    return !readState(combat);
  },

  async start(combat, { title = null } = {}) {
    if (!this.canStart(combat)) return null;
    if (!isConductor()) { ui.notifications?.warn(T("GLCI.warn.noGM")); return null; }
    const chosen = title ?? (await askTitle(combat));
    if (chosen == null) return null;
    const { slots, hidden } = await buildSlots(combat);
    if (!slots.length && !hidden.length) { ui.notifications?.warn(T("GLCI.warn.noCombatants")); return null; }
    const seqId = foundry.utils.randomID();
    this.clearTimers();
    this.private = { seqId, combatId: combat.id, toggles: {}, results: {}, held: {}, seq: {}, hidden };
    this.save();
    const at = game.time.serverTime + CUE_LEAD_MS;
    const state = {
      v: 1, id: seqId, combatId: combat.id, phase: "intro", at, skin: worldSkin(),
      intro: await buildIntro(combat, chosen, slots), slots, order: null, late: null,
    };
    await combat.update({ [`flags.${SUITE_ID}.${FLAG}`]: state });
    this.at(at + INTRO_MS, () => this.toRolling(combat, seqId));
    return seqId;
  },

  /** The GM-only half for this sequence, restored from storage or started fresh. */
  ensurePrivate(state, combat) {
    if (this.private?.seqId === state.id) return this.private;
    this.restore(state.id);
    this.private ??= { seqId: state.id, combatId: combat.id, toggles: {}, results: {}, held: {}, seq: {}, hidden: [] };
    if (this.private.seqId !== state.id) this.private = { seqId: state.id, combatId: combat.id, toggles: {}, results: {}, held: {}, seq: {}, hidden: [] };
    return this.private;
  },

  /** intro → rolling, then check at once: a table of only hidden creatures is ready immediately. */
  async toRolling(combat, seqId) {
    await this.advance(combat, seqId, "intro", "rolling");
    this.maybeSort(combat);
  },

  /** sorting → handoff, and the finish timed from the handoff's OWN stamp. */
  async toHandoff(combat, seqId) {
    await this.advance(combat, seqId, "sorting", "handoff");
    const state = readState(combat);
    if (state?.id === seqId && state.phase === "handoff") this.at(state.at + HANDOFF_MS + 150, () => this.finish(combat, seqId));
  },

  /** A combatant left mid-sequence: its slot goes, so the sort can still become ready. */
  async dropCombatant(combat, combatantId) {
    const state = readState(combat);
    const slot = state?.slots.find((s) => s.combatantId === combatantId);
    if (this.private?.hidden) this.private.hidden = this.private.hidden.filter((h) => h.combatantId !== combatantId);
    if (!slot) return;
    if (this.private) { delete this.private.results[slot.id]; delete this.private.held[slot.id]; this.save(); }
    await this.mutate(combat, (s) => ({ ...s, slots: s.slots.filter((x) => x.id !== slot.id) }));
    this.maybeSort(combat);
  },

  /** A combatant added while an unstarted sequence is open gets a slot (or a silent roll). */
  async addCombatant(combat, combatant) {
    const state = readState(combat);
    if (!state || state.late || !["intro", "rolling"].includes(state.phase)) return;
    this.ensurePrivate(state, combat);
    const { slots, hidden } = await buildSlots(combat, [combatant]);
    this.private.hidden.push(...hidden);
    this.save();
    if (slots.length) await this.mutate(combat, (s) => ({ ...s, slots: [...s.slots.filter((x) => !slots.some((n) => n.id === x.id)), ...slots] }));
  },

  /** A late reinforcement: the same table, no intro, one or more new cards. */
  async startLate(combat, combatants) {
    if (!isConductor() || readState(combat)) return;
    const { slots, hidden } = await buildSlots(combat, combatants);
    if (!slots.length) return;            // hidden or extra turns roll the ordinary way
    const seqId = foundry.utils.randomID();
    this.clearTimers();
    this.private = { seqId, combatId: combat.id, toggles: {}, results: {}, held: {}, seq: {}, hidden };
    this.save();
    const state = {
      v: 1, id: seqId, combatId: combat.id, phase: "rolling", at: game.time.serverTime + CUE_LEAD_MS, skin: worldSkin(),
      intro: { title: "", threat: null, party: [], hostiles: [] }, slots, order: null, late: slots[0].id,
    };
    await combat.update({ [`flags.${SUITE_ID}.${FLAG}`]: state });
  },

  advance(combat, seqId, from, to, patch = {}) {
    return this.mutate(combat, (state) => {
      if (state.id !== seqId || state.phase !== from || !canAdvance(from, to)) return null;
      return { ...state, ...patch, phase: to, at: game.time.serverTime + CUE_LEAD_MS };
    });
  },

  async onIntent(raw, attested) {
    if (!isConductor()) return;
    const msg = normalizeIntent(raw);
    const combat = game.combats.get(this.private?.combatId) ?? game.combat;
    const state = readState(combat);
    if (!msg || !state || msg.seqId !== state.id) return;
    this.ensurePrivate(state, combat);
    const user = game.users.get(attested);
    const slot = state.slots.find((s) => s.id === msg.slotId);
    if (!slot || !mayAct(user, slot, { owns }) || slot.throw) return;
    if (msg.op === "throw") {
      if (state.phase !== "rolling") return;
      return this.resolve(combat, slot.id);
    }
    if (!["intro", "rolling"].includes(state.phase)) return;
    if (msg.op === "stat") {
      if (slot.locked && !user.isGM) return;
      const allowed = slot.kind === "pc" ? slot.stats.some((s) => s.slug === msg.statistic) : NPC_STATS.includes(msg.statistic);
      if (!allowed) return;
      this.private.toggles[slot.id] = {};
      this.save();
      const mods = slot.kind === "pc" ? await this.probe(slot, msg.statistic) : [];
      return this.mutate(combat, (s) => patchSlot(s, slot.id, (x) => (x.throw ? null : { ...x, statistic: msg.statistic, mods })));
    }
    if (msg.op === "toggle" && slot.kind === "pc") {
      this.private.toggles[slot.id] = { ...(this.private.toggles[slot.id] ?? {}), [msg.slug]: msg.on };
      this.save();
      const mods = await this.probe(slot, slot.statistic);
      return this.mutate(combat, (s) => patchSlot(s, slot.id, (x) => (x.throw ? null : { ...x, mods })));
    }
  },

  async probe(slot, statistic) {
    const actor = await fromUuid(slot.actorUuid);
    const out = actor ? await probeInitiative(actor, statistic, this.private.toggles[slot.id] ?? {}) : null;
    return out?.mods ?? [];
  },

  async gm(action, payload = {}) {
    const combat = game.combats.get(this.private?.combatId) ?? game.combat;
    const state = readState(combat);
    if (!state) return;
    this.ensurePrivate(state, combat);
    switch (action) {
      case "skip":
        if (state.phase === "intro") { this.clearTimers(); return this.toRolling(combat, state.id); }
        return;
      case "lock":
        return this.mutate(combat, (s) => patchSlot(s, payload.slotId, (x) => ({ ...x, locked: !x.locked })));
      case "rollFor":
        if (state.phase === "rolling") return this.resolve(combat, payload.slotId);
        return;
      case "volley":
        if (state.phase !== "rolling") return;
        for (const s of state.slots.filter((x) => x.kind === "npc" && x.group === payload.group && !x.throw)) await this.resolve(combat, s.id);
        return;
      case "rest":
        if (state.phase === "intro") { this.clearTimers(); await this.toRolling(combat, state.id); }
        for (const s of state.slots.filter((x) => !x.throw)) await this.resolve(combat, s.id);
        this.maybeSort(combat);   // also retries a commit that failed
        return;
      case "cancel":
        return this.cancel(combat);
    }
  },

  /** Slots being rolled right now: a double-click, or a player's throw racing the GM's volley, rolls once. */
  inFlight: new Set(),

  async resolve(combat, slotId) {
    const state = readState(combat);
    const slot = state?.slots.find((s) => s.id === slotId);
    if (!slot || slot.throw || this.inFlight.has(slotId)) return;
    this.inFlight.add(slotId);
    try {
      this.ensurePrivate(state, combat);
      const kept = this.private.results[slotId];
      if (kept) {
        // Rolled, but the reload came before its throw stamp was written: replay it, never re-roll.
        return await this.announce(combat, state, slot, { ...kept, at: game.time.serverTime + CUE_LEAD_MS });
      }
      const actor = await fromUuid(slot.actorUuid);
      if (!actor) { await this.dropCombatant(combat, slot.combatantId); return; }
      let out;
      try {
        out = await rollInitiative(actor, slot.statistic, { toggles: this.private.toggles[slotId] ?? {} });
      } catch (e) {
        err("combat-intro: roll failed", e);
        ui.notifications?.error(F("GLCI.warn.rollFailed", { name: slot.name }));
        return;
      }
      const seq = (this.private.seq[slotId] = (this.private.seq[slotId] ?? 0) + 1);
      const full = {
        seqId: state.id, slotId, seq, at: game.time.serverTime + CUE_LEAD_MS, seed: Math.floor(Math.random() * 1e9), sealed: false,
        natural: out.natural, total: out.total, statistic: out.statistic, statLabel: out.statLabel, mods: out.mods,
      };
      this.private.results[slotId] = full;
      this.private.held[slotId] = out.held;
      this.save();
      await this.announce(combat, state, slot, full);
    } finally {
      this.inFlight.delete(slotId);
    }
  },

  /** Send one result to whoever may see it, play it here, stamp the throw, and check the sort. */
  async announce(combat, state, slot, full) {
    const { at, seed, seq } = full;
    const slotId = slot.id;
    // Who may see it: GMs always, everyone for a PC, nobody else for an NPC.
    const others = game.users.filter((u) => u.active && u.id !== game.user.id);
    const yes = others.filter((u) => entitled(u, slot)).map((u) => u.id);
    const no = others.filter((u) => !entitled(u, slot)).map((u) => u.id);
    if (yes.length) emitSocket(FEATURE_ID, { type: MSG.throw, result: full }, { recipients: yes });
    if (no.length) emitSocket(FEATURE_ID, { type: MSG.throw, result: sealResult(full) }, { recipients: no });
    applyResult(full);
    await this.mutate(combat, (s) => patchSlot(s, slotId, (x) => ({ ...x, throw: { at, seed, seq } })));
    this.maybeSort(combat);
  },

  maybeSort(combat) {
    const state = readState(combat);
    if (!state || state.phase !== "rolling") return;
    // No cards at all (every combatant hidden): nothing to wait for.
    const ready = state.slots.length ? sortReadyAt(state.slots) : game.time.serverTime;
    if (ready == null) return;
    this.at(ready, () => this.commitAndSort(combat, state.id));
  },

  async commitAndSort(combat, seqId) {
    const state = readState(combat);
    if (!state || state.id !== seqId || state.phase !== "rolling" || state.slots.some((s) => !s.throw)) return;
    if (this.sorting === seqId) return;
    this.sorting = seqId;
    this.ensurePrivate(state, combat);
    try {
      // Hidden combatants roll now, silently, with PF2e's own statistic.
      const hidden = [];
      for (const h of this.private.hidden ?? []) {
        const actor = await fromUuid(h.actorUuid);
        if (!actor) continue;
        try {
          const out = await rollInitiative(actor, h.statistic, { hidden: true });
          hidden.push({ combatantId: h.combatantId, total: out.total, statistic: out.statistic });
          this.private.held[`hidden:${h.combatantId}`] = out.held;
        } catch (e) { warn("combat-intro: hidden roll failed", e); }
      }
      const results = new Map(Object.entries(this.private.results));
      await commitInitiatives(combat, commitEntries(results, state.slots, hidden));
      // A boss's extra turns are placed by Boss Creatures off the boss's committed
      // initiative, on a hook of its own: the sort waits for them, so it plays the
      // order the rail will really show.
      await settleBossTurns(combat, state.slots);
      await this.postCards(combat);
      const order = orderFrom(combat.turns, state.slots);
      const rail = combat.turns.map((c) => c.id);
      await this.advance(combat, seqId, "rolling", "sorting", { order, rail });
      const sorted = readState(combat);
      if (sorted?.phase === "sorting") this.at(sorted.at + SORT_MS, () => this.toHandoff(combat, seqId));
    } catch (e) {
      // A timer callback has nobody to throw to: say so, and leave "Roll remaining" as the retry.
      err("combat-intro: commit failed", e);
      ui.notifications?.error(T("GLCI.warn.commitFailed"));
    } finally {
      this.sorting = null;
    }
  },

  /** PF2e's own cards, held since the roll, posted as the sort begins. */
  async postCards(combat) {
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    for (const [key, held] of Object.entries(this.private.held ?? {})) {
      if (!held) continue;
      const combatantId = key.startsWith("hidden:") ? key.slice(7) : readState(combat)?.slots.find((s) => s.id === key)?.combatantId;
      const combatant = combat.combatants.get(combatantId);
      try {
        await postHeld(held, { ...cardAudience(combatant, gms), reqId: this.private.seqId, slot: combatantId });
      } catch (e) { err("combat-intro: could not post an initiative card", e); }
      this.private.held[key] = null;
    }
    this.save();
  },

  async finish(combat, seqId) {
    const state = readState(combat);
    // Only ever from the handoff: a sort that failed to write must not start the combat unseen.
    if (!state || state.id !== seqId || state.phase !== "handoff") return;
    this.clearTimers();
    try {
      if (!state.late && !combat.started) await combat.startCombat();
    } finally {
      await combat.unsetFlag(SUITE_ID, FLAG);
      this.private = null;
      try { localStorage.removeItem(PRIVATE_KEY); } catch { /* ignore */ }
    }
  },

  /**
   * End a sequence from anywhere (the close button). Before the commit nothing
   * was written, so it cancels; after it the values stand and the combat starts.
   */
  async abort(combat, state) {
    this.clearTimers();
    if (["sorting", "handoff"].includes(state.phase)) {
      this.private = null;
      try { localStorage.removeItem(PRIVATE_KEY); } catch { /* ignore */ }
      if (!state.late && !combat.started) await combat.startCombat();
      if (readState(combat)) await combat.unsetFlag(SUITE_ID, FLAG);
      return;
    }
    return this.cancel(combat);
  },

  /** Cancel: nothing was committed, so nothing is written but the flag's removal. */
  async cancel(combat) {
    this.clearTimers();
    this.private = null;
    try { localStorage.removeItem(PRIVATE_KEY); } catch { /* ignore */ }
    if (readState(combat)) await combat.unsetFlag(SUITE_ID, FLAG);
  },

  /** Answer a late client with what it may see of each thrown slot. */
  sync(attested) {
    const combat = game.combats.get(this.private?.combatId) ?? game.combat;
    const state = readState(combat);
    const user = game.users.get(attested);
    if (!state || !user || this.private?.seqId !== state.id) return;
    for (const full of Object.values(this.private.results ?? {})) {
      const slot = state.slots.find((s) => s.id === full.slotId);
      if (!slot) continue;
      emitSocket(FEATURE_ID, { type: MSG.throw, result: entitled(user, slot) ? full : sealResult(full) }, { recipients: [user.id] });
    }
  },
};

function patchSlot(state, slotId, fn) {
  const i = state.slots.findIndex((s) => s.id === slotId);
  if (i < 0) return null;
  const next = fn(state.slots[i]);
  if (!next) return null;
  state.slots[i] = next;
  return state;
}

/* ── building a sequence (GM) ──────────────────────────────────────── */

function compendiumSource(actor) {
  const base = actor?.isToken ? (actor.token?.baseActor ?? actor) : actor;
  const s = base?._stats?.compendiumSource ?? base?.flags?.core?.sourceId ?? null;
  return typeof s === "string" && s.startsWith("Compendium.") ? s : null;
}

/** The tracker's own visibility rules: an explicit "hidden", or a GM-hidden token, never appears. */
function visibilityOf(c) {
  const mode = c.getFlag(SUITE_ID, INIT_FLAGS.visibility) || VISIBILITY.auto;
  const foundryHidden = !!(c.hidden || c.token?.hidden);
  return { hidden: mode === VISIBILITY.hidden || foundryHidden, mystery: mode === VISIBILITY.mystery };
}

/**
 * Boss Creatures creates and moves a boss's extra turns when the boss's
 * initiative changes. Resolves once the combat has been quiet for a beat (or
 * after a cap), so the sort reads them. Nothing to wait for without a boss.
 */
function settleBossTurns(combat, slots) {
  if (!slots.some((s) => s.boss)) return Promise.resolve();
  return new Promise((resolve) => {
    let quiet = 0;
    const hooks = ["createCombatant", "updateCombatant", "deleteCombatant"].map((h) => [h, Hooks.on(h, (c) => { if (c?.parent === combat) poke(); })]);
    const finish = () => { clearTimeout(quiet); clearTimeout(cap); for (const [h, id] of hooks) Hooks.off(h, id); resolve(); };
    const poke = () => { clearTimeout(quiet); quiet = setTimeout(finish, 400); };
    const cap = setTimeout(finish, 2500);
    poke();
  });
}

async function buildSlots(combat, only = null) {
  const slots = [], hidden = [];
  for (const c of only ?? combat.combatants) {
    const actor = c.actor;
    if (!actor || c.defeated || isExtraTurn(c)) continue;
    const statistic = defaultStatistic(actor);
    const vis = visibilityOf(c);
    if (vis.hidden) { hidden.push({ combatantId: c.id, actorUuid: actor.uuid, statistic }); continue; }
    const isPC = !!actor.hasPlayerOwner;
    const owner = isPC ? (game.users.find((u) => !u.isGM && u.character?.id === actor.id) ?? game.users.find((u) => !u.isGM && actor.testUserPermission(u, "OWNER"))) : null;
    const probe = isPC ? await probeInitiative(actor, statistic).catch(() => null) : null;
    const slot = publicSlot({
      combatantId: c.id, actorUuid: actor.uuid, tokenUuid: c.token?.uuid ?? "",
      hidden: false, tokenHidden: false, isPC,
      ownerId: owner?.id ?? null, appearanceUserId: owner?.id ?? game.user.id,
      // The actor's portrait, as the rail shows it (never the token art): the card
      // the sort hands over is the same picture the rail card carries.
      name: c.name ?? actor.name, img: actor.img,
      maskedName: vis.mystery ? T("GLUNI.Unknown") : (c.name ?? actor.name), maskedImg: vis.mystery ? "" : actor.img,
      side: isPC ? "party" : getDisposition(c, vis.mystery),
      // A mystery card must not say "boss" any more than the rail's does.
      boss: isPC || vis.mystery ? null : bossBadge(actor),
      // A mystified creature's kind would name it in the flag and the DOM, so it gets one of its own.
      kind: vis.mystery ? { name: `mystery-${c.id}` } : { sourceId: compendiumSource(actor), name: actor.name, level: actor.level ?? actor.system?.details?.level?.value ?? null },
      statistic, locked: false,
      stats: isPC ? statisticsOf(actor) : [], mods: probe?.mods ?? [],
    });
    if (slot) slots.push(slot);
  }
  return { slots, hidden };
}

async function buildIntro(combat, title, slots) {
  let threat = null;
  if (Suite.enabled("flatfinder")) {
    try {
      const { computeEncounter } = await import("../flatfinder/encounter.js");
      const enc = computeEncounter(combat);
      if (enc) threat = { severity: enc.severity, xp: enc.totalXp, budget: enc.budget?.[enc.severity] ?? 0 };
    } catch (e) { warn("combat-intro: threat unavailable", e); }
  }
  // Friendly creatures stand with the party; neutral and hostile ones across from
  // it, a boss at the head of its side.
  const groups = npcGroups(slots);
  const item = (g) => ({ name: g.name, img: g.img, count: g.slotIds.length, side: g.side, boss: g.boss });
  const party = [
    ...slots.filter((s) => s.kind === "pc").map((s) => ({ name: s.name, img: s.img, count: 1, side: "party", boss: null })),
    ...groups.filter((g) => g.side === "friendly").map(item),
  ];
  const hostiles = groups.filter((g) => g.side !== "friendly").map(item).sort((a, b) => (b.boss ? 1 : 0) - (a.boss ? 1 : 0));
  return { title, threat, party, hostiles };
}

/** The GM names the encounter (prefilled from the scene); null = cancelled. */
async function askTitle(combat) {
  const fallback = combat.scene?.name ?? game.scenes.viewed?.name ?? "";
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return fallback;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  try {
    const out = await DialogV2.wait({
      window: { title: T("GLCI.dialog.title"), icon: "fa-solid fa-clapperboard" },
      content: `<div class="form-group"><label>${esc(T("GLCI.dialog.encounterTitle"))}</label><input type="text" name="title" value="${esc(fallback)}" autofocus></div>`,
      buttons: [
        { action: "start", label: T("GLCI.dialog.start"), icon: "fa-solid fa-play", default: true, callback: (_e, button) => button.form.elements.title.value.trim() },
        { action: "cancel", label: T("GLCI.dialog.cancel"), callback: () => null },
      ],
      rejectClose: false,
    });
    return typeof out === "string" ? out : null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Hooks and lifecycle
   ══════════════════════════════════════════════════════════════════════ */

function onCombatChanged(combat) {
  if (!readyDone) return;
  if (combat.id !== game.combat?.id && combat.id !== stage.combatId) return;
  const state = readState(combat);
  if (state) { show(combat, state); return; }
  if (stage.combatId === combat.id) {
    // The flag went away: a finish after the handoff, or a cancel.
    if (!stage.handedOff && stage.phase === "handoff") maybeHandOffNow(combat);
    teardown();
  }
}

function maybeHandOffNow(combat) {
  stage.handedOff = true;
  const cards = stage.director?.handoffRects?.() ?? [];
  stage.director?.releasePresentation?.();
  lingerPresentation(combat.id);
  Hooks.callAll(HANDOFF_HOOK, { combatId: combat.id, late: false, cards });
}

/** Reinforcements: combatants created after the start get a small roll moment. */
const lateBatch = { combat: null, list: [], timer: 0 };
function onCombatantCreated(combatant) {
  if (!readyDone || !dsnOk || !isConductor() || !Suite.enabled(FEATURE_ID)) return;
  const combat = combatant.parent;
  if (!combat || isExtraTurn(combatant)) return;
  // Added while an unstarted sequence is open: it joins that table.
  if (!combat.started && readState(combat)) { conductor.addCombatant(combat, combatant).catch((e) => err("combat-intro: could not add a combatant", e)); return; }
  if (!combat.started || readState(combat) || combatant.initiative != null) return;
  if (lateBatch.combat && lateBatch.combat !== combat) return;
  lateBatch.combat = combat;
  lateBatch.list.push(combatant);
  clearTimeout(lateBatch.timer);
  lateBatch.timer = setTimeout(() => {
    const { combat: c, list } = lateBatch;
    lateBatch.combat = null;
    lateBatch.list = [];
    // Read initiative at FIRE time: PF2e's fromActor creates the combatant first and rolls it a
    // moment later, and a GM's "Roll NPCs" may land inside the window too. Those already rolled.
    const fresh = list.filter((x) => c.combatants.get(x.id) && c.combatants.get(x.id).initiative == null);
    if (fresh.length) conductor.startLate(c, fresh).catch((e) => err("combat-intro: late roll failed", e));
  }, 400);
}

export function registerSettings() {
  const s = (key, data) => game.settings.register(SUITE_ID, key, data);
  s(SETTINGS.cssOnly, { name: "GLCI.settings.cssOnly.name", hint: "GLCI.settings.cssOnly.hint", scope: "client", config: true, type: Boolean, default: false, requiresReload: true });
  s(SETTINGS.volume, { name: "GLCI.settings.volume.name", hint: "GLCI.settings.volume.hint", scope: "world", config: true, type: Number, range: { min: 0, max: 1, step: 0.05 }, default: 0.8, onChange: () => { stage.soundSkin = null; } });
  for (const cue of CUES) {
    s(`${SOUND_PREFIX}${cue}`, {
      name: `GLCI.settings.sound.${cue}.name`, hint: `GLCI.settings.sound.${cue}.hint`,
      scope: "world", config: true, type: String, default: "", filePicker: "audio",
      onChange: () => { stage.soundSkin = null; },
    });
  }
}

export function onInit() {
  Hooks.on("updateCombat", (combat) => onCombatChanged(combat));
  Hooks.on("deleteCombat", (combat) => {
    if (stage.combatId === combat.id) teardown();
    if (conductor.private?.combatId === combat.id) conductor.cancel(combat).catch(() => {});
  });
  Hooks.on("createCombatant", (combatant) => onCombatantCreated(combatant));
  Hooks.on("deleteCombatant", (combatant) => {
    if (readyDone && isConductor() && readState(combatant.parent)) conductor.dropCombatant(combatant.parent, combatant.id).catch(() => {});
  });
  // A GM who takes over as the active GM picks the sequence's clock up.
  Hooks.on("userConnected", () => {
    if (!readyDone || !isConductor()) return;
    const combat = game.combat, state = readState(combat);
    if (state && !conductor.timers.length) resumeConductor(combat, state);
  });
  Hooks.on("canvasReady", () => {
    const combat = game.combat;
    if (stage.combatId && stage.combatId !== combat?.id) teardown();
    if (combat) onCombatChanged(combat);
  });
}

export async function onReady() {
  const dsn = game.modules.get(DSN_ID);
  const major = Number(String(dsn?.version ?? "0").split(".")[0]);
  if (!dsn?.active || major < DSN_MIN_MAJOR) {
    warn(`combat-intro needs Dice So Nice ${DSN_MIN_MAJOR}.x or newer; it stands down.`);
    return;
  }
  if (!installCheckWrapper()) {
    warn("combat-intro: PF2e's Check.roll is not available; it stands down.");
    return;
  }
  dsnOk = true;
  onSocket(FEATURE_ID, (payload, _claimed, meta) => {
    // Results come from the GM's client only; a forged one with a high seq would lock the real one out.
    if (payload?.type === MSG.throw) return game.users.get(meta?.attested)?.isGM ? applyResult(payload.result) : undefined;
    if (!game.user.isGM || !meta?.attested) return;
    if (payload?.type === MSG.intent) return conductor.onIntent(payload, meta.attested);
    if (payload?.type === MSG.sync) return conductor.sync(meta.attested);
  });
  buildRoot();
  readyDone = true;
  // Warm what the first sequence needs, at idle.
  const idle = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500));
  idle(async () => {
    try {
      const mods = await loadModules();
      await ensureBackdrop(mods.skins.skinFor(worldSkin()));
    } catch (e) { warn("combat-intro: warm-up failed", e); }
  }, { timeout: 5000 });
  // Re-render the rail so its Start button can appear now that we are ready.
  Hooks.callAll("gluniverse.combatIntro.ready");
  const combat = game.combat;
  const state = readState(combat);
  if (state) {
    if (game.user.isGM) {
      conductor.restore(state.id);
      if (isConductor()) resumeConductor(combat, state);
    }
    show(combat, state);
  }
}

/** A GM who reloaded mid-sequence picks the clock back up. */
function resumeConductor(combat, state) {
  const p = conductor.private;
  if (!p || p.seqId !== state.id) {
    conductor.ensurePrivate(state, combat);
    // The private half is gone. While rolling, a thrown slot whose result is
    // lost goes back to "ready" so it can be rolled again; past the roll the
    // values are already committed, so the clock simply carries on.
    if (state.phase === "rolling") conductor.mutate(combat, (s) => ({ ...s, slots: s.slots.map((x) => ({ ...x, throw: null })) }));
  }
  if (state.phase === "intro") conductor.at(state.at + INTRO_MS, () => conductor.toRolling(combat, state.id));
  if (state.phase === "rolling") conductor.maybeSort(combat);
  if (state.phase === "sorting") conductor.at(state.at + SORT_MS, () => conductor.toHandoff(combat, state.id));
  if (state.phase === "handoff") conductor.at(state.at + HANDOFF_MS + 150, () => conductor.finish(combat, state.id));
}

/** Public API: game.modules.get(SUITE_ID).api.features["combat-intro"]. The rail's Start button calls these. */
export const api = {
  canStart: (combat) => conductor.canStart(combat),
  start: (combat, options) => conductor.start(combat, options),
  cancel: (combat = game.combat) => (game.user.isGM ? conductor.cancel(combat) : null),
  /** Diagnostics for a live session. */
  inspect: () => ({
    seqId: stage.seqId, phase: stage.phase, paused: stage.paused, raf: !!stage.raf,
    backdrop: stage.backdrop?.report ?? null, dice: !!stage.dice?.ok, handedOff: stage.handedOff,
    conductor: conductor.private ? { seqId: conductor.private.seqId, results: Object.keys(conductor.private.results ?? {}).length } : null,
  }),
};
