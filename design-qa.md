# Resource bars design QA

## Final design

The Refractive Core direction takes cues from actual Endfield HUD imagery, including [this combat screenshot](https://www.4gamer.net/games/622/G062211/20260123041/SS/019.jpg), adapted to Foundry token geometry.

- Bar frames match token width and sit below the token by default. Explicit position offsets remain supported.
- Current HP is bold and larger than the muted maximum. The compact HP/MAX readout fits inside the right edge, including long values and scaled text.
- Healthy HP uses colored glass with soft refraction. Below 50%, a separate calm liquid material uses broad folds and the configured danger palette. Exactly 50% remains non-bloodied.
- Temporary HP has a prominent ribbed band. Dividers are solid black.
- Damage has a jagged front, shards, and an amber trail. Healing uses curved ripples and drifting lights.
- Guard break spreads a golden fracture network across the bar. Dark seams, amber shoulders, and bright cores add depth. Cracks refract into the bevel, fade near the edges, and soften behind the readout.
- Idle effects run at half the initial design speed. Damage, healing, and initial fracture propagation remain responsive. The in-app motion setting controls animation; off-screen material clocks freeze.

## Validation

- Syntax checks passed for 302 scripts. All 28 JSON files parsed and all 65 manifest paths existed.
- Resource-bar checks passed, including interrupted healing, silent updates, disabled-motion clocks, fitted text geometry, token-width layouts, localization, permissions, and shader uniform wiring.
- Browser inspection covered healthy and bloodied material, damage, healing, temporary HP, disabled motion, and guard break. The final shader rendered without browser errors.
- Native-size preview samples measured 128px for both tokens and bar rows. The health ladder includes adjacent 50% and 49% samples.

## Preview

Generate with `node tools/resource-bar-preview.mjs --out=.preview/bars.html`, serve the repository root locally, and open `/.preview/bars.html`. The preview embeds the production shader and animation controller; token placeholders are preview context only.

## Remaining validation

A running Foundry world was unavailable during this pass. Live-world integration, crowded-scene performance, and appearance under Foundry's renderer remain unverified. The standalone preview has a separate rendering setup, so bloom can differ from Foundry.
