/**
 * Theatre GM apps — the openers the feature's controls and keybindings call.
 * Importable under plain Node: every Foundry class is built on first open.
 */

export { openFilmstrip, closeFilmstrip, toggleFilmstrip, isFilmstripOpen, refreshFilmstrip, FILMSTRIP_ID } from "./filmstrip.mjs";
export { openEditor, closeEditor, toggleEditor, EDITOR_ID } from "./editor.mjs";
export { APP_TEMPLATES } from "./shared.mjs";
