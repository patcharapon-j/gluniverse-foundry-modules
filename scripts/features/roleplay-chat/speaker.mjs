/**
 * Roleplay Chat — who this client is speaking as, and the picker on the chip.
 *
 * A player speaks as one of the actors they own: the one they picked, else their assigned character.
 * A GM's chip follows the token they control and falls back to the Narrator; picking a speaker pins it
 * until they unpin it. The rules are `resolvePlayerSpeaker` / `resolveGmSpeaker` in `model.mjs`; this
 * module only gathers the facts and builds the speaker data a message is posted under.
 */

import { narratorSpeaker, resolveGmSpeaker, resolvePlayerSpeaker } from "./model.mjs";
import { getGmPin, getSpeakerChoice, setGmPin, setSpeakerChoice } from "./settings.mjs";

const loc = (key) => game.i18n.localize(key);

/** Every actor this user owns, by name. */
export function ownedActors() {
  return (game.actors?.contents ?? [])
    .filter((actor) => actor.isOwner)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function controlledToken() {
  if (!canvas?.ready) return null;
  const token = canvas.tokens?.controlled?.[0];
  return token?.document ? token : null;
}

function pinnedTokenDoc(pin) {
  if (pin?.kind !== "token") return null;
  const scene = pin.sceneId ? game.scenes?.get(pin.sceneId) : canvas?.scene;
  return scene?.tokens?.get(pin.tokenId) ?? null;
}

const viewedSceneId = () => canvas?.scene?.id ?? game.scenes?.viewed?.id ?? null;
const artOf = (actor, tokenDoc) => actor?.img ?? tokenDoc?.texture?.src ?? null;

function narrator(source) {
  const name = loc("GLRP.narrator");
  return { kind: "narrator", key: "narrator", name, img: null, source, offScene: false, speakerData: narratorSpeaker(viewedSceneId(), name) };
}

function fromToken(doc, source) {
  return {
    kind: "token",
    key: `token:${doc.parent?.id ?? ""}:${doc.id}`,
    name: doc.name,
    img: artOf(doc.actor, doc),
    source,
    offScene: doc.parent?.id !== viewedSceneId(),
    speakerData: ChatMessage.implementation.getSpeaker({ token: doc })
  };
}

function fromActor(actor) {
  const speakerData = ChatMessage.implementation.getSpeaker({ actor });
  return { kind: "actor", key: `actor:${actor.id}`, name: speakerData.alias || actor.name, img: artOf(actor, null), source: null, offScene: false, speakerData };
}

/** The speaker this client posts as, or null for a player who owns nothing. */
export function currentSpeaker() {
  if (game.user?.isGM) {
    const pin = getGmPin();
    const pinDoc = pinnedTokenDoc(pin);
    const ctl = controlledToken();
    const r = resolveGmSpeaker({
      pin,
      pinExists: Boolean(pinDoc),
      controlled: ctl ? { tokenId: ctl.id, sceneId: ctl.document.parent?.id ?? null } : null
    });
    if (r.kind === "narrator") return narrator(r.source);
    return fromToken(r.source === "pinned" ? pinDoc : ctl.document, r.source);
  }
  const r = resolvePlayerSpeaker({ choice: getSpeakerChoice() || null, character: game.user?.character ?? null, owned: ownedActors() });
  const actor = r ? game.actors?.get(r.id) : null;
  return actor ? fromActor(actor) : null;
}

/** The groups of rows the chip's picker lists. */
export function pickerModel() {
  const current = currentSpeaker();
  if (!game.user?.isGM) {
    const assigned = game.user?.character?.id ?? null;
    return {
      groups: [{
        heading: loc("GLRP.picker.speakAs"),
        rows: ownedActors().map((actor) => ({
          key: `actor:${actor.id}`,
          name: actor.name,
          img: artOf(actor, null),
          selected: current?.key === `actor:${actor.id}`,
          tag: actor.id === assigned ? loc("GLRP.picker.assigned") : ""
        }))
      }]
    };
  }
  const pinned = current?.source === "pinned";
  const ctl = controlledToken();
  const follow = {
    key: "auto",
    name: ctl ? ctl.document.name : loc("GLRP.narrator"),
    img: ctl ? artOf(ctl.document.actor, ctl.document) : null,
    selected: !pinned,
    tag: ctl ? loc("GLRP.picker.selected") : loc("GLRP.picker.nothingSelected")
  };
  const rows = [{ key: "narrator", name: loc("GLRP.narrator"), img: null, selected: pinned && current.kind === "narrator" }];
  const seen = new Set();
  const docs = canvas?.ready ? (canvas.tokens?.placeables ?? []).map((t) => t.document).filter((d) => d?.actor) : [];
  for (const doc of docs.sort((a, b) => a.name.localeCompare(b.name))) {
    const key = `token:${doc.parent?.id ?? ""}:${doc.id}`;
    seen.add(key);
    rows.push({ key, name: doc.name, img: artOf(doc.actor, doc), selected: pinned && current.key === key, tag: doc.hidden ? loc("GLRP.picker.hidden") : "" });
  }
  // A pin on another scene stays listed, so it can be seen and unpinned from here.
  if (pinned && current.kind === "token" && !seen.has(current.key)) {
    rows.push({ key: current.key, name: current.name, img: current.img, selected: true, tag: loc("GLRP.picker.offScene") });
  }
  return { groups: [{ heading: loc("GLRP.picker.follow"), rows: [follow] }, { heading: loc("GLRP.picker.pin"), rows }] };
}

/** A click on a picker row. */
export async function pick(key) {
  const value = String(key ?? "");
  if (!game.user?.isGM) {
    if (!value.startsWith("actor:")) return;
    const id = value.slice("actor:".length);
    await setSpeakerChoice(id === game.user?.character?.id ? "" : id);
    return;
  }
  if (value === "auto") return setGmPin(null);
  if (value === "narrator") return setGmPin({ kind: "narrator" });
  const [kind, sceneId, tokenId] = value.split(":");
  if (kind === "token" && tokenId) return setGmPin({ kind: "token", sceneId: sceneId || null, tokenId });
}
