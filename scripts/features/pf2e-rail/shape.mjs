/**
 * The value/shape boundary. A rail is drawn once from a model and then
 * driven: when only values moved (Hit Points, temp, Stamina, the shield's
 * HP and whether it is raised, Hero Points, the portrait's frame, a foe's or
 * a seat's Hit Points, the actions left this turn and the MAP step, what is
 * typed in the Skills tab's field) the host calls the setters in drive.mjs on just those;
 * anything else is a change of shape and the rail is redrawn (~10ms).
 *
 * Everything is shape by default, which fails in the safe direction: a field
 * forgotten here costs one redraw, where a value mistaken for shape would be
 * a number on screen that never moves.
 *
 * Maxima are shape: a meter's markup carries its own maximum, and a max that
 * changes is a different meter. So are conditions, dying and the turn
 * marker — each adds or removes markup.
 *
 * Pure.
 */
const blankMeter = (m) => (m ? { ...m, value: 0, temp: 0 } : m);

/** The action diamonds lit. While you are on deck they are the turn coming,
 *  so all of them: the tally left over from your last turn is not what you
 *  are about to have (it refills when the turn comes round). */
export const actionsLeft = (tb) => {
  const e = tb?.economy;
  if (!e) return 0;
  return tb.next && !tb.mine ? e.max : Math.max(0, e.max - e.spent);
};

/** The model with every value slot blanked, as a string to compare. */
export function shapeOf(o) {
  const c = structuredClone(o);
  delete c.drawer; delete c.peek; delete c.overlay;
  if (c.turnbar) {
    c.turnbar = { ...c.turnbar, map: 0 };
    if (c.turnbar.economy) c.turnbar.economy = { ...c.turnbar.economy, spent: 0, reaction: true };
  }
  if (c.deck?.skills) c.deck.skills = { ...c.deck.skills, query: "" };
  if (c.plinth) {
    if (c.plinth.hero) c.plinth.hero = [0, c.plinth.hero[1]];
    if (c.plinth.hp) c.plinth.hp = [0, c.plinth.hp[1]];
    c.plinth.frame = null;
  }
  if (c.vitals) {
    c.vitals.hp = blankMeter(c.vitals.hp);
    c.vitals.sp = blankMeter(c.vitals.sp);
    /* A shield breaking is shape (the press stops being one); its HP and
       its Raise are values. */
    if (c.vitals.shield) c.vitals.shield = { ...c.vitals.shield, hp: 0, raised: false };
  }
  if (c.creature) c.creature.hp = blankMeter(c.creature.hp);
  if (c.hazard?.hp) c.hazard.hp = blankMeter(c.hazard.hp);
  if (c.foes?.foes) c.foes.foes = c.foes.foes.map((f) => (f.hp ? { ...f, hp: [0, f.hp[1]] } : f));
  for (const s of c.stack ?? []) {
    if (s.hp) s.hp = [0, s.hp[1]];
    s.temp = 0;
    if (s.hero) s.hero = [0, s.hero[1]];
  }
  return JSON.stringify(c);
}

/** The values a drawn rail is driven to, in the shape drive.mjs takes. */
export function liveOf(o) {
  return {
    hero: o.plinth?.hero?.[0] ?? null,
    foldHp: o.plinth?.hp ?? null,
    frame: o.plinth?.frame ?? null,
    hp: o.vitals?.hp ?? o.creature?.hp ?? o.hazard?.hp ?? null,
    sp: o.vitals?.sp ?? null,
    shield: o.vitals?.shield ? { hp: o.vitals.shield.hp, raised: !!o.vitals.shield.raised } : null,
    econ: o.turnbar?.economy ? { left: actionsLeft(o.turnbar), reaction: !!o.turnbar.economy.reaction } : null,
    map: o.turnbar ? o.turnbar.map ?? 0 : null,
    foes: Object.fromEntries((o.foes?.foes ?? []).filter((f) => f.hp).map((f) => [f.id, f.hp])),
    seats: Object.fromEntries((o.stack ?? []).filter((s) => s.id).map((s) => [s.id, { hp: s.hp ?? null, temp: s.temp ?? 0, hero: s.hero?.[0] ?? null }])),
  };
}

/** What was typed into the Hit Point field, as the table says it: "-12" (or a
 *  typographic minus) is damage, "+5" healing, a bare number or "=30" the new
 *  total. Anything else is null, and the field refuses it. */
export function hpEntry(text) {
  const s = String(text ?? "").replace(/\s+/g, "").replace(/[−–—]/g, "-");
  const m = /^([+\-=]?)(\d{1,5})$/.exec(s);
  if (!m) return null;
  const n = +m[2];
  return m[1] === "+" ? { delta: n } : m[1] === "-" ? { delta: -n } : { set: n };
}

/** Did the Hit Points get worse? The figure flinches only for that. */
export const tookHit = (before, after) =>
  !!(before?.hp && after?.hp && after.hp.value + (after.hp.temp ?? 0) < before.hp.value + (before.hp.temp ?? 0));
