/**
 * PF2e HUD — the Foundry host.
 *
 * One `.gph` root over the canvas, between Foundry's left and right columns.
 * It reads the subject through read.mjs, draws `RAIL` when the model's shape
 * changes and drives the drawn rail when only values moved (shape.mjs), and
 * answers every press with PF2e's own entry point:
 *
 *   check        actor.perception.roll / actor.saves[x].roll / actor.skills[x].roll
 *   strike       actor.system.actions[i].variants[map].roll, .damage, .critical
 *   blast        new game.pf2e.ElementalBlast(actor).attack / .damage
 *   skill action game.pf2e.actions.get(slug).use({ actors, statistic, multipleAttackPenalty })
 *                (the legacy game.pf2e.actions[camelCase] where 8.7 has no action object)
 *   spell        actor.spellcasting.get(entry).cast(spell, { rank, slotId })
 *   action/feat  game.pf2e.rollItemMacro(uuid) — PF2e's "use": frequency, self-effect
 *   consumable   item.consume()
 *   toggle       actor.toggleRollOption(domain, option, itemId, value)
 *   raise shield game.pf2e.actions.raiseAShield({ actors })
 *   reload       game.pf2eRangedCombat.reload() (PF2e Ranged Combat, when it runs)
 *   rest         game.pf2e.actions.restForTheNight({ actors })
 *
 * No roll dialog of its own, and nothing written but what those calls write,
 * the Hero Points, the exploration activity, and the `ph.` keys (settings.mjs).
 * Every press the view can draw is in presses.mjs; the check tool holds the
 * two to each other, and `onClick` below answers each.
 */
import { SUITE_ID, warn } from "../../core/const.mjs";
import * as V from "./view.mjs";
import * as D from "./drive.mjs";
import * as S from "./shape.mjs";
import * as K from "./skill-actions.mjs";
import { TIMING } from "./const.mjs";
import { RailLight } from "./light.mjs";
import { momentsOf, playMoments } from "./moments.mjs";
import { costOf, readGM, readPlayer, SKILLS, withSkills } from "./read.mjs";
import { Turn, economyOf, turnKey, upNext } from "./turn.mjs";
import { answers, echoOf } from "./echo.mjs";
import { combatOf, isTurnOf, subjectOf } from "./subject.mjs";
import { actionPeek, effectRows, inventoryRows, macroSlots, spellPeek, strikePeek } from "./peeks.mjs";
import { FLAGS, SETTINGS, setting } from "./settings.mjs";
import { clearKnowledgeCache, knownStat } from "../pf2e-odds/knowledge.mjs";
import { nameFor, seesTruth } from "../pf2e-odds/view.mjs";
import { metagame } from "../pf2e-odds/observe.mjs";

/** PF2e Ranged Combat is running and offers its Reload action. */
const rangedCombat = () => !!(game.modules.get("pf2e-ranged-combat")?.active && typeof game.pf2eRangedCombat?.reload === "function");


const list = (v) => (Array.isArray(v) ? v : v ? Array.from(v) : []);
const t = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const loc = (k) => (typeof k === "string" ? game.i18n.localize(k) : "");
const camel = (slug) => slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const str = (v) => (v == null ? "" : String(v));
/* Core's tracker setting: Next Turn passes over the defeated. */
const skipDefeated = () => { try { return !!game.settings.get("core", "combatTrackerConfig")?.skipDefeated; } catch { return false; } };
/* PF2e's reroll (a Hero Point, a mythic point) posts a new message whose
   check context says so; it answers the press the first roll echoed on. */
const isReroll = (m) => !!(m?.flags?.pf2e?.context?.isReroll || m?.rolls?.[0]?.options?.isReroll);
const safe = async (fn) => { try { return await fn(); } catch { return null; } };
const range = (r) => (r && Number.isFinite(r.lo) && Number.isFinite(r.hi) ? (r.lo === r.hi ? r.lo : { lo: r.lo, hi: r.hi }) : null);
const WORDS = () => [0, 1, 2, 3].map((i) => t(`GLRAIL.degree.${i}`));

/** The truth about one defence, read off the actor (GMs, and allies). */
function trueStat(a, stat) {
  if (stat === "ac") return a.armorClass?.value ?? a.system?.attributes?.ac?.value ?? null;
  if (stat === "perception") return a.perception?.dc?.value ?? null;
  if (a.saves?.[stat]) return a.saves[stat].dc?.value ?? null;
  return a.skills?.[stat]?.dc?.value ?? null;
}

export class RailHost {
  constructor({ stream = false } = {}) {
    this.stream = stream;
    this.el = null;
    this.model = null;
    this.prev = null;
    this.subjectKey = null;
    this.turns = new Map();
    this.views = new Map();
    this.cache = new Map();
    this.open = { drawer: null };
    this.peek = null;
    this.fs = { open: false, query: "", group: "all", sel: 0, settled: false, expanded: [] };
    this.pending = null;
    /* the press the last roll echoed on: a Hero Point spent on its reroll streaks there */
    this.lastEcho = null;
    /* the turn the GM's screen last read (undefined until the first read) */
    this.gmKey = undefined;
    this.fresh = false;
    this.hooks = [];
    this.gen = 0;
    this.raf = 0;
    this.peekT = 0;
    this.light = new RailLight();
  }

  /* ── lifecycle ──────────────────────────────────────────────── */

  mount() {
    if (this.el) return;
    const el = document.createElement("div");
    el.id = "gph-host";
    Object.assign(el.style, { position: "fixed", top: "0", bottom: "0", left: "0", right: "0", pointerEvents: "none", zIndex: "var(--gl-z-hud)" });
    document.body.append(el);
    this.el = el;
    el.addEventListener("click", (e) => this.onClick(e));
    el.addEventListener("input", (e) => this.onInput(e));
    el.addEventListener("contextmenu", (e) => this.onContext(e));
    el.addEventListener("pointerover", (e) => this.onOver(e));
    el.addEventListener("pointerout", (e) => this.onOut(e));
    this.keyH = (e) => this.onKey(e);
    document.addEventListener("keydown", this.keyH, true);
    this.resizeH = () => { this.place(); this.publishEdge(); };
    window.addEventListener("resize", this.resizeH);
    this.wire();
    this.place();
    this.dock();
    this.schedule();
  }

