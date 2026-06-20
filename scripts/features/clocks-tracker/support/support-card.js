/**
 * SupportCard — fires a support ability: resolves its authored tokens into native
 * PF2e inline automation (computed from the support's level + benchmark tiers),
 * enriches it into the interactive buttons PF2e renders everywhere, rolls the
 * availability pool for Field Calls, and posts the result as a chat card.
 *
 * Authoring tokens a GM may use in an ability's card text:
 *   {level} {half} {pool}            — computed numbers
 *   @check[reflex|high]              — a save/check the TARGET rolls vs the support's DC
 *   @roll[athletics|moderate]        — a d20 check the SUPPORT rolls (skill/save/perception)
 *   @atk[high]                       — a Strike attack roll at the chosen tier
 *   @dmg[moderate]                   — benchmark Strike damage dice at the tier
 *   @damage[2d6+{level}]             — a custom damage formula
 *   @heal[2d8+{level}]               — healing
 *   @dc[dc|high]                     — a bare DC number (dc/ac/save/skill/perception)
 *   @effect[0]                       — link the ability's Nth dropped Effect (@UUID)
 *
 * On PF2e these become @Check / @Damage / @UUID; on other systems they degrade to
 * core [[/r ]] inline rolls + @UUID, so the card is still useful everywhere.
 */

import { MODULE_ID, FLAG_NS, SUPPORT_ROUND_LIMITED_KINDS } from "../const.js";
import { SupportStore } from "./support-store.js";
import { Benchmarks } from "./benchmarks.js";
import { clamp, toInt as int } from "../../../core/util.mjs";

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const SAVES = ["fortitude", "reflex", "will"];

/** Map an author's stat word to a benchmark stat key for @roll/@dc. */
function statKey(word) {
  const w = String(word).toLowerCase();
  if (SAVES.includes(w)) return "save";
  if (w === "perception" || w === "per") return "perception";
  if (w === "dc") return "dc";
  if (w === "ac") return "ac";
  if (w === "spellattack" || w === "spell") return "spellAttack";
  if (w === "attack" || w === "strike") return "attack";
  return "skill";
}

export class SupportCard {
  /** The TextEditor used to enrich inline syntax (v13 namespaced, with fallback). */
  static get _enricher() {
    return foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  }

