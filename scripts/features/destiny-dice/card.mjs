/**
 * PF2e bakes a check's result into the message: the degree and the offset in
 * the flavor's `.target-dc-result`, and on a reroll both totals in the content.
 * Foundry renders those strings as they are, so a fate that changes the total
 * has to rewrite them, or the card keeps saying Failure under a strip that says
 * Success. Pure string edits on PF2e 8.x markup: anything not recognised is
 * left exactly as it was. Visibility attributes are never touched.
 */

const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const RESULT = /(<div class="result degree-of-success"[^>]*>)([\s\S]*?)(<\/div>)/;
const DEGREE_SPAN = new RegExp(`<span([^>]*\\bclass="[^"]*?)\\b(${DEGREES.join("|")})\\b([^"]*"[^>]*)>[^<]*</span>`);
const UNADJUSTED_SPAN = /(<span[^>]*\bclass="unadjusted"[^>]*>)[^<]*(<\/span>)/;
const OFFSET = /(<span[^>]*>[^<]*?)[+\-−]?\d+([^<]*<\/span>\s*)$/;

const signed = (n) => new Intl.NumberFormat("en", { signDisplay: "always", useGrouping: false }).format(n);

/**
 * @param {string} flavor
 * @param {object} args
 * @param {{after: string, unadjusted: string}} args.shift
 * @param {number} args.total  the new total
 * @param {number} args.dc
 * @param {(degree: string) => string} args.label  PF2e's own degree label for this check's scope
 */
export function refreshResultFlavor(flavor, { shift, total, dc, label }) {
  if (typeof flavor !== "string" || !shift || !DEGREES.includes(shift.after)) return flavor;
  return flavor.replace(RESULT, (_m, open, inner, close) => {
    let next = inner.replace(DEGREE_SPAN, (_s, pre, _old, post) => `<span${pre}${shift.after}${post}>${label(shift.after)}</span>`);
    if (DEGREES.includes(shift.unadjusted)) next = next.replace(UNADJUSTED_SPAN, (_s, a, b) => `${a}${label(shift.unadjusted)}${b}`);
    if (Number.isFinite(total) && Number.isFinite(dc)) next = next.replace(OFFSET, (_s, a, b) => `${a}${signed(total - dc)}${b}`);
    return open + next + close;
  });
}

/**
 * A reroll's content holds both rolls; the one PF2e kept is the block without
 * `reroll-discard`, and it is the message's first roll, which the fate changed.
 */
export function refreshRerollTotal(content, total) {
  if (typeof content !== "string" || !Number.isFinite(total)) return content;
  const keptIndex = /^\s*<div class="[^"]*\breroll-discard\b/.test(content) ? 1 : 0;
  let i = -1;
  return content.replace(/(<h4 class="dice-total[^"]*">)\s*-?\d+\s*(<\/h4>)/g, (m, a, b) => (++i === keptIndex ? `${a}${total}${b}` : m));
}

/** PF2e's label key for a degree, by the DC's scope ("Check", "Attack"). */
export function degreeKey(scope, degree) {
  const s = typeof scope === "string" && scope ? scope[0].toUpperCase() + scope.slice(1).replace(/-(\w)/g, (_m, c) => c.toUpperCase()) : "Check";
  return `PF2E.Check.Result.Degree.${s}.${degree}`;
}
