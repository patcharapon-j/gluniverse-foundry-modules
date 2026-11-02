/**
 * Creaturedexing — the dex window.
 *
 * This is the surface the players actually use, and it is player-facing by
 * default. Two things follow from that and shape the whole file.
 *
 * **It renders from stored snapshots, never from the creature.** Foundry hands
 * every client the full Actor document, so a window that drew a redacted stat
 * block out of the live actor would be locking data the player already holds:
 * theatre, on the player's own screen. A section is rendered by the GM at
 * reveal time and the *result* is what the store keeps (see `store.mjs`). The
 * cost is that a section is a memory rather than a live view, which is why the
 * GM has a refresh action.
 *
 * **What it shows is decided in `model.mjs` and drawn by `render.mjs`**, both
 * pure, so the preview page draws this exact markup. This file is the Foundry
 * half: who is looking, the GM's writes, and the window's own lifecycle.
 *
 * `foundry.applications.api` is read at module scope. That is why the resource
 * bars reach `CreaturedexApp.mayView` through a lazy `import()` that fails
 * closed, and why nothing a check tool loads under Node may import this file.
 */

import { escapeHTML } from "../../core/util.mjs";
import { PARTY_KEY, SETTINGS } from "./constants.mjs";
import { dexKey } from "./identity.mjs";
import { dexModel, matchesQuery } from "./model.mjs";
import { afterHandover } from "./notice.mjs";
import { buildSections } from "./sections.mjs";
import { dexHTML, prepareDetail } from "./render.mjs";
import { openFalsify } from "./falsify.mjs";
import {
  falseSections,
  forget,
  get,
  knownSections,
  ownerKey,
  partyCharacters,
  partyMode,
  readAll,
  redact,
  refresh,
  reveal,
  subjectMeta,
  trueSnapshot,
} from "./store.mjs";

const { ApplicationV2 } = foundry.applications.api;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** PF2e swaps in its own TextEditor, which resolves @Damage/@Check/@UUID. */
async function enrich(html) {
  if (!html) return "";
  try {
    const editor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    if (editor?.enrichHTML) return await editor.enrichHTML(String(html), { async: true });
  } catch {
    /* fall through to the raw value rather than losing the text */
  }
  return String(html);
}

/** Characters this user may look at the dex of. */
export function viewableCharacters() {
  if (game.user.isGM) return game.actors.filter((a) => a.type === "character");
  const owned = game.actors.filter((a) => a.type === "character" && a.testUserPermission(game.user, "OWNER"));
  const assigned = game.user.character;
  if (assigned && !owned.includes(assigned)) owned.push(assigned);
  return owned;
}

export function mayOpen() {
  if (game.user.isGM) return true;
  return !!get(SETTINGS.playerAccess, true) && viewableCharacters().length > 0;
}

/**
 * What the dex records about a subject, read off a live actor.
 *
 * Only ever called on a GM client: it is the half of the feature that needs to
 * see the creature honestly, and it is the only half that does.
 */
export function snapshotOf(actor) {
  const { kind, sections, deferred } = buildSections(actor);
  const available = sections.map((s) => s.key);
  const snapshots = Object.fromEntries(sections.map((s) => [s.key, s]));
  const base = actor?.isToken ? (actor.token?.baseActor ?? actor) : actor;
  return {
    kind,
    available,
    snapshots,
    deferred,
    meta: { name: base?.name ?? "", img: base?.img ?? "", kind, available, uuid: base?.uuid ?? null, deferred },
  };
}

