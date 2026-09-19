import { getActiveSceneCombat, getCombatants } from "./combat-utils.js";
import { FLAGS, HOOKS, MODULE_ID } from "./constants.js";
import { canEditDirectorSettings } from "./settings.js";
import { requestSceneFlag } from "./director-auth.mjs";

export class TokenTracking {
  registerHooks() {
    Hooks.on("renderTokenHUD", (hud, html) => this.addHudButton(hud, html));
  }

  getTrackedIds(scene = canvas?.scene) {
    const ids = scene?.getFlag(MODULE_ID, FLAGS.trackedTokenIds);
    return Array.isArray(ids) ? ids : [];
  }

  async setTrackedIds(ids, scene = canvas?.scene) {
    if (!scene) return;
    const next = Array.from(new Set(ids.filter(Boolean)));
    await requestSceneFlag(scene.id, FLAGS.trackedTokenIds, next);
    Hooks.callAll(HOOKS.trackedTokensChanged, scene.id, next);
  }

  async toggleToken(tokenOrDocument, scene = canvas?.scene) {
    const tokenId = tokenOrDocument?.document?.id ?? tokenOrDocument?.id;
    if (!tokenId || !scene) return;
    const ids = this.getTrackedIds(scene);
    const next = ids.includes(tokenId) ? ids.filter(id => id !== tokenId) : [...ids, tokenId];
    await this.setTrackedIds(next, scene);
  }

  async toggleTokenById(tokenId, scene = canvas?.scene) {
    if (!tokenId || !scene) return;
    const ids = this.getTrackedIds(scene);
    const next = ids.includes(tokenId) ? ids.filter(id => id !== tokenId) : [...ids, tokenId];
    await this.setTrackedIds(next, scene);
  }

  getTrackedTokens() {
    const ids = new Set(this.getTrackedIds());
    return canvas?.tokens?.placeables?.filter(token => ids.has(token.document?.id)) ?? [];
  }

  getTokenRows() {
    const tracked = new Set(this.getTrackedIds());
    const combatants = getCombatants(getActiveSceneCombat());
    const defeatedIds = new Set(combatants.filter(c => c.defeated).map(c => c.tokenId));
    return (canvas?.tokens?.placeables ?? []).map(token => ({
      id: token.document.id,
      name: token.document.name,
      tracked: tracked.has(token.document.id),
      hidden: Boolean(token.document.hidden),
      visibleHere: token.visible !== false,
      defeated: defeatedIds.has(token.document.id),
      actor: token.actor?.name ?? "",
      inCombat: combatants.some(c => c.tokenId === token.document.id)
    }));
  }

  addHudButton(hud, html) {
    // Not `isGM`. Tracked tokens are a scene flag with a delegated write path of
    // its own (`requestSceneFlag` allows exactly this flag), so a trusted
    // director is who this button is for. Gated on the GM, a director could see
    // the tracking list in the panel and had no way to add to it from the
    // canvas — the one place a director actually picks a token.
    if (!canEditDirectorSettings()) return;
    const element = getElement(html);
    const token = hud?.object;
    if (!element || !token?.document) return;
    if (element.querySelector(".gluniverse-stream-track-token")) return;

    const button = document.createElement("div");
    const tracked = this.getTrackedIds(token.document.parent).includes(token.document.id);
    button.className = `control-icon gluniverse-stream-track-token ${tracked ? "active" : ""}`;
    button.title = game.i18n.localize("GLUNIVERSE_STREAM.tokenHud.track");
    button.innerHTML = '<i class="fas fa-video"></i>';
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleToken(token, token.document.parent);
      button.classList.toggle("active");
    });

    const column = element.querySelector(".col.right") ?? element.querySelector(".right") ?? element;
    column.append(button);
  }
}

function getElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element instanceof HTMLElement) return html.element;
  return null;
}
