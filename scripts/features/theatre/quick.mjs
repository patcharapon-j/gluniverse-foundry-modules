/**
 * Theatre — the viewed scene's shots in the suite's quick palette
 * (core/quick-palette.mjs). GM only, and only on a Theatre scene.
 *
 * Enter puts the shot on air in the scene's own style; Shift+Enter cues it up
 * in the filmstrip without cutting; Ctrl+Enter opens it in the editor. An empty
 * query lists the shot on air and what follows it, which is what a GM reaching
 * for the palette mid-scene most often wants.
 */

import { warn } from "../../core/const.mjs";
import { foldText, matchScore } from "../../core/util.mjs";
import { isVideo, searchText } from "./model.mjs";
import { TheatreStore } from "./store.mjs";
import { openEditor } from "./controls.mjs";

/** Rows the palette shows for this scene. */
const LIMIT = 12;

function L(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

function item(store, shot, folderName, onAir) {
  const title = shot.title || shot.eyebrow || shot.subtitle || L("GLTH.app.untitled");
  const sub = [shot.title ? shot.eyebrow : "", folderName].filter(Boolean).join(" · ");
  const video = isVideo(shot.src);
  return {
    key: `th:${shot.id}`,
    title,
    sub,
    img: shot.src && !video ? shot.src : null,
    icon: video ? "fa-solid fa-video" : "fa-regular fa-image",
    badge: onAir ? L("GLTH.filmstrip.onAir") : null,
    actions: [
      { id: "go", label: L("GLTH.quick.go"), icon: "fa-solid fa-play", mod: "" },
      { id: "cue", label: L("GLTH.quick.cue"), icon: "fa-solid fa-film", mod: "shift" },
      { id: "edit", label: L("GLTH.quick.edit"), icon: "fa-solid fa-pen-ruler", mod: "ctrl" },
    ],
    async run(action) {
      if (action === "go") return store.cue({ kind: "shot", shotId: shot.id });
      if (action === "cue") return (await import("./apps/filmstrip.mjs")).cueUp(shot.id);
      if (action === "edit") return openEditor(shot.id);
      return null;
    },
  };
}

export const quickProvider = Object.freeze({
  id: "theatre",
  order: 0,
  label: "GLTH.quick.group",
  icon: "fa-solid fa-clapperboard",
  available: () => !!game.user?.isGM && !!TheatreStore.current,
  search(query) {
    const store = TheatreStore.current;
    if (!store) return [];
    try {
      const shots = store.shots;
      const onAirId = store.state.shotId;
      const folderName = (s) => store.folder(s.folder)?.name ?? "";
      if (!foldText(query)) {
        const from = Math.max(0, store.indexOf(onAirId));
        return shots.slice(from, from + LIMIT).map((s) => item(store, s, folderName(s), s.id === onAirId));
      }
      return shots
        .map((s, i) => ({ s, i, score: matchScore(s.title || s.eyebrow || s.subtitle, searchText(s, folderName(s)), query) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .slice(0, LIMIT)
        .map(({ s }) => item(store, s, folderName(s), s.id === onAirId));
    } catch (e) {
      warn("theatre | quick search failed", e);
      return [];
    }
  },
});
