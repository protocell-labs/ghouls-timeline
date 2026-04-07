# PS1 Aesthetic Overhaul + HUD Tags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Ghouls Timeline from glitchy/noisy to clean PS1 aesthetic, via modular extraction → rendering changes → HUD tags.

**Architecture:** Split monolithic `main.js` into 6 ES modules, then apply PS1 rendering changes (flat shading, Bayer dithering, glitch removal), then add HTML/CSS HUD tag overlay system. All modules use the existing import map for Three.js dependencies — no bundler.

**Tech Stack:** Three.js r138 (via import map), vanilla ES modules, HTML/CSS overlays.

**Note:** Do not make git commits. The user handles all commits themselves.

---

## Phase 1: Modular Extraction

### Task 1: Extract `palettes.js` to ES Module

**Files:**
- Modify: `palettes.js` (add `export`)
- Modify: `index.html` (remove `<script src="./palettes.js">` tag)

- [ ] **Step 1: Add export to palettes.js**

Add `export` before the `PALETTES` object at the end of the file. Change line 207:

```js
// Before:
const PALETTES = {

// After:
export const PALETTES = {
```

- [ ] **Step 2: Remove the palettes script tag from index.html**

Remove line 28 from `index.html`:
```html
  <script src="./palettes.js"></script>
```

The `<body>` should now contain only:
```html
<body>
  <script type="module" src="main.js"></script>
</body>
```

- [ ] **Step 3: Add import to main.js temporarily**

Add at the top of `main.js` after the other imports (line 10):
```js
import { PALETTES } from './palettes.js';
```

- [ ] **Step 4: Test in browser**

Run: `npm run dev` (or however the local server is started).
Open the page — verify palettes dropdown still works, scene renders, no console errors about `PALETTES is not defined`.

---

### Task 2: Extract `postprocessing.js`

**Files:**
- Create: `postprocessing.js`
- Modify: `main.js` (remove post-processing code, add import)

- [ ] **Step 1: Create `postprocessing.js`**

This file gets: the blue-noise texture loader, `MAX_COLORS`, `QuantizeDitherShader`, the bloom composer setup, the quantize pass setup, and `setPalette()`.

It needs to receive `renderer`, `scene`, `camera` as arguments since those are created in `main.js`.

```js
import * as THREE from 'three';
import { EffectComposer } from 'EffectComposer';
import { RenderPass } from 'RenderPass';
import { UnrealBloomPass } from 'UnrealBloomPass';
import { ShaderPass } from 'ShaderPass';

const MAX_COLORS = 32;

// --- Blue-noise texture (tiling) ---
const noiseTex = new THREE.TextureLoader().load('assets/HDR_L_15.png', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
});

const QuantizeDitherShader = {
    uniforms: {
        tDiffuse: { value: null },
        blueNoise: { value: noiseTex },

        palette: { value: new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0)) },
        paletteSize: { value: 0 },

        screenSize: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        pxFactor: { value: 3 },
        ditherPixelSize: { value: 300.0 },
        ditherStrength: { value: 0.5 },
        uTime: { value: 0.0 }
    },

    vertexShader: `
    precision highp float;
    precision highp int;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

    fragmentShader: `
    precision highp float;
    precision highp int;

    uniform sampler2D tDiffuse;
    uniform sampler2D blueNoise;

    uniform vec3  palette[${MAX_COLORS}];
    uniform int   paletteSize;

    uniform vec2  screenSize;
    uniform float pxFactor;
    uniform float ditherPixelSize;
    uniform float ditherStrength;
    uniform float uTime;

    varying vec2 vUv;

    vec2 pixelateUv(vec2 uv) {
      vec2 grid = screenSize / max(pxFactor, 1.0);
      vec2 cell = floor(uv * grid) + 0.5;
      return cell / grid;
    }

    void findTwoNearest(in vec3 c, out int iBest, out int iSecond, out float dBest, out float dSecond) {
      dBest = 1e9; iBest = 0; dSecond = 1e9; iSecond = 0;
      for (int i = 0; i < ${MAX_COLORS}; i++) {
        if (i >= paletteSize) break;
        vec3 p = palette[i];
        vec3 d = c - p;
        float dist = dot(d, d);
        if (dist < dBest) { dSecond = dBest; iSecond = iBest; dBest = dist; iBest = i; }
        else if (dist < dSecond) { dSecond = dist; iSecond = i; }
      }
    }

    void main() {
      vec2 uvPix = pixelateUv(vUv);
      vec3 c = texture2D(tDiffuse, uvPix).rgb;

      int iBest, iSecond; float dBest, dSecond;
      findTwoNearest(c, iBest, iSecond, dBest, dSecond);
      vec3 pBest = palette[iBest];
      vec3 pSecond = palette[iSecond];

      vec2 fragPx = vUv * screenSize;
      vec2 nUv = fragPx / max(ditherPixelSize, 1.0);
      nUv += vec2(fract(uTime * 0.00), -fract(uTime * 0.023));
      float n = texture2D(blueNoise, nUv).r;

      float a = sqrt(max(dBest,   0.0));
      float b = sqrt(max(dSecond, 0.0));
      float total = max(a + b, 1e-6);
      float probSecond = mix(0.0, a / total, clamp(ditherStrength, 0.0, 1.0));

      vec3 outColor = (n < probSecond) ? pSecond : pBest;
      gl_FragColor = vec4(outColor, 1.0);
    }
  `
};


export function initPostProcessing(renderer, scene, camera) {
    const bloomComposer = new EffectComposer(renderer);
    const scenePass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.0,   // strength
        0.1,   // radius
        0.70   // threshold
    );

    bloomComposer.addPass(scenePass);
    bloomComposer.addPass(bloomPass);

    const quantizePass = new ShaderPass(QuantizeDitherShader);
    quantizePass.renderToScreen = true;
    quantizePass.uniforms.blueNoise.value = noiseTex;
    quantizePass.uniforms.screenSize.value.set(window.innerWidth, window.innerHeight);

    bloomComposer.addPass(quantizePass);

    return { bloomComposer, bloomPass, quantizePass };
}


export function setPalette(quantizePass, hexArray) {
    const size = Math.min(hexArray.length, MAX_COLORS);
    const vecs = new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < size; i++) {
        const c = new THREE.Color(hexArray[i]);
        vecs[i] = new THREE.Vector3(c.r, c.g, c.b);
    }
    quantizePass.uniforms.palette.value = vecs;
    quantizePass.uniforms.paletteSize.value = size;
}
```

- [ ] **Step 2: Update `main.js`**

Remove from `main.js`:
- The `noiseTex` loader (lines 75-80)
- `MAX_COLORS` (line 62)
- The entire `QuantizeDitherShader` object (lines 418-505)
- The quantize pass setup (lines 508-521)
- The bloom composer setup (lines 319-332)
- The `setPalette()` function (lines 527-536)
- The imports for `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `ShaderPass` (lines 6-9) — these move to `postprocessing.js`

Add import at top of `main.js`:
```js
import { initPostProcessing, setPalette } from './postprocessing.js';
```

After renderer creation and scene/camera setup, initialize post-processing:
```js
const { bloomComposer, bloomPass, quantizePass } = initPostProcessing(renderer, scene, camera);
```

Update the resize handler to reference the returned objects:
```js
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    bloomComposer.setSize(w, h);
    bloomPass.setSize(w, h);
    quantizePass.uniforms.screenSize.value.set(w, h);
});
```

