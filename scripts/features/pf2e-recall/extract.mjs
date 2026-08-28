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
  return { rows, lowest: lowest.key };
}

/* -------------------------------------------------- per-type ------------ */

function extractActor(actor) {
  const sys = actor.system ?? {};
  const sv = saves(actor);
  const { immunities, weaknesses, resistances } = iwr(actor);

  const abilities = list(actor.itemTypes?.action).map((i) => ({
    name: i.name,
    text: capText(htmlToText(i.system?.description?.value), 600).text,
  }));
  const strikes = list(actor.itemTypes?.melee).map((i) => {
    const dmg = Object.values(i.system?.damageRolls ?? {})
      .map((d) => `${d.damage} ${d.damageType}`)
      .join(", ");
    return `${i.name}${dmg ? ` (${dmg})` : ""}`;
  });
  const spellcasting = list(actor.itemTypes?.spellcastingEntry).map(
    (e) => `${e.name}${e.system?.tradition?.value ? ` [${e.system.tradition.value}]` : ""}`
  );

  return {
    kind: "creature",
    name: actor.name,
    subtitle: [sys.details?.creature?.value, `Level ${sys.details?.level?.value ?? "?"}`]
      .filter(Boolean)
      .join(" · "),
    rarity: sys.traits?.rarity ?? "common",
    size: sys.traits?.size?.value ?? null,
    traits: list(sys.traits?.value),
    fields: {
      AC: sys.attributes?.ac?.value,
      HP: sys.attributes?.hp?.max,
      Perception: sys.perception?.mod ?? sys.attributes?.perception?.value,
      Senses: named(sys.perception?.senses).join(", "),
      Languages: list(sys.details?.languages?.value).join(", "),
      Speed: sys.attributes?.speed?.value,
      Saves: sv ? sv.rows.map((r) => `${r.key} ${r.value >= 0 ? "+" : ""}${r.value}`).join(", ") : "",
      "Lowest save": sv?.lowest ?? "",
      Immunities: immunities.join(", "),
      Weaknesses: weaknesses.join(", "),
      Resistances: resistances.join(", "),
      Strikes: strikes.join("; "),
      Spellcasting: spellcasting.join("; "),
    },
    abilities,
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
    abilities: [],
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
    },
    abilities: [],
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
    abilities: [],
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
