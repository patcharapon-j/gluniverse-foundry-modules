/**
 * GLUniverse Suite — Etched-Glass Chat Theme: tier resolution.
 *
 * The single deterministic function that maps one PF2e chat message to exactly
 * one Treatment Tier (and, when fractured, exactly one fracture color).
 *
 * Pure with respect to the message + live actor/token state: no DOM, no side
 * effects, no persistence. Total — always returns a valid tier; never throws.
 * Missing/foreign flags resolve to `baseline`.
 */

// PF2e roll types eligible for an outcome-driven fracture. Mirrors the
// `critical` feature's SUPPORTED_ROLL_TYPES (critical/module.js:630-636). Any
// other context.type never fractures (damage-roll, flat-check, etc.).
const ELIGIBLE_ROLL_TYPES = new Set([
  "attack-roll",
  "spell-attack-roll",
  "saving-throw",
  "skill-check",
  "perception-check",
]);

// Foundry token disposition constants: FRIENDLY=1, NEUTRAL=0, HOSTILE=-1,
// SECRET=-2. Only HOSTILE reverses the gold/red valence.
const HOSTILE = -1;

/** Resolve the speaker actor for a message (live document, may be null). */
function resolveActor(message) {
  try {
    if (message?.actor) return message.actor;
    const actorId = message?.speaker?.actor;
    if (actorId && game.actors) return game.actors.get(actorId) ?? null;
  } catch {
    /* defensive: missing game/actors during teardown */
  }
  return null;
}

/** Token-first disposition: message token → prototype token → neutral (0). */
function resolveDisposition(message, actor) {
  const tokenDisp = message?.token?.disposition;
  if (Number.isFinite(tokenDisp)) return tokenDisp;
  const protoDisp = actor?.prototypeToken?.disposition;
  if (Number.isFinite(protoDisp)) return protoDisp;
  return 0; // neutral default (never reverses)
}

/** True when the speaker actor is currently dying or wounded. Read live. */
function isDyingOrWounded(actor) {
  if (!actor) return false;
  try {
    if (Number(actor.system?.attributes?.dying?.value) > 0) return true;
    const items = actor.items ?? [];
    for (const item of items) {
      if (item?.type !== "condition") continue;
      const slug = item?.slug ?? item?.system?.slug;
      if (slug === "dying" || slug === "wounded") return true;
    }
  } catch {
    /* defensive: foreign actor shape */
  }
  return false;
}

/**
 * Roll/message visibility, derived from whisper recipients + the blind flag.
 *  - "public"  : visible to everyone (no whisper)
 *  - "blind"   : blind GM roll (GM sees result, roller does not)
 *  - "gm"      : whispered to the GM(s)
 *  - "self"    : whispered only to the author
 *  - "private" : whispered to specific others
 */
function resolveVisibility(message) {
  try {
    const whisper = message?.whisper ?? [];
    if (message?.blind) return "blind";
    if (!whisper.length) return "public";
    const gmIds = game.users?.filter?.((u) => u.isGM).map((u) => u.id) ?? [];
    const toGM = whisper.some((id) => gmIds.includes(id));
    const authorId = message?.author?.id ?? message?.user?.id ?? null;
    const onlySelf = whisper.length === 1 && authorId && whisper[0] === authorId;
    if (toGM) return "gm";
    if (onlySelf) return "self";
    return "private";
  } catch {
    return "public";
  }
}

/** Coarse card category, drives baseline sub-styling (data-glec-category). */
function resolveCategory(type) {
  switch (type) {
    case "attack-roll":
    case "spell-attack-roll":
      return "action";
    case "saving-throw":
      return "save";
    case "skill-check":
    case "perception-check":
    case "flat-check":
      return "check";
    case "damage-roll":
      return "damage";
    case "spell-cast":
      return "item-spell";
    default:
      return "other";
  }
}

/** Natural face of the active d20 in a message's first roll, or null. */
function naturalD20Face(message) {
  try {
    const roll = message?.rolls?.[0];
    const d20 = roll?.dice?.find((d) => Number(d.faces) === 20);
    if (!d20) return null;
    const res = d20.results?.find((r) => r.active && !r.discarded) ?? d20.results?.[0];
    const face = Number(res?.result);
    return Number.isFinite(face) ? face : null;
  } catch {
    return null;
  }
}

/** valence (after disposition) → fracture color, or null. */
function resolveColor(outcome, disposition) {
  let valence =
    outcome === "criticalSuccess" ? "positive" : outcome === "criticalFailure" ? "negative" : null;
  if (valence === null) return null;
  if (disposition === HOSTILE) valence = valence === "positive" ? "negative" : "positive";
  return valence === "positive" ? "gold" : "red";
}

/**
 * @param {ChatMessage} message
 * @returns {{
 *   tier: "baseline"|"fracture-gold"|"fracture-red"|"dying",
 *   fracture: null|"gold"|"red",
 *   category: "check"|"save"|"damage"|"action"|"item-spell"|"whisper"|"other",
 *   reason: string
 * }}
 */
export function classifyMessage(message) {
  const ctx = message?.flags?.pf2e?.context ?? null;
  const type = ctx?.type ?? null;
  const outcome = ctx?.outcome ?? null;

  let category = resolveCategory(type);
  if (message?.whisper?.length) category = "whisper";
  const visibility = resolveVisibility(message);

  // 1. Eligible critical outcome OR a natural 20 / natural 1 die face → fracture.
  //    A crit outcome sets the valence directly; a bare nat 20/1 (no crit) is
  //    synthesized to the matching valence so a swung-low / swung-high d20 still
  //    cracks. Color is valence × disposition (hostile reverses gold/red).
  if (ELIGIBLE_ROLL_TYPES.has(type)) {
    const isCrit = outcome === "criticalSuccess" || outcome === "criticalFailure";
    const face = naturalD20Face(message);
    const isNat = face === 20 || face === 1;
    if (isCrit || isNat) {
      const actor = resolveActor(message);
      const disposition = resolveDisposition(message, actor);
      const valenceOutcome = isCrit
        ? outcome
        : face === 20
          ? "criticalSuccess"
          : "criticalFailure";
      const color = resolveColor(valenceOutcome, disposition);
      if (color) {
        return {
          tier: color === "gold" ? "fracture-gold" : "fracture-red",
          fracture: color,
          category,
          visibility,
          reason: `${outcome ?? "—"}|nat:${face ?? "—"}|disp:${disposition}|${color}`,
        };
      }
    }
  }

  // 2. Dying / wounded speaker → resting dying sheen.
  if (isDyingOrWounded(resolveActor(message))) {
    return { tier: "dying", fracture: null, category, visibility, reason: "dying-or-wounded" };
  }

  // 3. Baseline.
  return { tier: "baseline", fracture: null, category, visibility, reason: "baseline" };
}