  unmount() {
    for (const [hook, id] of this.hooks) Hooks.off(hook, id);
    this.hooks = [];
    document.removeEventListener("keydown", this.keyH, true);
    window.removeEventListener("resize", this.resizeH);
    this.light.dispose();
    this.light = new RailLight();
    this.el?.remove();
    this.el = null;
    this.dock(false);
    document.body.style.removeProperty("--gph-rail-top");
  }

  on(hook, fn) { this.hooks.push([hook, Hooks.on(hook, fn)]); }

  /** The hooks that move the model, every one throttled to a frame. An
   *  actor's damage formulas and spell sheet data are cached until that
   *  actor (or an item on it) changes. */
  wire() {
    const stale = (doc) => {
      const actor = doc?.documentName === "Actor" ? doc : doc?.parent?.documentName === "Actor" ? doc.parent : doc?.actor ?? null;
      if (actor) this.cache.delete(actor.uuid); else this.cache.clear();
      this.schedule();
    };
    for (const h of ["updateActor", "createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) this.on(h, stale);
    for (const h of ["updateCombat", "createCombat", "deleteCombat", "combatStart", "createCombatant", "updateCombatant", "deleteCombatant",
      "targetToken", "controlToken", "createToken", "deleteToken", "canvasReady"]) this.on(h, () => this.schedule());
    this.on("updateToken", (doc, change) => { if (["name", "disposition", "hidden", "actorId", "ring", "texture", "x", "y"].some((k) => k in (change ?? {}))) this.schedule(); });
    this.on("updateUser", (user, change) => { if (user.id === game.user.id && ("character" in change || "flags" in change)) this.schedule(); });
    this.on("createChatMessage", (m) => this.onMessage(m));
    this.on("pf2eRangedCombatReload", (actor) => this.onReloaded(actor));
    this.on("renderHotbar", () => this.dock());
    this.on("renderPlayers", () => this.dock());
    this.on("collapseSidebar", () => requestAnimationFrame(() => { this.place(); this.publishEdge(); }));
    /* What the party knows (PF2e Odds' ledger, a Creaturedex reveal) moves the
       finder's chances, whether or not the Odds feature is on to notice. */
    this.on("updateSetting", (setting) => {
      const key = String(setting?.key ?? "");
      if (key.endsWith(".od.ledger") || key.endsWith(".od.partyKnowledge") || key.includes(".dex.")) { clearKnowledgeCache(); this.schedule(); }
    });
    this.on("clientSettingChanged", (key) => { if (String(key).startsWith(`${SUITE_ID}.ph.`)) { this.dock(); this.schedule(); } });
  }

  /** One refresh per frame however many hooks fire. A background tab starves
   *  animation frames, so a timer stands behind the frame: whichever comes
   *  first runs, and an alt-tabbed player comes back to a current rail. */
  schedule() {
    if (this.raf || !this.el) return;
    const run = () => {
      if (!this.raf) return;
      cancelAnimationFrame(this.raf); clearTimeout(this.rafT);
      this.raf = 0;
      this.refresh().catch((e) => warn("PF2e HUD |", e));
    };
    this.raf = requestAnimationFrame(run);
    this.rafT = setTimeout(run, TIMING.refreshFallback);
  }

  /** The rail stands in the bottom-left corner, where Foundry's player list
   *  was, and runs to the right column, wherever it is now. A kept player
   *  list keeps its corner, and the rail starts beside it. */
  place() {
    if (!this.el) return;
    const mid = document.getElementById("ui-middle")?.getBoundingClientRect?.();
    const pl = document.getElementById("players");
    const kept = pl && pl.style.display !== "none" ? pl.getBoundingClientRect() : null;
    this.el.style.left = `${kept?.width ? Math.round(kept.right) : 0}px`;
    this.el.style.right = `${Math.max(0, Math.round(mid ? innerWidth - mid.right : 0))}px`;
  }

  /** Foundry's hotbar and player list sit where the rail does, so while a
   *  rail is drawn both are hidden (each behind its own setting) and given
   *  back when it is not. The Macros drawer shows the hotbar. */
  dock(drawn = !!this.el && !!this.model) {
    const hide = (id, key) => {
      const el = document.getElementById(id);
      const off = drawn && setting(key, true);
      if (el) el.style.display = off ? "none" : "";
      return off;
    };
    hide("hotbar", SETTINGS.hideHotbar);
    const players = hide("players", SETTINGS.hidePlayers);
    if (players !== this.playersOff) { this.playersOff = players; this.place(); }
  }

  /** Other docked UI sits above the rail: the distance from the bottom of the
   *  viewport to the top of its plates, as `--gph-rail-top` on body. */
  publishEdge() {
    const r = this.el?.querySelector(".gph-rail")?.getBoundingClientRect?.();
    if (r && r.height > 0) document.body.style.setProperty("--gph-rail-top", `${Math.round(innerHeight - r.top)}px`);
    else document.body.style.removeProperty("--gph-rail-top");
  }

  /* ── reading ────────────────────────────────────────────────── */

  subjectNow() {
    const isGM = !!game.user.isGM;
    const sceneTokens = canvas?.tokens?.placeables ?? [];
    const s = subjectOf({
      isGM, controlled: canvas?.tokens?.controlled ?? [], character: game.user.character ?? null,
      owned: (a) => a.isOwner, sceneTokens,
    });
    if (s?.role === "gm" && !setting(SETTINGS.gmRail, true)) return null;
    return s;
  }

  async dataOf(actor) {
    let c = this.cache.get(actor.uuid);
    if (!c) { c = this.load(actor); this.cache.set(actor.uuid, c); }
    return c;
  }

  /** What only an async PF2e call can say: the damage formulas (as PF2e's own
   *  sheet gets them, `getFormula`), the blasts and the spellcasting sheet data. */
  async load(actor) {
    const formulas = new Map();
    const jobs = list(actor.system?.actions).map(async (a, i) => {
      if (a?.type !== "strike") return;
      formulas.set(String(i), { damage: str(await safe(() => a.damage?.({ getFormula: true }))), critical: str(await safe(() => a.critical?.({ getFormula: true }))) });
    });
    let blasts = null;
    const EB = game.pf2e?.ElementalBlast;
    if (EB && list(actor.itemTypes?.action).some((i) => i.slug === "elemental-blast")) {
      try {
        const eb = new EB(actor);
        blasts = list(eb.configs).map((c) => ({ ...c, elementLabel: CONFIG.PF2E.elementTraits?.[c.element] ?? c.element }));
        for (const c of blasts) {
          const damageType = (list(c.damageTypes).find((d) => d.selected) ?? list(c.damageTypes)[0])?.value;
          for (const melee of [true, false]) {
            const id = `blast:${c.element}:${melee ? "m" : "r"}`;
            jobs.push((async () => formulas.set(id, {
              damage: str(await safe(() => eb.damage({ element: c.element, damageType, melee, getFormula: true }))),
              critical: str(await safe(() => eb.damage({ element: c.element, damageType, melee, outcome: "criticalSuccess", getFormula: true }))),
            }))());
          }
        }
      } catch (e) { warn("PF2e HUD | elemental blast", e); }
    }
    const spells = [];
    for (const entry of list(actor.spellcasting?.regular)) {
      const d = await safe(() => entry.getSheetData());
      if (d) spells.push({ id: entry.id, name: entry.name, isPrepared: !!d.isPrepared, isSpontaneous: !!d.isSpontaneous, isFlexible: !!d.isFlexible, isInnate: !!d.isInnate, isFocusPool: !!d.isFocusPool, isRitual: !!d.isRitual, dc: entry.statistic?.dc?.value ?? null, atk: entry.statistic?.check?.mod ?? entry.statistic?.mod ?? null, groups: d.groups });
    }
    await Promise.all(jobs);
    return { formulas, blasts, spells };
  }

  viewOf(actor) {
    if (!this.views.has(actor.uuid)) this.views.set(actor.uuid, { tab: null, rank: null });
    return this.views.get(actor.uuid);
  }

  turnOf(actor) {
    if (!this.turns.has(actor.uuid)) this.turns.set(actor.uuid, new Turn());
    return this.turns.get(actor.uuid);
  }

  pinsOf(actor) { return list(game.user.getFlag(SUITE_ID, FLAGS.pins)?.[actor.id]); }

  targetFor(actor, truth) {
    const tk = list(game.user.targets).find((x) => x.actor && x.actor !== actor);
    if (!tk) return { target: null, know: () => null };
    const a = tk.actor;
    const name = nameFor(tk, a) || t("GLRAIL.skill.target");
    const id = a.identificationDCs;
    const target = { name, img: truth ? a.img : tk.document?.texture?.src ?? a.img, recallSkill: list(id?.skills)[0] ?? null, recallDC: id?.standard?.dc ?? null, actor: a };
    const know = (stat) => {
      if (truth || a.hasPlayerOwner) return trueStat(a, stat);
      try { return range(knownStat(a, stat).range); } catch { return null; }
    };
    return { target, know };
  }

  partyOf(self, combat) {
    const members = list(game.actors?.party?.members).filter((a) => a?.type === "character");
    const pcs = members.length ? members : list(game.actors).filter((a) => a.type === "character" && a.hasPlayerOwner);
    return pcs.filter((a) => a.id !== self?.id).map((a) => ({
      actor: a, observe: game.user.isGM || a.testUserPermission(game.user, "OBSERVER"),
      turn: !!combat?.started && combat.combatant?.actorId === a.id,
    }));
  }

  common() {
    return { t, loc, config: CONFIG.PF2E, stamina: !!game.pf2e?.settings?.variants?.stamina, ranged: rangedCombat() };
  }

  async readNow(subj) {
    const { actor, token } = subj;
    if (subj.role === "gm") {
      const combat = game.combat?.started ? game.combat : null;
      const k = turnKey(combat);
      this.fresh = !!k && this.gmKey !== undefined && k !== this.gmKey;
      this.gmKey = k;
      const { target, know } = this.targetFor(actor, true);
      const tokens = canvas?.tokens?.placeables ?? [];
      const data = actor ? await this.dataOf(actor) : { formulas: new Map() };
      return readGM({
        ...this.common(), actor, token, name: token?.name, formulas: data.formulas, tokens, selected: token?.id ?? null,
        turnTokenId: combat?.combatant?.tokenId ?? null, target, know, party: this.partyOf(null, combat), pins: actor ? this.pinsOf(actor) : [],
      });
    }
    const combat = combatOf(game.combats?.contents ?? [], actor, token, canvas?.scene?.id);
    const mine = !!combat && isTurnOf(combat.combatant, actor, token);
    const next = !!combat && !mine && upNext(list(combat.turns), combat.turn, (c) => isTurnOf(c, actor, token), { skipDefeated: skipDefeated() });
    const turn = this.turnOf(actor);
    this.fresh = turn.sync(turnKey(combat), mine) && this.subjectKey === `player:${actor.uuid}`;
    const base = economyOf(list(actor.itemTypes?.condition));
    const truth = seesTruth();
    const { target, know } = this.targetFor(actor, truth);
    const data = await this.dataOf(actor);
    const v = this.viewOf(actor);
    const cb = combat?.combatant;
    const veiled = !truth && !!(cb?.hidden || cb?.token?.hidden);
    const current = cb ? (veiled ? t("GLRAIL.turnbar.someone") : nameFor(cb.token, cb.actor) || t("GLRAIL.skill.target")) : "";
    this.combatNow = combat ?? null;
    return readPlayer({
      ...this.common(), actor, token, readonly: !actor.isOwner, mode: combat ? "encounter" : "exploration",
      turn: combat ? { mine, next, current, round: combat.round } : null, econ: turn.economy(base), map: mine ? turn.map : 0,
      formulas: data.formulas, blasts: data.blasts, spells: data.spells, rank: v.rank, tab: v.tab,
      target, know, truth, party: this.partyOf(actor, combat), pins: this.pinsOf(actor),
      frame: actor.getFlag(SUITE_ID, FLAGS.frame) ?? null, folded: setting(SETTINGS.folded, false),
    });
  }

  async refresh() {
    if (!this.el) return;
    const gen = ++this.gen;
    const subj = this.subjectNow();
    if (!subj) { this.clear(); return; }
    const model = await this.readNow(subj);
    if (gen !== this.gen || !this.el) return;
    const key = `${subj.role}:${subj.actor?.uuid ?? ""}`;
    this.subj = subj;
    if (key !== this.subjectKey) {
      this.subjectKey = key;
      this.fs = { ...this.fs, open: false };
      this.open.drawer = null; this.peek = null;
      this.model = model;
      this.render({ arrive: true });
    } else {
      const was = this.model;
      this.update(model);
      playMoments(this.root, momentsOf(was, model, { fresh: this.fresh }), { light: this.light, heroAt: () => this.heroAt() });
    }
    this.fresh = false;
  }

  clear() {
    this.model = this.prev = null; this.subjectKey = null; this.subj = null;
    if (this.el) this.el.innerHTML = "";
    this.dock();
    this.publishEdge();
  }

  /* ── drawing (the preview's compose/render/update) ─────────── */

  finder(query = this.fs.query, group = this.fs.group) {
    const m = this.model;
    if (!m?.sk) return null;
    return { ...K.finderModel({ ...m.sk, query, group, sel: this.fs.sel, mode: m.mode ?? "encounter", map: m.turnbar?.map ?? 0, t }), expanded: this.fs.expanded };
  }

  compose() {
    const m = this.model;
    const o = { ...m, ...(m.util ? { util: { ...m.util, open: this.open.drawer } } : {}) };
    if (o.deck && m.sk) o.deck = withSkills(o.deck, m.sk, { mode: m.mode ?? "encounter", map: m.turnbar?.map ?? 0, t });
    if (this.fs.open && m.sk) o.overlay = V.FINDER(this.finder(), t);
    else if (this.open.drawer) { const d = this.drawer(this.open.drawer); if (d) o.overlay = V.DRAWER(d); }
    return o;
  }

  get root() { return this.el?.firstElementChild ?? null; }

  render({ arrive = false } = {}) {
    if (!this.model || !this.el) return;
    this.el.innerHTML = V.RAIL(this.compose(), t);
    const root = this.root;
    this.light.attach(root);
    if (arrive) { root.classList.add("is-arriving"); setTimeout(() => root.classList.remove("is-arriving"), D.token(root, "--gl-d-cinematic", 900)); }
    if (this.open.drawer && !this.fs.open) D.placeDrawer(root);
    if (this.fs.open) this.settleFinder();
    if (this.peek) this.showPeek(this.peek.model, root.querySelector(this.peek.anchor), this.peek);
    this.prev = this.model;
    this.dock();
    this.publishEdge();
  }

  update(next) {
    const root = this.root;
    if (root && this.prev && S.shapeOf(this.prev) === S.shapeOf(next)) {
      D.drive(root, S.liveOf(next), { raised: t("GLRAIL.shield.raised"), raise: t("GLRAIL.shield.raise") });
      if (S.tookHit(this.prev.vitals ?? this.prev.creature, next.vitals ?? next.creature)) D.flinch(root);
      this.model = this.prev = next;
    } else { this.model = next; this.render(); }
  }

  /* ── drawers ────────────────────────────────────────────────── */

  drawer(kind) {
    const actor = this.subj?.actor, m = this.model;
    if (kind === "rest") return { title: t("GLRAIL.drawer.rest"), body: V.REST(t) };
    if (kind === "macros") {
      const page = ui.hotbar?.page ?? 1;
      return { title: t("GLRAIL.drawer.macros"), body: V.MACROS({ page, slots: macroSlots(game.user.getHotbarMacros(page)) }, t) };
    }
    if (kind === "ranks" && m.deck?.spells) return { title: t("GLRAIL.spell.hand"), note: m.deck.spells.dc != null ? `${t("GLRAIL.skill.dcShort", { dc: m.deck.spells.dc })}` : "", body: V.RANKS(m.deck.spells, t) };
    if (kind === "foes") return { title: t("GLRAIL.drawer.foes"), note: String(m.foes?.foes?.length ?? 0), body: V.DLIST({ rows: (m.foes?.foes ?? []).map((f) => ({ key: `foe:${f.id}`, act: true, name: f.name, icon: f.img, meta: `${t("GLRAIL.gm.level", { n: f.level })} · ${t(`GLRAIL.disp.${f.disp}`)}`, n: f.hp ? `${f.hp[0]}/${f.hp[1]}` : null })) }, t) };
    if (!actor) return null;
    if (kind === "inventory") return { title: t("GLRAIL.drawer.inventory"), body: V.DLIST({ rows: inventoryRows(actor, t) }, t) };
    if (kind === "effects") return { title: t("GLRAIL.drawer.effects"), body: V.DLIST({ rows: effectRows(actor) }, t) };
    if (kind === "strikes") return { title: t("GLRAIL.drawer.strikes"), body: V.DLIST({ rows: (m.strikes?.list ?? []).map((s) => ({ key: `strike:${s.id}`, act: true, name: s.name, icon: s.img, n: s.variants[m.turnbar?.map ?? 0] ?? s.variants[0], meta: s.damage })) }, t) };
    if (kind === "explore") return { title: t("GLRAIL.turnbar.chooseActivity"), body: V.DLIST({ rows: (m.turnbar?.activities ?? []).map((a) => ({ key: `explore:${a.id}`, act: true, name: a.name, ...(a.on ? { tag: t("GLRAIL.turnbar.on") } : {}) })), empty: t("GLRAIL.turnbar.none") }, t) };
    return null;
  }

  /* ── the finder ─────────────────────────────────────────────── */

  settleFinder() {
    const f = this.root?.querySelector("[data-finder]");
    if (!f) return;
    if (this.fs.settled) f.setAttribute("data-settled", "");
    else setTimeout(() => { this.fs.settled = true; f.setAttribute("data-settled", ""); }, D.token(f, "--gl-d-glide", 900));
    const input = f.querySelector("[data-find]");
    if (input) { input.focus(); const n = input.value.length; input.setSelectionRange(n, n); }
    f.querySelector(".gph-fa.is-sel")?.scrollIntoView({ block: "nearest" });
  }

  redrawFinder({ slide = false, pinned = null, opened = null } = {}) {
    const root = this.root, old = root?.querySelector("[data-finder]");
    if (!old) return this.render();
    const from = slide ? old.querySelector(".gph-fa.is-sel")?.getBoundingClientRect() : null;
    const scroll = old.querySelector(".gph-results")?.scrollTop ?? 0;
    old.insertAdjacentHTML("afterend", V.FINDER(this.finder(), t));
    old.remove();
    const f = root.querySelector("[data-finder]");
    f.querySelector(".gph-results").scrollTop = scroll;
    this.settleFinder();
    if (from) D.slideSel(f, from);
    if (pinned) f.querySelector(`[data-skill-action="${CSS.escape(pinned)}"]`)?.classList.add("is-pinning");
    if (opened) f.querySelectorAll(".gph-scol").forEach((c) => {
      if (c.querySelector(`[data-check="skill:${CSS.escape(opened)}"], [data-check="${CSS.escape(opened)}"]`) || (opened === "untrained" && c.classList.contains("is-untrained"))) c.classList.add("is-opening");
    });
  }

  openFinder(query = "") {
    if (!this.model?.sk) return;
    this.fs = { ...this.fs, open: true, query, group: "all", sel: 0, settled: false, expanded: [] };
    this.open.drawer = null; this.peek = null;
    this.render();
  }

  closeFinder() {
    const f = this.root?.querySelector("[data-finder]");
    this.fs.open = false;
    if (!f) return;
    f.classList.add("is-closing");
    setTimeout(() => this.render(), D.token(f, "--gl-d-tap", 130));
  }

  async togglePin(id) {
    const actor = this.subj?.actor;
    if (!actor) return;
    const p = new Set(this.pinsOf(actor));
    p.has(id) ? p.delete(id) : p.add(id);
    const pins = [...p];
    this.model = { ...this.model, sk: { ...this.model.sk, pins } };
    this.fs.settled = true;
    this.redrawFinder({ pinned: p.has(id) ? id : null });
    await game.user.setFlag(SUITE_ID, FLAGS.pins, { [actor.id]: pins });
  }

  /* ── peeks ──────────────────────────────────────────────────── */

  showPeek(model, anchor, meta) {
    const root = this.root;
    if (!root || !anchor || !model) return;
    root.querySelector(".gph-peek")?.remove();
    root.querySelectorAll(".is-peek").forEach((x) => x.classList.remove("is-peek"));
    root.insertAdjacentHTML("beforeend", V.PEEK(model, t));
    const peek = root.querySelector(".gph-peek");
    (anchor.closest(".gph-held") ?? anchor.closest(".gph-row") ?? anchor).classList.add("is-peek");
    D.placePeek(root, anchor, peek);
    this.peek = { ...meta, model };
  }

  closePeek() {
    const root = this.root, peek = root?.querySelector(".gph-peek");
    this.peek = null;
    if (!peek) return;
    root.querySelectorAll(".is-peek").forEach((x) => x.classList.remove("is-peek"));
    peek.classList.add("is-closing");
    setTimeout(() => peek.remove(), D.token(peek, "--gl-d-swift", 160));
  }

  enrich(html, item) {
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    return safe(() => TE.enrichHTML(html ?? "", { rollData: item?.getRollData?.(), relativeTo: item, secrets: item?.isOwner })).then((s) => s ?? "");
  }

  async peekStrike(button) {
    const actor = this.subj?.actor, id = button.dataset.strike;
    const row = this.model?.strikes?.list?.find((s) => s.id === id) ?? this.model?.creature?.strikes?.find((s) => s.id === id);
    const strike = id.startsWith("blast:") ? null : list(actor?.system?.actions)[+id];
    const model = strike ? strikePeek(strike, { t, loc, mod: row?.variants?.[0], damage: row?.damage, critical: row?.critical, labels: { weapon: CONFIG.PF2E.weaponTraits } })
      : { name: row?.name ?? "", from: "", lines: [[t("GLRAIL.peek.damage"), row?.damage ?? ""], [t("GLRAIL.peek.critical"), row?.critical ?? ""]].filter(([, v]) => v), actions: [] };
    this.showPeek(model, button, { kind: "strike", id, anchor: `[data-strike="${CSS.escape(id)}"].gph-stn` });
  }

  async peekAction(button) {
    const id = button.dataset.action ?? button.dataset.stance;
    const item = this.subj?.actor?.items?.get(id);
    if (!item) return;
    const text = await this.enrich(item.description ?? item.system?.description?.value, item);
    const attr = button.dataset.stance != null ? "data-stance" : "data-action";
    this.showPeek(actionPeek(item, { t, text }), button, { kind: "action", id, anchor: `[${attr}="${CSS.escape(id)}"]` });
  }

  async peekSpell(card) {
    const ref = this.spellRef(card.dataset.spell);
    if (!ref?.spell) return;
    const text = await this.enrich(ref.spell.description ?? ref.spell.system?.description?.value, ref.spell);
    if (!card.isConnected) return;
    this.showPeek(spellPeek(ref.spell, { t, rank: ref.key, entryName: ref.entry?.name, dc: ref.entry?.statistic?.dc?.value ?? null, text }), card, { kind: "spell", id: card.dataset.spell, anchor: `[data-spell="${CSS.escape(card.dataset.spell)}"]` });
  }

  /* ── presses ────────────────────────────────────────────────── */

  /** `<entry>.<spell>.<rank>.<slot>` → the entry, the spell and where it is cast. */
  spellRef(id) {
    const [entryId, spellId, key, slot] = String(id).split(".");
    const actor = this.subj?.actor;
    const entry = actor?.spellcasting?.get?.(entryId) ?? null;
    const spell = entry?.spells?.get?.(spellId) ?? actor?.items?.get(spellId) ?? null;
    const rank = /^\d+$/.test(key) ? +key : key;
    return { entry, spell, key: rank, slotId: slot === "" || slot == null ? undefined : +slot };
  }

  /** Remember the press a roll answers, so its chat message can echo there. */
  expect(button) {
    const actor = this.subj?.actor;
    if (!actor || !button) return;
    const sel = ["data-strike", "data-variant", "data-dmg", "data-crit", "data-check", "data-skill-action"]
      .filter((a) => button.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(button.getAttribute(a))}"]`).join("");
    this.pending = { actorId: actor.id, at: Date.now(), sel };
  }

  onMessage(message) {
    const now = Date.now(), userId = game.user.id;
    let p = this.pending;
    if (p && answers(message, p, { userId, now })) this.pending = null;
    /* a reroll answers the press its first roll echoed on, for as long as
       a Hero Point may be spent on it */
    else if (isReroll(message) && answers(message, this.lastEcho, { userId, now, within: TIMING.rerollWindow })) p = this.lastEcho;
    else return;
    const e = echoOf(message, { userId, stream: this.stream, degreeShown: seesTruth() || metagame("results"), words: WORDS() });
    if (!e) return;
    const b = p.sel ? this.root?.querySelector(p.sel) : null;
    if (b) { D.echo(b, e); this.lastEcho = { actorId: p.actorId, sel: p.sel, at: now }; }
  }

  /** The press a Hero Point spent now streaks to: the last roll echoed for
   *  this subject, while a reroll could still answer it. */
  heroAt() {
    const e = this.lastEcho, actor = this.subj?.actor;
    if (!e?.sel || !actor || e.actorId !== actor.id || Date.now() - e.at > TIMING.rerollWindow) return null;
    return this.root?.querySelector(e.sel) ?? null;
  }

/** Who is spending and in which turn, taken when the press lands: PF2e's
   *  dialog may still be open when the subject or the turn moves on. */
  spendCtx() {
    const actor = this.subj?.actor, tb = this.model?.turnbar;
    if (!actor || this.model?.mode !== "encounter" || !tb?.economy) return null;
    const combat = this.combatNow;
    return { actor, combat, turn: this.turnOf(actor), key: turnKey(combat), mine: !!tb.mine, max: tb.economy.max };
  }

  /** A costed press drains the tally; an attack advances the MAP step. A
   *  press that finishes in a later turn spends nothing; one that finishes
   *  after the subject changed spends from its own actor's tally. */
  spend(cost, attack = false, ctx = this.spendCtx()) {
    /* The originating combat, read live: a turn that moved on while PF2e's
       dialog was open has already refilled this tally, and spends nothing. */
    if (!ctx || turnKey(ctx.combat) !== ctx.key) return;
    const before = ctx.turn.map;
    if (!ctx.turn.spend(cost, attack, { mine: ctx.mine, max: ctx.max })) return;
    const tb = this.model?.turnbar;
    if (this.subj?.actor !== ctx.actor || !tb?.economy) return;
    const next = { ...this.model, turnbar: { ...tb, map: tb.mine ? ctx.turn.map : 0, economy: ctx.turn.economy(tb.economy) } };
    /* The skill keys and the finder print attack actions at the MAP step. */
    if (ctx.turn.map !== before && (this.model.deck?.tab === "skills" || this.fs.open)) { this.model = next; this.render(); }
    else this.update(next);
  }

  /** Reload is PF2e Ranged Combat's own action: it takes no weapon, picks
   *  the one to load itself (asking only when several could be), and says
   *  so through its hook when one was. The actions are spent then, against
   *  the turn the press landed in, so a cancelled pick spends nothing. */
  reload(id, b) {
    const s = this.model?.strikes?.list?.find((x) => x.id === id);
    if (!s?.reload || !rangedCombat()) return this.deny(b);
    const ctx = this.spendCtx(), actor = this.subj?.actor;
    this.reloading = { ctx, cost: s.reload.cost, actorId: actor?.id, until: Date.now() + TIMING.rerollWindow };
    return game.pf2eRangedCombat.reload();
  }

  onReloaded(actor) {
    const p = this.reloading;
    if (!p || Date.now() > p.until || actor?.id !== p.actorId) return;
    this.reloading = null;
    if (p.cost) this.spend(p.cost, false, p.ctx);
  }

  deny(el) { el.classList.remove("is-denied"); void el.offsetWidth; el.classList.add("is-denied"); }

  async onClick(e) {
    const seat = e.target.closest("[data-seat]");
    if (seat && !e.target.closest("button")) return this.pressSeat(seat.dataset.seat);
    const b = e.target.closest("button");
    if (!b || !this.model) return;
    const d = b.dataset, actor = this.subj?.actor, m = this.model;
    if (m.readonly && !b.matches("[data-drawer],[data-act='fold'],[data-act='close']")) return;
    try {
      if (d.act === "fold") { await game.settings.set(SUITE_ID, SETTINGS.folded, !m.folded); return; }
      if (d.act === "close") { if (this.fs.open) this.closeFinder(); else { this.open.drawer = null; this.render(); } return; }
      if (d.act === "frame") return this.frame();
      if (d.hero) { const n = +d.hero, cur = m.plinth.hero?.[0] ?? 0; return actor.update({ "system.resources.heroPoints.value": cur === n ? n - 1 : n }); }
      if (d.pip != null) { const turn = this.turnOf(actor), tb = m.turnbar; turn.pip(d.pip, tb.economy.max); return this.update({ ...m, turnbar: { ...tb, economy: turn.economy(tb.economy) } }); }
      if (d.explore) return this.explore(d.explore);
      if (d.act === "explore") { this.open.drawer = this.open.drawer === "explore" ? null : "explore"; return this.render(); }
      if (d.act === "raise") { if (b.getAttribute("aria-disabled") === "true") return this.deny(b); const ctx = this.spendCtx(); await game.pf2e.actions.raiseAShield({ actors: [actor], event: e }); return this.spend(1, false, ctx); }
      if (d.tab) { if (d.tab === m.deck.tab) return; const from = m.deck.tabs.findIndex((x) => x.key === m.deck.tab); this.viewOf(actor).tab = d.tab; this.model = { ...m, deck: { ...m.deck, tab: d.tab } }; this.render(); return D.travelTab(this.root, from); }
      if (d.act === "expand") { const tab = m.deck?.tab; if (tab === "skills") return this.openFinder(""); this.open.drawer = tab === "items" ? "inventory" : tab === "spells" ? "ranks" : "effects"; return this.render(); }
      if (d.act === "finder") return this.openFinder("");
      if (d.act === "sheet") return actor?.sheet?.render(true);
      if (d.drawer) { if (d.drawer === "sheet") return actor?.sheet?.render(true); this.fs.open = false; this.open.drawer = this.open.drawer === d.drawer ? null : d.drawer; this.peek = null; return this.render(); }
      if (d.act === "ranks") { this.open.drawer = this.open.drawer === "ranks" ? null : "ranks"; return this.render(); }
      if (d.rankStep) return this.stepRank(+d.rankStep);
      if (d.row) return this.pressRow(d.row, e);
      if (d.foe) return this.controlToken(d.foe);
      if (d.act === "expand-col") { this.fs = { ...this.fs, expanded: [...this.fs.expanded, d.col], settled: true }; return this.redrawFinder({ opened: d.col }); }
      if (d.skillAction) return this.useSkillAction(d.skillAction, d.variant != null ? +d.variant : undefined, e, b);
      if (d.variant != null && d.strike) {
        if (b.getAttribute("aria-disabled") === "true") return this.deny(b.closest(".gph-stk, .gph-nstk") ?? b);
        this.expect(b);
        const ctx = this.spendCtx();
        await this.strike(d.strike, "attack", +d.variant, e);
        return this.spend(1, true, ctx);
      }
      if (d.dmg) { this.expect(b); return this.strike(d.dmg, "damage", 0, e); }
      if (d.crit) { this.expect(b); return this.strike(d.crit, "critical", 0, e); }
      if (d.act === "peek-strike") return this.peek?.kind === "strike" && this.peek.id === d.strike ? this.closePeek() : this.peekStrike(b);
      if (d.check) { this.expect(b); return this.check(d.check, e); }
      if (d.toggle) { const [domain, option, itemId] = d.toggle.split("|"); const g = m.deck?.actions?.toggles?.find((x) => x.id === d.toggle); return actor.toggleRollOption(domain, option, itemId || null, !g?.on); }
      if (d.reload) return this.reload(d.reload, b);
      if (d.item) { const it = actor.items.get(d.item); if (!it || !(it.system?.quantity > 0)) return this.deny(b); return it.consume(); }
      if (d.action || d.stance) { const id = d.action ?? d.stance; return this.peek?.kind === "action" && this.peek.id === id ? this.closePeek() : this.peekAction(b); }
      if (d.spell) return this.cast(d.spell, b, e);
      if (d.pa) return this.pressPeek(d.pa, e);
    } catch (err) {
      warn("PF2e HUD | press", err);
      ui.notifications?.warn?.(err?.message ?? String(err));
    }
  }

  async check(key, event) {
    const actor = this.subj?.actor;
    if (key === "perception") return actor.perception?.roll({ event });
    if (actor.saves?.[key]) return actor.saves[key].roll({ event });
    if (key.startsWith("skill:")) return actor.skills?.[key.slice(6)]?.roll({ event });
  }

  async strike(id, what, variant, event) {
    const actor = this.subj?.actor;
    if (id.startsWith("blast:")) {
      const [, element, mr] = id.split(":");
      const eb = new game.pf2e.ElementalBlast(actor);
      const c = list(eb.configs).find((x) => x.element === element);
      const damageType = (list(c?.damageTypes).find((x) => x.selected) ?? list(c?.damageTypes)[0])?.value;
      const melee = mr === "m";
      if (what === "attack") return eb.attack({ element, damageType, melee, mapIncreases: variant, event });
      return eb.damage({ element, damageType, melee, outcome: what === "critical" ? "criticalSuccess" : "success", event });
    }
    const s = list(actor.system?.actions)[+id];
    if (!s) return;
    if (what === "attack") return s.variants?.[variant]?.roll({ event });
    return s[what]?.({ event });
  }

  async useSkillAction(id, variant, event, button, kind = null) {
    const f = this.finder("", "all");
    const a = f?.actions.find((x) => x.id === id);
    const actor = this.subj?.actor;
    if (!a || !actor) return;
    if (a.locked) { ui.notifications?.info?.(t("GLRAIL.skill.locked", { name: a.name, rank: a.locked })); return; }
    const map = a.attack ? (variant ?? this.model?.turnbar?.map ?? 0) : 0;
    this.expect(button);
    /* Earn Income is PF2e's own dialog, opened for the actor. */
    if (a.slug === "earn-income") return game.pf2e.actions.earnIncome?.(actor);
    const action = game.pf2e.actions.get?.(a.slug);
    /* PF2e refuses to guess between an action's variants (Administer First
       Aid, Create a Diversion, Perform): the press asks which, over itself. */
    const variants = action?.variants ? [...action.variants.values()] : [];
    if (!kind && variants.length > 1) {
      return this.showPeek({ name: a.name, from: `${a.skill.name} ${(a.mapMod ?? a.skill.mod) < 0 ? "−" : "+"}${Math.abs(a.mapMod ?? a.skill.mod)}`,
        actions: variants.map((x) => ({ id: `variant:${x.slug}`, label: game.i18n.localize(x.name ?? x.slug), ...(a.cost != null ? { cost: a.cost } : {}) })) },
        button, { kind: "variant", id: a.id, anchor: `[data-skill-action="${CSS.escape(a.id)}"]` });
    }
    const ctx = this.spendCtx();
    if (action) await action.use({ actors: [actor], statistic: a.skill.slug, event, ...(kind ? { variant: kind } : {}), ...(a.attack ? { multipleAttackPenalty: map } : {}) });
    else {
      const legacy = game.pf2e.actions[camel(a.slug)];
      if (typeof legacy !== "function") { warn(`PF2e HUD | PF2e has no action "${a.slug}"`); return; }
      await legacy({ actors: [actor], skill: a.skill.slug, event });
    }
    this.spend(a.cost, a.attack, ctx);
  }

  async cast(id, card, event) {
    const ref = this.spellRef(id);
    if (!ref.entry || !ref.spell) return;
    if (card.closest(".gph-card.is-spent")) return this.deny(card);
    const ctx = this.spendCtx();
    await D.castCard(card);
    await ref.entry.cast(ref.spell, { ...(typeof ref.key === "number" ? { rank: ref.key } : {}), ...(ref.slotId != null ? { slotId: ref.slotId } : {}) });
    this.spend(card.dataset.cost ?? null, false, ctx);
  }

  async pressPeek(pa, event) {
    const p = this.peek, actor = this.subj?.actor;
    if (!p || !actor) return;
    if (p.kind === "spell") {
      const ref = this.spellRef(p.id);
      if (pa === "cast") { const card = this.root?.querySelector(p.anchor); this.closePeek(); return card ? this.cast(p.id, card, event) : null; }
      if (pa === "post") { this.closePeek(); return ref.spell?.toMessage(event); }
    }
    if (p.kind === "action") {
      const item = actor.items.get(p.id);
      this.closePeek();
      if (pa === "use") { const ctx = this.spendCtx(); await game.pf2e.rollItemMacro(item.uuid, event); return this.spend(costOf(item), false, ctx); }
      if (pa === "post") return item?.toMessage(event);
    }
    if (p.kind === "variant" && pa.startsWith("variant:")) {
      const button = this.root?.querySelector(p.anchor);
      this.closePeek();
      return this.useSkillAction(p.id, undefined, event, button, pa.slice(8));
    }
    if (p.kind === "strike" && pa === "post") { const s = list(actor.system?.actions)[+p.id]; this.closePeek(); return s?.item?.toMessage(event); }
  }

  async pressRow(row, event) {
    const actor = this.subj?.actor;
    const [kind, ...rest] = row.split(":");
    const id = rest.join(":");
    if (kind === "rank") { this.viewOf(actor).rank = /^\d+$/.test(id) ? +id : id; this.open.drawer = null; return this.schedule(); }
    if (kind === "rest") { this.open.drawer = null; this.render(); return game.pf2e.actions.restForTheNight({ actors: [actor] }); }
    if (kind === "macro") return game.macros.get(id)?.execute();
    if (kind === "foe") return this.controlToken(id);
    if (kind === "explore") { this.open.drawer = null; return this.explore(id); }
    if (kind === "strike") { const s = this.model?.strikes?.list?.find((x) => x.id === id); this.open.drawer = null; this.render(); const ctx = this.spendCtx(); await this.strike(id, "attack", this.model?.turnbar?.map ?? 0, event); return s ? this.spend(1, true, ctx) : null; }
    if (kind === "i") { const it = actor?.items?.get(id); if (!it) return; return it.type === "consumable" ? it.consume() : it.toMessage(event); }
  }

  stepRank(step) {
    const actor = this.subj?.actor, sp = this.model?.deck?.spells;
    if (!sp) return;
    const i = sp.ranks.findIndex((r) => r.key === sp.rank), j = Math.max(0, Math.min(sp.ranks.length - 1, i + step));
    if (i === j) return;
    this.viewOf(actor).rank = sp.ranks[j].key;
    this.model = { ...this.model, deck: { ...this.model.deck, spells: { ...sp, rank: sp.ranks[j].key } } };
    this.render();
  }

  explore(id) {
    const actor = this.subj?.actor;
    const now = list(actor.system?.exploration);
    return actor.update({ "system.exploration": now.includes(id) ? [] : [id] });
  }

  controlToken(id) {
    const tk = canvas?.tokens?.get(id);
    this.open.drawer = null;
    return tk?.control({ releaseOthers: true });
  }

  pressSeat(id) {
    const a = game.actors.get(id);
    if (!a) return;
    if (game.user.isGM) { const tk = a.getActiveTokens?.()[0]; if (tk) return tk.control({ releaseOthers: true }); }
    if (a.testUserPermission(game.user, "OBSERVER")) return a.sheet?.render(true);
  }

  frame() {
    const actor = this.subj?.actor, p = this.root?.querySelector("[data-plinth]");
    if (!actor || !p) return;
    D.framePlinth(p, this.model.plinth.frame, { onCommit: (f) => actor.setFlag(SUITE_ID, FLAGS.frame, f) });
  }

  /* ── pointer and keys ───────────────────────────────────────── */

  onInput(e) {
    const inp = e.target.closest("[data-find]");
    if (!inp) return;
    if (!this.fs.open) return this.openFinder(inp.value);
    this.fs = { ...this.fs, query: inp.value, sel: 0, settled: true };
    this.redrawFinder();
  }

  onContext(e) {
    const c = e.target.closest("[data-finder] .gph-fa");
    if (!c) return;
    e.preventDefault();
    this.togglePin(c.dataset.skillAction);
  }

  onOver(e) {
    const c = e.target.closest("[data-spell]");
    if (!c || this.fs.open) return;
    clearTimeout(this.peekT);
    this.peekT = setTimeout(() => this.peekSpell(c), TIMING.peekOpen);
  }

  onOut(e) {
    if (!e.target.closest("[data-spell], .gph-peek")) return;
    clearTimeout(this.peekT);
    this.peekT = setTimeout(() => { if (this.peek?.kind === "spell" && !this.el?.querySelector(".gph-peek:hover, [data-spell]:hover")) this.closePeek(); }, TIMING.peekClose);
  }

  onKey(e) {
    if (!this.root || !this.model) return;
    const inField = e.target.closest?.("[data-find]");
    const eat = () => { e.preventDefault(); e.stopPropagation(); };
    if (this.fs.open) {
      const cards = [...this.root.querySelectorAll("[data-finder] .gph-fa")];
      if (e.key === "Escape") { eat(); return this.closeFinder(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { eat(); this.fs.sel = Math.max(0, Math.min(cards.length - 1, this.fs.sel + (e.key === "ArrowDown" ? 1 : -1))); this.fs.settled = true; return this.redrawFinder({ slide: true }); }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (inField && e.target.value) return;
        eat();
        const cols = [...this.root.querySelectorAll("[data-finder] .gph-scol")];
        const at = cols.findIndex((c) => c.contains(cards[this.fs.sel]));
        const first = cols[Math.max(0, Math.min(cols.length - 1, at + (e.key === "ArrowRight" ? 1 : -1)))]?.querySelector(".gph-fa");
        if (first) { this.fs.sel = +first.dataset.k; this.fs.settled = true; this.redrawFinder({ slide: true }); }
        return;
      }
      if (e.key === "Enter") { eat(); const c = cards[this.fs.sel]; if (c) this.useSkillAction(c.dataset.skillAction, undefined, e, c); return; }
      if (/^[123]$/.test(e.key) && (!inField || !e.target.value)) { const c = cards[this.fs.sel]; if (c?.hasAttribute("data-attack")) { eat(); this.useSkillAction(c.dataset.skillAction, +e.key - 1, e, c); } return; }
      if ((e.key === "p" || e.key === "P") && (!inField || !e.target.value)) { const c = cards[this.fs.sel]; if (c) { eat(); this.togglePin(c.dataset.skillAction); } return; }
      return;
    }
    if (inField) return;
    /* "/" opens the finder only from the canvas: never while somebody types elsewhere. */
    const typing = e.target.closest?.("input, textarea, select, [contenteditable='true'], .editor");
    if (e.key === "/" && !typing && this.model.sk && !e.ctrlKey && !e.metaKey && !e.altKey) { eat(); return this.openFinder(""); }
    if (e.key === "Escape" && (this.peek || this.open.drawer)) { this.closePeek(); if (this.open.drawer) { this.open.drawer = null; this.render(); } }
  }
}

/** For the check tool and the docs: the skill catalogue's slugs, and PF2e's
 *  sixteen skills, are what the host addresses PF2e with. */
export const ADDRESSES = Object.freeze({ skills: SKILLS, actions: K.SKILL_ACTIONS.map((a) => a.slug) });
