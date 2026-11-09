/**
 * The rail's icons. Authored for it, one stroke weight (1.6 on a 16 grid),
 * because the rail sets them at 12–15px beside a count, where Foundry's and
 * PF2e's filled 48px item glyphs read as blots.
 *
 * The action costs are PF2e's own marks redrawn on the same grid: one, two
 * and three actions as the book's chevron-diamonds, the reaction's hooked
 * arrow, the free action's hollow diamond. PF2e prints them from a webfont
 * (`Pathfinder2eActions`) that only a live session loads, and the rail has
 * to draw them on the preview page and on the stream capture alike.
 *
 * Pure strings.
 */
const I = (d, cls = "gph-ic") => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${d}</svg>`;

export const ICON = {
  skills: I('<path d="M2.5 13.5h11"/><path d="M4 13.5V7.5M8 13.5V4M12 13.5V9.5"/>'),
  actions: I('<path d="M8 1.8 14.2 8 8 14.2 1.8 8z"/><path d="M8 5.2 10.8 8 8 10.8 5.2 8z" class="f"/>'),
  inventory: I('<path d="M5.5 4.5 4.2 2.4h7.6L10.5 4.5"/><path d="M5.5 4.5h5c2.4 1.5 3.5 3.7 3.5 6 0 2-1.5 3-3.5 3h-5c-2 0-3.5-1-3.5-3 0-2.3 1.1-4.5 3.5-6z"/>'),
  effects: I('<path d="M8 1.8v2.4M8 11.8v2.4M1.8 8h2.4M11.8 8h2.4M3.6 3.6l1.7 1.7M10.7 10.7l1.7 1.7M3.6 12.4l1.7-1.7M10.7 5.3l1.7-1.7"/><circle cx="8" cy="8" r="2.2"/>'),
  rest: I('<path d="M10.8 2.2a5.6 5.6 0 1 0 3 8.6 5 5 0 0 1-3-8.6z"/>'),
  macros: I('<path d="M2.5 3.5h11v9h-11z"/><path d="M5 6.5 7 8.2 5 10M8.5 10h3"/>'),
  sheet: I('<path d="M3.5 1.8h6.2l2.8 2.8v9.6h-9z"/><path d="M9.5 1.8v3h3"/><path d="M5.6 8h4.8M5.6 10.8h4.8"/>'),
  more: I('<circle cx="3.5" cy="8" r=".9" class="f"/><circle cx="8" cy="8" r=".9" class="f"/><circle cx="12.5" cy="8" r=".9" class="f"/>'),
  fold: I('<path d="M4 6.5 8 10.5l4-4"/>'),
  frame: I('<path d="M2.5 5.5v-3h3"/><path d="M10.5 2.5h3v3"/><path d="M13.5 10.5v3h-3"/><path d="M5.5 13.5h-3v-3"/><path d="M8 6v4M6 8h4"/>'),
  shield: I('<path d="M8 1.8 13.2 3.6v4.2c0 3.1-2.2 5.3-5.2 6.4-3-1.1-5.2-3.3-5.2-6.4V3.6z"/>'),
  up: I('<path d="M4 9.5 8 5.5l4 4"/>'),
  down: I('<path d="M4 6.5 8 10.5l4-4"/>'),
  prev: I('<path d="M9.5 4 5.5 8l4 4"/>'),
  next: I('<path d="M6.5 4l4 4-4 4"/>'),
  post: I('<path d="M2.5 3.5h11v7.5H7l-3 2.5v-2.5H2.5z"/>'),
  spells: I('<path d="M8 1.8 9.4 6.6 14.2 8 9.4 9.4 8 14.2 6.6 9.4 1.8 8 6.6 6.6z"/>'),
  expand: I('<path d="M9.5 2.5h4v4"/><path d="M13.5 2.5 9 7"/><path d="M6.5 13.5h-4v-4"/><path d="M2.5 13.5 7 9"/>'),
  search: I('<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.8 13.8"/>'),
  close: I('<path d="M4 4l8 8M12 4l-8 8"/>'),
  secret: I('<path d="M1.8 8s2.4-4.2 6.2-4.2S14.2 8 14.2 8s-2.4 4.2-6.2 4.2S1.8 8 1.8 8z"/><path d="M3 13 13 3"/>'),
  pin: I('<path d="M6 2.2h4l-.6 4 2.4 2.4H4.2L6.6 6.2z"/><path d="M8 8.6v5.2"/>'),
};

/* PF2e's action marks. Filled diamonds set a hair apart, so two actions
   read as two and never merge into one blot at 13px; the
   reaction is a stroke and the free action a hollow diamond. Diamonds are
   spent on actions and Hero Points only: every other count on the rail
   (slots, uses, beads) is a round pip, so a cost is never read as a count. */
const DIAMOND = (x) => `<path class="f" d="M${x} 8 ${x + 4.6} 3.4 ${x + 9.2} 8 ${x + 4.6} 12.6z"/>`;
const GLYPH = (w, d, label) =>
  `<svg class="gph-act" viewBox="0 0 ${w} 16" width="${w * 0.8}" height="12.8" role="img" aria-label="${label}" focusable="false">${d}</svg>`;

/** The action-cost glyph for a cost of 1, 2, 3, "r" (reaction), "f" (free) or
 *  a range like "1-3". `label` is the sentence a screen reader gets. */
export function costGlyph(cost, label = "") {
  if (cost === "r") return GLYPH(16, '<path d="M12.5 5.2A5 5 0 1 0 13 9.5"/><path class="f" d="M10.6 2.4 14.4 4.6 12 8z"/>', label);
  if (cost === "f") return GLYPH(16, '<path d="M8 2.8 13.2 8 8 13.2 2.8 8z"/>', label);
  if (typeof cost === "string" && /^\d-\d$/.test(cost)) {
    const [a, b] = cost.split("-").map(Number);
    return `<span class="gph-acts">${costGlyph(a, "")}<span aria-hidden="true">–</span>${costGlyph(b, "")}<span class="gph-sr">${label}</span></span>`;
  }
  const n = Math.max(1, Math.min(3, Number(cost) || 1));
  let d = "";
  for (let i = 0; i < n; i++) d += DIAMOND(0.8 + i * 10.6);
  return GLYPH(10.8 + (n - 1) * 10.6, d, label);
}
