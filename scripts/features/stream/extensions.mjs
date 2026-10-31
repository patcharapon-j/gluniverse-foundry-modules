/**
 * GLUniverse Stream — extension slots.
 *
 * The standalone module was one package, so its chat overlay simply imported
 * the PF2e roll-card feed, `main.js` imported the portrait sheet header, and
 * the control panel imported the framing app. Split into three suite features
 * those become a **cycle**: `stream` → `stream-cards` → `stream`.
 *
 * It is resolved by inverting the edge rather than by hoisting code. `stream`
 * knows only that a card feed and some panel sections *may* exist; the children
 * fill these slots from their own `onReady`. Nothing here imports a child, so
 * `stream` builds and runs identically whether or not they are installed or
 * enabled — which is also what makes a disabled `stream-cards` inert rather
 * than merely idle.
 *
 * Slots are process-wide, not per-instance: a feature registers once at ready
 * and the overlay may be torn down and rebuilt many times per session.
 */

/** system id -> feed factory. One reader per game system; a world whose system has none clones chat cards. */
const cardFeedFactories = new Map();
const panelSections = [];

/** The system a factory registered without naming one is for: the slot was PF2e's alone before it was per-system. */
const LEGACY_FEED_SYSTEM = "pf2e";

/**
 * `stream-cards` calls this once per system it reads, with
 * `("pf2e", overlay => new RollCardFeed(overlay))` and the Daggerheart feed beside it.
 * `registerCardFeed(factory)` with no system is the slot's original, PF2e-only form and still means that.
 *
 * The feed's contract, as the chat overlay uses it: `handleCreate(message)`
 * (async), `handleDelete(message) → boolean`, `forget(record)`, `prescan()`,
 * `clear()`, and optionally `handleUpdate(message, changes)` — a system that
 * rewrites a posted message in place (a Daggerheart reroll, the GM's Fear claim)
 * hears about it there; one that does not leaves it out.
 *
 * A record the feed pushes onto `overlay.cards` may carry a `card` — anything
 * with `element`, `exit()` and `destroy()`. The overlay then lets that object
 * animate itself off the stack and calls `forget(record)` so the feed can drop
 * the message ids, timers and framing watches behind it. A record without one
 * (a cloned chat card) is animated by the overlay itself. That property name is
 * the whole seam: spelled differently on the two sides, the card still
 * disappears on cue and everything it was holding leaks for the session.
 */
export function registerCardFeed(system, factory) {
  if (typeof system === "function") [system, factory] = [LEGACY_FEED_SYSTEM, system];
  if (typeof system !== "string" || !system) return;
  if (typeof factory === "function") cardFeedFactories.set(system, factory);
  else cardFeedFactories.delete(system);
}

/** True when something has claimed the card-feed slot for this system. */
export function hasCardFeed(system) {
  return cardFeedFactories.has(system);
}

/** Build a feed for an overlay in a world running `system`, or null when no feature reads that system. */
export function createCardFeed(overlay, system) {
  const factory = cardFeedFactories.get(system);
  if (!factory) return null;
  try {
    return factory(overlay) ?? null;
  } catch (error) {
    console.error("GLUniverse Suite | Stream: a card feed factory threw; the overlay falls back to cloned chat cards.", error);
    return null;
  }
}

/**
 * Contribute a section to the control panel.
 *
 * `stream-targets` uses this so its settings appear beside the shot they affect
 * when `stream` is on, while remaining reachable from its own editor when
 * `stream` is off — a feature that can run alone has to be configurable alone.
 *
 * @param {object} section
 * @param {string} section.id      unique; re-registering replaces.
 * @param {number} [section.order] ascending; panel-native sections sit at 0.
 * @param {() => Promise<string>|string} section.render  the section's HTML.
 * @param {(name: string, value: unknown) => Promise<boolean>|boolean} [section.change]
 *        offered every form change the panel did not recognise as its own,
 *        in registration order; return true to claim it. The panel never
 *        writes a child's settings itself — the owning feature does, through
 *        its own prefix and its own sanitizers.
 * @param {(action: string, element: HTMLElement) => Promise<boolean>|boolean} [section.action]
 *        the same for `[data-action]` clicks.
 * @param {boolean} [section.gmOnly] true when the feature's writers refuse a
 *        non-GM. Both children do — the attested channel carries this feature's
 *        allow-listed keys and widening it would put a child's rules in the
 *        parent — and their setters return the stored value rather than
 *        throwing, so without this a trusted director got live-looking controls
 *        that discarded every edit without a word. Declared by the section
 *        because only it knows whether it has a delegated path.
 */
export function registerPanelSection(section) {
  if (!section?.id || typeof section.render !== "function") return;
  const at = panelSections.findIndex((s) => s.id === section.id);
  const entry = { order: 0, ...section };
  if (at >= 0) panelSections[at] = entry;
  else panelSections.push(entry);
}

/** Remove a contributed section (a feature disabled at runtime). */
export function unregisterPanelSection(id) {
  const at = panelSections.findIndex((s) => s.id === id);
  if (at >= 0) panelSections.splice(at, 1);
}

/** Contributed sections in display order. */
export function getPanelSections() {
  return [...panelSections].sort((a, b) => a.order - b.order);
}

/**
 * Render every contributed section. A section that throws is skipped with its
 * own id named, rather than taking the whole panel down with it — the panel is
 * how a GM stops a stream that has gone wrong, so it has to open.
 */
export async function renderPanelSections() {
  const out = [];
  const isGM = Boolean(game.user?.isGM);
  for (const section of getPanelSections()) {
    try {
      const html = String((await section.render()) ?? "");
      if (!html) continue;
      // Shown, not hidden: a director should still be able to read what the
      // cards and the arcs are set to while looking at the shot they affect.
      out.push(section.gmOnly && !isGM
        ? `<fieldset class="gluniverse-stream-controls" disabled>${html}</fieldset>`
        : html);
    } catch (error) {
      console.error(`GLUniverse Suite | Stream: panel section "${section.id}" failed to render.`, error);
    }
  }
  return out.join("");
}

/** Offer a form change to the contributed sections. True once one claims it. */
export async function offerPanelChange(name, value) {
  for (const section of getPanelSections()) {
    if (typeof section.change !== "function") continue;
    try {
      if (await section.change(name, value)) return true;
    } catch (error) {
      console.error(`GLUniverse Suite | Stream: panel section "${section.id}" failed on "${name}".`, error);
    }
  }
  return false;
}

/** Offer a `[data-action]` click to the contributed sections. */
export async function offerPanelAction(action, element) {
  for (const section of getPanelSections()) {
    if (typeof section.action !== "function") continue;
    try {
      if (await section.action(action, element)) return true;
    } catch (error) {
      console.error(`GLUniverse Suite | Stream: panel section "${section.id}" failed on action "${action}".`, error);
    }
  }
  return false;
}
