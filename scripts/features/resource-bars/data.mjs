/**
 * GLUniverse Suite — resource bars: reading the numbers.
 *
 * The core is system-agnostic: it asks the token document what its bars are
 * bound to and renders whatever comes back, so a GM's existing bar
 * configuration keeps working untouched. The PF2e layer is additive — temp HP
 * and a raised shield — and is skipped entirely under any other system.
 */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** A bar attribute reduced to what the renderer needs, or null. */
function readBar(token, name) {
  let data;
  try {
    data = token.document.getBarAttribute?.(name);
  } catch {
    return null;                      // a bar bound to a path the actor lost
  }
  if (!data || data.type !== "bar") return null;
  const max = Number(data.max);
  const value = Number(data.value);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(value)) return null;
  return { value, max, frac: clamp01(value / max) };
}

/**
 * PF2e temp HP, as a fraction of *max HP* rather than of itself.
 *
 * Measuring temp against its own maximum would make 3 temp HP on a level-1
 * character and 30 on a level-20 one draw the same plate, which tells the
 * viewer nothing. Against max HP it reads as "this much of a buffer", which is
 * the question being asked.
 */
function readTempHp(actor, heroMax) {
  const temp = Number(actor?.system?.attributes?.hp?.temp ?? 0);
  if (!Number.isFinite(temp) || temp <= 0 || !heroMax) return 0;
  return clamp01(temp / heroMax);
}

/** PF2e raised shield, or null when none is up. */
function readShield(actor) {
  const shield = actor?.attributes?.shield;
  const value = Number(shield?.hp?.value);
  const max = Number(shield?.hp?.max);
  if (!shield || !Number.isFinite(max) || max <= 0 || !Number.isFinite(value)) return null;
  if (!shield.raised && !shield.broken && value >= max) return null;  // carried, not raised
  return { value, max, frac: clamp01(value / max), broken: !!shield.broken };
}

/**
 * Everything the renderer needs for one token.
 *
 * @param {Token} token
 * @param {{ bothBars: boolean, pf2eLayers: boolean }} opts
 */
export function readToken(token, { bothBars = true, pf2eLayers = true } = {}) {
  const hero = readBar(token, "bar1");
  const rail = bothBars ? readBar(token, "bar2") : null;
  if (!hero && !rail) return null;

  const out = { hero, rail, temp: 0, shield: null };

  if (pf2eLayers && game.system.id === "pf2e") {
    const actor = token.actor;
    out.temp = readTempHp(actor, hero?.max ?? 0);
    out.shield = readShield(actor);
  }

  return out;
}

/** True when two readings would draw the same picture. */
export function sameReading(a, b) {
  if (!a || !b) return a === b;
  const bar = (x, y) => (!x || !y ? x === y : x.value === y.value && x.max === y.max);
  return bar(a.hero, b.hero) && bar(a.rail, b.rail) && a.temp === b.temp
    && (!a.shield || !b.shield
      ? a.shield === b.shield
      : a.shield.value === b.shield.value && a.shield.broken === b.shield.broken);
}