Update `setPalette` calls to pass `quantizePass`:
```js
// Wherever setPalette is called:
setPalette(quantizePass, hexArray);
```

The animation loop still calls:
```js
quantizePass.uniforms.uTime.value = t;
bloomComposer.render();
```

- [ ] **Step 3: Remove unused variables from main.js**

Remove these variables that were only used by the extracted code:
- `pxFactor` (line 31)
- `ditherPixelSize` (line 32)
- `ditherStrength` (line 33)
- `bloomStrength`, `bloomRadius`, `bloomThreshold` (lines 35-37)

- [ ] **Step 4: Test in browser**

Verify: scene renders with bloom and dithering, palette switching works, no console errors.

---

### Task 3: Extract `skull.js`

**Files:**
- Create: `skull.js`
- Modify: `main.js` (remove skull code, add import)

- [ ] **Step 1: Create `skull.js`**

This file gets: all skull/jaw/torso globals, mouse tracking event listeners, idle config, jaw animation, `loadHeadParts()`, `updateMaterial()`, and the per-frame animation logic.

```js
import * as THREE from 'three';
import { GLTFLoader } from 'GLTFLoader';

// --- Skull state ---
let skull, jaw, torso;
let jawOpen = 0;
let targetJawOpen = 0;
let nextJawEvent = 0;

let mouseInWindow = true;
let resetTimer = null;
let shouldReset = false;

const mouse = { x: 0, y: 0 };
const targetRotation = { x: 0, y: 0 };

const materialOptions = {
    type: 'Lambert',
};

// --- Mouse tracking lerps ---
const trackLerp = 0.06;
const outLerp = 0.03;
const resetLerp = 0.04;

// --- Idle wobble ---
const idle = {
    ampX: 0.04,
    ampY: 0.06,
    speedX: 0.3,
    speedY: 0.4
};

// --- Head group ---
export const head = new THREE.Group();

// --- Mouse event listeners ---
window.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    const maxRotation = Math.PI / 6;
    targetRotation.x = -mouse.y * maxRotation;
    targetRotation.y = mouse.x * maxRotation;
});

function scheduleReset(delayMs = 500) {
    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
    resetTimer = setTimeout(() => {
        shouldReset = true;
        resetTimer = null;
    }, delayMs);
}

document.body.addEventListener('mouseenter', () => {
    mouseInWindow = true;
    shouldReset = false;
    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
});

document.body.addEventListener('mouseleave', () => {
    mouseInWindow = false;
    scheduleReset(500);
});

document.addEventListener('pointerleave', () => {
    mouseInWindow = false;
    scheduleReset(500);
});

window.addEventListener('blur', () => {
    mouseInWindow = false;
    scheduleReset(500);
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        mouseInWindow = false;
        scheduleReset(500);
    }
});


// --- Load GLB models ---
export async function loadHeadParts() {
    const loader = new GLTFLoader();
    try {
        const [skullGltf, jawGltf, torsoGltf] = await Promise.all([
            loader.loadAsync('assets/skull_model_01_06_skull.glb'),
            loader.loadAsync('assets/skull_model_01_06_jaw.glb'),
            loader.loadAsync('assets/skull_jaw_torso_01.glb')
        ]);

        skull = skullGltf.scene;
        jaw = jawGltf.scene;
        torso = torsoGltf.scene;

        [skull, jaw, torso].forEach((obj) => {
            obj.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshLambertMaterial({
                        color: 0xffffff,
                        side: THREE.DoubleSide
                    });
                }
            });
        });

        skull.add(jaw);
        head.add(skull);
        head.add(torso);

        console.log('Head parts loaded: skull + jaw + torso (hierarchy applied)');
    } catch (e) {
        console.error('Error loading head parts:', e);
    }
}


// --- Update material ---
export function updateMaterial() {
    let mat;
    switch (materialOptions.type) {
        case 'Lambert':
            mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
            break;
        case 'Normal':
        default:
            mat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
            break;
    }
    [skull, torso].forEach((obj) => {
        if (obj) {
            obj.traverse((child) => {
                if (child.isMesh) {
                    child.material = mat;
                }
            });
        }
    });
}

export function setMaterialType(type) {
    materialOptions.type = type;
    updateMaterial();
}


// --- Per-frame animation ---
export function animateSkull(t) {
    if (head) head.rotation.set(0, 0, 0);

    const idleX = idle.ampX * Math.sin(t * idle.speedX * Math.PI * 2.0);
    const idleY = idle.ampY * Math.sin(t * idle.speedY * Math.PI * 2.0 + Math.PI / 3);

    // Skull follows mouse + idle/reset
    if (skull) {
        let targetX, targetY, lerp;
        if (mouseInWindow) {
            targetX = targetRotation.x + idleX;
            targetY = targetRotation.y + idleY;
            lerp = trackLerp;
        } else if (!shouldReset) {
            targetX = targetRotation.x + idleX;
            targetY = targetRotation.y + idleY;
            lerp = outLerp;
        } else {
            targetX = idleX;
            targetY = idleY;
            lerp = resetLerp;
        }
        skull.rotation.x += (targetX - skull.rotation.x) * lerp;
        skull.rotation.y += (targetY - skull.rotation.y) * lerp;
    }

    // Torso: wobble only
    if (torso) {
        const torsoLerp = 0.05;
        torso.rotation.x += (idleX - torso.rotation.x) * torsoLerp;
        torso.rotation.y += (idleY - torso.rotation.y) * torsoLerp;
    }

    // Jaw animation
    if (jaw) {
        if (!mouseInWindow) {
            targetJawOpen = 0;
            nextJawEvent = t + 0.4;
        } else {
            if (t > nextJawEvent) {
                if (targetJawOpen === 0) {
                    targetJawOpen = 1;
                    nextJawEvent = t + THREE.MathUtils.randFloat(0.5, 1.5);
                } else {
                    targetJawOpen = 0;
                    nextJawEvent = t + THREE.MathUtils.randFloat(2.0, 5.0);
                }
            }
        }

        jawOpen += (targetJawOpen - jawOpen) * 0.05;
        const maxOpen = THREE.MathUtils.degToRad(28);
        const openFactor = (mouseInWindow) ? THREE.MathUtils.smoothstep(jawOpen, 0.05, 0.30) : 0.0;
        const idleAmp = THREE.MathUtils.degToRad(mouseInWindow ? 0.5 : 0.0) * openFactor;
        const idleSpeed = 2.2;
        const idleOffset = idleAmp * Math.sin(t * idleSpeed * Math.PI * 2.0);
        const angle = (jawOpen * maxOpen) + idleOffset;
        jaw.rotation.x = angle;
    }
}
```

- [ ] **Step 2: Update `main.js`**

Remove from `main.js`:
- All skull/jaw/torso variables (lines 19-29)
- `mouse`, `targetRotation` (lines 19-20)
- `materialOptions` (lines 64-66)
- All mouse event listeners (lines 214-273)
- `idle` config (lines 201-207)
- `setJawOpen01` (lines 210-212)
- `trackLerp`, `outLerp`, `resetLerp` (lines 197-199)
- `scheduleReset` function (lines 247-256)
- `loadHeadParts` (lines 346-381)
- `updateMaterial` (lines 389-410)
- The skull/torso/jaw animation block in `animate()` (lines 1111-1181)
- The `GLTFLoader` import (line 5)

