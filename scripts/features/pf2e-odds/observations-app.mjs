/**
 * PF2e Odds — the GM's Observations view.
 *
 * A read of `od.ledger` laid out one creature kind per block, with the GM's
 * three resets: one stat, one creature, everything. It never writes the ledger
 * itself — every reset goes through `observe.mjs`, which serialises writes so a
 * reset cannot race a card landing in chat.
 *
 * The class is built on first use, not at import time (the pattern
 * `pf2e-variant-rules/dent-config.mjs` documents): `settings.mjs` imports this
 * module, and it is reached transitively by pure modules the check tools load
 * under plain Node, where `foundry` does not exist. The factory is memoised so
 * `registerMenu` and the scene-control road get the same class.
 *
 * The label and range formatters are exported because the Creaturedex hint
 * (`dex-hint.mjs`) prints the same facts and must print them the same way.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { STATS, SETTINGS, STRIKE_PREFIX, isStrikeStat, statKind } from "./constants.mjs";
import { PARTY } from "./ledger-model.mjs";

/**
 * Loaded on first use. settings.mjs imports this file, so a static import here
 * would pull the chat watcher and Creaturedex into every tool that only wants
 * a setting key.
 */
const writer = () => import("./observe.mjs");
const knowledge = () => import("./knowledge.mjs");

let _app = null;

const L = (key, fallback) => {
  const s = game.i18n.localize(key);
  return s === key ? (fallback ?? key) : s;
};
const F = (key, data, fallback) => {
  const s = game.i18n.format(key, data);
  return s === key ? (fallback ?? key) : s;
};

/** Saves and Perception are stored as DCs; their labels name the bare statistic. */
const DC_SUFFIXED = new Set(["fortitude", "reflex", "will", "perception"]);

