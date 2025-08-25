// MODULE IMPORTS

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { GLTFLoader } from 'GLTFLoader';
import { EffectComposer } from 'EffectComposer';
import { RenderPass } from 'RenderPass';
import { UnrealBloomPass } from 'UnrealBloomPass';
import { ShaderPass } from 'ShaderPass';
import { perlin2D } from './perlin.min.js';






// GLOBALS

const mouse = { x: 0, y: 0 };          // current mouse position in NDC
const targetRotation = { x: 0, y: 0 }; // desired model rotation based on mouse

let skull, jaw;
let jawOpen = 0;          // smoothed value (0 closed .. 1 open)
let targetJawOpen = 0;    // current target
let nextJawEvent = 0;     // time until we change state again

let mouseInWindow = true; // checks if the mouse is inside the window
let resetTimer = null; // timer for the skull rotation reset when the mouse leaves the screen
let shouldReset = false; // trigger for the skull rotation reset when the mouse leaves the screen

let pxFactor = 3; // ↑ bigger = chunkier pixels
let ditherPixelSize = 300.0; // blue noise grain size
let ditherStrength = 0.5; // 0.0 (none) to 1.0 (strong)

let bloomStrength = 1.0; // 1.0, 0.5
let bloomRadius = 0.1;
let bloomThreshold = 0.70;

let particleCloud = null;
let particleGeo = null;
let particleMat = null;

let particleCloudTilt = 25; // tilt the rings around X axis in degrees
let particleCloudHeight = 75 // translate the rings up above the skull

let cameraPosition = { // camera position (X - horizontal, Y - height, Z - depth)
    x: 0,
    y: -150,
    z: 250
}; 
let cameraTarget = { // look-at point (X - horizontal, Y - height, Z - depth)
    x: 0,
    y: 75,
    z: 0
}; 

const MAX_COLORS = 32; // for use in quantization shader

const materialOptions = {
    type: 'Lambert', // default
};


const clock = new THREE.Clock();




// --- Blue-noise texture (tiling) ---
const noiseTex = new THREE.TextureLoader().load('assets/HDR_L_15.png', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
});





// ----------- RING PARTICLE PARAMETERS (with Perlin) -----------
const RINGS = {
    ringCount: 12,
    pointsPerRing: 4000,
    baseRadius: 50,
    ringSpacing: 18, // uniform spacing distance between rings
    ringSpacingNonLin: 2.0, // non-linear spacing factor - progressively increases spacing for outer rings

    // Gaussian grit
    radialSigma: 2.0, // radial spread of points
    radialSigmaNonLin: 0.50, // non-linear spread factor - progressively increases spread for outer rings - 0.5
    verticalSigma: 1.0, // vertical spread of points

    // Perlin controls (now periodic along θ via cos/sin)
    noiseRadialAmp: 5.0, // 6.0
    noiseVerticalAmp: 3.0,
    noiseThetaFreq: 2.75,  // how many “waves” around a ring
    noiseRingFreqU: 0.22,  // how much ring index shifts noise U
    noiseRingFreqV: 0.31,  // how much ring index shifts noise V
    noiseOffsetU: Math.random() * 1000.0,
    noiseOffsetV: Math.random() * 1000.0,

    // extra: per-ring angular phase to avoid alignment
    ringPhaseStep: 0.17,   // radians added per ring

    // appearance
    sizePx: 1 * window.devicePixelRatio,
    color: 0x0033ff, // 0x808080 - 50% gray, 0x0033ff - EVA HUD blue
    opacity: 0.85
};


// ----------- STARFIELD PARAMETERS -----------
const STARFIELD = {
  planeZ: -250,          // z coordinate of the star plane

  // random walk branches
  nrOfBranches: 50,       // number of random walk branches - 20
  branchPoints: 4000,     // stars in each branch - 4000
  stepSizeInit: 10.0,      // initial step size per branch - 5.0
  stepSizeDecay: 0.95,    // step size shrink factor for each branch
  startOffset: 50,       // starting XY offset range - 100
  biasStrength: 0.75,      // vertical bias strength (smearing upward) - 0.50

  // extra stars (uniform random distribution)
  extraStars: 2500,
  extraSpreadX: 2000,
  extraSpreadY: 1000,

  // appearance
  sizePx: 1 * window.devicePixelRatio,
  color: 0x0033ff,
  opacity: 0.85,

  // transform (optional tilt/shift)
  tiltX: THREE.MathUtils.degToRad(25),
  offsetY: 250
};




