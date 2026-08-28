/**
 * GLUniverse Suite — Recall Knowledge: subject extraction.
 *
 * Turns any supported document into a plain-text brief for the clipboard
 * payload. Four document types produce four different shapes; a Scene carries
 * almost nothing on its own and leans on the GM's free-text context.
 *
 * Two things this module is careful about:
 *
 *  1. PF2e rules text is dense with enricher syntax (`@Damage[...]`,
 *     `@Check[...]`, `@UUID[...]{Label}`, `@Template[...]`). Stripping HTML
 *     without resolving those leaves raw markup in the payload, and a
 *     regex that also removes digits produces sentences like "within feet".
 *     `flattenEnrichers` resolves them to readable prose instead.
 *  2. The payload is GM-facing, so it KEEPS numbers. The "weaknesses as types,
 *     never numbers" rule governs what the model is asked to *write*, not what
 *     it is allowed to *read*.
 *
 * Everything here is pure and Foundry-free except `subjectBrief`, so
 * tools/recall-check.mjs can exercise the text pipeline under plain Node.
 */

import { EXTRACT_CHAR_CAP } from "./constants.mjs";

/* -------------------------------------------------- text pipeline ------- */

/** Collapse runs of whitespace without disturbing paragraph breaks. */
function tidy(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Resolve PF2e/Foundry enricher syntax to readable text.
 *
 * Order matters: `@UUID` labels are taken before the generic bracket sweep, and
 * `@Damage` is unwrapped from the inside out because its damage-type sits in a
 * nested bracket (`@Damage[2d6[fire]]`).
 */
export function flattenEnrichers(text) {
  let out = String(text ?? "");

  // @UUID[...]{Label} -> Label ; @UUID[...] -> trailing path segment
  out = out.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1");
  out = out.replace(/@UUID\[([^\]]*)\]/g, (_m, ref) => String(ref).split(".").pop());

  // @Damage[2d6[fire]] -> "2d6 fire" ; @Damage[(2d6)[fire]]{Label} -> Label
  out = out.replace(/@Damage\[[^\]]*(?:\[[^\]]*\])?[^\]]*\]\{([^}]*)\}/g, "$1");
  out = out.replace(/@Damage\[([^\]]*?)\[([^\]]*)\]\]/g, (_m, dice, type) =>
    `${String(dice).replace(/[()]/g, "")} ${type}`.trim()
  );
  out = out.replace(/@Damage\[([^\]]*)\]/g, (_m, body) => String(body).replace(/[()]/g, ""));

  // @Check[reflex|dc:20] -> "Reflex DC 20" ; also the older type:reflex form
  out = out.replace(/@Check\[([^\]]*)\](?:\{([^}]*)\})?/g, (_m, body, label) => {
    if (label) return label;
    const parts = String(body).split("|");
    const stat = (parts[0] || "").replace(/^type:/, "");
    const dc = parts.find((p) => /^dc:/.test(p))?.slice(3);
    const name = stat.charAt(0).toUpperCase() + stat.slice(1);
    return dc ? `${name} DC ${dc}` : name;
  });

  // @Template[burst|distance:20] -> "20-foot burst"
  out = out.replace(/@Template\[([^\]]*)\](?:\{([^}]*)\})?/g, (_m, body, label) => {
    if (label) return label;
    const parts = String(body).split("|");
    const shape = (parts[0] || "").replace(/^type:/, "");
    const dist = parts.find((p) => /^distance:/.test(p))?.slice(9);
    return dist ? `${dist}-foot ${shape}` : shape;
  });

  // Remaining @Thing[...]{Label} / @Thing[...] — keep the label, drop the call.
  out = out.replace(/@[A-Za-z]+\[[^\]]*\]\{([^}]*)\}/g, "$1");
  out = out.replace(/@[A-Za-z]+\[[^\]]*\]/g, "");

  return out;
}