Add import at top:
```js
import { head, loadHeadParts, animateSkull, updateMaterial, setMaterialType } from './skull.js';
```

`scene.add(head)` stays in `main.js` (the orchestrator adds things to the scene).

Replace the animation block with:
```js
animateSkull(t);
```

- [ ] **Step 3: Test in browser**

Verify: skull loads, mouse tracking works, jaw opens/closes, idle wobble works, material switching works.

---

### Task 4: Extract `particles.js`

**Files:**
- Create: `particles.js`
- Modify: `main.js` (remove particle code, add import)

- [ ] **Step 1: Create `particles.js`**

This file gets: `RINGS` config, `randNormal()`, `buildRingParticles()` including the full vertex/fragment shader strings, and related variables.

```js
import * as THREE from 'three';

// ----------- RING PARTICLE PARAMETERS -----------
const RINGS = {
    ringCount: 20,
    pointsPerRing: 1000,
    baseRadius: 50,
    ringSpacing: 25,
    ringSpacingNonLin: 1.2,

    radialSigma: 1.0,
    radialSigmaNonLin: 1.1,
    verticalSigma: 1.0,
    verticalSigmaNonLin: 1.0,

    noiseRadialAmp: 5.0,
    noiseVerticalAmp: 5.0,
    noiseThetaFreq: 1.0,
    noiseRingFreqU: 0.22,
    noiseRingFreqV: 0.31,
    noiseOffsetU: Math.random() * 1000.0,
    noiseOffsetV: Math.random() * 1000.0,

    noiseDriftU: 0.5,
    noiseDriftV: 0.3,

    ringPhaseStep: 0.17,

    sizePx: 5 * window.devicePixelRatio,
    color: 0xffffff,
    opacity: 0.5,

    birthWidth: 1.5,
    segments: 40.0,
    glitchSpeed: 100.0,
    glitchIntensity: 0.85
};

const particleCloudTilt = 0;
const particleCloudHeight = 75;

let particleCloud = null;

function randNormal(mean = 0, sigma = 1) {
    let u = 1 - Math.random(), v = 1 - Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + sigma * z;
}

export function buildRingParticles() {
    const total = RINGS.ringCount * RINGS.pointsPerRing;
    const positions = new Float32Array(total * 3);
    const ringIndex = new Float32Array(total);

    let idx = 0;
    for (let r = 0; r < RINGS.ringCount; r++) {
        for (let j = 0; j < RINGS.pointsPerRing; j++) {
            const theta = (j / RINGS.pointsPerRing) * Math.PI * 2.0;
            positions[idx * 3 + 0] = Math.cos(theta);
            positions[idx * 3 + 1] = 0.0;
            positions[idx * 3 + 2] = Math.sin(theta);
            ringIndex[idx] = r;
            idx++;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('ringIndex', new THREE.BufferAttribute(ringIndex, 1));

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uSize: { value: RINGS.sizePx },
            uColor: { value: new THREE.Color(RINGS.color) },
            uOpacity: { value: RINGS.opacity },

            uBaseRadius: { value: RINGS.baseRadius },
            uSpacing: { value: RINGS.ringSpacing },
            uSpacingNonLin: { value: RINGS.ringSpacingNonLin },
            uRingCount: { value: RINGS.ringCount },
            uSpeed: { value: 10.0 },

            uRadialSigma: { value: RINGS.radialSigma },
            uRadialSigmaNonLin: { value: RINGS.radialSigmaNonLin },
            uVerticalSigma: { value: RINGS.verticalSigma },
            uVerticalSigmaNonLin: { value: RINGS.verticalSigmaNonLin },

            uNoiseRadialAmp: { value: RINGS.noiseRadialAmp },
            uNoiseVerticalAmp: { value: RINGS.noiseVerticalAmp },
            uNoiseThetaFreq: { value: RINGS.noiseThetaFreq },
            uNoiseRingFreqU: { value: RINGS.noiseRingFreqU },
            uNoiseRingFreqV: { value: RINGS.noiseRingFreqV },
            uNoiseOffsetU: { value: RINGS.noiseOffsetU },
            uNoiseOffsetV: { value: RINGS.noiseOffsetV },
            uNoiseDriftU: { value: RINGS.noiseDriftU },
            uNoiseDriftV: { value: RINGS.noiseDriftV },

            uRingPhaseStep: { value: RINGS.ringPhaseStep },

            uBirthWidth: { value: RINGS.birthWidth },
            uSegments: { value: RINGS.segments },
            uGlitchSpeed: { value: RINGS.glitchSpeed },
            uGlitchIntensity: { value: RINGS.glitchIntensity }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`
      attribute float ringIndex;

      uniform float uTime;
      uniform float uSize;

      uniform float uBaseRadius;
      uniform float uSpacing;
      uniform float uSpacingNonLin;
      uniform float uRingCount;
      uniform float uSpeed;

      uniform float uRadialSigma;
      uniform float uRadialSigmaNonLin;
      uniform float uVerticalSigma;
      uniform float uVerticalSigmaNonLin;

      uniform float uNoiseRadialAmp;
      uniform float uNoiseVerticalAmp;
      uniform float uNoiseThetaFreq;
      uniform float uNoiseRingFreqU;
      uniform float uNoiseRingFreqV;
      uniform float uNoiseOffsetU;
      uniform float uNoiseOffsetV;
      uniform float uNoiseDriftU;
      uniform float uNoiseDriftV;

      uniform float uRingPhaseStep;
      uniform float uBirthWidth;

      varying float vBirth;
      varying float vAng;

      vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
      vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
      vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
      float snoise(vec2 v){
        const vec4 C = vec4(0.211324865405187,0.366025403784439,
                            -0.577350269189626,0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
        vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                               + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0),dot(x12.xy,x12.xy),
                                dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0*fract(p*C.www)-1.0;
        vec3 h = abs(x)-0.5;
        vec3 ox = floor(x+0.5);
        vec3 a0 = x-ox;
        m *= 1.79284291400159 - 0.85373472095314*(a0*a0+h*h);
        vec3 g;
        g.x  = a0.x*x0.x  + h.x*x0.y;
        g.yz = a0.yz*x12.xz + h.yz*x12.yw;
        return 130.0*dot(m,g);
      }
      float perlin2D(vec2 p){ return snoise(p); }

      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float gaussJitter(vec2 p){ return (hash(p)+hash(p+19.19)-1.0); }

      void main(){
        float phase = uTime * (uSpeed / max(uSpacing,1e-5));
        float idx = mod(ringIndex + phase, uRingCount);

        float d0 = min(idx, uRingCount - idx);
        vBirth = smoothstep(0.0, max(0.0001,uBirthWidth), d0);

        float radial = uBaseRadius + idx*uSpacing + pow(idx,1.0+uSpacingNonLin);

        float ang = atan(position.z, position.x) + ringIndex*uRingPhaseStep;
        vAng = ang;

        float rSigma = uRadialSigma + idx*uRadialSigmaNonLin;
        radial += gaussJitter(vec2(ang,idx)) * rSigma;

        float vSigma = uVerticalSigma + idx*uVerticalSigmaNonLin;
        float y = gaussJitter(vec2(idx,ang)) * vSigma;

        vec2 uv = vec2(
            cos(ang) * uNoiseThetaFreq + idx * uNoiseRingFreqU + uNoiseOffsetU + uTime * uNoiseDriftU,
            sin(ang) * uNoiseThetaFreq + idx * uNoiseRingFreqV + uNoiseOffsetV + uTime * uNoiseDriftV
        );

        radial += perlin2D(uv)             * uNoiseRadialAmp;
        y      += perlin2D(uv.yx + 12.345) * uNoiseVerticalAmp;

        vec3 pos;
        pos.x = radial*cos(ang);
        pos.z = radial*sin(ang);
        pos.y = y;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos,1.0);
        gl_PointSize = uSize;
      }
    `,
        fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uSegments;
      uniform float uGlitchSpeed;
      uniform float uGlitchIntensity;

      varying float vBirth;
      varying float vAng;

      float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }

      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        if(dot(uv,uv)>0.25) discard;

        float seg = floor((vAng+3.14159265)/(6.2831853/max(1.0,uSegments)));
        float gate = hash(vec2(seg, floor(uGlitchSpeed*vBirth)));
        float mask = step(gate, mix(vBirth,1.0,1.0-uGlitchIntensity));

        float alpha = uOpacity*mask;
        if(alpha<=0.0) discard;

        gl_FragColor = vec4(uColor, alpha);
      }
    `
    });

    if (particleCloud) {
        scene.remove(particleCloud);
        particleCloud.geometry.dispose();
        particleCloud.material.dispose();
    }
    particleCloud = new THREE.Points(geo, mat);
    particleCloud.rotation.x = THREE.MathUtils.degToRad(particleCloudTilt);
    particleCloud.position.y = particleCloudHeight;

    return particleCloud;
}