// Gaussian helper
function randNormal(mean = 0, sigma = 1) {
    let u = 1 - Math.random(), v = 1 - Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + sigma * z;
}





// SKULL ANIMATION


// skull mouse tracking
const trackLerp = 0.06;   // when following mouse
const outLerp = 0.03;   // during delay (mouse out, before reset starts)
const resetLerp = 0.04;   // while resetting to center

// slight wobbling of the skull while idle
const idle = {
    ampX: 0.04,  // idle amplitude in radians
    ampY: 0.06,  // idle amplitude in radians
    speedX: 0.3, // cycles per second-ish
    speedY: 0.4
};


export function setJawOpen01(v) {
    targetJawOpen = THREE.MathUtils.clamp(v, 0, 1);
}

window.addEventListener('mousemove', (event) => {
    // Convert to normalized device coordinates [-1, 1]
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    const maxRotation = Math.PI / 6; // 30 degrees
    targetRotation.x = -mouse.y * maxRotation; // <-- Y is inverted - up-down mouse tracking
    targetRotation.y = mouse.x * maxRotation;
});



// skull animation
document.body.addEventListener('mouseenter', () => {
    // console.log('🟢 enter');
    mouseInWindow = true;
    shouldReset = false;
    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
});


// skull animation
document.body.addEventListener('mouseleave', () => {
    // console.log('🔴 leave');
    mouseInWindow = false;
    scheduleReset(500); // delay before reset starts
});


// skull animation - helper function
function scheduleReset(delayMs = 500) {
    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
    resetTimer = setTimeout(() => {
        shouldReset = true;
        resetTimer = null; // allow re-arming next time
    }, delayMs);
}


// skull animation - extra robustness
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





// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1, // near clipping plane
    100000 // far clipping plane
);

camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z); // camera position (X, Y - height, Z - depth)


// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

controls.target.set(cameraTarget.x, cameraTarget.y, cameraTarget.z); // look-at point
controls.update();

// Lighting
const dirLightA = new THREE.DirectionalLight(0xff0000, 0.8); // red light
dirLightA.position.set(1, 1, 1);
const dirLightB = new THREE.DirectionalLight(0x0000ff, 0.4); // blue light
dirLightB.position.set(-1, -1, 1);
const dirLightC = new THREE.DirectionalLight(0xffffff, 0.7); // white light
dirLightC.position.set(1, 0, 0);

scene.add(dirLightA);
scene.add(dirLightB);
scene.add(dirLightC);



// ----- Bloom composer (full resolution) -----
const bloomComposer = new EffectComposer(renderer);
const scenePass = new RenderPass(scene, camera);

// strength, radius, threshold — tweak to taste
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    bloomStrength,   // strength
    bloomRadius,     // radius
    bloomThreshold   // threshold
);

bloomComposer.addPass(scenePass);
bloomComposer.addPass(bloomPass);





// Load GLB model
const loader = new GLTFLoader();

// Parent group to move/rotate/scale the whole head together
const head = new THREE.Group();
scene.add(head);


(async function loadHeadParts() {
    try {
        const [skullGltf, jawGltf] = await Promise.all([
            loader.loadAsync('assets/skull_model_01_06_skull.glb'),
            loader.loadAsync('assets/skull_model_01_06_jaw.glb'),
        ]);

        // Base halves
        skull = skullGltf.scene;
        jaw = jawGltf.scene;

        // Apply Normal material (DoubleSide so geometry draws correctly)
        [skull, jaw].forEach((obj) => {
            obj.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
                    // Optional niceties:
                    // child.frustumCulled = false;
                    // child.castShadow = child.receiveShadow = false;
                }
            });
        });

        // Add skull and jaw to the head group
        head.add(skull);
        head.add(jaw);

        console.log('Head parts loaded: skull + jaw');

    } catch (e) {
        console.error('Error loading head parts:', e);
    }
})();



