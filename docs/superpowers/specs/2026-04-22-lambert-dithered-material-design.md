# Lambert Dithered Material — Design Spec

## Summary

Add a new material option, **`Lambert Dithered`**, that applies palette quantization and 4x4 Bayer dithering directly to the skull/jaw/torso meshes in their fragment shader, with the Bayer lookup sampled in world space (triplanar). The dither pattern sticks to the mesh surface and rotates with it — the "PS1-baked-texture" or Minecraft feel — rather than living in screen space.

This is an additional aesthetic option, selectable from the existing `MATERIAL` dropdown alongside `Lambert` and `Normal`. The existing screen-space post-pass (pixelation + palette quantize + Bayer) is unchanged. To get the clean "surface dither only" look, the user turns off the existing `DITHER` checkbox — no auto-toggle logic.

## Motivation

The current pipeline dithers the entire frame in screen space after rendering. That pattern is camera-locked: it slides across the skull as the camera or mesh rotates. This proposal moves dither onto the mesh surface itself, so the pattern is locked to the geometry and behaves like a low-res palette-reduced texture was baked into the model — closer to PS1 authenticity for the foreground character while leaving the scene's outer elements (particles, starfield, HUD tags) untouched.

## Non-Goals

- No change to post-pass bloom, pixelation, palette quantize, or screen-space Bayer.
- No change to particles, starfield, or HUD tags.
- No change to material glitch vertex displacement.
- No new palette data or palette-derivation logic. Uses the same palette array already pushed to the post-pass.
- No UV-space or screen-space dither variants. World-space triplanar only.
- `MeshNormalMaterial` is unchanged. Surface dither is not offered for it (shading already produces non-palette colors; dithering it isn't a coherent combo).

## Approach

### Coordinate space: world-space triplanar

The Bayer threshold is sampled from the mesh's world-space position. Because a 3D coordinate doesn't map to a 2D Bayer lookup directly, we use a cheap triplanar choice:

```
vec3 n = abs(normalize(vWorldNormal));
vec2 p;
if (n.z > n.x && n.z > n.y)      p = vWorldPosition.xy;   // cap along +/-Z
else if (n.y > n.x)              p = vWorldPosition.xz;   // cap along +/-Y
else                             p = vWorldPosition.yz;   // cap along +/-X
vec2 cell = floor(p / surfacePxWorld);
float n01 = bayer4x4(cell);
```

The dominant-axis pick (rather than blended triplanar) keeps the pattern crisp — blended triplanar would smear the Bayer pattern across seams. A visible seam where axes switch is acceptable on this model; it reinforces the low-poly/PS1 feel.

### Shader injection

`skull.js::createMaterial()` already uses `material.onBeforeCompile` for the vertex glitch. A second injection adds:

1. **Varyings from vertex shader:** `vWorldPosition`, `vWorldNormal`. Computed from `(modelMatrix * vec4(transformed, 1.0)).xyz` and `normalize(mat3(modelMatrix) * objectNormal)` injected after `#include <worldpos_vertex>` and `#include <defaultnormal_vertex>` respectively (Three.js r138 Lambert chunks).
2. **Uniforms on the material:**
   - `uPalette` — `vec3[MAX_COLORS]` — same RGB values as post-pass.
   - `uPaletteSize` — `int`.
   - `uSurfacePxWorld` — `float`, world-units-per-dither-cell.
3. **Fragment shader tail:** after `#include <dithering_fragment>` (or at end of `main`), read `gl_FragColor.rgb`, compute the triplanar Bayer threshold, find the two nearest palette colors (same `findTwoNearest` logic as post-pass), and overwrite `gl_FragColor.rgb` with the dithered palette pick.

The `findTwoNearest` + blend function is identical to the one in `postprocessing.js`. To avoid drift, extract it into a GLSL string constant in a new tiny module (see "Shared palette GLSL" below).

### Material type plumbing

`skull.js`:
- Add `'Lambert Dithered'` branch in `createMaterial()`. Builds a `MeshLambertMaterial` (same base as `Lambert`), then calls `applyGlitchShader(mat)`, then calls new `applyDitherShader(mat)`.
- `applyDitherShader(mat)` does the second `onBeforeCompile`. Because `onBeforeCompile` is a single function slot, it must be **composed** with the existing glitch injection — they cannot both be assigned separately. Resolution: rename the glitch injection into a helper that takes a `shader` argument, and have a single `onBeforeCompile` that calls both in sequence. Glitch first (vertex-side), then dither (fragment-side).
- Export `setDitherSurfacePx(value)` so GUI can tune `uSurfacePxWorld` live.
- The dither material must know the current palette. Two options:
  - **A. Shared uniforms object** (preferred). Create a `ditherUniforms` module-level object in `skull.js` mirroring the `glitchUniforms` pattern: `uPalette`, `uPaletteSize`, `uSurfacePxWorld`. `onBeforeCompile` wires `shader.uniforms.uPalette = ditherUniforms.uPalette` etc., so updates propagate to all meshes using the material. Palette is pushed into this object whenever palette changes.
  - B. Re-create material on palette change. Rejected — would interact poorly with glitch state and force a material rebuild on every palette select.
- Export `setDitherPalette(hexArray)` that updates `ditherUniforms.uPalette` and `ditherUniforms.uPaletteSize`.

### Palette flow

Currently `gui.js::makePaletteGUI`'s onChange calls `setPalette(quantizePass, ...)` and `updateTagColors(...)`. Add a third call: `setDitherPalette(...)` (imported from `skull.js`). Same hexArray source. The initial palette set at GUI construction also calls it. Order: the three setters are independent, order doesn't matter.

### Shared palette GLSL

To avoid duplicating the `findTwoNearest` + two-color dither blend across `postprocessing.js` and `skull.js`, extract the GLSL fragment into a new file: `palette-glsl.js`. Exports a single string constant `PALETTE_DITHER_GLSL` containing:

- `void findTwoNearest(in vec3 c, ...)`
- `vec3 palettePick(vec3 c, float bayer01, float ditherStrength, vec3 palette[MAX_COLORS], int paletteSize)` — the two-nearest blend wrapped as a function for cleaner reuse.

Both `postprocessing.js` and the new dither injection template-interpolate this string into their fragment shaders. `MAX_COLORS` is also centralized there.

### GUI

`gui.js`:
- `makeMaterialGUI` gains a third option: `'Lambert Dithered'`.
- Add a new control group `SURFACE PX`, structured like the existing `PX SIZE` input (number, step 0.1, range 0.5–20, default **2.0**). Range in world units.
- On change, call `setDitherSurfacePx(val)` from `skull.js`.
- **Conditional visibility:** `SURFACE PX` container is hidden by default. When the material dropdown changes, show it only when value is `'Lambert Dithered'`. Done with `wrap.style.display = '...' ? 'block' : 'none'`. The check runs once at init (to match the initial material) and again in the material dropdown's change handler.

### World-space pixel size — default rationale

The skull spans roughly 100 world units at the current camera distance (`cameraPosition = (-100, -400, 400)`, camera looks at origin). Post-pass `pxFactor` default is `3`. At typical distance, one world unit covers a few screen pixels, so `uSurfacePxWorld = 2.0` gives Bayer cells of ~6 screen pixels — comfortably larger than the default post-pass pixel so the pattern survives post-pass nearest-sampling. This is the default; user can tune via the new control.

## File Changes

| File | Change |
|---|---|
| `postprocessing.js` | Replace inline `findTwoNearest` + blend with template-interpolated `PALETTE_DITHER_GLSL`. Expose `MAX_COLORS` import from shared module. No behavioral change. |
| `palette-glsl.js` | **NEW.** Exports `MAX_COLORS` and `PALETTE_DITHER_GLSL` string constant. |
| `skull.js` | Add `ditherUniforms` module-level object. Refactor glitch injection into `injectGlitch(shader)` helper. Add `injectDither(shader)` helper. `createMaterial()` adds `'Lambert Dithered'` case; wires a single `onBeforeCompile` that calls both injectors. Export `setDitherPalette(hexArray)`, `setDitherSurfacePx(v)`. |
| `gui.js` | Add `'Lambert Dithered'` option to material dropdown. Add `SURFACE PX` control. Add show/hide logic keyed on material selection. Palette onChange also calls `setDitherPalette`. |
| `style.css` | No change. |

No changes to `main.js`, `tags.js`, `particles.js`, `starfield.js`, `palettes.js`, `index.html`.

## Data Flow

```
GUI palette select ─┬─> setPalette(quantizePass, hex)       [post-pass uniforms]
                   ├─> updateTagColors(hex)                  [CSS vars on :root]
                   └─> setDitherPalette(hex)                 [ditherUniforms in skull.js]

GUI material select ─> setMaterialType('Lambert Dithered')
                      └─> createMaterial() ─> applyGlitch + applyDither
                      └─> show SURFACE PX control

GUI SURFACE PX input ─> setDitherSurfacePx(v) ─> ditherUniforms.uSurfacePxWorld.value = v

Frame render:
  vertex shader: glitch displaces `transformed`, then compute vWorldPosition + vWorldNormal
  fragment shader: Lambert lighting → triplanar Bayer lookup → palettePick → gl_FragColor
  post-pass: bloom → pixelate → (quantize+dither if user hasn't toggled off) → screen
```

## Edge Cases

- **Material swap mid-glitch:** if user switches to `Lambert Dithered` while a vertex glitch is active, `uGlitchAmount` continues to drive the existing glitch uniforms (shared across materials), so the glitch persists seamlessly. Confirmed by existing behavior — glitch uniforms are module-level and reused across material rebuilds.
- **Palette change with dither active:** `ditherUniforms.uPalette` is updated in place; next frame picks up the new palette. No material rebuild needed.
- **Double-sided flat-shaded material:** back-faces get the same triplanar lookup (world position is the same). Fine.
- **Degenerate normals:** near-zero `vWorldNormal` causes no issue — the `max` comparison still picks an axis; just might flip seam placement. Not worth defensive code.
- **Camera zoom / world transforms:** since the Bayer is sampled in world space, the on-screen cell size scales with camera distance. Closer camera → bigger Bayer cells on screen. This is desired behavior (the pattern is painted "on" the skull), but it's a real visual consequence worth knowing.

## Risks & Open Questions

- **Post-pass pixelation can still destroy the pattern** if `pxFactor` is much larger than the screen projection of the surface cell. The default tuning (surfacePx 2.0, pxFactor 3) is chosen to avoid this. If user cranks pxFactor up, the pattern degrades. Acceptable — it's a user-visible tradeoff.
- **Post-pass palette quantize is lossless for already-palette-exact surface pixels.** But post-pass Bayer (if left on) will *re-dither* the already-dithered surface, producing a noisier result. The spec's answer: leave it to the user to toggle off via existing DITHER checkbox. If that ends up being annoying in practice, we can revisit with an auto-disable later.
- **Glitch + dither layering:** vertex glitch displaces `transformed` before world-position is computed. That means during a glitch, the Bayer lookup uses the *displaced* world position — which is correct: the pattern "follows" the distorted geometry. If this looks wrong visually, the alternative is to snapshot pre-glitch world position; we go with post-glitch as the default and evaluate.
- **Triplanar seam visibility** on curved surfaces (skull has many) — where the dominant axis flips, the pattern will discontinue. Blended triplanar avoids this but smears the Bayer dots. We accept seams as stylistically consistent. If they look bad, switch to an 8x8 Bayer or blend per-axis with a narrow falloff.

## Testing

This is a visual feature. Verification is by:

1. Load the site, select `Lambert Dithered`. Expect: skull covered in a coarse Bayer pattern in palette colors, pattern rotates with the mesh.
2. Toggle DITHER off. Expect: rest of scene loses screen-space Bayer; skull pattern remains (now the only dithered element).
3. Cycle palettes. Expect: skull pattern recolors within a frame, no material rebuild stutter.
4. Adjust SURFACE PX. Expect: Bayer cell size changes in real-time.
5. Switch back to `Lambert`. Expect: SURFACE PX control hides; skull returns to flat-shaded-only look.
6. Trigger a glitch (wait ~3s). Expect: glitch displacement still works; Bayer pattern follows the distortion.
7. Resize window. Expect: no visual regressions; pattern size unchanged (because it's world-space).