export function getParticleCloud() {
    return particleCloud;
}
```

- [ ] **Step 2: Update `main.js`**

Remove from `main.js`:
- `RINGS` config (lines 87-126)
- `particleCloud`, `particleGeo`, `particleMat` variables (lines 39-41)
- `particleCloudTilt`, `particleCloudHeight` (lines 43-44)
- `randNormal()` (lines 175-179)
- `buildRingParticles()` function (lines 623-830)
- The `buildRingParticles()` call (line 834)
- The `perlin2D` import (line 10) — only used inside the shader now

Add import:
```js
import { buildRingParticles, getParticleCloud } from './particles.js';
```

Build and add to scene:
```js
const particleCloud = buildRingParticles();
scene.add(particleCloud);
```

Animation loop uses:
```js
if (particleCloud) {
    particleCloud.rotation.y += 0.001;
    particleCloud.material.uniforms.uTime.value = t;
}
```

Note: `buildRingParticles()` now returns the Points object instead of adding to `scene` internally. The `scene.remove` cleanup inside the function needs adjustment — pass `scene` as an argument or handle cleanup in `main.js`. For simplicity in the extraction, the function returns the new cloud and `main.js` manages scene membership.

- [ ] **Step 3: Adjust `buildRingParticles` for scene independence**

The function currently does `scene.remove(particleCloud)` — but `scene` isn't available in the module. Change the cleanup approach: the function returns the new Points object. If rebuilding, `main.js` handles removing the old one first.

Update the end of `buildRingParticles()` — remove the `scene.remove` block and just return the new cloud:

```js
    // Replace the scene.remove block and scene.add at the end with:
    if (particleCloud) {
        particleCloud.geometry.dispose();
        particleCloud.material.dispose();
    }
    particleCloud = new THREE.Points(geo, mat);
    particleCloud.rotation.x = THREE.MathUtils.degToRad(particleCloudTilt);
    particleCloud.position.y = particleCloudHeight;

    return particleCloud;
```

- [ ] **Step 4: Test in browser**

Verify: particle rings appear, animate, rotate, birth animation works, glitch gating still present (we remove it in Phase 2).

---

### Task 5: Extract `starfield.js`

**Files:**
- Create: `starfield.js`
- Modify: `main.js` (remove starfield code, add import)

- [ ] **Step 1: Create `starfield.js`**

This file gets: `STARFIELD` config, `branchLength()`, `addStarField()` with full shader code.

```js
import * as THREE from 'three';

// ----------- STARFIELD PARAMETERS -----------
const STARFIELD = {
    planeZ: -250,

    nrOfBranches: 200,
    branchPoints: 1500,
    stepSizeInit: 30.0,
    stepSizeDecay: 0.975,
    startOffsetX: 600,
    startOffsetY: 350,
    biasStrength: 3.0,

    trailSpeed: 0.15,
    trailWidth: 0.5,
    glitchIntensity: 0.85,
    glitchSegments: 36.0,
    glitchSpeed: 100.0,
    blinkSpeed: 8.0,
    jitterAmp: 0.75,
    driftX: 0.0,
    driftY: 0.0,

    extraStars: 0,
    extraSpreadX: 2500,
    extraSpreadY: 1500,

    sizePx: 4 * window.devicePixelRatio,
    color: 0x808080,
    opacity: 0.5,

    tiltX: THREE.MathUtils.degToRad(45),
    tiltY: THREE.MathUtils.degToRad(-16),
    offsetX: -100,
    offsetY: -425
};

let starField = null;
let starGeo = null;
let starMat = null;

function branchLength(b, nrOfBranches, branchPoints) {
    const factor = 0.5 + (b / (nrOfBranches - 1));
    return Math.floor(branchPoints * factor);
}