// this will traverse both skull + jaw meshes and swap their material when we switch from GUI

function updateMaterial() {
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

    [skull, jaw].forEach((obj) => {
        if (obj) {
            obj.traverse((child) => {
                if (child.isMesh) {
                    child.material = mat;
                }
            });
        }
    });
}

updateMaterial();



// quantize dither shader

const QuantizeDitherShader = {
    uniforms: {
        tDiffuse: { value: null },  // provided by ShaderPass automatically
        blueNoise: { value: noiseTex },

        palette: { value: new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0)) },
        paletteSize: { value: 0 },

        screenSize: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        pxFactor: { value: pxFactor },                  // pixel size in SCREEN pixels
        ditherPixelSize: { value: ditherPixelSize },    // dithering cell size (screen pixels)
        ditherStrength: { value: ditherStrength },      // 0..1
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

    uniform sampler2D tDiffuse;   // bloom-composited input from previous pass
    uniform sampler2D blueNoise;

    uniform vec3  palette[${MAX_COLORS}];
    uniform int   paletteSize;

    uniform vec2  screenSize;
    uniform float pxFactor;        // pixelation size in screen pixels
    uniform float ditherPixelSize; // blue-noise cell size in screen pixels
    uniform float ditherStrength;  // 0..1
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
      // 1) Pixelate the bloom-composited image from previous pass
      vec2 uvPix = pixelateUv(vUv);
      vec3 c = texture2D(tDiffuse, uvPix).rgb;

      // 2) Quantize to palette with blue-noise dithering
      int iBest, iSecond; float dBest, dSecond;
      findTwoNearest(c, iBest, iSecond, dBest, dSecond);
      vec3 pBest = palette[iBest];
      vec3 pSecond = palette[iSecond];

      // screen-space blue noise (animated)
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


const quantizePass = new ShaderPass(QuantizeDitherShader);

// make it the final pass (outputs to screen)
quantizePass.renderToScreen = true;

// wire uniforms you tweak elsewhere (if you keep variables pxFactor, etc.)
quantizePass.uniforms.blueNoise.value = noiseTex;
quantizePass.uniforms.screenSize.value.set(window.innerWidth, window.innerHeight);
quantizePass.uniforms.pxFactor.value = pxFactor;
quantizePass.uniforms.ditherPixelSize.value = ditherPixelSize;
quantizePass.uniforms.ditherStrength.value = ditherStrength;

// add to composer after bloom
bloomComposer.addPass(quantizePass);





function setPalette(hexArray) {
    const size = Math.min(hexArray.length, MAX_COLORS);
    const vecs = new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < size; i++) {
        const c = new THREE.Color(hexArray[i]);
        vecs[i] = new THREE.Vector3(c.r, c.g, c.b);
    }
    quantizePass.uniforms.palette.value = vecs;
    quantizePass.uniforms.paletteSize.value = size;
}




// Create one container for all GUI controls
const guiWrap = document.createElement('div');
guiWrap.id = 'gui-container';
document.body.appendChild(guiWrap);


// palette GUI
function makePaletteGUI(defaultKey = 'CGA 8') {
    const wrap = document.createElement('div');

    const label = document.createElement('label');
    label.textContent = 'PALETTE';
    wrap.appendChild(label);

    const select = document.createElement('select');
    for (const name of Object.keys(PALETTES)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    }
    select.value = defaultKey;
    wrap.appendChild(select);

    // append into main container
    guiWrap.appendChild(wrap);

    // apply initial palette
    setPalette(PALETTES[select.value]);

    select.addEventListener('change', () => {
        setPalette(PALETTES[select.value]);
    });
}

// material GUI
function makeMaterialGUI(defaultKey = 'Lambert') {
    const wrap = document.createElement('div');

    const label = document.createElement('label');
    label.textContent = 'MATERIAL';
    wrap.appendChild(label);

    const select = document.createElement('select');
    const materialTypes = ['Normal', 'Lambert'];

    materialTypes.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });

    select.value = defaultKey;
    wrap.appendChild(select);

    // append into main container
    guiWrap.appendChild(wrap);

    // update materialOptions and call your existing updateMaterial()
    materialOptions.type = select.value;
    updateMaterial();

    select.addEventListener('change', () => {
        materialOptions.type = select.value;
        updateMaterial();
    });
}