  /** Resolve authoring tokens → PF2e (or core) inline source for enrichment. */
  static resolveTokens(text, support, ability) {
    const pf2e = SupportStore.isPF2e;
    const lvl = support.level;
    const half = Math.floor(lvl / 2);

    let src = String(text ?? "")
      .replace(/\{level\}/g, lvl)
      .replace(/\{half\}/g, half)
      .replace(/\{pool\}/g, support.current ?? 0);

    // @check[type|tier] — the target rolls vs the support's DC
    src = src.replace(/@check\[([a-z]+)(?:\|([a-z]+))?\]/gi, (_m, type, tier) => {
      const dc = Benchmarks.resolve("dc", lvl, tier || "moderate");
      return pf2e ? `@Check[${type.toLowerCase()}|dc:${dc}]`
                  : `<strong>${cap(type)} DC ${dc}</strong>`;
    });

    // @roll[stat|tier] — a d20 check the support makes
    src = src.replace(/@roll\[([a-z]+)(?:\|([a-z]+))?\]/gi, (_m, stat, tier) => {
      const n = Benchmarks.resolve(statKey(stat), lvl, tier || "moderate");
      const sign = n >= 0 ? `+${n}` : `${n}`;
      return `[[/r 1d20${sign} #${cap(stat)}]]{${cap(stat)} ${sign}}`;
    });

    // @atk[tier] — a Strike
    src = src.replace(/@atk\[([a-z]+)?\]/gi, (_m, tier) => {
      const n = Benchmarks.resolve("attack", lvl, tier || "moderate");
      return `[[/r 1d20+${n} #Strike]]{Strike +${n}}`;
    });

    // @dmg[tier] — benchmark Strike damage dice
    src = src.replace(/@dmg\[([a-z]+)?\]/gi, (_m, tier) => {
      const dice = Benchmarks.resolve("damage", lvl, tier || "moderate");
      return pf2e ? `@Damage[${dice}]` : `[[/r ${dice}]]{${dice} damage}`;
    });

    // @damage[formula] / @heal[formula] — custom expressions
    src = src.replace(/@damage\[([^\]]+)\]/gi, (_m, f) =>
      pf2e ? `@Damage[${f}]` : `[[/r ${f}]]{${f} damage}`);
    src = src.replace(/@heal\[([^\]]+)\]/gi, (_m, f) =>
      pf2e ? `@Damage[(${f})[healing]]` : `[[/r ${f}]]{${f} healing}`);

    // @dc[stat|tier] — a bare number
    src = src.replace(/@dc\[([a-z]+)(?:\|([a-z]+))?\]/gi, (_m, stat, tier) =>
      String(Benchmarks.resolve(statKey(stat), lvl, tier || "moderate")));

    // @effect[idx] — link the ability's Nth dropped Effect
    src = src.replace(/@effect\[(\d+)\]/gi, (_m, idx) => {
      const uuid = ability?.effectUuids?.[Number(idx)];
      return uuid ? `@UUID[${uuid}]` : "";
    });

    return src;
  }

  /** Enrich resolved source into final card HTML. */
  static async enrich(text, support, ability) {
    const src = this.resolveTokens(text, support, ability);
    try { return await this._enricher.enrichHTML(src, { async: true }); }
    catch (err) { console.warn(`${MODULE_ID} | enrich failed`, err); return src; }
  }

  /**
   * Fire an ability. Validates permission / state, rolls the pool for Field Calls
   * (apply effect first, then roll → discard ≤ threshold), and posts the card.
   * Returns the resulting state delta (or null if it didn't fire).
   */
  static async fire(support, kind) {
    const ability = support?.abilities?.[kind];
    if (!ability) return null;
    if (!SupportStore.canInvoke(support)) {
      ui.notifications?.warn(game.i18n.localize("GLCT.support.cantInvoke"));
      return null;
    }
    if (support.downed) {
      ui.notifications?.warn(game.i18n.localize("GLCT.support.isDowned"));
      return null;
    }
    // Players need an active GM to persist the result (world-scope write).
    if (!game.user.isGM && !game.users.some(u => u.isGM && u.active)) {
      ui.notifications?.warn(game.i18n.localize("GLCT.support.noGM"));
      return null;
    }
    // The Free radio + the 1-action field call SHARE one 1/round action lock —
    // firing either consumes the round for both. Only enforced while in combat;
    // players are blocked once used, the GM overrides.
    const roundLimited = SUPPORT_ROUND_LIMITED_KINDS.includes(kind);
    const inCombat = !!game.combat?.started;
    if (roundLimited && inCombat && support.radioUsed && !game.user.isGM) {
      ui.notifications?.warn(game.i18n.localize("GLCT.support.radioUsed"));
      return null;
    }

    const burn = SupportStore.isBurnKind(kind);
    let footer = "";
    const result = {};

    if (burn) {
      const n = Math.max(0, Number(support.current) || 0);
      if (n <= 0) { ui.notifications?.warn(game.i18n.localize("GLCT.support.poolEmpty")); return null; }
      // Match the canonical default (SupportStore._sanitizeSupport): a roster
      // entry that predates the discard field — or any unsaved/imported support
      // the read-side never sanitized — must fall back to 2, NOT 0. With a 0
      // threshold every d6 face survives, so the pool never drops and no die
      // renders as discarded.
      const discard = clamp(int(support.discard, 2), 0, 5);
      const roll = await new Roll(`${n}d6`).evaluate();
      // Mark dice rolling at/under the threshold as discarded on the term itself so
      // the roll renders them dropped (Dice So Nice fades active:false / discarded
      // dice). A plain Nd6 has no keep/drop modifier, so we set the flags by hand.
      const results = roll.dice[0]?.results ?? [];
      for (const r of results) {
        if (r.result <= discard) { r.discarded = true; r.active = false; }
      }
      const faces = results.map(r => r.result);
      const remaining = faces.filter(v => v > discard).length;
      if (game.dice3d) {
        try { await game.dice3d.showForRoll(roll, game.user, true); }
        catch (err) { console.warn(`${MODULE_ID} | Dice So Nice roll failed`, err); }
      }
      result.current = remaining;
      result.downed = remaining <= 0;
      if (remaining <= 0) result.downedLastMission = true;
      footer = this._poolFooter({ faces, discard, remaining });
    }
    // Consume the shared 1/round action lock (radio OR field-combat), but only
    // while in combat — out of combat there's no per-round economy to spend.
    if (roundLimited && inCombat) result.radioUsed = true;

    const body = await this.enrich(ability.cardText, support, ability);
    const { content, message } = await this._post({ support, kind, ability, body, footer, result });
    return { result, content, message };
  }

  /** Compact kept-vs-discarded dice footer for a Field Call. */
  static _poolFooter({ faces, discard, remaining }) {
    const empty = remaining <= 0;
    const dice = faces.map(v =>
      `<span class="glct-sc-die${v <= discard ? " drop" : ""}">${v}</span>`).join("");
    const label = empty
      ? game.i18n.localize("GLCT.support.card.downed")
      : game.i18n.format("GLCT.support.card.poolLeft", { n: remaining });
    return `<div class="glct-sc-pool${empty ? " empty" : ""}">
        <span class="glct-sc-pool-lbl"><i class="fa-solid fa-dice"></i> ${label}</span>
        <span class="glct-sc-pool-dice">${dice}</span>
      </div>`;
  }

  /** Build the card's inner HTML (reused by the chat message and the HUD takeover). */
  static buildContent({ support, kind, ability, body, footer }) {
    const kindLabel = game.i18n.localize(`GLCT.support.kinds.${kind}`);
    const traits = (ability.traits ?? []).map(t =>
      `<span class="glct-sc-trait">${foundry.utils.escapeHTML(t)}</span>`).join("");
    // Diorama header: the portrait art bleeds in from the left and fades out,
    // framed by the support's saved "card" crop (x / y / scale).
    const f = SupportStore.frame(support, "card");
    const headArt = support.img
      ? `<img class="glct-sc-art" src="${support.img}" alt="" style="--cx:${f.x}px;--cy:${f.y}px;--cs:${f.s}">`
      : `<i class="glct-sc-ph fa-solid fa-user-shield"></i>`;

    return `
      <div class="glct-support-card" style="--glct-sup-accent:${support.accent}">
        <div class="glct-sc-head">
          ${headArt}
          <span class="glct-sc-who">
            <span class="glct-sc-cost">${foundry.utils.escapeHTML(ability.costLabel || kindLabel)}</span>
            <span class="glct-sc-a">${foundry.utils.escapeHTML(support.name)} · ${game.i18n.localize("GLCT.support.support")}</span>
            <span class="glct-sc-b">${foundry.utils.escapeHTML(ability.name || kindLabel)}</span>
          </span>
        </div>
        ${traits ? `<div class="glct-sc-traits">${traits}</div>` : ""}
        <div class="glct-sc-body">${body}</div>
        ${footer}
      </div>`;
  }

  static async _post({ support, kind, ability, body, footer, result }) {
    const content = this.buildContent({ support, kind, ability, body, footer });
    const speaker = ChatMessage.implementation.getSpeaker({ alias: support.name || "Support" });
    const message = await ChatMessage.implementation.create({
      speaker, content,
      flags: { [MODULE_ID]: { [FLAG_NS]: { supportAction: { supportId: support.id, kind, result }, supportCard: true } } }
    });
    return { content, message };
  }
}
