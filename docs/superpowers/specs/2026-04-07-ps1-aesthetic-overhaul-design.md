# PS1 Aesthetic Overhaul + HUD Tags — Design Spec

## Summary

Transform Ghouls Timeline from its current glitchy/noisy aesthetic to a clean PS1/early-2000s look, and add a HUD tag system for narrative text overlays. Work is split into three phases: modular extraction, aesthetic overhaul, HUD tags.

## Phase 1: Modular Extraction

Split `main.js` (~1200 lines) into focused ES modules. No visual changes — pure structural refactor.

### Module Map

| File | Responsibility | Exports |
|---|---|---|
| `main.js` | Scene, camera, renderer, lights, animation loop, resize, screenshot key. Orchestrator. ~150 lines. | — |
| `skull.js` | GLB loading (skull/jaw/torso), head group, mouse tracking, idle sway, jaw animation, `updateMaterial()` | `head`, `animateSkull(t)`, `updateMaterial()` |
| `particles.js` | RINGS config, `buildRingParticles()`, ring vertex/fragment shaders | `buildRingParticles()`, `particleCloud` ref, ring material for uniform updates |
| `starfield.js` | STARFIELD config, `addStarField()`, `branchLength()`, starfield vertex/fragment shaders | `addStarField()`, `starMat` ref for uniform updates |
| `postprocessing.js` | Bloom composer, QuantizeDitherShader, quantize pass setup, `setPalette()` | `bloomComposer`, `quantizePass`, `setPalette()` |
| `gui.js` | GUI container, `makePaletteGUI()`, `makeMaterialGUI()`. Debug-only, removed in final version. | `initGUI()` |
| `palettes.js` | Convert from global `<script>` to ES module. All palette definitions + `PALETTES` registry. | `PALETTES` |

### Wiring

- Each module imports Three.js (and any needed addons) directly via the existing import map — no bundler.
- `main.js` imports from all other modules and orchestrates the animation loop.
- `palettes.js` gets `export` added to `PALETTES`. The `<script src="./palettes.js">` tag is removed from `index.html`. Instead, `palettes.js` is imported by the modules that need it (e.g., `postprocessing.js`, `gui.js`).
- `perlin.min.js` is imported by `particles.js` only if used at the JS level. The GPU-side simplex noise is inlined in the vertex shader and stays there.

### Animation Loop Contract

`main.js` animation loop calls:
```
animateSkull(t)                          — from skull.js
particleCloud.material.uniforms.uTime    — from particles.js
starMat.uniforms.uTime                   — from starfield.js
quantizePass.uniforms.uTime              — from postprocessing.js
bloomComposer.render()                   — from postprocessing.js
```

## Phase 2: Aesthetic Overhaul

Applied to the modularized codebase.

### Skull Rendering

- Set `flatShading: true` on `MeshLambertMaterial` for hard polygon faces.
- Keep existing 3-light setup (red/blue/white directional lights).
- `updateMaterial()` in `skull.js` applies `flatShading` to all material options.

### Particle Rings (particles.js)

- Remove glitch gating from fragment shader: delete `seg`, `gate`, `mask` logic.
- Keep `vBirth` smoothstep for ring emergence animation from center.
- Switch from `THREE.AdditiveBlending` to `THREE.NormalBlending`.
- Remove dead uniforms: `uSegments`, `uGlitchSpeed`, `uGlitchIntensity`.
- Remove dead varyings/uniforms from vertex shader related to glitch.

### Starfield (starfield.js)

- Remove glitch gating from fragment shader: delete `seg`, `gate`, `mask` logic.
- Keep trail head/tail sweep (`vVis`, `uTrailSpeed`, `uTrailWidth`).
- Remove per-frame jitter: delete `uJitterAmp` and jitter calculation from vertex shader.
- Remove `uBlinkSpeed` (unused after jitter removal).
- Switch from `THREE.AdditiveBlending` to `THREE.NormalBlending`.

### Post-Processing (postprocessing.js)

**Bayer dithering replaces blue-noise dithering:**

- Remove `blueNoise` uniform and `HDR_L_15.png` texture loading.
- Replace with a hardcoded 4x4 Bayer matrix in the fragment shader:
  ```
  const mat4 bayer = mat4(
     0/16,  8/16,  2/16, 10/16,
    12/16,  4/16, 14/16,  6/16,
     3/16, 11/16,  1/16,  9/16,
    15/16,  7/16, 13/16,  5/16
  );
  ```