export function addStarField() {
    const {
        planeZ,
        nrOfBranches, branchPoints,
        stepSizeInit, stepSizeDecay, startOffsetX, startOffsetY, biasStrength,
        extraStars, extraSpreadX, extraSpreadY,
        sizePx, color, opacity,
        tiltX, tiltY, offsetX, offsetY,
        trailSpeed, trailWidth,
        glitchIntensity, glitchSegments, glitchSpeed,
        blinkSpeed, jitterAmp,
        driftX, driftY
    } = STARFIELD;

    let perBranchCounts = new Array(nrOfBranches);
    let totalBranchStars = 0;
    for (let b = 0; b < nrOfBranches; b++) {
        const steps = branchLength(b, nrOfBranches, branchPoints);
        perBranchCounts[b] = steps;
        totalBranchStars += steps;
    }
    const totalStars = totalBranchStars + extraStars;

    const positions = new Float32Array(totalStars * 3);
    const aBranch = new Float32Array(totalStars);
    const aT = new Float32Array(totalStars);
    const aSeed = new Float32Array(totalStars);

    let idx = 0;
    for (let b = 0; b < nrOfBranches; b++) {
        const steps = perBranchCounts[b];
        let stepSize = stepSizeInit * Math.pow(stepSizeDecay, b);
        let p = new THREE.Vector3(
            (Math.random() * 2 - 1) * startOffsetX,
            (Math.random() * 2 - 1) * startOffsetY,
            planeZ
        );

        const bias = biasStrength / Math.sqrt(b + 1);

        for (let i = 0; i < steps; i++) {
            const rv = new THREE.Vector3(
                (Math.random() * 2 - 1) * stepSize,
                (Math.random() * 2 - 1) * stepSize + bias,
                0
            );
            p.add(rv);

            positions[3 * idx + 0] = p.x;
            positions[3 * idx + 1] = p.y;
            positions[3 * idx + 2] = p.z;

            aBranch[idx] = b;
            aT[idx] = steps > 1 ? (i / (steps - 1)) : 0.0;
            aSeed[idx] = Math.random() * 1000.0;
            idx++;
        }
    }

    for (let i = 0; i < extraStars; i++) {
        positions[3 * idx + 0] = (Math.random() - 0.5) * extraSpreadX;
        positions[3 * idx + 1] = (Math.random() - 0.5) * extraSpreadY;
        positions[3 * idx + 2] = planeZ;
        aBranch[idx] = -1.0;
        aT[idx] = Math.random();
        aSeed[idx] = Math.random() * 1000.0;
        idx++;
    }

    starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('aBranch', new THREE.BufferAttribute(aBranch, 1));
    starGeo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    starGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));

    starMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
            uSize: { value: sizePx },
            uColor: { value: new THREE.Color(color) },
            uOpacity: { value: opacity },
            uTrailSpeed: { value: trailSpeed },
            uTrailWidth: { value: trailWidth },
            uGlitchIntensity: { value: glitchIntensity },
            uGlitchSegments: { value: glitchSegments },
            uGlitchSpeed: { value: glitchSpeed },
            uBlinkSpeed: { value: blinkSpeed },
            uJitterAmp: { value: jitterAmp },
            uDrift: { value: new THREE.Vector2(driftX, driftY) }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`
        attribute float aBranch;
        attribute float aT;
        attribute float aSeed;

        uniform float uTime;
        uniform float uSize;
        uniform float uJitterAmp;

        uniform float uTrailSpeed;
        uniform float uTrailWidth;

        uniform vec2  uDrift;

        varying float vVis;

        float hash(float x){ return fract(sin(x*12.9898)*43758.5453); }

        void main() {
        vec3 pos = position;

        pos.x += uDrift.x * uTime;
        pos.y += uDrift.y * uTime;

        float jx = (hash(aSeed + floor(uTime*37.0)) - 0.5) * uJitterAmp;
        float jy = (hash(aSeed + floor(uTime*29.0) + 7.0) - 0.5) * uJitterAmp;
        pos.x += jx;
        pos.y += jy;

        float branchPhase = hash(aBranch + 13.37);
        float head = fract(uTime * uTrailSpeed + branchPhase);

        float forward = head - aT;
        if (forward < 0.0) forward += 1.0;

        float inside = 1.0 - step(uTrailWidth, forward);

        float tailFade = 1.0 - smoothstep(uTrailWidth*0.85, uTrailWidth, forward);

        vVis = inside * tailFade;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = uSize;
        }

    `,
        fragmentShader: /* glsl */`
        precision mediump float;

        uniform vec3  uColor;
        uniform float uOpacity;
        uniform float uGlitchSegments;
        uniform float uGlitchSpeed;
        uniform float uGlitchIntensity;

        varying float vVis;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }

        void main() {
        vec2 uv = gl_PointCoord - 0.5;
        if (dot(uv,uv) > 0.25) discard;

        float ang = atan(uv.y, uv.x) + 3.14159265;
        float seg = floor( ang / (6.2831853 / max(1.0, uGlitchSegments)) );

        float gate = hash(vec2(seg, floor(uGlitchSpeed * vVis)));
        float mask = step(gate, mix(vVis, 1.0, 1.0 - uGlitchIntensity));

        float alpha = uOpacity * vVis * mask;
        if (alpha <= 0.0) discard;

        gl_FragColor = vec4(uColor, alpha);
        }

    `
    });

    if (starField) {
        scene.remove(starField);
        starGeo.dispose();
        starMat.dispose();
    }

    starField = new THREE.Points(starGeo, starMat);
    starField.rotation.x = tiltX;
    starField.rotation.y = tiltY;
    starField.position.x = offsetX;
    starField.position.y = offsetY;

    return starField;
}

export function getStarMat() {
    return starMat;
}
```

- [ ] **Step 2: Adjust `addStarField` for scene independence**

Same pattern as particles — remove the `scene.remove(starField)` line (since `scene` isn't in scope). Just dispose old geometry/material if they exist, and return the new Points object:

```js
    if (starField) {
        starField.geometry.dispose();
        starField.material.dispose();
    }

    starField = new THREE.Points(starGeo, starMat);
    // ... set rotation/position ...
    return starField;
```

- [ ] **Step 3: Update `main.js`**

Remove from `main.js`:
- `STARFIELD` config (lines 131-169)
- `starField`, `starGeo`, `starMat` variables (lines 47-49)
- `branchLength()` (lines 183-187)
- `addStarField()` function (lines 841-1050)
- The `addStarField()` call (line 1054)

Add import:
```js
import { addStarField, getStarMat } from './starfield.js';
```

Build and add to scene:
```js
const starField = addStarField();
scene.add(starField);
```

Animation loop:
```js
const starMat = getStarMat();
if (starMat) {
    starMat.uniforms.uTime.value = t;
}
```

- [ ] **Step 4: Test in browser**

Verify: starfield appears, trail animation works, stars positioned correctly.

---

### Task 6: Extract `gui.js`

**Files:**
- Create: `gui.js`
- Modify: `main.js` (remove GUI code, add import)

- [ ] **Step 1: Create `gui.js`**

```js
import { PALETTES } from './palettes.js';
import { setPalette } from './postprocessing.js';
import { setMaterialType } from './skull.js';

export function initGUI(quantizePass) {
    const guiWrap = document.createElement('div');
    guiWrap.id = 'gui-container';
    document.body.appendChild(guiWrap);

    // --- Palette selector ---
    const paletteWrap = document.createElement('div');
    const paletteLabel = document.createElement('label');
    paletteLabel.textContent = 'PALETTE';
    paletteWrap.appendChild(paletteLabel);

    const paletteSelect = document.createElement('select');
    for (const name of Object.keys(PALETTES)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        paletteSelect.appendChild(opt);
    }
    // Random default palette
    const paletteKeys = Object.keys(PALETTES);
    paletteSelect.value = paletteKeys[Math.floor(Math.random() * paletteKeys.length)];
    paletteWrap.appendChild(paletteSelect);
    guiWrap.appendChild(paletteWrap);

    // Apply initial palette
    setPalette(quantizePass, PALETTES[paletteSelect.value]);

    paletteSelect.addEventListener('change', () => {
        setPalette(quantizePass, PALETTES[paletteSelect.value]);
    });

    // --- Material selector ---
    const matWrap = document.createElement('div');
    const matLabel = document.createElement('label');
    matLabel.textContent = 'MATERIAL';
    matWrap.appendChild(matLabel);

    const matSelect = document.createElement('select');
    ['Normal', 'Lambert'].forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        matSelect.appendChild(opt);
    });
    matSelect.value = 'Lambert';
    matWrap.appendChild(matSelect);
    guiWrap.appendChild(matWrap);

    setMaterialType(matSelect.value);

    matSelect.addEventListener('change', () => {
        setMaterialType(matSelect.value);
    });
}
```

Note: `gui.js` imports `setPalette` from `postprocessing.js` — but `setPalette` now takes `quantizePass` as a first argument. So `initGUI` receives `quantizePass` and passes it through.

- [ ] **Step 2: Update `main.js`**

Remove from `main.js`:
- `guiWrap` creation (lines 542-544)
- `makePaletteGUI()` function (lines 548-574)
- `makeMaterialGUI()` function (lines 577-608)
- The GUI init calls (lines 614-615)

Add import:
```js
import { initGUI } from './gui.js';
```

Call after post-processing is initialized:
```js
initGUI(quantizePass);
```

- [ ] **Step 3: Test in browser**

Verify: palette dropdown works, material dropdown works, scene renders correctly.

---

### Task 7: Clean Up `main.js` — Final Orchestrator

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Verify `main.js` is now the orchestrator**

After all extractions, `main.js` should contain only:
- Three.js import (`import * as THREE from 'three'`)
- OrbitControls import
- Module imports (skull, particles, starfield, postprocessing, gui)
- Scene, camera, renderer creation
- Lighting setup (3 directional lights)
- OrbitControls setup
- Camera position/target config
- `scene.add(head)`, `scene.add(particleCloud)`, `scene.add(starField)`
- Post-processing init call
- GUI init call
- `loadHeadParts()` call
- Clock
- Resize handler
- Screenshot key handler
- Animation loop
- `animate()` call

- [ ] **Step 2: Write the final clean `main.js`**

```js
import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { head, loadHeadParts, animateSkull } from './skull.js';
import { buildRingParticles, getParticleCloud } from './particles.js';
import { addStarField, getStarMat } from './starfield.js';
import { initPostProcessing } from './postprocessing.js';
import { initGUI } from './gui.js';


