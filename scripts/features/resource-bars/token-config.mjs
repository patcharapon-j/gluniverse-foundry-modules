/**
 * GLUniverse Suite — resource bars: the per-token placement override.
 *
 * Two number fields appended to Token Config. They are plain form inputs named
 * for the flag they write, which is what makes them work without a submit
 * handler of our own: Foundry expands `flags.<package>.rb.offsetX` into the
 * update payload alongside everything else on the sheet, so the override is
 * saved by the same OK button, rolled back by the same Cancel, and applied to a
 * prototype token by the same remapping — none of which is true of an input
 * that writes the flag itself on `change`, which would persist a value the user
 * then cancelled out of.
 *
 * `data-dtype="Number"` is load-bearing. Foundry's form reader turns an empty
 * Number field into `null` rather than into `0`, and null is what "inherit the
 * world default" is made of. Without it an emptied field would read as a
 * deliberate zero and pin the bar in place forever.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { FLAGS, OFFSET, SETTINGS } from "./constants.mjs";

/** Marker so a re-render of the same sheet does not stack a second copy. */
const MARK = "glrbOffsets";

const worldDefault = (key) => {
  try {
    const v = Number(game.settings.get(SUITE_ID, key));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
};

function numberRow({ label, hint, name, value, placeholder }) {
  const group = document.createElement("div");
  group.className = "form-group";

  const lab = document.createElement("label");
  lab.textContent = label;
  group.appendChild(lab);

  const fields = document.createElement("div");
  fields.className = "form-fields";
  const input = document.createElement("input");
  input.type = "number";
  input.name = name;
  input.step = String(OFFSET.step);
  input.min = String(OFFSET.min);
  input.max = String(OFFSET.max);
  input.dataset.dtype = "Number";
  input.placeholder = String(placeholder);
  if (Number.isFinite(value)) input.value = String(value);
  fields.appendChild(input);
  group.appendChild(fields);

  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = hint;
  group.appendChild(p);

  return group;
}

/**
 * Find somewhere sensible to put the fields.
 *
 * The bar attribute pickers live in the Resources tab, so a bar *placement*
 * control belongs beside them.
 *
 * The obvious selector for that tab is `[data-tab="resources"]` and it is
 * wrong: Foundry stamps `data-tab` on the navigation *link* as well as on the
 * body it switches to, the link comes first in document order, and
 * `querySelector` returns the first match — so the fields get appended inside
 * the header's Resources button, which is where they were turning up. Nothing
 * about that fails loudly. The fieldset renders, the inputs work, they save.
 * It just sits in the header.
 *
 * So the anchor is real content instead of a tab id: `bar1.attribute` exists
 * only inside the tab body, and walking up from it cannot land on a nav link.
 * The fallbacks are tab *bodies* only, and the last of them is the form rather
 * than the sheet root — a sheet restructured by another module should still get
 * the fields somewhere sane rather than back in the header.
 */
function findHost(root) {
  const anchor = root.querySelector('[name="bar1.attribute"], [name="bar2.attribute"]');
  if (anchor) {
    const body = anchor.closest(".tab, [data-application-part]");
    if (body && body !== root) return body;
    /* No tab wrapper (some sheets flatten it): sit beside the picker's own
       fieldset rather than inside it. */
    const fs = anchor.closest("fieldset");
    if (fs?.parentElement) return fs.parentElement;
  }

  const guess = root.querySelector('[data-application-part="resources"]')
             ?? root.querySelector('.tab[data-tab="resources"]')
             ?? root.querySelector('.tab[data-tab="appearance"]')
             ?? root.querySelector("form");
  /* Never inside the tab strip, whichever way we got here. */
  return guess && !guess.closest("nav") ? guess : null;
}

export function injectTokenConfig(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root || root.querySelector(`[data-${MARK}]`)) return;

  const doc = app?.document ?? app?.token ?? app?.object;
  const read = (flag) => {
    try {
      const v = doc?.getFlag?.(SUITE_ID, flag);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };

  const host = findHost(root);
  if (!host) return;

  const section = document.createElement("fieldset");
  section.dataset[MARK] = "1";
  const legend = document.createElement("legend");
  legend.textContent = game.i18n.localize("GLRB.TokenConfig.Legend");
  section.appendChild(legend);

  for (const axis of ["X", "Y"]) {
    const flag = axis === "X" ? FLAGS.offsetX : FLAGS.offsetY;
    const setting = axis === "X" ? SETTINGS.offsetX : SETTINGS.offsetY;
    section.appendChild(numberRow({
      label: game.i18n.localize(`GLRB.TokenConfig.Offset${axis}.Name`),
      hint: game.i18n.localize(`GLRB.TokenConfig.Offset${axis}.Hint`),
      name: `flags.${SUITE_ID}.${flag}`,
      value: read(flag),
      placeholder: worldDefault(setting),
    }));
  }

  host.appendChild(section);

  /* The sheet grew; ApplicationV2 does not resize itself when a module adds to
     it, so the last field ends up under the footer on a sheet that was already
     at its natural height. */
  try { app?.setPosition?.({ height: "auto" }); } catch { /* not resizable */ }
}
