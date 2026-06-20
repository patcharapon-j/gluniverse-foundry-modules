/**
 * SupportStore — data layer for the Mission Support System (mirrors WeatherStore
 * and TrackerStore).
 *
 * The whole roster + live state lives in one world-scope setting (`supports`):
 * an array of support definitions plus the id of the one "active" this mission.
 * Every GM edit, pool roll, or mission reset propagates to all clients via the
 * setting's onChange → SupportHud.refresh() + HOOKS.supportsChanged pipeline.
 *
 * Players read the roster but never write it. A player who fires an action rolls
 * dice + posts the card on their own client; the card carries the resulting pool
 * state in its flags and the responsible GM persists it from createChatMessage —
 * the same GM-authoritative pattern TrackerStore uses for pool rolls, so it needs
 * no module socket channel.
 *
 * The Passive auto-applies a PF2e Effect (icon swapped to the support's token
 * image) to every party member while a support is active, and is removed/swapped
 * by setActive/clearActive. On non-PF2e systems it degrades to a core
 * ActiveEffect carrying just the image marker.
 */

import {
  MODULE_ID, FLAG_NS, SETTINGS, HOOKS, SUPPORT_ABILITY_KINDS, SUPPORT_BURN_KINDS,
  SUPPORT_FACTION_MOD, SUPPORT_TIERS, SUPPORT_LEVEL_RANGE, SUPPORT_POOL_RANGE
} from "../const.js";

import { clamp, toInt as int, hex6 } from "../../../core/util.mjs";

const str = (v, max = 200) => String(v ?? "").slice(0, max);

/** A blank ability of a given kind, with a sensible default label. */
function makeAbility(kind) {
  const defaults = {
    passive:      { name: "Passive",                  costLabel: "Passive" },
    radio:        { name: "Radio Active",             costLabel: "Free · 1/rd" },
    fieldCombat:  { name: "Field Call — Combat",      costLabel: "1 action" },
    fieldExplore: { name: "Field Call — Exploration", costLabel: "Field · explore" }
  }[kind] ?? { name: "Ability", costLabel: "" };
  return { name: defaults.name, costLabel: defaults.costLabel, traits: [], cardText: "", effectUuids: [] };
}

export function makeDefaultSupports() {
  return { schemaVersion: 1, activeId: null, roster: [] };
}

/** Per-surface portrait framing (translate px + scale), one crop per shape.
 *  The coin is a circle, the card a wide banner, the expanded sheet a top-left
 *  diorama — so each remembers its own x/y/scale. Tuned to look sane uncropped. */
export function defaultFrames() {
  return {
    coin: { x: 0, y: -10, s: 1 },
    card: { x: 0, y: -18, s: 1 },
    exp:  { x: 0, y: -22, s: 1 }
  };
}

const SUPPORT_SURFACES = ["coin", "card", "exp"];
const num = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

export class SupportStore {
  /* ------------------------------- reads ------------------------------- */

  static get enabled() {
    try { return !!game.settings.get(MODULE_ID, SETTINGS.supportEnabled); } catch { return false; }
  }

  static get visibleToPlayers() {
    try { return !!game.settings.get(MODULE_ID, SETTINGS.supportHudVisibleToPlayers); } catch { return false; }
  }

