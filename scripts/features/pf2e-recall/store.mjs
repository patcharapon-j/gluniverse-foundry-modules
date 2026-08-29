/**
 * GLUniverse Suite — Recall Knowledge: persistence.
 *
 * The flag is the source of truth; the `privateNotes` mirror is a read-only
 * courtesy so a GM who disables this feature (or reads the statblock export)
 * still finds their lore. On conflict the flag wins and the mirror is rebuilt.
 *
 * ## Why the heading is deliberately NOT statsblock-import's
 *
 * `features/statsblock-import` already owns `GLSBI.notes.recallKnowledge` and
 * recovers its DC-keyed ladder by scraping `privateNotes` for that exact
 * `<h3>` followed by a `<ul>` (see `exportRecallKnowledge`). If this feature
 * wrote a *tiered* ladder under the same heading, that exporter would scrape it
 * and round-trip tiered prose back out as `{dc, skills, text}` entries —
 * silent corruption of a documented format. So this mirror uses its own
 * heading (`GLRK.notes.ladder`) and its own structure. Both keys are DATA:
 * changing either breaks existing worlds. See docs/RECALL_KNOWLEDGE.md.
 *
 * ## Why only Actors get a mirror
 *
 * `system.details.privateNotes` is an NPC/hazard field. A JournalEntry, one of
 * its pages, an Item or a Scene has no GM-only prose field, and writing into
 * their public description (or a page's own `text.content`) would leak the
 * ladder to any player who can read the document. Those subjects are flag-only.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import {
  BAND_KEYS,
  DEFAULT_PRESENTATION,
  FLAG_CONTEXT,
  FLAG_LADDER,
  FLAG_PRESENTATION,
  presentationByKey,
  presentationForKey,
  presentationForText,
} from "./constants.mjs";
import { inlineMarkdownToHtml } from "./markdown.mjs";
import { HEADINGS } from "./prompt.mjs";

const escapeRegExp = (v) => String(v ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Our own mirror heading. Data, not copy — see the module note. */
const mirrorHeading = () => game.i18n.localize("GLRK.notes.ladder");

/* -------------------------------------------------- flag ---------------- */

/** Read the stored ladder, or null. */
export function readLadder(doc) {
  const raw = doc?.getFlag?.(SUITE_ID, FLAG_LADDER) ?? null;
  if (!raw) return null;

  // v2: one paragraph per competence band.
  if (raw.bands && typeof raw.bands === "object") {
    const bands = {};
    for (const key of BAND_KEYS) {
      const value = raw.bands[key];
      if (typeof value === "string" && value.trim()) bands[key] = value.trim();
    }
    if (!Object.keys(bands).length) return null;
    return {
      name: raw.name ?? doc?.name ?? "",
      bands,
      version: 2,
      // Absent on every ladder authored before presentations existed. That is
      // "unknown", not "recall": claiming a presentation nobody chose would put
      // a false staleness warning on every existing ladder in the world.
      presentation: raw.presentation?.key ? { ...raw.presentation } : null,
      generatedAt: raw.generatedAt ?? null,
    };
  }

  // v1: three cumulative tiers of bullets. Read in place and converted on the
  // fly rather than migrated, so a world that rolls back to an older build
  // still finds its ladder intact. Regenerating replaces it with v2.
  if (raw.tiers && typeof raw.tiers === "object") {
    return {
      name: raw.name ?? doc?.name ?? "",
      bands: bandsFromLegacy(raw),
      version: 1,
      generatedAt: raw.generatedAt ?? null,
    };
  }
  return null;
}

/**
 * Project a stored v1 ladder onto the eight bands.
 *
 * The mapping mirrors what v1 did at read time: the shallow tier answers the
 * lower bands, the middle tier the middle, the deep tier the top, and the
 * Misremembered line becomes Inept. Prose quality suffers — these were written
 * as bullets — but nothing is lost and nothing needs migrating.
 */