- Dither threshold is looked up by `mod(pixelCoord, 4)` instead of sampling a texture.
- `ditherStrength` uniform remains for controlling intensity.
- `ditherPixelSize` uniform removed (Bayer operates per-pixel, not per-cell).

**Bloom stays in current position** (before dither pass). Bloom glow gets absorbed into the pixelated/dithered output. Strength/radius/threshold remain tunable.

**Pixelation and palette quantization unchanged.**

### New Palettes (palettes.js)

Add 4 PS1-era palettes to the existing set:

1. **Silent Hill** — muted grays, browns, washed-out blues, sickly greens. 8 colors.
2. **Resident Evil** — dark reds, deep blacks, cold grays, occasional warm amber. 8 colors.
3. **Ridge Racer** — saturated but limited: racing blue, sunset orange, asphalt gray, sky cyan. 8 colors.
4. **PS1 Boot** — the black-to-white gradient with the Sony startup screen colors: deep black, dark gray, medium gray, white, plus the PS logo blue/red/yellow/green. 8 colors.

Exact hex values to be determined during implementation based on reference screenshots.

## Phase 3: HUD Tag System

### Architecture

- New `tags.js` ES module.
- Tags are HTML/CSS overlays absolutely positioned over the canvas.
- Positions updated each frame using `THREE.Vector3.project()` to convert world coords to screen coords.
- Tags render on top of the dithered 3D scene — they do not go through post-processing. This matches authentic PS1 behavior where HUD was a separate 2D layer.

### Tag Data Format

```js
{
  id: 'skull',
  target: [0, 50, 0],       // world-space position
  title: 'SPECIMEN_01',
  subtitle: 'EST. 1347 — UNKNOWN ORIGIN',
  connector: 'down'          // 'down' | 'up' — line direction toward target
}
```

### Tag DOM Structure

Per tag:
```html
<div class="tag" style="position:absolute; left:Xpx; top:Ypx;">
  <div class="tag-box">
    <div class="tag-title">SPECIMEN_01</div>
    <div class="tag-subtitle">EST. 1347 — UNKNOWN ORIGIN</div>
  </div>
  <div class="tag-connector"></div>
  <div class="tag-marker"></div>
</div>
```

### Tag Styling

- Monospace font (system monospace or a specific retro font if available).
- 1px solid border, semi-transparent dark background (`rgba(0,0,0,0.6)`).
- Uppercase text, letter-spacing 1-2px.
- Title: lighter color. Subtitle: dimmer, smaller.
- Connector: 1px vertical line, 20-40px long.
- Marker: small square (5-6px), 1px border, at the end of the connector.
- Text/border color derived from current palette's lightest color for visual coherence.

### Tag Behavior

- Repositioned every frame via `project()`.
- Tags whose projected position is off-screen (or behind camera) are hidden (`display: none`).
- No animation on the tags themselves for now — static position tracking only.
- Tag container sits as a sibling to the canvas, z-indexed above it.

### Placeholder Tags

4 initial tags with placeholder narrative content:
1. Skull: `SPECIMEN_01` / `EST. 1347 — UNKNOWN ORIGIN`
2. Ring system: `RING_CYCLE_08` / `STATUS: ACTIVE`
3. Starfield area: `FIELD_OBSERVATION` / `MAPPING IN PROGRESS`
4. Floating (no specific target): `TIMELINE_ENTRY` / `DATE: UNKNOWN`

### CSS Location

Tag styles added to `style.css` alongside existing GUI styles.

## What We're NOT Changing

- Camera position/target values
- OrbitControls (debug, removed later)
- Screenshot functionality
- Scene geometry (skull, jaw, torso GLBs)
- Ring particle positions/motion (Perlin warping, phase stepping)
- Starfield branch structure (random walk geometry)
- The `<script type="importmap">` approach for Three.js
- `perlin.min.js`

## Risks

- **Flat shading + dithering interaction**: flat shading creates hard color boundaries per face. Combined with palette quantization this could produce very stark/harsh results on the skull. May need to soften bloom slightly or adjust palette choices. Tunable after implementation.
- **Normal blending on particles**: switching from additive may make rings/stars less visible against dark backgrounds. May need to increase opacity values. Tunable.
- **Tag readability**: clean HTML text on top of a heavily dithered/pixelated scene could look jarring. May want to add `image-rendering: pixelated` or a pixel font to match. Evaluate after first pass.