// --- Scene ---
const scene = new THREE.Scene();

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100000
);
camera.position.set(-100, -400, 400);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- Controls (debug) ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.update();

// --- Lighting ---
const dirLightA = new THREE.DirectionalLight(0xff0000, 0.8);
dirLightA.position.set(1, 1, 1);
const dirLightB = new THREE.DirectionalLight(0x0000ff, 0.4);
dirLightB.position.set(-1, -1, 1);
const dirLightC = new THREE.DirectionalLight(0xffffff, 0.7);
dirLightC.position.set(1, 0, 0);
scene.add(dirLightA, dirLightB, dirLightC);

// --- Post-processing ---
const { bloomComposer, bloomPass, quantizePass } = initPostProcessing(renderer, scene, camera);

// --- Skull ---
scene.add(head);
loadHeadParts();

// --- Particles ---
const particleCloud = buildRingParticles();
scene.add(particleCloud);

// --- Starfield ---
const starField = addStarField();
scene.add(starField);

// --- GUI (debug) ---
initGUI(quantizePass);

// --- Clock ---
const clock = new THREE.Clock();

// --- Resize ---
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    bloomComposer.setSize(w, h);
    bloomPass.setSize(w, h);
    quantizePass.uniforms.screenSize.value.set(w, h);
});

// --- Screenshot (S key) ---
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 's') {
        renderer.setRenderTarget(null);
        bloomComposer.render();
        const dataURL = renderer.domElement.toDataURL('image/png');
        const rand = Math.floor(Math.random() * 1000000);
        const filename = `skullshot_${rand}.png`;
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = filename;
        link.click();
    }
});

// --- Animation loop ---
function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    quantizePass.uniforms.uTime.value = t;

    animateSkull(t);

    if (particleCloud) {
        particleCloud.rotation.y += 0.001;
        particleCloud.material.uniforms.uTime.value = t;
    }

    const starMat = getStarMat();
    if (starMat) {
        starMat.uniforms.uTime.value = t;
    }

    controls.update();
    bloomComposer.render();
}

animate();
```

- [ ] **Step 3: Full browser test**

Verify everything works identically to before the extraction:
- Skull loads, tracks mouse, jaw animates, idle wobble
- Particle rings animate with birth effect
- Starfield trails sweep
- Bloom + dithering + palette quantization all work
- Palette and material dropdowns work
- Screenshot key works
- Resize works
- No console errors

---

## Phase 2: Aesthetic Overhaul

### Task 8: Flat Shading on Skull

**Files:**
- Modify: `skull.js`

- [ ] **Step 1: Add `flatShading: true` to all Lambert materials**

In `loadHeadParts()`, change the material creation:

```js
// Before:
child.material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide
});

// After:
child.material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    flatShading: true
});
```

In `updateMaterial()`, change the Lambert case:

```js
// Before:
mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });

// After:
mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, flatShading: true });
```

- [ ] **Step 2: Test in browser**

Verify: skull faces are now visibly flat/faceted with hard color boundaries between triangles. The low-poly geometry should be very pronounced.

---

### Task 9: Remove Glitch Gating from Particle Rings

**Files:**
- Modify: `particles.js`

- [ ] **Step 1: Simplify fragment shader**

Replace the entire fragment shader in `buildRingParticles()`:

```glsl
      uniform vec3 uColor;
      uniform float uOpacity;

      varying float vBirth;

      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        if(dot(uv,uv)>0.25) discard;

        float alpha = uOpacity * vBirth;
        if(alpha<=0.0) discard;

        gl_FragColor = vec4(uColor, alpha);
      }
```

- [ ] **Step 2: Remove dead uniforms from ShaderMaterial**

Remove these from the `uniforms` object in the ShaderMaterial constructor:
```js
            uSegments: { value: RINGS.segments },
            uGlitchSpeed: { value: RINGS.glitchSpeed },
            uGlitchIntensity: { value: RINGS.glitchIntensity }
```

- [ ] **Step 3: Remove `vAng` varying from vertex shader**

In the vertex shader, remove:
- The `varying float vAng;` declaration
- The `vAng = ang;` assignment

These were only used by the glitch gating in the fragment shader.

- [ ] **Step 4: Remove dead RINGS config entries**

Remove from the `RINGS` object:
```js
    segments: 40.0,
    glitchSpeed: 100.0,
    glitchIntensity: 0.85
```

- [ ] **Step 5: Switch to normal blending**

Change in the ShaderMaterial options:
```js
// Before:
blending: THREE.AdditiveBlending,

// After:
blending: THREE.NormalBlending,
```

- [ ] **Step 6: Test in browser**

Verify: rings still animate with birth emergence from center, but no flickering/gating. Points should appear and fade smoothly. They may look dimmer with normal blending — that's expected and tunable via `opacity`.

---

### Task 10: Remove Glitch Gating and Jitter from Starfield

**Files:**
- Modify: `starfield.js`

- [ ] **Step 1: Simplify vertex shader — remove jitter**

In the vertex shader, remove the jitter block:
```glsl
        // Remove these lines:
        float jx = (hash(aSeed + floor(uTime*37.0)) - 0.5) * uJitterAmp;
        float jy = (hash(aSeed + floor(uTime*29.0) + 7.0) - 0.5) * uJitterAmp;
        pos.x += jx;
        pos.y += jy;
```

Also remove from the vertex shader uniforms declaration:
```glsl
        uniform float uJitterAmp;
```

The `hash` function and `aSeed` attribute stay — `hash` is still used for `branchPhase`.

- [ ] **Step 2: Simplify fragment shader — remove glitch gating**

Replace the entire fragment shader:

```glsl
        precision mediump float;

        uniform vec3  uColor;
        uniform float uOpacity;

        varying float vVis;

        void main() {
        vec2 uv = gl_PointCoord - 0.5;
        if (dot(uv,uv) > 0.25) discard;

        float alpha = uOpacity * vVis;
        if (alpha <= 0.0) discard;

        gl_FragColor = vec4(uColor, alpha);
        }
```

- [ ] **Step 3: Remove dead uniforms from ShaderMaterial**

Remove from the `uniforms` object:
```js
            uGlitchIntensity: { value: glitchIntensity },
            uGlitchSegments: { value: glitchSegments },
            uGlitchSpeed: { value: glitchSpeed },
            uBlinkSpeed: { value: blinkSpeed },
            uJitterAmp: { value: jitterAmp },