function bandsFromLegacy(raw) {
  const tier = (k) => (Array.isArray(raw.tiers?.[k]) ? raw.tiers[k].filter(Boolean) : []);
  const join = (list) => list.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(" ");
  const bands = {};
  const everyone = tier("everyone");
  const might = tier("might");
  const few = tier("few");
  if (raw.misremembered) bands.inept = raw.misremembered;
  if (everyone.length) {
    bands.poor = join(everyone.slice(0, 2));
    bands.passable = join(everyone);
  }
  if (might.length) {
    bands.solid = join(might.slice(0, 1));
    bands.impressive = join(might);
  }
  if (few.length) {
    bands.remarkable = join(few.slice(0, 1));
    bands.phenomenal = join(few);
  }
  return bands;
}

export function hasLadder(doc) {
  return !!readLadder(doc);
}

/**
 * Write a ladder, then rebuild the mirror. The flag write lands first so a
 * failure to update `privateNotes` (a locked compendium actor, say) still
 * leaves the authoritative copy stored.
 */
export async function writeLadder(doc, ladder) {
  if (!doc) return null;
  const bands = {};
  for (const key of BAND_KEYS) {
    const value = ladder.bands?.[key];
    if (typeof value === "string" && value.trim()) bands[key] = value.trim();
  }
  const record = {
    name: ladder.name ?? doc.name ?? "",
    bands,
    // Stamped with the presentation these paragraphs were actually authored
    // under. Nothing can re-voice stored prose (the module holds no runtime
    // model access), so the honest thing is to record what was used and tell
    // the GM when the box no longer matches.
    presentation: readPresentation(doc),
    generatedAt: Date.now(),
  };
  await doc.setFlag(SUITE_ID, FLAG_LADDER, record);
  await syncMirror(doc, record);
  return record;
}

export async function clearLadder(doc) {
  if (!doc) return;
  await doc.unsetFlag(SUITE_ID, FLAG_LADDER);
  await syncMirror(doc, null);
}

/* -------------------------------------------------- context ------------- */

/**
 * The GM's free-text steer, persisted so regenerating does not mean retyping
 * "the Hillfolk elder lied to them" every time.
 */
export function readContext(doc) {
  return doc?.getFlag?.(SUITE_ID, FLAG_CONTEXT) ?? "";
}

export async function writeContext(doc, text) {
  if (!doc) return;
  const value = String(text ?? "").trim();
  if (value) await doc.setFlag(SUITE_ID, FLAG_CONTEXT, value);
  else await doc.unsetFlag(SUITE_ID, FLAG_CONTEXT);
}

/* -------------------------------------------------- presentation -------- */

/**
 * How the knowledge reaches the player: `{key, text}`, kept in ONE flag.
 *
 * `text` is the GM's own words and the authority; `key` only remembers which
 * preset last filled the box, so the payload can offer that preset's scaffolding
 * behind their words rather than instead of them.
 *
 * Both halves travel together for the reason statsblock-import keeps
 * `{context, rung, level}` in one flag — they are a single intent, and redoing
 * one should not mean retyping the other. It stays separate from `rk.context`,
 * which is about what is TRUE at this table rather than how it is delivered:
 * a GM switches presentation while the campaign facts stay put.
 *
 * The world settings supply the default for a subject nobody has set, so a
 * campaign that is entirely ship's logs is configured once rather than per
 * creature.
 */
export function readPresentation(doc) {
  const stored = doc?.getFlag?.(SUITE_ID, FLAG_PRESENTATION);

  // `note` is read for anyone who ran the two-field build of this branch; it was
  // never released, so this is courtesy rather than a migration path.
  const storedText = typeof stored?.text === "string" ? stored.text : stored?.note;
  if (typeof storedText === "string") {
    return { key: presentationForKey(stored?.key)?.key ?? null, text: storedText };
  }

  // Nothing set on this subject: the world's default fills the box. A world that
  // typed its OWN sentence there has no preset behind it, and saying otherwise
  // would hand the model scaffolding nobody chose.
  const defaultKey = presentationByKey(
    worldSetting("rk.defaultPresentation", DEFAULT_PRESENTATION)
  );
  const defaultText = String(worldSetting("rk.defaultPresentationText", "") ?? "").trim();
  if (!defaultText) return { key: defaultKey.key, text: defaultKey.text };
  return { key: presentationForText(defaultText)?.key ?? null, text: defaultText };
}