// init palettes GUI - sets default palette at random
makePaletteGUI(Object.keys(PALETTES)[Math.floor(Math.random() * Object.keys(PALETTES).length)]); // manual override - makePaletteGUI('ZX Spectrum 8');
makeMaterialGUI('Lambert'); // init materials GUI





// ----------- RING PARTICLE CLOUD -----------

function buildRingParticles() {
    // dispose old
    if (particleCloud) {
        scene.remove(particleCloud);
        particleGeo.dispose();
        particleMat.dispose();
        particleCloud = null;
    }

    const total = RINGS.ringCount * RINGS.pointsPerRing;
    const positions = new Float32Array(total * 3);

    let idx = 0;
    for (let r = 0; r < RINGS.ringCount; r++) {
        const ringR = RINGS.baseRadius + r * RINGS.ringSpacing + r * r * RINGS.ringSpacingNonLin;
        const phase = r * RINGS.ringPhaseStep;

        for (let j = 0; j < RINGS.pointsPerRing; j++) {
            const theta = (j / RINGS.pointsPerRing) * Math.PI * 2.0 + phase;

            // PERIODIC noise sampling along θ:
            // circle coords in noise space (u,v), plus ring-index drift & global offsets
            const c = Math.cos(theta) * RINGS.noiseThetaFreq;
            const s = Math.sin(theta) * RINGS.noiseThetaFreq;

            const u = c + r * RINGS.noiseRingFreqU + RINGS.noiseOffsetU;
            const v = s + r * RINGS.noiseRingFreqV + RINGS.noiseOffsetV;

            // two decorrelated samples
            const nRad = perlin2D(u, v);                  // [-1,1]
            const nY = perlin2D(u + 123.45, v - 67.89); // [-1,1]

            const radius = ringR
                + nRad * RINGS.noiseRadialAmp
                + randNormal(0, RINGS.radialSigma * r * RINGS.radialSigmaNonLin);

            const y = (nY * RINGS.noiseVerticalAmp)
                + randNormal(0, RINGS.verticalSigma);

            const x = radius * Math.cos(theta);
            const z = radius * Math.sin(theta);

            positions[idx++] = x;
            positions[idx++] = y;
            positions[idx++] = z;
        }
    }

    particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    particleMat = new THREE.PointsMaterial({
        size: RINGS.sizePx,
        sizeAttenuation: true,
        color: RINGS.color,
        transparent: true,
        opacity: RINGS.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    particleCloud = new THREE.Points(particleGeo, particleMat);
    particleCloud.rotation.x = THREE.MathUtils.degToRad(particleCloudTilt); // tilt the rings around X axis
    particleCloud.position.y = particleCloudHeight; // translate the rings up above the skull

    scene.add(particleCloud);
}

// Build once (re-run if you tweak RINGS)
buildRingParticles();




// ----------- STAR FIELD PARTICLE CLOUD -----------

function addStarField() {
  const {
    planeZ,
    nrOfBranches, branchPoints,
    stepSizeInit, stepSizeDecay, startOffset, biasStrength,
    extraStars, extraSpreadX, extraSpreadY,
    sizePx, color, opacity,
    tiltX, offsetY
  } = STARFIELD;

  const totalStars = branchPoints * nrOfBranches + extraStars;
  const positions = new Float32Array(totalStars * 3);
  let idx = 0;

  // random walk branches
  for (let b = 0; b < nrOfBranches; b++) {
    let stepSize = stepSizeInit * Math.pow(stepSizeDecay, b);
    let start_point = new THREE.Vector3(
      (Math.random() * 2 - 1) * startOffset,
      (Math.random() * 2 - 1) * startOffset,
      planeZ
    );

    // alternating bias (up vs down)
    const biasUp = (b % 2) * biasStrength / Math.sqrt(b + 1);
    const biasDown = -((b + 1) % 2) * biasStrength / Math.sqrt(b + 1);

    for (let i = 0; i < branchPoints; i++) {
      const rand_vec = new THREE.Vector3(
        (Math.random() * 2 - 1) * stepSize,
        (Math.random() * 2 - 1) * stepSize +
          (Math.random() < 0.5 ? biasUp : biasDown),
        0
      );
      start_point.add(rand_vec);

      positions[idx++] = start_point.x;
      positions[idx++] = start_point.y;
      positions[idx++] = start_point.z;
    }
  }

  // sprinkle extra random stars
  for (let i = 0; i < extraStars; i++) {
    positions[idx++] = (Math.random() - 0.5) * extraSpreadX;
    positions[idx++] = (Math.random() - 0.5) * extraSpreadY;
    positions[idx++] = planeZ;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const starMat = new THREE.PointsMaterial({
    size: sizePx,
    sizeAttenuation: true,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const starField = new THREE.Points(starGeo, starMat);

  // tilt & translate
  starField.rotation.x = tiltX;
  starField.position.y = offsetY;

  scene.add(starField);
}


addStarField();



// ---------- Resize handling ----------
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    renderer.setSize(w, h);

    // bloom composer + pass
    bloomComposer.setSize(w, h);
    bloomPass.setSize(w, h); // helps some versions/drivers

    quantizePass.uniforms.screenSize.value.set(w, h);

});




// ---------- SCREENSHOT KEY ("s") ----------
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 's') {
        // 1) Force a render of the final pass to screen
        renderer.setRenderTarget(null);
        bloomComposer.render();   // run bloom pipeline

        // 2) Then capture
        const dataURL = renderer.domElement.toDataURL('image/png');

        // 3) Build filename
        const rand = Math.floor(Math.random() * 1000000);
        const filename = `skullshot_${rand}.png`;

        // 4) Trigger download
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = filename;
        link.click();
    }
});




// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const t = clock.getElapsedTime();
    quantizePass.uniforms.uTime.value = t; // advance animated grain


    // ---------- HEAD ORIENTATION ----------
    if (head) {
        const idleX = idle.ampX * Math.sin(t * idle.speedX * Math.PI * 2.0);
        const idleY = idle.ampY * Math.sin(t * idle.speedY * Math.PI * 2.0 + Math.PI / 3);

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

        head.rotation.x += (targetX - head.rotation.x) * lerp;
        head.rotation.y += (targetY - head.rotation.y) * lerp;
    }

    // ---------- JAW ANIMATION ----------
    if (jaw) {
        if (!mouseInWindow) {
            targetJawOpen = 0;
            nextJawEvent = t + 0.4;
        } else {
            if (t > nextJawEvent) {
                if (targetJawOpen === 0) {
                    targetJawOpen = 1; // open
                    nextJawEvent = t + THREE.MathUtils.randFloat(0.5, 1.5);
                } else {
                    targetJawOpen = 0; // close
                    nextJawEvent = t + THREE.MathUtils.randFloat(2.0, 5.0);
                }
            }
        }

        jawOpen += (targetJawOpen - jawOpen) * 0.05;
        const maxOpen = THREE.MathUtils.degToRad(28);

        const openFactor = (mouseInWindow)
            ? THREE.MathUtils.smoothstep(jawOpen, 0.05, 0.30)
            : 0.0;
        const idleAmp = THREE.MathUtils.degToRad(mouseInWindow ? 0.5 : 0.0) * openFactor;
        const idleSpeed = 2.2;
        const idleOffset = idleAmp * Math.sin(t * idleSpeed * Math.PI * 2.0);

        const angle = (jawOpen * maxOpen) + idleOffset;
        jaw.rotation.x = angle;
    }

    // ---------- PARTICLE ANIMATION ----------
    if (particleCloud) {
        particleCloud.rotation.y += 0.001; // slow spin around vertical axis
    }


    controls.update();


    // ---------- POST-PROCESSING PIPELINE ----------

    // render the chain: RenderPass → UnrealBloomPass → QuantizeDitherShader (to screen)
    bloomComposer.render();

}



animate();