```

- [ ] **Step 4: Remove dead STARFIELD config entries**

Remove from `STARFIELD`:
```js
    glitchIntensity: 0.85,
    glitchSegments: 36.0,
    glitchSpeed: 100.0,
    blinkSpeed: 8.0,
    jitterAmp: 0.75,
```

Also remove from the destructuring in `addStarField()`:
```js
        glitchIntensity, glitchSegments, glitchSpeed,
        blinkSpeed, jitterAmp,
```

- [ ] **Step 5: Switch to normal blending**

```js
// Before:
blending: THREE.AdditiveBlending,

// After:
blending: THREE.NormalBlending,
```

- [ ] **Step 6: Test in browser**

Verify: starfield trails still sweep along branches, but no per-point flickering or jitter. Clean, smooth trail movement.

---

### Task 11: Replace Blue-Noise Dithering with Bayer Dithering

**Files:**
- Modify: `postprocessing.js`

- [ ] **Step 1: Remove blue-noise texture loading**

Delete the entire `noiseTex` block from `postprocessing.js`:
```js
// Delete this:
const noiseTex = new THREE.TextureLoader().load('assets/HDR_L_15.png', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
});
```

- [ ] **Step 2: Update shader uniforms — remove blue noise, remove ditherPixelSize**

In `QuantizeDitherShader.uniforms`, remove:
```js
        blueNoise: { value: noiseTex },
        ditherPixelSize: { value: 300.0 },
```

Keep: `tDiffuse`, `palette`, `paletteSize`, `screenSize`, `pxFactor`, `ditherStrength`, `uTime`.

- [ ] **Step 3: Rewrite the fragment shader with Bayer dithering**

Replace the entire `fragmentShader` in `QuantizeDitherShader`:

```glsl
    precision highp float;
    precision highp int;

    uniform sampler2D tDiffuse;

    uniform vec3  palette[${MAX_COLORS}];
    uniform int   paletteSize;

    uniform vec2  screenSize;
    uniform float pxFactor;
    uniform float ditherStrength;
    uniform float uTime;

    varying vec2 vUv;

    vec2 pixelateUv(vec2 uv) {
      vec2 grid = screenSize / max(pxFactor, 1.0);
      vec2 cell = floor(uv * grid) + 0.5;
      return cell / grid;
    }

    // 4x4 Bayer matrix (normalized to 0..1)
    float bayer4x4(vec2 pos) {
      int x = int(mod(pos.x, 4.0));
      int y = int(mod(pos.y, 4.0));
      int index = x + y * 4;
      // Bayer matrix values (row-major)
      if (index == 0) return  0.0/16.0;
      if (index == 1) return  8.0/16.0;
      if (index == 2) return  2.0/16.0;
      if (index == 3) return 10.0/16.0;
      if (index == 4) return 12.0/16.0;
      if (index == 5) return  4.0/16.0;
      if (index == 6) return 14.0/16.0;
      if (index == 7) return  6.0/16.0;
      if (index == 8) return  3.0/16.0;
      if (index == 9) return 11.0/16.0;
      if (index == 10) return 1.0/16.0;
      if (index == 11) return 9.0/16.0;
      if (index == 12) return 15.0/16.0;
      if (index == 13) return  7.0/16.0;
      if (index == 14) return 13.0/16.0;
      if (index == 15) return  5.0/16.0;
      return 0.0;
    }

    void findTwoNearest(in vec3 c, out int iBest, out int iSecond, out float dBest, out float dSecond) {
      dBest = 1e9; iBest = 0; dSecond = 1e9; iSecond = 0;
      for (int i = 0; i < ${MAX_COLORS}; i++) {
        if (i >= paletteSize) break;
        vec3 p = palette[i];
        vec3 d = c - p;
        float dist = dot(d, d);
        if (dist < dBest) { dSecond = dBest; iSecond = iBest; dBest = dist; iBest = i; }
        else if (dist < dSecond) { dSecond = dist; iSecond = i; }
      }
    }

    void main() {
      // 1) Pixelate
      vec2 uvPix = pixelateUv(vUv);
      vec3 c = texture2D(tDiffuse, uvPix).rgb;

      // 2) Find two nearest palette colors
      int iBest, iSecond; float dBest, dSecond;
      findTwoNearest(c, iBest, iSecond, dBest, dSecond);
      vec3 pBest = palette[iBest];
      vec3 pSecond = palette[iSecond];

      // 3) Bayer dither — use pixelated grid coordinates
      vec2 grid = screenSize / max(pxFactor, 1.0);
      vec2 cellCoord = floor(vUv * grid);
      float n = bayer4x4(cellCoord);

      // 4) Blend between two nearest based on distance ratio + dither
      float a = sqrt(max(dBest,   0.0));
      float b = sqrt(max(dSecond, 0.0));
      float total = max(a + b, 1e-6);
      float probSecond = mix(0.0, a / total, clamp(ditherStrength, 0.0, 1.0));

      vec3 outColor = (n < probSecond) ? pSecond : pBest;
      gl_FragColor = vec4(outColor, 1.0);
    }
```

Key change: `bayer4x4(cellCoord)` replaces `texture2D(blueNoise, nUv).r`. The dither pattern is now a fixed ordered grid aligned to the pixelation grid, not a random noise texture.

- [ ] **Step 4: Update `initPostProcessing` — remove blue noise references**

Remove the line:
```js
    quantizePass.uniforms.blueNoise.value = noiseTex;
```

- [ ] **Step 5: Test in browser**

Verify: dithering now shows a regular crosshatch/checkerboard pattern instead of random noise. The pattern should be visible at color boundaries. Pixelation and palette quantization still work. Bloom glow is still absorbed into the dithered output.

---

### Task 12: Add PS1-Era Palettes

**Files:**
- Modify: `palettes.js`

- [ ] **Step 1: Add 4 new palettes before the PALETTES registry**

Add these after the existing palette definitions, before `export const PALETTES = {`:

```js
// 🌫️ Silent Hill — foggy, muted, unsettling
const palette_silent_hill = [
    '#1a1a1a', // near-black
    '#3d3d3d', // dark gray
    '#6b6b6b', // medium gray
    '#8c7b6b', // warm gray-brown
    '#5c6b5c', // muted olive
    '#6b7b8c', // washed-out blue
    '#8c8c7b', // pale khaki
    '#b3a89c'  // foggy beige
];

// 🧟 Resident Evil — dark, moody, cold with warm accents
const palette_resident_evil = [
    '#0a0a0a', // deep black
    '#1a1a2a', // blue-black
    '#3d2a2a', // dark blood
    '#5c3a2a', // dried rust
    '#4a4a5a', // cold gray
    '#7a6a5a', // warm gray
    '#8c2a1a', // crimson
    '#c4a882'  // amber highlight
];

// 🏎️ Ridge Racer — bold, limited, high-contrast
const palette_ridge_racer = [
    '#0a0a1a', // night sky
    '#1a3a5a', // racing blue
    '#2a6a8c', // sky cyan
    '#4a4a4a', // asphalt gray
    '#8c5a2a', // sunset orange
    '#cc7a2a', // bright orange
    '#2a8c4a', // racing green
    '#d4d4d4'  // headlight white
];

// 🎮 PS1 Boot — Sony startup screen palette
const palette_ps1_boot = [
    '#000000', // black
    '#1a1a1a', // dark gray
    '#4a4a4a', // medium gray
    '#8a8a8a', // light gray
    '#e42528', // PlayStation red
    '#2151a1', // PlayStation blue
    '#f5c518', // PlayStation yellow
    '#ffffff'  // white
];
```

- [ ] **Step 2: Register new palettes in the PALETTES object**

Add to the `PALETTES` object:

```js
    'Silent Hill': palette_silent_hill,
    'Resident Evil': palette_resident_evil,
    'Ridge Racer': palette_ridge_racer,
    'PS1 Boot': palette_ps1_boot,
```

- [ ] **Step 3: Test in browser**

Verify: new palettes appear in dropdown, selecting each one applies correct colors.

---

## Phase 3: HUD Tag System

### Task 13: Create `tags.js` — Tag Rendering System

**Files:**
- Create: `tags.js`
- Modify: `style.css` (add tag styles)

- [ ] **Step 1: Add tag CSS to `style.css`**

Append to the end of `style.css`:

```css
/* --- HUD Tags --- */
#tag-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 5;
    overflow: hidden;
}

