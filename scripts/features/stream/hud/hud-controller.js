/**
 * Party HUD — GM-authoritative state source.
 *
 * The dedicated stream client may not own the party actors, so rather than read
 * sheets locally it renders snapshots the GM computes and broadcasts. This keeps
 * "live from the character sheet" working regardless of the stream user's
 * permissions, and matches the rest of the module's director→stream authority
 * model. Only the responsible GM broadcasts (see socket.emitHudState) so a
 * multi-GM table doesn't double-emit.
 */

import { HOOK_NS } from "../constants.js";
import { getSetting } from "../settings.js";
import { buildActorSnapshot, hasAdapter } from "./system-adapter.js";
import { emitHudState } from "../socket.js";

const ACTOR_HOOKS = [
  "updateActor", "updateItem", "createItem", "deleteItem",
  "createActiveEffect", "deleteActiveEffect", "updateActiveEffect"
];
const COMBAT_HOOKS = ["updateCombat", "combatTurnChange", "combatStart", "combatTurn", "combatRound", "deleteCombat"];

export class HudController {
  constructor() {
    this._debounce = null;
  }

  registerHooks() {
    for (const hook of ACTOR_HOOKS) {
      Hooks.on(hook, doc => {
        if (this.#touchesRoster(doc)) this.scheduleBroadcast();
      });
    }
    for (const hook of COMBAT_HOOKS) {
      Hooks.on(hook, () => this.scheduleBroadcast());
    }
    Hooks.on(`${HOOK_NS}.settingsChanged`, key => {
      if (key === "hudSettings") this.scheduleBroadcast();
    });
  }

  #rosterIds() {
    return new Set(getSetting("hudSettings")?.roster ?? []);
  }

  #touchesRoster(doc) {
    const actor = doc?.actor ?? (doc?.documentName === "Actor" ? doc : null);
    const id = actor?.id ?? (doc?.documentName === "Actor" ? doc?.id : null);
    return id ? this.#rosterIds().has(id) : false;
  }

  scheduleBroadcast() {
    if (!game.user?.isGM) return;
    clearTimeout(this._debounce);
    // Coalesce the burst of hooks a single damage application fires (actor +
    // effect + item) into one broadcast so the stream animates once.
    this._debounce = setTimeout(() => this.broadcast(), 60);
  }

  broadcast() {
    if (!game.user?.isGM) return;
    emitHudState(this.computeState());
  }

  computeState() {
    const settings = getSetting("hudSettings") ?? {};
    const activeActorId = this.#activeTurnActorId();
    const cards = (settings.roster ?? [])
      .map(id => {
        const actor = game.actors?.get(id);
        const snapshot = actor ? buildActorSnapshot(actor, settings) : null;
        if (!snapshot) return null;
        snapshot.turn = activeActorId != null && snapshot.id === activeActorId;
        return snapshot;
      })
      .filter(Boolean);

    return {
      visible: Boolean(settings.enabled) && hasAdapter(),
      layout: {
        anchor: settings.anchor ?? "bottom",
        align: settings.align ?? "center",
        offsetX: Number(settings.offsetX) || 0,
        offsetY: Number(settings.offsetY) || 0,
        scale: Number(settings.scale) || 100
      },
      cards
    };
  }

  #activeTurnActorId() {
    return game.combat?.combatant?.actor?.id ?? null;
  }
}
