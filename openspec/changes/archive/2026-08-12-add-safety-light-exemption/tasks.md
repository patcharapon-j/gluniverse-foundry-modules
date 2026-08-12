## 1. Setting and configuration surface

- [x] 1.1 Register `sp.safetyExemptUsers` in `scripts/features/stream-pacer/settings.js` — `scope: 'world'`, `config: false`, `type: Array`, `default: []`, alongside `sp.perilExemptUsers`. Comment why it is tracked separately from the other two lists.
- [x] 1.2 Export `isSafetyExempt(userId)` from `settings.js`, reading the setting on every call. Comment that the per-call read is deliberate (see design.md — "Two questions, one setting").
- [x] 1.3 Extend `saveExemptUsers()` with a `safety-` branch and a third `game.settings.set` call.
- [x] 1.4 Extend `ExemptUsersConfig._prepareContext()` to emit `isSafetyExempt` per user.
- [x] 1.5 Add the third column to `templates/stream-pacer/exempt-users.hbs` — header cell plus `<input type="checkbox" name="safety-{{id}}">`.
- [x] 1.6 Add i18n keys to `lang/stream-pacer.en.json`: `ExemptSafetyColumn`, `SafetyExemptUsers`, `SafetyExemptUsersHint`. Rewrite `ExemptUsersHint` for three columns, and state in it that the safety column is for capture/overlay logins and that exempting a person removes their means of signalling distress (spec: "Named users can be exempt from the safety-light surface").
- [x] 1.7 Confirm no `index.mjs` change is needed — the key has no standalone ancestor (design.md — Migration Plan). Do not add it to `legacy.settings`.

> 1.1 also added `captureLocalSafetyExemption()` / `isLocallySafetyExempt()` to
> `settings.js`. The local snapshot has to live somewhere both `PacerHUD` and
> `PacerManager` can read; putting it in `module.js` would have made those
> imports circular.
>
> 1.5 widened `ExemptUsersConfig`'s window from 400 to 480 px — three columns do
> not fit the original two-column width. No CSS rule changed (`.exempt-col` /
> `.exempt-cell` were already generic); only the stale "two-column table"
> section comment in `styles/stream-pacer.css` was corrected.
>
> 1.7 confirmed: `legacy.settings` in `index.mjs` also omits `sp.safetyAudioEnabled`,
> `sp.spotlightEnabled` and `sp.spotlightMode` — everything post-dating the port.

## 2. Local surface gating

- [x] 2.1 In `scripts/features/stream-pacer/module.js`, snapshot `isSafetySurfaceExempt` from `isSafetyExempt(game.user.id)` next to the existing two booleans, with a comment that all three share the same `onReady` reload boundary.
- [x] 2.2 Gate `SafetyRequestOverlay` construction on it. Replace the comment at `module.js:118` that promises a safety ask reaches every player — the guarantee is now "every player who is not explicitly exempt".
- [x] 2.3 Gate `SafetyLightPanel` construction on it, in addition to the existing bars exemption.
- [x] 2.4 Gate `SafetyAlertOverlay` construction on it inside the GM branch, so the alert pill and the escalated viewport treatment are suppressed for a GM-rights capture login.
- [x] 2.5 Gate the `PacerManager.onSafetyLight(...)` chime subscription on it, leaving `AudioManager` and the hand-raise path untouched.
- [x] 2.6 Verify `game.streamPacer` still exposes the safety keys as `null` rather than throwing when exempt.

> 2.6 confirmed by inspection: `safetyLightPanel`, `safetyRequestOverlay` and
> `safetyAlertOverlay` are module-level bindings initialized to `null`, and the
> API object just reads them — the keys stay present and `null`.
>
> Deliberately left ungated: the sole-GM repair block (`emitSafetyRequestStop` /
> `emitSafetyLightRequest`). Those are outgoing only; a safety-exempt GM client
> renders nothing from the result, and suppressing them would stop a GM-rights
> capture login from closing a check-in orphaned by a departed GM client.

## 3. GM HUD gating

- [x] 3.1 In `PacerHUD.js`, make the local safety exemption available to `_prepareContext()`.
- [x] 3.2 Return an inert context from `_prepareSafetyContext()` when exempt — `requested: false`, no `hudAlert`, `show: false` — so the container tier class, the toggle button and the board all fall away.
- [x] 3.3 Carry an explicit flag in the HUD context and guard the per-player roster chip in `templates/stream-pacer/pacer-hud.hbs:19-20` on it. Do **not** merely omit `safetyLight` / `safetyAcknowledged`: an absent `safetyAcknowledged` makes `{{#unless}}` add `awaiting-light` to every row, and an absent `safetyLight` emits a bare `light-` class (design.md — "The GM roster chip needs an explicit template guard").
- [x] 3.4 Drop `safetyLight`, `safetyLightTitle` and `safetyAcknowledged` from the per-player context when exempt, and confirm the chip title no longer names any colour.
- [x] 3.5 Confirm the GM's check-in toggle and light-reset controls are both absent when exempt, so button state cannot reveal a running check-in.