  /** The whole config (deep-cloned), guaranteed structurally valid. */
  static get data() {
    let raw = null;
    try { raw = game.settings.get(MODULE_ID, SETTINGS.supports); } catch { /* ignore */ }
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.roster)) return makeDefaultSupports();
    return foundry.utils.deepClone(raw);
  }

  /** Roster ordered for display. */
  static roster(data = this.data) {
    return [...data.roster].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  static get(id, data = this.data) { return data.roster.find(s => s.id === id) ?? null; }

  /** The active support object, or null if none / not in the roster. */
  static active(data = this.data) {
    return data.activeId ? (data.roster.find(s => s.id === data.activeId) ?? null) : null;
  }

  /** PF2e is the system that gets full automation; everything else degrades. */
  static get isPF2e() { return game.system?.id === "pf2e"; }

  /** True when the current viewer should see the coin (GM always; players when shown). */
  static get viewerSees() {
    if (game.user?.isGM) return true;
    return !!this.active() && this.visibleToPlayers;
  }

  /** Availability-pool maximum = base + faction-track modifier (never below 0). */
  static poolMax(support) {
    if (!support) return 0;
    const mod = SUPPORT_FACTION_MOD[clamp(int(support.faction, 3), 0, 5)] ?? 0;
    return Math.max(0, int(support.basePool, 5) + mod);
  }

  /** Whether a given viewer may fire actions for this support. */
  static canInvoke(support) {
    if (game.user?.isGM) return true;
    return !!support?.playerInvoke;
  }

  /* ------------------------------- writes (GM) ------------------------------- */

  static async save(data, { payload = null } = {}) {
    if (!game.user.isGM) return;
    this._sanitize(data);
    await game.settings.set(MODULE_ID, SETTINGS.supports, data);
    Hooks.callAll(HOOKS.supportsChanged, payload ?? { reason: "save" });
  }

  /** Read → mutate → save convenience. `mutator(data)` may return a payload. */
  static async update(mutator, opts = {}) {
    if (!game.user.isGM) return;
    const data = this.data;
    const payload = mutator(data) ?? null;
    await this.save(data, { payload, ...opts });
  }

  static makeNew(overrides = {}) {
    const order = this.roster().reduce((m, s) => Math.max(m, s.order ?? 0), 0) + 1;
    const support = {
      id: foundry.utils.randomID(),
      order,
      name: "New Support",
      role: "",
      level: 1,
      img: "",
      tokenImg: "",
      accent: "#e0a368",
      basePool: 5,
      faction: 3,
      discard: 2,
      downFloor: false,
      playerInvoke: true,
      passiveEffectUuid: "",
      frames: defaultFrames(),
      abilities: Object.fromEntries(SUPPORT_ABILITY_KINDS.map(k => [k, makeAbility(k)])),
      // live state
      current: 0,
      downed: false,
      downedLastMission: false,
      radioUsed: false,
      ...overrides
    };
    support.current = this.poolMax(support);
    return support;
  }

  static async create(overrides = {}) {
    if (!game.user.isGM) return null;
    const support = this.makeNew(overrides);
    await this.update(data => { data.roster.push(support); return { reason: "create", id: support.id }; });
    return support;
  }

  static async updateSupport(id, patch) {
    if (!game.user.isGM) return;
    await this.update(data => {
      const s = data.roster.find(x => x.id === id);
      if (!s) return null;
      foundry.utils.mergeObject(s, patch, { inplace: true });
      return { reason: "update", id };
    });
    // If the active support's passive source changed, re-seat the aura.
    if (id === this.data.activeId) await this.applyPassive();
  }

  static async delete(id) {
    if (!game.user.isGM) return;
    if (this.data.activeId === id) await this.clearActive();
    await this.update(data => {
      data.roster = data.roster.filter(s => s.id !== id);
      return { reason: "delete", id };
    });
  }

  static async reorder(idsInOrder) {
    if (!game.user.isGM) return;
    await this.update(data => {
      idsInOrder.forEach((id, i) => { const s = data.roster.find(x => x.id === id); if (s) s.order = i; });
      return { reason: "reorder" };
    });
  }

  /** Append several supports (e.g. importing a preset). */
  static async importSupports(supports) {
    if (!game.user.isGM || !Array.isArray(supports)) return;
    await this.update(data => {
      let order = data.roster.reduce((m, s) => Math.max(m, s.order ?? 0), 0) + 1;
      for (const raw of supports) {
        const s = this.makeNew({ ...raw, id: foundry.utils.randomID(), order: order++ });
        data.roster.push(s);
      }
      return { reason: "import" };
    });
  }

  /** World folder the imported passive Effect items live in. */
  static SUPPORT_EFFECT_FOLDER = "GLCT · Support Effects";

  /**
   * Create (or update in place) PF2e Effect items from a list of raw item
   * definitions, in the "GLCT · Support Effects" folder. Used by the JSON import
   * to materialise a support's bundled passive so it can be linked + auto-applied.
   *
   * Returns a Map keyed by both the lower-cased effect name AND its slug → the new
   * item's UUID, so callers can resolve a support's passive by either reference.
   * No-ops (returns an empty map) on non-PF2e systems, where the Effect item type
   * doesn't exist and the passive degrades to a marker ActiveEffect anyway.
   */
  static async importEffectItems(defs = []) {
    const byKey = new Map();
    if (!game.user.isGM || !this.isPF2e || !Array.isArray(defs) || !defs.length) return byKey;

    let folder = game.folders.find(f => f.type === "Item" && f.name === this.SUPPORT_EFFECT_FOLDER);
    if (!folder) {
      try { folder = await Folder.create({ name: this.SUPPORT_EFFECT_FOLDER, type: "Item", color: "#8fc7ff" }); }
      catch { /* a non-folder world (compendium-only) still works without one */ }
    }

    for (const raw of defs) {
      const data = foundry.utils.deepClone(raw);
      if (!data || typeof data !== "object" || data.type !== "effect" || !data.name) continue;
      delete data._id;
      if (folder) data.folder = folder.id;
      const slug = data.system?.slug ? String(data.system.slug).toLowerCase() : null;
      const pool = folder ? folder.contents : (game.items?.filter(i => i.type === "effect") ?? []);
      const existing = pool.find(i => i.name === data.name || (slug && String(i.system?.slug).toLowerCase() === slug));
      let item = null;
      try {
        if (existing) { await existing.update(data); item = existing; }
        else { item = await Item.create(data); }
      } catch (err) { console.warn(`${MODULE_ID} | support effect import failed: ${data.name}`, err); continue; }
      if (item) {
        byKey.set(String(item.name).trim().toLowerCase(), item.uuid);
        if (slug) byKey.set(slug, item.uuid);
      }
    }
    return byKey;
  }

  /* ------------------------------- active + passive ------------------------------- */

  /** Make a support active (swapping the passive aura). Pass null to clear. */
  static async setActive(id) {
    if (!game.user.isGM) return;
    if (!id) return this.clearActive();
    const prev = this.active();
    if (prev && prev.id !== id) await this.removePassive(prev);
    await this.update(data => {
      if (!data.roster.some(s => s.id === id)) return null;
      data.activeId = id;
      return { reason: "active", id };
    });
    await this.applyPassive();
  }

  static async clearActive() {
    if (!game.user.isGM) return;
    const prev = this.active();
    if (prev) await this.removePassive(prev);
    await this.update(data => { data.activeId = null; return { reason: "active", id: null }; });
  }

  /** Actors that count as "the party": the PF2e Party actor's members, else
   *  every character-type actor a player owns. */
  static partyActors() {
    const out = new Map();
    try {
      const party = game.actors?.party;
      if (party?.members?.length) { for (const m of party.members) if (m) out.set(m.id, m); }
    } catch { /* no party actor */ }
    if (!out.size) {
      for (const a of game.actors ?? []) {
        const isPC = a.type === "character" || a.hasPlayerOwner;
        if (isPC && a.hasPlayerOwner) out.set(a.id, a);
      }
    }
    return [...out.values()];
  }

  /** Our passive effects carry this flag so cleanup is unambiguous. */
  static _passiveFlag(supportId) { return { [MODULE_ID]: { [FLAG_NS]: { supportPassive: true, supportId } } }; }

  /** Module option: show the passive Effect's icon on party tokens (default true). */
  static _passiveTokenIcon() {
    try { return game.settings.get(MODULE_ID, SETTINGS.supportPassiveTokenIcon); }
    catch { return true; }
  }

  /**
   * Apply the active support's Passive effect to every party member, with the
   * effect icon swapped to the support's token image. Best-effort and idempotent
   * (removes any prior copy first). GM-only.
   */
  static async applyPassive(support = this.active()) {
    if (!game.user.isGM || !support) return;
    // Remember what the aura now reflects so syncPassive can skip no-op re-seats
    // (otherwise every pool tick would delete + recreate the Effect, flashing the
    // "effect removed / applied" text over each token).
    this._passiveDownedSig = `${support.id}:${support.downed ? 1 : 0}`;
    await this.removePassive(support);                 // never stack duplicates
    // A downed support is entirely offline — passive included. Leave the aura off
    // the party until it recovers (syncPassive re-applies once Downed clears).
    if (support.downed) return;
    const showOnToken = this._passiveTokenIcon();
    const icon = support.tokenImg || support.img || null;
    const actors = this.partyActors();
    if (!actors.length) return;

    // PF2e path: clone the linked Effect item onto each member.
    if (this.isPF2e && support.passiveEffectUuid) {
      let source = null;
      try { source = (await fromUuid(support.passiveEffectUuid))?.toObject?.(); } catch { /* ignore */ }
      if (source) {
        delete source._id;
        if (icon) source.img = icon;
        source.name = support.abilities?.passive?.name || source.name;
        // Honour the "show passive icon on tokens" module option (PF2e effects
        // expose system.tokenIcon.show); the aura still applies either way.
        source.system = foundry.utils.mergeObject(source.system ?? {}, { tokenIcon: { show: showOnToken } });
        source.flags = foundry.utils.mergeObject(source.flags ?? {}, this._passiveFlag(support.id));
        for (const actor of actors) {
          try { await actor.createEmbeddedDocuments("Item", [foundry.utils.deepClone(source)]); }
          catch (err) { console.warn(`${MODULE_ID} | passive apply failed on ${actor.name}`, err); }
        }
        return;
      }
    }

    // Fallback (non-PF2e, or no linked effect): a marker ActiveEffect carrying the
    // support's image so players still see "this person has your back".
    const eff = {
      name: support.abilities?.passive?.name || support.name,
      icon: icon || "icons/svg/aura.svg",
      img: icon || "icons/svg/aura.svg",
      origin: null,
      disabled: false,
      flags: this._passiveFlag(support.id)
    };
    for (const actor of actors) {
      try { await actor.createEmbeddedDocuments("ActiveEffect", [foundry.utils.deepClone(eff)]); }
      catch (err) { console.warn(`${MODULE_ID} | passive marker failed on ${actor.name}`, err); }
    }
  }

  /** Remove this module's passive effects (optionally only one support's). */
  static async removePassive(support = null) {
    if (!game.user.isGM) return;
    const matches = (doc) => {
      const f = doc.flags?.[MODULE_ID]?.[FLAG_NS];
      return f?.supportPassive && (!support || f.supportId === support.id);
    };
    for (const actor of game.actors ?? []) {
      try {
        const items = actor.items?.filter(matches).map(i => i.id) ?? [];
        if (items.length) await actor.deleteEmbeddedDocuments("Item", items);
        const fx = actor.effects?.filter(matches).map(e => e.id) ?? [];
        if (fx.length) await actor.deleteEmbeddedDocuments("ActiveEffect", fx);
      } catch { /* ignore per-actor failures */ }
    }
  }

  /** Re-seat the active support's aura ONLY when its Downed flag actually flipped.
   *  Pool nudges that don't cross 0 leave the aura untouched, so PF2e no longer
   *  flashes "effect removed / applied" over every token on each step. Pulls the
   *  aura when a support drops, restores it when it recovers. */
  static async syncPassive(id) {
    if (!game.user.isGM) return;
    const active = this.active();
    if (!active || (id && id !== active.id)) return;
    const sig = `${active.id}:${active.downed ? 1 : 0}`;
    if (sig === this._passiveDownedSig) return;   // Downed state unchanged → no-op
    await this.applyPassive(active);
  }

  /* ------------------------------- mission lifecycle ------------------------------- */

  /**
   * Start a new mission for `id` (or the current active support). Refills the
   * pool: a support Downed last mission starts at HALF (rounded down) unless the
   * "unavailable until Recover" floor is set, in which case it stays unavailable.
   * Clears the Downed flag, consumes the carried penalty, resets radio use.
   */
  static async startMission(id = this.data.activeId) {
    if (!game.user.isGM || !id) return;
    if (id !== this.data.activeId) await this.setActive(id);
    await this.update(data => {
      const s = data.roster.find(x => x.id === id);
      if (!s) return null;
      const max = this.poolMax(s);
      if (s.downedLastMission && s.downFloor) {
        // Unavailable-until-Recover: leave it Downed/empty this mission.
        s.current = 0; s.downed = true;
      } else if (s.downedLastMission) {
        s.current = Math.floor(max / 2); s.downed = s.current <= 0;
      } else {
        s.current = max; s.downed = false;
      }
      s.downedLastMission = false;
      s.radioUsed = false;
      return { reason: "mission", id };
    });
    await this.syncPassive(id);   // refilled support comes back online → re-seat aura
  }

  /** Restore a support to a full pool and clear all Downed flags (Infirmary). */
  static async recover(id) {
    if (!game.user.isGM) return;
    await this.update(data => {
      const s = data.roster.find(x => x.id === id);
      if (!s) return null;
      s.current = this.poolMax(s);
      s.downed = false; s.downedLastMission = false;
      return { reason: "recover", id };
    });
    await this.syncPassive(id);   // recovered → restore aura to the party
  }

  /** GM directly sets the current availability pool (HUD steppers / dice click).
   *  Clamps to [0,max]; emptying marks Downed, refilling clears it. */
  static async setPool(id, n) {
    if (!game.user.isGM) return;
    await this.update(data => {
      const s = data.roster.find(x => x.id === id);
      if (!s) return null;
      const max = this.poolMax(s);
      s.current = clamp(int(n), 0, max);
      if (s.current <= 0) s.downed = true;
      else if (s.downed) s.downed = false;
      return { reason: "pool", id };
    });
    await this.syncPassive(id);   // pool emptied/refilled may have toggled Downed
  }

  /** Reset the soft radio-per-round flag on every support (combat round change). */
  static async resetRadio() {
    if (!game.user.isGM) return;
    if (!this.data.roster.some(s => s.radioUsed)) return;   // nothing to clear
    await this.update(data => { data.roster.forEach(s => { s.radioUsed = false; }); return { reason: "radioReset" }; });
  }

  /* ------------------------------- action results (GM persist) ------------------------------- */

  /**
   * Persist the state change produced by firing an action. Called GM-side when a
   * support action card is created (see registerHandlers). Carries the already-
   * resolved values so a player's action sticks without a module socket.
   */
  static async _applyActionResult(id, { current, downed, downedLastMission, radioUsed } = {}) {
    if (!game.user.isGM) return;
    await this.update(data => {
      const s = data.roster.find(x => x.id === id);
      if (!s) return null;
      if (Number.isFinite(current)) s.current = clamp(int(current), 0, this.poolMax(s));
      if (typeof downed === "boolean") s.downed = downed;
      if (typeof downedLastMission === "boolean") s.downedLastMission = downedLastMission;
      if (typeof radioUsed === "boolean") s.radioUsed = radioUsed;
      return { reason: "action", id };
    });
    await this.syncPassive(id);   // a Field Call that downed the support pulls its aura
  }

  /** The one GM responsible for persisting routed player action results. */
  static _isResponsibleGM() {
    if (!game.user?.isGM) return false;
    const gms = game.users.filter(u => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id));
    return gms[0]?.id === game.user.id;
  }

  /** Wire GM-side persistence of action results (called once from ready). */
  static registerHandlers() {
    Hooks.on("createChatMessage", (message) => {
      const flag = message?.flags?.[MODULE_ID]?.[FLAG_NS]?.supportAction;
      if (!flag?.supportId) return;
      if (!this._isResponsibleGM()) return;
      this._applyActionResult(flag.supportId, flag.result ?? {});
    });
  }

  /* ------------------------------- sanitize ------------------------------- */

  static _sanitize(data) {
    if (!data || typeof data !== "object") return;
    data.schemaVersion = 1;
    if (!Array.isArray(data.roster)) data.roster = [];
    const seen = new Set();
    data.roster = data.roster.filter(s => s && typeof s === "object" && s.id && !seen.has(s.id) && seen.add(s.id));
    data.roster.forEach((s, i) => this._sanitizeSupport(s, i));
    if (data.activeId && !data.roster.some(s => s.id === data.activeId)) data.activeId = null;
  }

  static _sanitizeSupport(s, i) {
    s.order = int(s.order, i);
    s.name = str(s.name, 60) || "Support";
    s.role = str(s.role, 120);
    s.level = clamp(int(s.level, 1), SUPPORT_LEVEL_RANGE.min, SUPPORT_LEVEL_RANGE.max);
    s.img = str(s.img, 400);
    s.tokenImg = str(s.tokenImg, 400);
    s.accent = hex6(s.accent, "#e0a368");
    s.basePool = clamp(int(s.basePool, 5), SUPPORT_POOL_RANGE.min, SUPPORT_POOL_RANGE.max);
    s.faction = clamp(int(s.faction, 3), 0, 5);
    s.discard = clamp(int(s.discard, 2), 0, 5);
    s.downFloor = !!s.downFloor;
    s.playerInvoke = s.playerInvoke !== false;
    s.passiveEffectUuid = str(s.passiveEffectUuid, 400);

    // per-surface portrait framing
    const df = defaultFrames();
    if (!s.frames || typeof s.frames !== "object") s.frames = {};
    for (const surf of SUPPORT_SURFACES) {
      const f = s.frames[surf] && typeof s.frames[surf] === "object" ? s.frames[surf] : (s.frames[surf] = {});
      f.x = clamp(num(f.x, df[surf].x), -1000, 1000);
      f.y = clamp(num(f.y, df[surf].y), -1000, 1000);
      f.s = clamp(num(f.s, df[surf].s), 0.1, 8);
    }
    for (const k of Object.keys(s.frames)) if (!SUPPORT_SURFACES.includes(k)) delete s.frames[k];

    if (!s.abilities || typeof s.abilities !== "object") s.abilities = {};
    for (const k of SUPPORT_ABILITY_KINDS) {
      const a = s.abilities[k] && typeof s.abilities[k] === "object" ? s.abilities[k] : (s.abilities[k] = makeAbility(k));
      a.name = str(a.name, 80);
      a.costLabel = str(a.costLabel, 40);
      a.cardText = str(a.cardText, 4000);
      a.traits = Array.isArray(a.traits) ? a.traits.map(t => str(t, 30)).filter(Boolean).slice(0, 12) : [];
      a.effectUuids = Array.isArray(a.effectUuids) ? a.effectUuids.map(u => str(u, 400)).filter(Boolean).slice(0, 12) : [];
    }
    // drop any stray ability keys
    for (const k of Object.keys(s.abilities)) if (!SUPPORT_ABILITY_KINDS.includes(k)) delete s.abilities[k];

    const max = this.poolMax(s);
    s.current = clamp(int(s.current, max), 0, max);
    s.downed = !!s.downed;
    s.downedLastMission = !!s.downedLastMission;
    s.radioUsed = !!s.radioUsed;
  }

  /* ------------------------------- helpers for UI/cards ------------------------------- */

  static isBurnKind(kind) { return SUPPORT_BURN_KINDS.includes(kind); }
  static get tiers() { return SUPPORT_TIERS; }

  /** Safe read of a support's framing for one surface ("coin"|"card"|"exp"). */
  static frame(support, surface) {
    const df = defaultFrames();
    const f = support?.frames?.[surface];
    if (!f) return df[surface] ?? { x: 0, y: 0, s: 1 };
    return { x: num(f.x, df[surface].x), y: num(f.y, df[surface].y), s: num(f.s, df[surface].s) };
  }
}