/** Strip HTML to text, preferring the DOM when one exists. */
export function htmlToText(html) {
  const withEnrichers = flattenEnrichers(html);
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(
      String(withEnrichers).replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "</$1>\n"),
      "text/html"
    );
    return tidy(doc.body?.textContent ?? "");
  }
  return tidy(
    String(withEnrichers)
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

/**
 * Truncate to the cap on a paragraph boundary where possible.
 * Returns `{ text, truncated }` so the caller can announce the loss.
 */
export function capText(text, cap = EXTRACT_CHAR_CAP) {
  const value = tidy(text);
  if (value.length <= cap) return { text: value, truncated: false };
  const slice = value.slice(0, cap);
  const cut = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
  return { text: (cut > cap * 0.6 ? slice.slice(0, cut + 1) : slice).trim(), truncated: true };
}

/* -------------------------------------------------- helpers ------------- */

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
const named = (entries) => list(entries).map((e) => e?.type ?? e?.label ?? e).filter(Boolean);

const signed = (n) =>
  Number.isFinite(Number(n)) ? `${Number(n) >= 0 ? "+" : ""}${Number(n)}` : "";

/**
 * Join a value to its qualifying note as `value (note)`.
 * PF2e pairs a number with free text all over the statblock (AC 26 / "27 vs
 * ranged", HP 180 / "regeneration 20"); concatenating them bare produces
 * "26 27 vs ranged", which reads as two numbers.
 */
function withDetail(value, detail) {
  const v = value == null || value === "" ? "" : String(value).trim();
  const d = detail ? String(detail).trim() : "";
  if (!v) return d;
  return d ? `${v} (${d})` : v;
}

/** PF2e stores size abbreviated; spell it out for a reader. */
const SIZES = { tiny: "tiny", sm: "small", med: "medium", lg: "large", huge: "huge", grg: "gargantuan" };

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

/** Item types that make up an NPC's carried gear. */
const INVENTORY_TYPES = ["weapon", "armor", "shield", "consumable", "equipment", "backpack", "treasure"];

/** PF2e action cost, as a phrase a reader (and a model) understands. */
const ACTION_COST = { 1: "one action", 2: "two actions", 3: "three actions" };

/** `Str +5, Dex +2, …` — core statblock data the brief previously omitted. */
function abilityLine(actor) {
  return ABILITY_KEYS.map((k) => {
    const mod = actor?.system?.abilities?.[k]?.mod;
    return Number.isFinite(Number(mod))
      ? `${k.charAt(0).toUpperCase()}${k.slice(1)} ${signed(mod)}`
      : "";
  })
    .filter(Boolean)
    .join(", ");
}

/**
 * NPC skills live at `system.skills[slug].base`. Older data (and some importers)
 * used `mod` or `value`, so all three are accepted — the suite's own statblock
 * exporter reads them the same way.
 */
function skillLine(actor) {
  return Object.entries(actor?.system?.skills ?? {})
    .map(([slug, data]) => {
      const mod = data?.base ?? data?.mod ?? data?.value;
      return Number.isFinite(Number(mod)) ? `${slug} ${signed(mod)}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

/** Land speed plus every other movement mode — fly/swim/climb/burrow matter. */
function speedLine(actor) {
  const sp = actor?.system?.attributes?.speed ?? {};
  const parts = [];
  if (sp.value != null && sp.value !== "") parts.push(`${sp.value} feet`);
  for (const other of list(sp.otherSpeeds)) {
    const label = other?.type ?? other?.label;
    if (label) parts.push(`${label} ${other.value} feet`);
  }
  const line = parts.join(", ");
  return withDetail(line, sp.details);
}

/**
 * NPC attacks are `melee`-type items whether or not they are ranged; the
 * presence of `system.range` is what distinguishes the two. Attack bonus,
 * traits (reach, agile, deadly) and attack effects are all load-bearing for
 * "how it fights", so none of them are dropped.
 */
function attackEntries(actor) {
  return list(actor.itemTypes?.melee).map((item) => {
    const s = item.system ?? {};
    const damage = Object.values(s.damageRolls ?? {})
      .map((d) => `${d.damage} ${d.damageType}`)
      .filter(Boolean)
      .join(", ");
    const meta = [
      s.range ? "ranged" : "melee",
      signed(s.bonus?.value) ? `attack ${signed(s.bonus.value)}` : "",
      damage ? `damage ${damage}` : "",
      s.range?.increment ? `range increment ${s.range.increment} feet` : "",
      s.area?.value ? `${s.area.value}-foot ${s.area.type ?? "area"}` : "",
      list(s.traits?.value).length ? `traits ${list(s.traits.value).join(", ")}` : "",
      list(s.attackEffects?.value).length ? `effects ${list(s.attackEffects.value).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return { name: item.name, meta, text: capText(htmlToText(s.description?.value), 400).text };
  });
}

/**
 * Actions, reactions, free actions and passives, each labelled with its cost.
 * The distinction is the whole point: a passive aura and a three-action ritual
 * read identically without it.
 */
function actionEntries(actor) {
  return list(actor.itemTypes?.action).map((item) => {
    const s = item.system ?? {};
    const type = s.actionType?.value ?? "action";
    const cost =
      type === "action"
        ? ACTION_COST[s.actions?.value] ?? "one action"
        : type === "reaction"
          ? "reaction"
          : type === "free"
            ? "free action"
            : "passive";
    const meta = [cost, s.category, list(s.traits?.value).join(", ")].filter(Boolean).join(" · ");
    return { name: item.name, meta, text: capText(htmlToText(s.description?.value), 600).text };
  });
}

/** Sort spell ranks the way a statblock does: highest first, cantrips last. */
function rankOrder(label) {
  return label === "Cantrips" ? -1 : Number(label.replace(/\D/g, "")) || 0;
}

/**
 * Each spellcasting entry with its DC/attack and its actual spell list, grouped
 * by rank. Previously only the entry name and tradition survived, which told
 * the model a creature casts but never what.
 */
function spellEntries(actor) {
  const entries = list(actor.itemTypes?.spellcastingEntry);
  if (!entries.length) return [];
  const spells = list(actor.itemTypes?.spell);
  return entries.map((entry) => {
    const s = entry.system ?? {};
    const meta = [
      s.tradition?.value,
      s.prepared?.value,
      s.spelldc?.dc ? `DC ${s.spelldc.dc}` : "",
      s.spelldc?.value ? `attack ${signed(s.spelldc.value)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const byRank = new Map();
    for (const spell of spells.filter((sp) => sp.system?.location?.value === entry.id)) {
      const label = list(spell.system?.traits?.value).includes("cantrip")
        ? "Cantrips"
        : `Rank ${spell.system?.level?.value ?? "?"}`;
      if (!byRank.has(label)) byRank.set(label, []);
      byRank.get(label).push(spell.name);
    }
    const text = [...byRank.entries()]
      .sort((a, b) => rankOrder(b[0]) - rankOrder(a[0]))
      .map(([label, names]) => `${label}: ${names.join(", ")}`)
      .join("\n");
    return { name: entry.name, meta, text };
  });
}

/** Carried gear, as a single line — quantity only when it is more than one. */
function inventoryLine(actor) {
  return list(actor.items?.contents ?? actor.items)
    .filter((i) => INVENTORY_TYPES.includes(i?.type))
    .map((i) => (Number(i.system?.quantity) > 1 ? `${i.name} (${i.system.quantity})` : i.name))
    .join(", ");
}

/** Drop empty sections so the payload never prints a bare heading. */
const sections = (blocks) => blocks.filter((b) => b?.entries?.length);

function iwr(actor) {
  const a = actor?.system?.attributes ?? {};
  const fmt = (entries, withValue) =>
    list(entries)
      .map((e) => {
        const label = e?.type ?? e?.label ?? String(e);
        const value = withValue && e?.value != null ? ` ${e.value}` : "";
        const except = list(e?.exceptions).length ? ` (except ${list(e.exceptions).join(", ")})` : "";
        return `${label}${value}${except}`;
      })
      .filter(Boolean);
  return {
    immunities: fmt(a.immunities, false),
    weaknesses: fmt(a.weaknesses, true),
    resistances: fmt(a.resistances, true),
  };
}

/** Saves as name+value pairs, plus which is lowest — the most-asked RK fact. */
function saves(actor) {
  const s = actor?.system?.saves ?? {};
  const rows = ["fortitude", "reflex", "will"]
    .map((k) => ({ key: k, value: Number(s?.[k]?.value) }))
    .filter((r) => Number.isFinite(r.value));
  if (!rows.length) return null;
  const lowest = rows.reduce((a, b) => (b.value < a.value ? b : a));
  // Per-save notes ("+1 status to all saves vs. magic") change how a save
  // actually plays, so they travel with the numbers.
  const details = ["fortitude", "reflex", "will"]
    .map((k) => (s?.[k]?.saveDetail ? `${k}: ${s[k].saveDetail}` : ""))
    .filter(Boolean)
    .join("; ");
  return { rows, lowest: lowest.key, details };
}

/* -------------------------------------------------- per-type ------------ */

/**
 * A hazard is a different actor type with a different shape: no abilities, no
 * languages, but hardness, stealth and the disable/routine/reset triad, and its
 * prose lives in `details.description` rather than `publicNotes`. Extracting it
 * as a creature produced a near-empty brief.
 */
function extractHazard(actor) {
  const sys = actor.system ?? {};
  const sv = saves(actor);
  const { immunities, weaknesses, resistances } = iwr(actor);
  const stealth = sys.attributes?.stealth ?? {};

  return {
    kind: "hazard",
    name: actor.name,
    subtitle: [
      "Hazard",
      `Level ${sys.details?.level?.value ?? "?"}`,
      sys.details?.isComplex ? "complex" : "simple",
    ].join(" · "),
    rarity: sys.traits?.rarity ?? "common",
    size: SIZES[sys.traits?.size?.value] ?? sys.traits?.size?.value ?? null,
    traits: list(sys.traits?.value),
    fields: {
      Stealth: withDetail(signed(stealth.value), stealth.details),
      AC: sys.attributes?.ac?.value,
      Saves: sv ? sv.rows.map((r) => `${r.key} ${signed(r.value)}`).join(", ") : "",
      "Lowest save": sv?.lowest ?? "",
      Hardness: sys.attributes?.hardness,
      HP: sys.attributes?.hp?.max ?? sys.attributes?.hp?.value,
      Immunities: immunities.join(", "),
      Weaknesses: weaknesses.join(", "),
      Resistances: resistances.join(", "),
      Disable: htmlToText(sys.details?.disable),
      Routine: htmlToText(sys.details?.routine),
      Reset: htmlToText(sys.details?.reset),
    },
    sections: sections([
      { title: "Attacks", entries: attackEntries(actor) },
      { title: "Actions", entries: actionEntries(actor) },
    ]),
    prose: capText(htmlToText(sys.details?.description)),
  };
}

function extractActor(actor) {
  if (actor.type === "hazard") return extractHazard(actor);

  const sys = actor.system ?? {};
  const sv = saves(actor);
  const { immunities, weaknesses, resistances } = iwr(actor);
  const inventory = inventoryLine(actor);

  return {
    kind: "creature",
    name: actor.name,
    subtitle: `Level ${sys.details?.level?.value ?? "?"}`,
    rarity: sys.traits?.rarity ?? "common",
    size: SIZES[sys.traits?.size?.value] ?? sys.traits?.size?.value ?? null,
    traits: list(sys.traits?.value),
    fields: {
      // Ordered as a printed statblock reads, so the model meets the numbers in
      // the shape it has seen ten thousand times.
      Perception: withDetail(
        [
          signed(sys.perception?.mod ?? sys.attributes?.perception?.value),
          named(sys.perception?.senses).join(", "),
        ]
          .filter(Boolean)
          .join("; "),
        sys.perception?.details
      ),
      Languages: withDetail(
        list(sys.details?.languages?.value).join(", "),
        sys.details?.languages?.details
      ),
      Skills: skillLine(actor),
      Abilities: abilityLine(actor),
      Items: inventory,
      AC: withDetail(sys.attributes?.ac?.value, sys.attributes?.ac?.details),
      Saves: sv ? sv.rows.map((r) => `${r.key} ${signed(r.value)}`).join(", ") : "",
      "Save notes": [sys.attributes?.allSaves?.value, sv?.details].filter(Boolean).join("; "),
      "Lowest save": sv?.lowest ?? "",
      HP: withDetail(sys.attributes?.hp?.max, sys.attributes?.hp?.details),
      Immunities: immunities.join(", "),
      Weaknesses: weaknesses.join(", "),
      Resistances: resistances.join(", "),
      Speed: speedLine(actor),
    },
    sections: sections([
      { title: "Attacks", entries: attackEntries(actor) },
      { title: "Actions, reactions and passive abilities", entries: actionEntries(actor) },
      { title: "Spellcasting", entries: spellEntries(actor) },
    ]),
    blurb: htmlToText(sys.details?.blurb),
    prose: capText(
      [htmlToText(sys.details?.publicNotes), htmlToText(sys.details?.privateNotes)]
        .filter(Boolean)
        .join("\n\n")
    ),
  };
}

function extractJournal(entry) {
  const pages = list(entry.pages?.contents ?? entry.pages)
    .filter((p) => p?.type === "text")
    .map((p) => `## ${p.name}\n${htmlToText(p.text?.content)}`);
  return {
    kind: "journal",
    name: entry.name,
    subtitle: `${pages.length} page${pages.length === 1 ? "" : "s"}`,
    traits: [],
    fields: {},
    sections: [],
    prose: capText(pages.join("\n\n")),
  };
}

function extractItem(item) {
  const sys = item.system ?? {};
  return {
    kind: "item",
    name: item.name,
    subtitle: item.type,
    rarity: sys.traits?.rarity ?? "common",
    traits: list(sys.traits?.value),
    fields: {
      Level: sys.level?.value,
      Price: sys.price?.value?.gp != null ? `${sys.price.value.gp} gp` : "",
      Usage: sys.usage?.value ?? "",
      Bulk: sys.bulk?.value ?? sys.weight?.value ?? "",
      Group: sys.group ?? "",
    },
    sections: [],
    prose: capText(htmlToText(sys.description?.value)),
  };
}

function extractScene(scene) {
  const inhabitants = list(scene.tokens?.contents ?? scene.tokens)
    .map((t) => t?.actor?.name ?? t?.name)
    .filter(Boolean);
  const unique = [...new Set(inhabitants)];
  return {
    kind: "scene",
    name: scene.name,
    subtitle: `${unique.length} distinct token${unique.length === 1 ? "" : "s"}`,
    traits: [],
    fields: { Present: unique.join(", ") },
    sections: [],
    prose: capText(htmlToText(scene.journal?.name ? `See journal: ${scene.journal.name}` : "")),
  };
}

const EXTRACTORS = {
  Actor: extractActor,
  JournalEntry: extractJournal,
  Item: extractItem,
  Scene: extractScene,
};

/**
 * Build the structured brief for a document.
 * Returns null for an unsupported document type.
 */
export function subjectBrief(doc) {
  const fn = EXTRACTORS[doc?.documentName];
  if (!fn) return null;
  const brief = fn(doc);
  brief.uuid = doc.uuid;
  brief.documentName = doc.documentName;
  return brief;
}