> The context flag is `showSafetyLights` (`game.user.isGM && !isLocallySafetyExempt()`).
> Three template branches were re-keyed from `isGM` onto it: the chip's class and
> title, the `<span class="p-light">` lamp (which otherwise renders a permanently
> green lamp on every row), and the raised-light board.
>
> 3.5 required a template change, not just a context one: the `safety-check-btn`
> at `pacer-hud.hbs:110` sat inside `{{#if isGM}}` with no dependency on
> `safety.*` at all, so it rendered for every GM regardless. It is now wrapped in
> `{{#if showSafetyLights}}`. The reset control was already inside `safety.show`.

## 4. Roster exclusion

- [x] 4.1 Exclude safety-exempt users in `PacerManager.getSafetyRoster()` using the per-call helper, so `total`, `pending`, `raised` and the answered-of-total readout all follow.
- [x] 4.2 Return early from `announceSafetyLight()` when the local user is safety-exempt.
- [x] 4.3 Confirm an exempt user reappears in the roster and totals on the GM's next board update after the GM un-ticks the box, with no GM reload (spec: "A user's exemption is removed").

> 4.3 did not hold on inspection and needed a fix: roster membership was absent
> from `PacerHUD._structuralSignature()`, so through a ticking countdown
> `_canUpdateInPlace()` would keep returning true and the board would hold the
> stale total until some unrelated structural change forced a render. The roster's
> user ids are now part of the safety signature.

## 5. Guard tool

- [x] 5.1 Add `tools/stream-pacer-safety-check.mjs` asserting the four contract points in design.md — prefix agreement across settings/save-handler/context/template; every enumerated safety surface in `module.js` sitting inside the exemption gate; each safety branch in `pacer-hud.hbs` guarded; every new i18n key resolving in `lang/stream-pacer.en.json`.
- [x] 5.2 Make the tool exit non-zero with a named problem list, matching the house style of `tools/locations-check.mjs`.
- [x] 5.3 Add the tool to `CLAUDE.md` under Validation, with a one-line note that it is a source-shape check and cannot prove the rendered result.

> Beyond the four contract points, the tool also asserts the two liveness rules
> (`isSafetyExempt` must read the setting per call; the roster must ask about each
> user rather than about the local client), that `_prepareSafetyContext()` keeps
> its inert-return choke point — which is what covers the container's
> `safety-alert-*` tier class — and that both hints still carry the
> capture-login/distress wording the spec requires.
>
> Validated against 20 deliberate mutations (one per contract point, including
> re-keying a template branch back onto `isGM`, renaming the `safety-` save
> branch, caching in `isSafetyExempt`, and swapping the roster's live read for the
> local snapshot). All 20 were caught; no blind spots.

## 6. Verification

- [x] 6.1 `find scripts tools -name '*.mjs' -o -name '*.js' | xargs -I{} node --check {}` — clean.
- [x] 6.2 JSON parse check over `module.json` and every `lang/*.json` — clean.
- [x] 6.3 `node tools/stream-pacer-safety-check.mjs` — zero problems.
- [x] 6.4 Confirm every dynamically-built i18n key the safety surfaces use still resolves; the three-column form and the new hint are the only additions.
- [ ] 6.5 Manual session, empty exemption list: confirm behaviour is unchanged — check-in reaches players, board counts everyone, chime fires, red vignette shows.
- [ ] 6.6 Manual session, capture login exempt **with player rights**: open a check-in and raise a red from a real player. Confirm the capture screen shows no banner, no lamps, no dimming of the pacer overlay or centre aura, and that the GM's readout reaches *n* of *n*.
- [ ] 6.7 Manual session, capture login exempt **with GM rights**: confirm no alert pill, no red viewport vignette, no raised-light board, no safety colouring or colour wording on any player roster row, no check-in or reset control, and no audible cue — without touching any client setting on that machine.
- [ ] 6.8 Manual session, exempt from safety only (bars and peril left on): confirm the pacing bars and Dire Peril reveal still display on that client.
- [ ] 6.9 Confirm a second, non-exempt GM client sees the full safety surface throughout 6.6–6.7.

> 6.1 clean over 252 files. 6.2 clean. 6.3 zero problems. 6.4 verified: the
> `SafetyCheck.<colour>`, `SafetyCheck.Word.<colour>` and `Status.<status>` keys
> all resolve for every enum value, and every path in `module.json` still exists.
>
> **6.5–6.9 not run.** They need a live Foundry session with the capture login
> signed in, which is the only thing that can verify how this looks. Everything a
> source check can reach is covered by 6.1–6.4 and the guard tool; these five are
> the part it explicitly cannot prove.