/** `strike:jaws` → "Jaws", `strike:longsword-2` → "Longsword 2". */
const prettySlug = (slug) =>
  String(slug ?? "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** The human label for a ledger stat key. */
export function statLabel(key) {
  if (isStrikeStat(key)) {
    const name = prettySlug(key.slice(STRIKE_PREFIX.length));
    return F("GLOD.observations.strikeLabel", { name }, `${name} attack`);
  }
  const base = STATS[key] ? L(STATS[key].label, key) : prettySlug(key);
  return DC_SUFFIXED.has(key) ? F("GLOD.observations.dcLabel", { stat: base }, `${base} DC`) : base;
}

/** Sort order: the STATS table's own order, then Strikes alphabetically, then anything unknown. */
function statOrder(key) {
  const keys = Object.keys(STATS);
  const i = keys.indexOf(key);
  if (i >= 0) return [0, i, ""];
  return [isStrikeStat(key) ? 1 : 2, 0, key];
}
export const compareStats = (a, b) => {
  const [ga, ia, sa] = statOrder(a);
  const [gb, ib, sb] = statOrder(b);
  return ga - gb || ia - ib || sa.localeCompare(sb);
};

const finite = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * A stored range as text. Open ends are null in storage (JSON has no Infinity).
 * A modifier is signed; a DC is not.
 */
export function rangeText(rec, key) {
  const signed = statKind(key) === "mod";
  const fmt = (v) => (signed && v >= 0 ? `+${v}` : String(v));
  const lo = finite(rec?.lo) ? rec.lo : null;
  const hi = finite(rec?.hi) ? rec.hi : null;
  if (lo !== null && hi !== null) {
    return lo === hi ? fmt(lo) : F("GLOD.observations.range.between", { lo: fmt(lo), hi: fmt(hi) }, `${fmt(lo)}–${fmt(hi)}`);
  }
  if (lo !== null) return F("GLOD.observations.range.atLeast", { value: fmt(lo) }, `≥ ${fmt(lo)}`);
  if (hi !== null) return F("GLOD.observations.range.atMost", { value: fmt(hi) }, `≤ ${fmt(hi)}`);
  return L("GLOD.observations.range.unknown", "?");
}

const ownerName = (owner) =>
  owner === PARTY ? L("GLOD.observations.party", "Party") : (game.actors?.get(owner)?.name ?? owner);

/** `attack-roll:abc123` → "attack roll". The message id is not for reading. */
const sourceText = (src) => {
  const s = String(src ?? "");
  const i = s.lastIndexOf(":");
  return (i > 0 ? s.slice(0, i) : s).replace(/[-_]+/g, " ").trim();
};

const stamp = (at) => {
  if (!finite(at) || at <= 0) return "";
  try {
    return new Date(at).toLocaleString();
  } catch {
    return "";
  }
};

/** The ledger as rows for the template. Pure over its argument. */
function rowsOf(ledger) {
  const kinds = [];
  for (const [key, entry] of Object.entries(ledger ?? {})) {
    const owners = entry?.owners ?? {};
    const stats = [];
    for (const [owner, rec] of Object.entries(owners)) {
      for (const [stat, value] of Object.entries(rec ?? {})) {
        if (!value || typeof value !== "object") continue;
        stats.push({
          kind: key,
          stat,
          label: statLabel(stat),
          range: rangeText(value, stat),
          owner: ownerName(owner),
          isParty: owner === PARTY,
          src: sourceText(value.src),
          when: stamp(value.at),
          contradiction: !!value.contradiction,
        });
      }
    }
    if (!stats.length) continue;
    stats.sort((a, b) => compareStats(a.stat, b.stat) || a.owner.localeCompare(b.owner));
    const name = entry?.name || key;
    kinds.push({
      key,
      name,
      count: stats.length,
      stats,
      contradictions: stats.some((s) => s.contradiction),
      search: `${name} ${key}`.toLowerCase(),
    });
  }
  kinds.sort((a, b) => a.name.localeCompare(b.name));
  return kinds;
}

export function ObservationsMenu() {
  if (_app) return _app;
  const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

  _app = class ObservationsApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      // The glass lives on `.glod-obs-root` inside the window content, never on
      // the frame: `.gl-glass` declares `position`, which would beat Foundry's
      // layered `.application { position: absolute }` and drop the window
      // into document flow.
      id: "glod-observations",
      classes: ["glod", "glod-obs"],
      tag: "div",
      window: { title: "GLOD.observations.title", icon: "fa-solid fa-binoculars", resizable: true },
      position: { width: 560, height: 640 },
      actions: {
        forgetStat: ObservationsApp.prototype._onForgetStat,
        forgetKind: ObservationsApp.prototype._onForgetKind,
        forgetAll: ObservationsApp.prototype._onForgetAll,
      },
    };

    static PARTS = {
      main: { template: `modules/${SUITE_ID}/templates/pf2e-odds/observations.hbs` },
    };

    /** The filter survives re-renders, which arrive whenever the ledger moves. */
    #query = "";
    #hook = null;

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const { partyMode, readLedger } = await knowledge();
      const kinds = rowsOf(readLedger());
      return {
        ...context,
        isGM: !!game.user?.isGM,
        kinds,
        empty: !kinds.length,
        total: kinds.reduce((n, k) => n + k.count, 0),
        query: this.#query,
        modeLabel: partyMode()
          ? L("GLOD.observations.modeParty", "Party knowledge")
          : L("GLOD.observations.modeCharacter", "Per character"),
      };
    }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      // Registered while the window is open, never at import time.
      this.#hook = Hooks.on("updateSetting", (setting) => {
        if (String(setting?.key ?? "") === `${SUITE_ID}.${SETTINGS.ledger}`) this.render();
      });
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      const input = this.element.querySelector(".glod-obs-search");
      if (!input) return;
      input.addEventListener("input", () => {
        this.#query = input.value;
        this.#applyFilter();
      });
      this.#applyFilter();
    }

    _onClose(options) {
      if (this.#hook !== null) Hooks.off("updateSetting", this.#hook);
      this.#hook = null;
      super._onClose?.(options);
    }

    /** Hide kinds that do not match; a search never re-renders. */
    #applyFilter() {
      const q = this.#query.trim().toLowerCase();
      let shown = 0;
      for (const el of this.element.querySelectorAll(".glod-obs-kind")) {
        const hit = !q || String(el.dataset.search ?? "").includes(q);
        el.hidden = !hit;
        if (hit) shown += 1;
      }
      const none = this.element.querySelector(".glod-obs-nomatch");
      if (none) none.hidden = !q || shown > 0;
    }

    async _onForgetStat(_event, target) {
      if (!game.user?.isGM) return;
      const { kind, stat } = target?.dataset ?? {};
      if (kind && stat) await (await writer()).forgetStat(kind, stat);
    }

    async _onForgetKind(_event, target) {
      if (!game.user?.isGM) return;
      const kind = target?.dataset?.kind;
      if (kind) await (await writer()).forgetStat(kind, null);
    }

    async _onForgetAll() {
      if (!game.user?.isGM) return;
      const ok = await DialogV2.confirm({
        window: { title: L("GLOD.observations.forgetAllTitle", "Forget every observation?") },
        content: `<p>${L(
          "GLOD.observations.forgetAllConfirm",
          "Every range the party has observed, for every creature, is erased. Creaturedex is not touched."
        )}</p>`,
      });
      if (ok) await (await writer()).forgetAll();
    }
  };

  return _app;
}