export class CreaturedexApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    // The frame stays bare; `.gl-glass` never goes on an ApplicationV2 frame,
    // because Foundry sets `.application { position: absolute }` inside
    // `@layer applications` and an unlayered utility that declares `position`
    // wins outright, dropping the window into normal document flow.
    id: "gldex-app",
    classes: ["gldex", "gldex-app"],
    tag: "div",
    window: { title: "GLDEX.app.title", icon: "fa-solid fa-book-skull", resizable: true },
    position: { width: 760, height: 680 },
    actions: {
      setOwner: CreaturedexApp.prototype._onSetOwner,
      setSubject: CreaturedexApp.prototype._onSetSubject,
      jumpSection: CreaturedexApp.prototype._onJump,
      revealSection: CreaturedexApp.prototype._onReveal,
      falsifySection: CreaturedexApp.prototype._onFalsify,
      clearSection: CreaturedexApp.prototype._onClear,
      refreshSubject: CreaturedexApp.prototype._onRefresh,
      forgetSubject: CreaturedexApp.prototype._onForget,
    },
  };

  #ownerId = null;
  #subject = null;
  /** A creature the GM opened on that nobody has learned anything about yet. */
  #pending = null;
  #query = "";
  /** Sections drawn as held, per subject and read, so a new one can unseal on screen. */
  #held = new Map();
  /** The subject last drawn, so switching entries plays the entrance and a re-render does not. */
  #shown = null;

  constructor(options = {}) {
    super(options);
    // Party-wide is the GM's default. The common case at a real table is that
    // the players have just been told out loud, so the per-player reveal is
    // the exception rather than a click on every ordinary one.
    this.#ownerId = options.ownerId ?? (game.user.isGM ? PARTY_KEY : null);
    this.#subject = options.subject ?? null;
    this.#pending = options.pending ?? null;
  }

  /** True when the GM has the whole party selected rather than one character. */
  get everyone() {
    return game.user.isGM && (partyMode() || this.#ownerId === PARTY_KEY || !this.owner);
  }

  get owner() {
    const pool = viewableCharacters();
    if (game.user.isGM) return this.#ownerId && this.#ownerId !== PARTY_KEY ? (pool.find((a) => a.id === this.#ownerId) ?? null) : null;
    return pool.find((a) => a.id === this.#ownerId) ?? pool[0] ?? null;
  }

  /**
   * The key a *read* resolves against.
   *
   * `PARTY_KEY` makes `knownSections` union every owner, which is exactly what
   * "what does the party know" means and is also what the Party Knowledge
   * sidebar does for a single character. So the whole-party view is a read mode,
   * not a separate store.
   */
  get readKey() {
    return this.everyone ? PARTY_KEY : ownerKey(this.owner);
  }

  /**
   * The characters a *write* lands on.
   *
   * Fanned out across the party rather than written to a shared `party` bucket.
   * A shared bucket would only read back while the Party Knowledge setting was
   * on, so turning that setting off would silently delete everything the GM had
   * revealed to "everyone", and each character's own dex would be empty while
   * the GM's screen looked correct.
   */
  get writeKeys() {
    if (!this.everyone) {
      const key = ownerKey(this.owner);
      return key ? [key] : [];
    }
    return partyCharacters().map((a) => a.id);
  }

  /** The live creature behind the current entry, for the GM's writes only. */
  async #actor(key = this.#subject) {
    if (this.#pending && dexKey(this.#pending) === key) return this.#pending;
    const uuid = subjectMeta(key)?.uuid ?? null;
    return uuid ? await fromUuid(uuid).catch(() => null) : null;
  }

  async _prepareContext() {
    const isGM = game.user.isGM;
    const party = partyMode();
    const characters = viewableCharacters().map((a) => ({ id: a.id, name: a.name }));
    const data = readAll();
    const pending = isGM && this.#pending ? { key: dexKey(this.#pending), meta: snapshotOf(this.#pending).meta } : null;
    const base = { data, isGM, party, characters, ownerId: this.#ownerId, subject: this.#subject, pending, query: this.#query };

    let model = dexModel(base);
    this.#subject = model.subject;

    // What the live creature says about itself, for the GM's eyes only.
    let live = null;
    if (isGM && model.subject) {
      const actor = await this.#actor(model.subject);
      if (actor) live = { deferredCount: buildSections(actor).deferred.length };
    }

    // A section that became held since this subject was last drawn unseals.
    const memo = `${model.subject}|${model.readKey}`;
    const held = new Set((model.detail?.sections ?? []).filter((s) => s.state !== "sealed").map((s) => s.key));
    const before = this.#held.get(memo);
    const fresh = before ? [...held].filter((k) => !before.has(k)) : [];
    this.#held.set(memo, held);

    const entering = model.subject !== this.#shown;
    this.#shown = model.subject;
    model = dexModel({ ...base, subject: model.subject, live, fresh, entering });
    // PF2e Odds hangs its "observed" line off `detail.key` from this context.
    return model;
  }

  async _renderHTML(context) {
    await prepareDetail(context.detail, { t, enrich });
    return dexHTML(context, { t });
  }

  _replaceHTML(result, content) {
    const sameSubject = content.querySelector(".gldex-detail-head") && this.#shown === content.dataset.gldexSubject;
    const detailTop = content.querySelector(".gldex-detail")?.scrollTop ?? 0;
    const shelfTop = content.querySelector(".gldex-shelf-list")?.scrollTop ?? 0;
    const searching = document.activeElement?.name === "gldex-query" && content.contains(document.activeElement);
    content.innerHTML = result;
    content.dataset.gldexSubject = this.#shown ?? "";
    const shelf = content.querySelector(".gldex-shelf-list");
    if (shelf) shelf.scrollTop = shelfTop;
    const detail = content.querySelector(".gldex-detail");
    if (detail && sameSubject) detail.scrollTop = detailTop;
    if (searching) {
      const input = content.querySelector("input[name='gldex-query']");
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    const input = root?.querySelector("input[name='gldex-query']");
    input?.addEventListener("input", () => this.#filter(input.value));
    // Bring a section that just unsealed into view; the GM's click may have
    // landed while the player was reading something else.
    const fresh = root?.querySelector(".gldex-section.is-fresh");
    if (fresh && !game.user.isGM) fresh.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** Filter the shelf in place, so typing never re-renders under the cursor. */
  #filter(query) {
    this.#query = String(query ?? "");
    const entries = [...(this.element?.querySelectorAll(".gldex-entry") ?? [])];
    for (const el of entries) el.hidden = !matchesQuery(el.dataset.name, this.#query);
    const none = this.element?.querySelector(".gldex-nomatch");
    if (none) none.hidden = !(entries.length && entries.every((el) => el.hidden));
  }

  /* ── actions ─────────────────────────────────────────────────────────── */

  async _onSetOwner(event, target) {
    this.#ownerId = target.dataset.owner ?? null;
    await this.render();
  }

  async _onSetSubject(event, target) {
    this.#subject = target.dataset.key ?? null;
    if (this.#pending && dexKey(this.#pending) !== this.#subject) this.#pending = null;
    await this.render();
  }

  _onJump(event, target) {
    const key = target.dataset.section;
    const plate = this.element?.querySelector(`.gldex-section[data-section="${CSS.escape(key ?? "")}"]`);
    plate?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /**
   * The GM's manual controls.
   *
   * This is the whole reveal mechanism, by design. Nothing here watches a
   * Recall Knowledge roll: the GM clicks when the table has earned it, which
   * covers the check the module never saw, the creature nobody targeted and the
   * correction after a misclick without any of them being special cases.
   *
   * No write re-renders the window itself. The `updateSetting` hook redraws
   * every open dex on every client, this one included, exactly once, which is
   * what lets a section unseal on the player's screen and on the GM's alike.
   */
  #write(target) {
    if (!game.user.isGM) return null;
    const section = target?.dataset?.section ?? null;
    const owners = this.writeKeys;
    if (!section || !owners.length || !this.#subject) {
      if (section && !owners.length) ui.notifications?.warn(t("GLDEX.app.noOwners"));
      return null;
    }
    return { section, owners, key: this.#subject, everyone: this.everyone };
  }

  #ownerActors(ids) {
    return ids.map((id) => game.actors?.get(id)).filter(Boolean);
  }

  async _onReveal(event, target) {
    const w = this.#write(target);
    if (!w) return;
    const actor = await this.#actor();
    if (!actor) {
      ui.notifications?.warn(t("GLDEX.app.noActor"));
      return;
    }
    // The snapshot is taken here, on the GM's client, post-flatten: the numbers
    // that will actually apply at this table.
    const snap = snapshotOf(actor);
    if (!(await reveal(w.key, w.owners, w.section, snap.snapshots, snap.meta))) return;
    this.#pending = null;
    await afterHandover({ subject: w.key, section: w.section, owners: this.#ownerActors(w.owners), everyone: w.everyone });
  }

  /**
   * Plant a lie by hand, through the authoring dialog.
   *
   * The book produces one on a critical failure, but a GM needs to make the
   * same thing happen for a reason the dice did not supply: a disguised
   * creature, a poisoned source, a lie the party was told in character.
   */
  async _onFalsify(event, target) {
    const w = this.#write(target);
    if (!w) return;
    const actor = await this.#actor();
    const snap = actor ? snapshotOf(actor) : null;
    const meta = snap?.meta ?? subjectMeta(w.key);
    openFalsify({
      dexKey: w.key,
      section: w.section,
      owners: w.owners,
      everyone: w.everyone,
      toName: w.everyone ? t("GLDEX.app.everyone") : (this.owner?.name ?? ""),
      name: meta?.name ?? actor?.name ?? "",
      kind: meta?.kind ?? "creature",
      actorId: actor?.id ?? null,
      // The truth to doctor and to compare against: the creature as it is now,
      // else what the dex already holds for that section.
      truth: snap?.snapshots?.[w.section] ?? trueSnapshot(w.key, w.section),
      meta: snap?.meta ?? null,
    });
  }

  async _onClear(event, target) {
    const w = this.#write(target);
    if (!w) return;
    await redact(w.key, w.owners, w.section);
  }

  /**
   * Re-take every snapshot this entry holds.
   *
   * A snapshot is a memory and going stale is usually correct: a creature the
   * GM buffed last session *should* surprise the party. This is for the other
   * case: the GM fixed a typo, or rebuilt the creature, and wants the dex to
   * stop disagreeing with the thing on the board.
   */
  async _onRefresh() {
    if (!game.user.isGM || !this.#subject) return;
    const actor = await this.#actor();
    if (!actor) {
      ui.notifications?.warn(t("GLDEX.app.noActor"));
      return;
    }
    const snap = snapshotOf(actor);
    if (await refresh(this.#subject, snap.snapshots, snap.meta)) ui.notifications?.info(t("GLDEX.app.refreshed", { name: snap.meta.name }));
  }

  async _onForget(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.key ?? this.#subject;
    if (!key) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("GLDEX.forget.title") },
      content: `<p>${escapeHTML(t("GLDEX.forget.body"))}</p>`,
    });
    if (!ok) return;
    this.#subject = null;
    await forget(key);
  }

  /** One window, reused: a second dex open beside the first is just confusing. */
  static open(options = {}) {
    const existing = foundry.applications.instances.get("gldex-app");
    if (existing instanceof CreaturedexApp) {
      if (options.ownerId) existing.#ownerId = options.ownerId;
      if (options.subject) existing.showSubject(options.subject, options.pending ?? null, false);
      return existing.render({ force: true });
    }
    return new CreaturedexApp(options).render({ force: true });
  }

  /** Point an already-open window at a creature without re-opening it. */
  showSubject(key, pending = null, draw = true) {
    this.#subject = key ?? null;
    this.#pending = pending;
    if (draw && this.rendered) this.render();
  }

  /**
   * Redraw an open dex after the knowledge or a read rule changed, on every
   * client. A player whose access was just switched off loses the window.
   */
  static refreshOpen() {
    const app = foundry.applications.instances.get("gldex-app");
    if (!(app instanceof CreaturedexApp) || !app.rendered) return;
    if (!mayOpen()) return app.close();
    return app.render();
  }

  /**
   * Open the entry for a creature on the canvas.
   *
   * A player may only open a creature they have learned something about. An
   * unknown creature's entry would print its **actor** name and portrait, and a
   * GM who hid a token's name did so on purpose, so "nothing learned" is the
   * honest answer rather than a window that quietly identifies the thing the
   * party is looking at.
   *
   * Knowing a *lie* counts. A player who was told one cannot see that it is
   * false, so refusing to open there would be the module losing the only thing
   * they were given.
   */
  static mayView(actor) {
    const key = dexKey(actor);
    if (!key) return null;
    if (game.user.isGM) return key;
    const known = viewableCharacters().some(
      (pc) => knownSections(key, ownerKey(pc)).length || falseSections(key, ownerKey(pc)).length
    );
    return known ? key : null;
  }

  /** The character whose dex holds something about this subject, for a player with several. */
  static #knowerOf(key) {
    return viewableCharacters().find((pc) => knownSections(key, ownerKey(pc)).length || falseSections(key, ownerKey(pc)).length) ?? null;
  }

  static openForActor(actor) {
    const key = CreaturedexApp.mayView(actor);
    if (!key) {
      ui.notifications?.info(t("GLDEX.app.unknown", { name: actor?.token?.name ?? actor?.name ?? "" }));
      return null;
    }
    // The GM may open a creature nothing is known about; the actor rides along
    // so the reveal controls have something to read. A player opens it in the
    // dex of whichever of their characters actually knows it.
    if (game.user.isGM) return CreaturedexApp.open({ subject: key, pending: actor });
    return CreaturedexApp.open({ subject: key, ownerId: CreaturedexApp.#knowerOf(key)?.id ?? null });
  }

  /**
   * Follow the user's target, but only into a window that is already open.
   *
   * Targeting is a thing players do constantly and for reasons that have nothing
   * to do with the dex; opening a window on it would be a window that appears
   * while you are aiming a spell. Silent when the creature is unknown.
   */
  static followTarget(actor) {
    const app = foundry.applications.instances.get("gldex-app");
    if (!(app instanceof CreaturedexApp) || !app.rendered) return;
    const key = CreaturedexApp.mayView(actor);
    if (!key) return;
    if (!game.user.isGM) {
      const knower = CreaturedexApp.#knowerOf(key);
      if (knower) app.#ownerId = knower.id;
    }
    app.showSubject(key, game.user.isGM ? actor : null);
  }
}
