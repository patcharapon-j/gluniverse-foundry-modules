/**
 * Daggerheart chat messages, as the stream's snapshot step (`stream-cards/daggerheart/snapshot.js`)
 * hands them to the reader.
 *
 * Each `raw` is what the `gluniverse-daggerheart` system writes (v1.23, `dice/rolls.ts` `postPlate`,
 * `sheets/post-card.ts`, `apps/rest.ts`): style OTHER, `flags["gluniverse-daggerheart"]` carrying the
 * plate, its kind, the actor's uuid and the trailing button. The plates follow `dice/types.ts` field for
 * field. `derived` is what the snapshot step looks up in the world.
 *
 * Shared by `tests/daggerheart-read-message.test.mjs` and `tools/stream-cards-preview.mjs`, so the
 * preview draws exactly the messages the tests read.
 */

export const SYSTEM = "gluniverse-daggerheart";
const OTHER = 0;

const PLAYER = { id: "userPlayer01", name: "Mira" };
const GM = { id: "userGameMast", name: "Gamemaster" };

export const ARIA = {
  uuid: "Actor.ariaCharacter1",
  name: "Aria Vell",
  img: "modules/gluniverse-foundry-modules/assets/stream-cards/preview/aria.webp",
  type: "character"
};
export const KESS = {
  uuid: "Actor.kessCharacter1",
  name: "Kess Thornweld",
  img: "modules/gluniverse-foundry-modules/assets/stream-cards/preview/kess.webp",
  type: "character"
};
export const BRUTE = {
  uuid: "Scene.sceneA.Token.tokBrute.Actor.bruteAdversary",
  name: "Bramblewood Brute",
  img: "modules/gluniverse-foundry-modules/assets/stream-cards/preview/brute.webp",
  type: "adversary"
};

let counter = 0;
const nextId = () => `dhMessage${String(++counter).padStart(7, "0")}`;

/** One message's snapshot. */
function message({ id = nextId(), author = PLAYER, isGM = false, actor = ARIA, token = null, flags = {}, rolls = [], style = OTHER, content = "", whisper = [], blind = false, chatFilter = null, foeTarget = null, extraDerived = {} } = {}) {
  const speakerToken = token ?? { name: actor?.name ?? null, textureSrc: actor?.img ?? null, displayName: isGM ? 0 : 30 };
  return {
    raw: {
      _id: id,
      blind,
      whisper,
      author: author.id,
      speaker: { scene: "sceneA", token: actor ? `tok${actor.name.split(" ")[0]}` : null, actor: actor?.uuid?.split(".").pop() ?? null, alias: speakerToken?.name ?? author.name },
      flavor: "",
      content,
      style,
      flags
    },
    derived: {
      authorName: author.name,
      authorIsGM: isGM,
      rollCount: rolls.length,
      rolls,
      actor: actor ? { name: actor.name, type: actor.type, img: actor.img, hasPlayerOwner: actor.type === "character", focusOverrides: [] } : null,
      token: speakerToken,
      defaultArt: { src: "", focus: null },
      chatFilter,
      foeTarget,
      ...extraDerived
    }
  };
}

function plateFlags(kind, plate, actor, { next = null, nextAct = null, extra = {}, claimed = null } = {}) {
  return {
    [SYSTEM]: {
      plate,
      kind,
      actorUuid: actor?.uuid ?? null,
      next,
      nextAct,
      ...extra,
      ...(claimed ? { claimed } : {})
    }
  };
}

const dualityRoll = (h, f, total, hopeDie = "d12", fearDie = "d12") => ({
  total,
  formula: `1${hopeDie} + 1${fearDie} + ${total - h - f}`,
  dice: [{ faces: Number(hopeDie.slice(1)), results: [h] }, { faces: Number(fearDie.slice(1)), results: [f] }]
});

/**
 * A player's duality roll.
 * @param {object} o
 * @param {number} o.h  Hope's face
 * @param {number} o.f  Fear's face
 */
export function duality({ h, f, mod = 2, dc = null, label = "Agility", kind, rxn = false, attack = false, claimed = null, rr = null, actor = ARIA, isGM = false, author, id, whisper, blind, chatFilter, hd, fd } = {}) {
  const total = h + f + mod;
  const out = h === f ? "crit" : h > f ? "hope" : "fear";
  const hit = out === "crit" ? true : dc == null ? false : total >= dc;
  const plate = {
    who: actor.name,
    label,
    img: actor.img,
    kind: kind ?? (attack ? "attack roll" : rxn ? "reaction roll" : `${label.toLowerCase()} roll`),
    total,
    mods: [{ k: label.toLowerCase(), v: mod }],
    h,
    f,
    hd: hd ?? "d12",
    fd: fd ?? "d12",
    out,
    dc,
    hit,
    ...(rxn ? { rxn: true } : {}),
    ...(rr ? { rr } : {})
  };
  return message({
    id,
    actor,
    isGM,
    author: author ?? (isGM ? GM : PLAYER),
    whisper,
    blind,
    chatFilter,
    rolls: [dualityRoll(h, f, total, plate.hd, plate.fd)],
    flags: plateFlags("duality", plate, actor, attack
      ? { next: "Roll damage", nextAct: "roll-damage", extra: { weaponId: "itemLongsword1" }, claimed }
      : { claimed })
  });
}

