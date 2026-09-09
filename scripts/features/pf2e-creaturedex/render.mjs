/**
 * Creaturedexing — drawing a section, and drawing the absence of one.
 *
 * Two rules shape everything here.
 *
 * **An unknown section is drawn, not omitted.** The sealed plate is the whole
 * point of the feature: a player has to see that a creature *has* a Defense
 * section they have not bought yet, or the dex is just a shorter stat block and
 * the choice the book gives them means nothing.
 *
 * **A false section is drawn exactly like a true one.** It carries no marker of
 * any kind in the player's view, because a lie a player can see is not a lie.
 * The GM's own view labels it; that asymmetry is deliberate and is the only
 * place in this feature where two people looking at the same window see
 * different things.
 */

import { escapeHTML } from "../../core/util.mjs";

const esc = (v) => escapeHTML(String(v ?? ""));
const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** PF2e swaps in its own TextEditor, which resolves @Damage/@Check/@UUID. */
async function enrich(html) {
  if (!html) return "";
  try {
    const editor = foundry.applications?.ux?.TextEditor?.implementation;
    if (editor?.enrichHTML) return await editor.enrichHTML(String(html), { async: true });
  } catch {
    /* fall through to the raw value rather than losing the text entirely */
  }
  return String(html);
}

const costGlyph = (cost) => {
  if (cost === "reaction") return "⤾";
  if (cost === "free") return "◇";
  if (cost === "passive") return "";
  return "◆".repeat(Math.max(1, Math.min(3, Number(cost) || 1)));
};

async function renderAbility(entry) {
  const glyph = costGlyph(entry.cost);
  const traits = entry.traits?.length
    ? `<span class="gldex-traits">${entry.traits.map((t) => `<span class="gldex-trait">${esc(t)}</span>`).join("")}</span>`
    : "";
  return `<div class="gldex-ability">
    <div class="gldex-ability-head">
      <span class="gldex-ability-name">${esc(entry.name)}</span>
      ${glyph ? `<span class="gldex-cost" aria-hidden="true">${glyph}</span>` : ""}
      ${traits}
    </div>
    <div class="gldex-ability-body">${await enrich(entry.html)}</div>
  </div>`;
}

function renderStrike(entry, kindKey) {
  const bits = [
    entry.bonus ? `<span class="gldex-num">${esc(entry.bonus)}</span>` : "",
    entry.range ? esc(entry.range) : "",
    entry.traits?.length ? `(${esc(entry.traits.join(", "))})` : "",
    entry.damage ? `<span class="gldex-dmg">${esc(entry.damage)}</span>` : "",
    entry.effects?.length ? esc(entry.effects.join(", ")) : "",
  ].filter(Boolean);
  return `<div class="gldex-row">
    <span class="gldex-row-key">${esc(L(`GLDEX.row.${kindKey}`))}</span>
    <span class="gldex-row-val"><strong>${esc(entry.name)}</strong> ${bits.join(" ")}</span>
  </div>`;
}

function renderSpellBlock(block) {
  const meta = [block.tradition, block.dc, block.attack].filter(Boolean).join(", ");
  const ranks = block.ranks
    .map((r) => `<div class="gldex-spell-rank"><span>${esc(r.label)}</span> ${esc(r.names.join(", "))}</div>`)
    .join("");
  return `<div class="gldex-row">
    <span class="gldex-row-key">${esc(L(`GLDEX.row.${block.kind}`))}</span>
    <span class="gldex-row-val">${meta ? `<em>${esc(meta)}</em>` : ""}${ranks}</span>
  </div>`;
}

/** One revealed section, as the stat block fragment it is. */
export async function renderSection(section) {
  const parts = section.rows.map(
    (r) => `<div class="gldex-row">
      <span class="gldex-row-key">${esc(L(`GLDEX.row.${r.key}`))}</span>
      <span class="gldex-row-val">${esc(r.value)}</span>
    </div>`
  );

  if (section.prose) parts.push(`<div class="gldex-prose">${await enrich(section.prose)}</div>`);

  for (const entry of section.strikes?.melee ?? []) parts.push(renderStrike(entry, "melee"));
  for (const entry of section.strikes?.ranged ?? []) parts.push(renderStrike(entry, "ranged"));
  for (const block of section.spells ?? []) parts.push(renderSpellBlock(block));
  for (const entry of section.abilities ?? []) parts.push(await renderAbility(entry));

  return parts.join("");
}

/**
 * The sealed plate.
 *
 * It names the section and nothing else. Showing a row count, or the labels
 * with the values blanked, would leak the shape of what has not been learned —
 * "this creature has three resistances" is knowledge.
 */
export function renderSealed(key) {
  return `<div class="gldex-sealed">
    <i class="fa-solid fa-lock" aria-hidden="true"></i>
    <span>${esc(L("GLDEX.sealed", { section: L(`GLDEX.section.${key}`) }))}</span>
  </div>`;
}