.tag {
    position: absolute;
    font-family: monospace;
    image-rendering: pixelated;
}

.tag-box {
    border: 1px solid rgba(200, 200, 200, 0.4);
    background: rgba(0, 0, 0, 0.6);
    padding: 6px 10px;
}

.tag-title {
    font-size: 11px;
    color: #ccc;
    letter-spacing: 1px;
    text-transform: uppercase;
}

.tag-subtitle {
    font-size: 9px;
    color: #888;
    letter-spacing: 1px;
    margin-top: 2px;
}

.tag-connector {
    width: 1px;
    height: 30px;
    background: rgba(200, 200, 200, 0.3);
    margin-left: 20px;
}

.tag-connector.up {
    /* For upward connectors, the connector goes above the box.
       Handled by flex-direction: column-reverse on the .tag */
}

.tag.connector-up {
    display: flex;
    flex-direction: column-reverse;
}

.tag.connector-down {
    display: flex;
    flex-direction: column;
}

.tag-marker {
    width: 6px;
    height: 6px;
    border: 1px solid rgba(200, 200, 200, 0.4);
    margin-left: 17px;
}
```

- [ ] **Step 2: Create `tags.js`**

```js
import * as THREE from 'three';

// --- Placeholder tag data ---
const TAG_DATA = [
    {
        id: 'skull',
        target: [0, 50, 0],
        title: 'SPECIMEN_01',
        subtitle: 'EST. 1347 — UNKNOWN ORIGIN',
        connector: 'down'
    },
    {
        id: 'rings',
        target: [0, 150, 0],
        title: 'RING_CYCLE_08',
        subtitle: 'STATUS: ACTIVE',
        connector: 'down'
    },
    {
        id: 'starfield',
        target: [-200, -200, -250],
        title: 'FIELD_OBSERVATION',
        subtitle: 'MAPPING IN PROGRESS',
        connector: 'up'
    },
    {
        id: 'timeline',
        target: [150, -100, 0],
        title: 'TIMELINE_ENTRY',
        subtitle: 'DATE: UNKNOWN',
        connector: 'down'
    }
];

let container = null;
let tagElements = [];
const projVec = new THREE.Vector3();

function createTagElement(data) {
    const tag = document.createElement('div');
    tag.className = `tag connector-${data.connector}`;

    const box = document.createElement('div');
    box.className = 'tag-box';

    const title = document.createElement('div');
    title.className = 'tag-title';
    title.textContent = data.title;

    const subtitle = document.createElement('div');
    subtitle.className = 'tag-subtitle';
    subtitle.textContent = data.subtitle;

    box.appendChild(title);
    box.appendChild(subtitle);

    const connector = document.createElement('div');
    connector.className = `tag-connector ${data.connector}`;

    const marker = document.createElement('div');
    marker.className = 'tag-marker';

    tag.appendChild(box);
    tag.appendChild(connector);
    tag.appendChild(marker);

    return tag;
}

export function initTags() {
    container = document.createElement('div');
    container.id = 'tag-container';
    document.body.appendChild(container);

    TAG_DATA.forEach((data) => {
        const el = createTagElement(data);
        container.appendChild(el);
        tagElements.push({
            el,
            target: new THREE.Vector3(data.target[0], data.target[1], data.target[2]),
            connector: data.connector
        });
    });
}

export function updateTags(camera) {
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;

    tagElements.forEach((tag) => {
        projVec.copy(tag.target);
        projVec.project(camera);

        // Behind camera check
        if (projVec.z > 1) {
            tag.el.style.display = 'none';
            return;
        }

        const screenX = (projVec.x * halfW) + halfW;
        const screenY = -(projVec.y * halfH) + halfH;

        // Off-screen check (with margin)
        if (screenX < -100 || screenX > window.innerWidth + 100 ||
            screenY < -100 || screenY > window.innerHeight + 100) {
            tag.el.style.display = 'none';
            return;
        }

        tag.el.style.display = 'flex';

        if (tag.connector === 'down') {
            // Box above, connector points down to target
            tag.el.style.left = `${screenX - 20}px`;
            tag.el.style.top = `${screenY - 70}px`;
        } else {
            // Connector points up, box below target
            tag.el.style.left = `${screenX - 20}px`;
            tag.el.style.top = `${screenY}px`;
        }
    });
}
```

- [ ] **Step 3: Test tag module in isolation**

Check that the file has no syntax errors by importing it. No visual test yet — that comes after wiring into `main.js`.

---

### Task 14: Wire Tags into `main.js`

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Import and initialize tags**

Add import at top of `main.js`:
```js
import { initTags, updateTags } from './tags.js';
```

After the GUI init, call:
```js
initTags();
```

- [ ] **Step 2: Update animation loop**

Add to the animation loop, after `controls.update()` and before `bloomComposer.render()`:
```js
    updateTags(camera);
```

- [ ] **Step 3: Test in browser**

Verify:
- 4 tags appear on screen as thin-bordered boxes with monospace text
- Tags track their 3D positions (move when orbiting with OrbitControls)
- Tags pointing at the skull area are near the skull
- Tags disappear when their target is off-screen or behind camera
- Tags don't interfere with the 3D scene (pointer-events: none)
- Tags render on top of the dithered/pixelated scene as clean overlays

---

### Task 15: Final Integration Test

**Files:** None (test only)

- [ ] **Step 1: Full visual check**

Open the page and verify all systems together:
- Skull: flat-shaded, faceted faces visible, mouse tracking + idle + jaw all work
- Particles: smooth ring emergence from center, no flickering, normal blending
- Starfield: clean trail sweeps, no jitter, no glitch gating
- Post-processing: bloom → pixelation → Bayer dithering → palette quantization
- Dithering: visible ordered crosshatch pattern at color boundaries (not random noise)
- Tags: 4 HUD overlays with thin borders, monospace text, connectors
- GUI: palette and material dropdowns work
- New palettes: Silent Hill, Resident Evil, Ridge Racer, PS1 Boot all selectable
- Screenshot: S key captures frame
- Resize: everything adjusts correctly

- [ ] **Step 2: Console check**

Open browser dev tools console. Verify: no errors, no warnings about missing imports or undefined variables.

- [ ] **Step 3: Performance check**

The scene should maintain smooth framerate (60fps on decent hardware). Check with dev tools performance tab or the browser's built-in FPS counter. If there's a regression, note which change caused it.