/** An adversary's d20 (the GM's). `target`/`dc` as `attackTarget()` leaves them. */
export function adversary({ d20 = [14], mod = 3, target = "", dc = null, rxn = false, neg = false, label = "Claws", actor = BRUTE, foeTarget = null, whisper, id, chatFilter, token } = {}) {
  const kept = neg ? Math.min(...d20) : Math.max(...d20);
  const total = kept + mod;
  const crit = !rxn && kept === 20;
  const hit = crit ? true : dc == null ? false : total >= dc;
  const plate = {
    who: actor.name,
    label,
    kind: rxn ? "adversary reaction" : "adversary attack",
    total,
    mods: [{ k: "attack modifier", v: mod }],
    d20,
    ...(neg ? { neg: true } : {}),
    target,
    dc,
    hit,
    ...(rxn ? { rxn: true } : {})
  };
  return message({
    id,
    actor,
    isGM: true,
    author: GM,
    token,
    // The system whispers an adversary reaction to the GMs: its Difficulty is the GM's number.
    whisper: whisper ?? (rxn ? [GM.id] : []),
    chatFilter,
    foeTarget,
    rolls: [{ total, formula: `1d20 + ${mod}`, dice: [{ faces: 20, results: d20 }] }],
    flags: plateFlags("adversary", plate, actor, hit && !rxn ? { next: "Deal 2d8+2 physical damage", nextAct: "roll-foe-damage" } : {})
  });
}

/** A damage roll. `max` present only on a critical, as the system stores it. */
export function damage({ rolls = [4, 6], die = "d8", bonus = 2, dtype = "physical", crit = false, label = "Longsword", actor = ARIA, isGM = false, extra, id, chatFilter } = {}) {
  const faces = Number(die.slice(1));
  const max = crit ? rolls.map(() => faces) : null;
  const total = rolls.reduce((a, b) => a + b, 0) + (max ? max.reduce((a, b) => a + b, 0) : 0) + bonus;
  const plate = {
    who: actor.name,
    label,
    img: actor.img,
    total,
    mods: [{ k: "bonus", v: bonus }],
    n: rolls.length,
    die,
    rolls,
    ...(max ? { max } : {}),
    ...(extra ? { extra } : {}),
    dtype
  };
  return message({
    id,
    actor,
    isGM,
    author: isGM ? GM : PLAYER,
    chatFilter,
    rolls: [{ total, formula: `${rolls.length}${die} + ${bonus}`, dice: [{ faces, results: rolls }] }],
    flags: plateFlags("damage", plate, actor)
  });
}

/** A card or one of its features posted from a sheet (`sheets/post-card.ts`). */
export function feature({ name = "Book of Ava", feature: featureName = "Power Push", type = "domainCard", actions = [{ kind: "pay-cost", label: "Power Push · Spend 1 Hope", hope: 1, stress: 0, armor: 0, fear: 0 }], actor = ARIA, isGM = false, id, chatFilter } = {}) {
  return message({
    id,
    actor,
    isGM,
    author: isGM ? GM : PLAYER,
    chatFilter,
    content: `<div class="dh dh-card"><h3>${featureName || name}</h3></div>`,
    flags: {
      [SYSTEM]: {
        kind: "card",
        actorUuid: actor?.uuid ?? null,
        itemId: "itemCard00001",
        feature: featureName || null,
        card: { name, type, id: "itemCard00001" },
        cardActions: actions
      }
    }
  });
}

/** A rest summary (`apps/rest.ts`). */
export function rest({ actor = ARIA, id } = {}) {
  return message({
    id,
    actor,
    content: `<div class="dh dh-rest">Short rest</div>`,
    flags: { [SYSTEM]: { kind: "rest", rest: { type: "short", moves: ["tend", "clear-stress"] } } }
  });
}

/** A line somebody typed. Style IC 2, EMOTE 3, OOC 1; a Roleplay Chat mode rides `flags[suite].rp.mode`. */
export function typed({ body = "Stay behind me.", style = 2, rpMode = null, actor = ARIA, isGM = false, whisper, blind, id, chatFilter } = {}) {
  return message({
    id,
    actor: style === 1 && !rpMode ? null : actor,
    isGM,
    author: isGM ? GM : PLAYER,
    whisper,
    blind,
    chatFilter,
    style,
    content: `<p>${body}</p>`,
    flags: rpMode ? { "gluniverse-foundry-modules": { rp: { mode: rpMode } } } : {}
  });
}

/** A plain `/r` roll, or the system's `roll-dice` card button: Foundry's own roll card, no system flag. */
export function plainRoll({ formula = "1d4", results = [3], total = 3, actor = ARIA, id } = {}) {
  return message({
    id,
    actor,
    rolls: [{ total, formula, dice: [{ faces: Number(formula.split("d")[1]) || 4, results }] }]
  });
}

/** A copy with the system flags changed, the way an `updateChatMessage` leaves the document. */
export function withFlags(snapshot, patch) {
  const copy = structuredClone(snapshot);
  Object.assign(copy.raw.flags[SYSTEM], structuredClone(patch));
  return copy;
}
