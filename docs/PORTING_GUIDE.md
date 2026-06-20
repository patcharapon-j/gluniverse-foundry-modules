# GLUniverse Suite — Porting Procedure (for each feature)

Read `docs/FEATURE_CONTRACT.md` first. You are porting ONE standalone module
into the suite. You will be told: `featureId`, `prefix`, `sourceDir`,
`system`, `requires`, `defaultEnabled`, and the old module id.

Work ONLY inside these target locations (do not touch shared/core files,
`module.json`, `lang/en.json`, or other features):

- `scripts/features/<featureId>/`   ← all JS, preserving the source's internal subfolders
- `styles/<featureId>.css` (or `<featureId>-<name>.css` if the source had several)
- `templates/<featureId>/`           ← only if the source had templates
- `assets/<featureId>/`              ← only if the source had assets (images/audio/fonts)
- `lang/<featureId>.en.json`         ← the source's English strings (copy as-is)

## Steps

1. **Copy** the source's `scripts/` (or root entry file) into
   `scripts/features/<featureId>/`, preserving subfolders. Keep the original
   entry file name. Copy `styles/*` → `styles/<featureId>*.css`, `templates/*`
   → `templates/<featureId>/`, `assets/*` → `assets/<featureId>/`, and the
   source `lang/en.json` (or `lang/*.json`) → `lang/<featureId>.en.json`.

2. **Module id constant** → set the module's `MODULE_ID` (or equivalent) to
   `"gluniverse-suite"`. Add `const FEATURE_ID = "<featureId>";` if helpful.

3. **Settings** — every `game.settings.register/get/set/registerMenu` that used
   the old id now uses `"gluniverse-suite"`, and EVERY setting KEY is prefixed
   with `"<prefix>."`. If the module has a central `SETTINGS`/`Settings` key map,
   prefix the values there once; otherwise prefix each inline key string. Keep a
   note of the full old→new key list for your report.

4. **Flags** — `getFlag/setFlag/unsetFlag(<old-id>, key)` → scope
   `"gluniverse-suite"`, key prefixed with `"<prefix>."`. Same for any
   `flags["<old-id>"]` / `flags?.[MODULE_ID]` chat-message lookups (prefix the
   sub-keys). Update `module.json`-style hotReload flags are N/A (core owns it).

5. **Sockets** — replace ALL `game.socket.emit("module.<old-id>", ...)` and
   `game.socket.on("module.<old-id>", ...)`. Import
   `import { onSocket, emitSocket } from "../../core/socket.mjs";` (adjust `../`
   depth to reach `scripts/core/`). Use `emitSocket("<featureId>", payload)` and
   register `onSocket("<featureId>", handler)` from your `onReady`. Remove the
   feature's own `game.socket.on` wiring.

6. **Paths** — replace every `modules/<old-id>/` string with
   `modules/gluniverse-suite/features/<featureId>/`. This covers template
   loaders (`loadTemplates`, `renderTemplate`, `FilePicker`), CSS `url(...)` (use
   relative `../assets/...` or absolute module path consistently), and JS asset
   paths. Verify template/asset paths point at the new copied locations.

7. **Lifecycle** — the source almost certainly calls `Hooks.once("init"/"ready")`
   and registers hooks at import. REMOVE those top-level Foundry hook
   registrations and instead expose three functions wired through the adapter:
   - settings registration → `registerSettings()`
   - everything from the old `init` hook → `onInit()`
   - everything from the old `ready` hook (+ socket wiring) → `onReady()`
   The feature must do NOTHING at import time except define things.

8. **Adapter** — create `scripts/features/<featureId>/index.mjs` exactly per the
   contract, calling `Suite.register({...})` with `registerSettings/onInit/onReady`
   delegating into the ported entry module, plus the `legacy` migration
   descriptor (map each old setting key → new prefixed key; add a `migrate`
   async only if document flags need moving — keep it best-effort/guarded).
   Use `title: "GLS.feature.<featureId>.title"`, `hint: "GLS.feature.<featureId>.hint"`.

9. **i18n title/hint** — the suite already defines
   `GLS.feature.<featureId>.title/hint`; just reference them.

## Verify before finishing

- `node --check` every `.mjs`/`.js` you wrote under the feature folder
  (for plain scripts that use browser globals this still parses).
- `grep -rn "<old-id>"` inside your feature folder returns ONLY occurrences that
  are intentional (e.g. the `legacy.id`, i18n keys that legitimately contain it,
  or comments). No `game.settings`/`game.socket`/`getFlag`/path string should
  reference the old id.
- `grep -rn "game.socket"` inside your feature folder returns nothing (all routed
  through core/socket).

## Report back (concise)

Return a JSON block:
```json
{
  "featureId": "...",
  "entry": "scripts/features/<id>/<file>",
  "styles": ["styles/<id>.css"],
  "lang": "lang/<id>.en.json",
  "templates": true|false,
  "assets": true|false,
  "settingKeys": ["<prefix>.foo", "..."],
  "usesSocket": true|false,
  "notes": "anything tricky, conflicts, or assumptions"
}
```