export async function writePresentation(doc, { key, text }) {
  if (!doc) return;
  const written = String(text ?? "").trim();
  await doc.setFlag(SUITE_ID, FLAG_PRESENTATION, {
    // Strict, and null-preserving: coercing an absent key to the baseline here
    // would invent a preset the GM never picked and quietly put its scaffolding
    // behind their words. A preset the box still quotes verbatim is recognised
    // from the text itself, so nothing is lost by being honest about it.
    key: presentationForKey(key)?.key ?? presentationForText(written)?.key ?? null,
    text: written,
  });
}

/** A world setting that may not be registered yet (feature disabled, early hook). */
function worldSetting(key, fallback) {
  try {
    const value = game.settings.get(SUITE_ID, key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

/* -------------------------------------------------- mirror -------------- */

/** True when this document has a GM-only prose field we may safely write to. */
function mirrorable(doc) {
  return doc?.documentName === "Actor" && typeof doc.system?.details?.privateNotes === "string";
}

function renderMirror(record) {
  const rows = BAND_KEYS.filter((k) => record.bands?.[k])
    .map(
      (key) =>
        // The band text goes through the inline-markdown renderer rather than
        // bare escaping: it escapes first and marks up second, so the mirror is
        // no less safe than it was and a GM reading it in the actor sheet sees
        // bold rather than asterisks. Headings are ours and stay literal.
        `<h4>${escapeHTML(HEADINGS[key])}</h4><p>${inlineMarkdownToHtml(record.bands[key])}</p>`
    )
    .join("");
  if (!rows) return "";
  // The presentation is part of what these paragraphs ARE, so a GM reading the
  // mirror with the feature disabled still needs to know they are looking at a
  // console log rather than a memory.
  const stamp = record.presentation?.text
    ? `<p><em>${escapeHTML(record.presentation.text)}</em></p>`
    : "";
  return `<section data-glrk="ladder"><h3>${escapeHTML(mirrorHeading())}</h3>${stamp}${rows}</section>`;
}

/** Replace (or remove) our section in privateNotes, leaving everything else. */
export async function syncMirror(doc, record) {
  if (!mirrorable(doc)) return;
  const current = doc.system.details.privateNotes ?? "";
  const block = record ? renderMirror(record) : "";

  const existing = new RegExp(
    `<section data-glrk="ladder">[\\s\\S]*?</section>|<h3>\\s*${escapeRegExp(mirrorHeading())}\\s*</h3>(?:(?!<h3>)[\\s\\S])*`,
    "i"
  );

  let next;
  if (existing.test(current)) next = current.replace(existing, block);
  else next = block ? `${current}${current ? "\n" : ""}${block}` : current;

  if (next.trim() !== current.trim()) {
    await doc.update({ "system.details.privateNotes": next.trim() });
  }
}

/* -------------------------------------------------- seed ---------------- */

/**
 * Existing DC-keyed entries written by `statsblock-import`, offered to the
 * generation prompt as raw material (never auto-migrated into tiers — a
 * `DC 20` line carries no reliable tier signal, least of all under PWoL).
 */
export function readSeed(doc) {
  if (doc?.documentName !== "Actor") return [];
  const html = doc.system?.details?.privateNotes ?? "";
  const heading = game.i18n.localize("GLSBI.notes.recallKnowledge");
  const section = html.match(
    new RegExp(`<h3>\\s*${escapeRegExp(heading)}\\s*</h3>\\s*<ul>([\\s\\S]*?)</ul>`, "i")
  );
  if (!section) return [];

  const out = [];
  for (const item of section[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const raw = item[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const parts = raw.split(/\s+[—-]\s+/);
    if (parts.length >= 2) {
      const label = parts[0].trim();
      out.push({
        dc: Number(label.match(/DC\s*(\d+)/i)?.[1]) || null,
        skills: label.replace(/DC\s*\d+/i, "").trim(),
        text: parts.slice(1).join(" — ").trim(),
      });
    } else {
      out.push({ dc: null, skills: "", text: raw });
    }
  }
  return out;
}
