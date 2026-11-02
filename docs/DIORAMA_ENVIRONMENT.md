# Diorama environment

Time of day, weather, air and water for the Diorama 3D view. The GM sets it
per scene; each player's Graphics settings decide how much of it their machine
draws. A scene nobody touched draws exactly what the view drew before this
existed.

## Where things live

| File | Role |
| --- | --- |
| `scripts/features/diorama/environment.mjs` | Pure. The flag's shape (`normalizeEnv`), the presets, the sun path, and `resolveEnv()`, which turns a flag into light, sky, weather and wind. |
| `view/environment-source.mjs` | Reads the world. The only reader and writer of the `dio.env` scene flag; picks the hour and the weather from the source the GM chose. |
| `view/environment-app.mjs` | The GM panel (toolbar button, GM only). |
| `render/atmosphere.mjs` | Draws a resolved environment: writes the shared light uniforms, the weather particles, the lightning. |
| `render/glsl.mjs` | The lighting, fog, haze, cloud shadows, wet ground, snow, water edge and waterfall shaders. |
| `render/terrain-field.mjs`, `render/terrain-mesh.mjs` | The wet band (field alpha) and the waterfall faces (side flag +8). |
| `tools/diorama-check/env.mjs` | The check. |

## The flag

`scene.flags[SUITE_ID].dio.env`, keys are stored data:

```
{ v, preset, hour, weather: { kind, intensity }, wind: { dir, strength },
  fog: { density, height }, clouds, water: { dir, speed }, wetness, snow }
```

`hour: null` means "table light": the fixed light the view always had. Every
write is a forced replacement (`writeEnvironment`), because a plain nested
update merges and a weather the GM cleared would survive. Directions are
compass degrees the thing moves toward: 0 up the map, 90 right.

## Where time and weather come from

World settings, in the Control Center:

- `dio.envSource`: `scene` (the flag's hour), `darkness` (Foundry's darkness
  picks the hour, and the hour does not darken a second time), or `calendar`
  (Clocks & Tracker's time, to the minute).
- `dio.weatherSource`: `scene` or `calendar` (the Weather feature's current hex,
  mapped by kind, then archetype, by `weatherFromEffect`).

A calendar source whose feature is off falls back on the flag, and the panel
says so. The view listens to `updateWorldTime`, the clocks-tracker hooks and
`updateSetting` (players learn about the weather walk through a setting); an
environment that resolves the same as before costs the renderer nothing.

## Per user

`dio.dayNight` off gives that user today's fixed light whatever the hour; the
weather still shows. The Graphics options decide the rest:

| Option | Effect |
| --- | --- |
| `weatherFx` off / reduced / full | particles and rain rings; reduced draws a third |
| `atmosphere` | height fog, haze, light shafts, cloud shadows, mist over water |
| `water` simple / full | full: flow, waves rolling in, foam line, rain rings, waterfalls, wet band. Simple: flat tinted water |
| `detail` low / high | low drops the cliff relief |
| `grade` | the final colour grade |

The frame budget sheds `weatherParticles` and `atmosphere` under load.

## How it draws

- **Light.** `resolveEnv` gives the key direction and colour, fill, bounce, sky
  and darkness for the hour. The sun runs one continuous path, never below 7°;
  after sunset the key is the moon. The renderer uses the darker of Foundry's
  darkness and the hour's. Moving the sun marks the shadow map dirty; nothing
  else does.
- **Weather.** One instanced draw for particles, one for splashes. Each
  instance carries only a seed; the vertex shader places it from the seed and
  the clock inside a box around the camera target, so `frame()` never loops.
  Kinds: rain, storm, snow, blizzard, leaves, petals, embers, ash, sand,
  fireflies. Drops and flakes never go under a device pixel.
- **Lightning.** Storms only, 6 to 18 seconds apart, a soft double flash.
  Never strobing; the check holds the gap.
- **Water edge.** The terrain field's alpha is how near dry ground is to water,
  which draws the wet band and the lapping line. Water spilling onto lower
  ground or into lower water gets a waterfall face from its surface down.
- **Idle.** Clear and calm asks for no frames. Clouds, fog and mist drift, so
  they keep the clock running while they are on.

## Checking

```
node tools/diorama-check.mjs
node tools/diorama-preview.mjs && node tools/preview-server.mjs
```

Preview URL parameters: `preset`, `time`, `weather`, `intensity`, `fog`,
`fogh`, `wind`, `winddir`, `clouds`, `wet`, `snow`, `flow`, `flowdir`, `q`,
`water`, `detail`, `weatherFx`, `atmosphere`, `dayNight=0`, `grade=0`.
Headless software GL is slow enough that the budget sheds the weather; add
`adaptive=0` for stills. `probe=1` prints the weather layer's state.
