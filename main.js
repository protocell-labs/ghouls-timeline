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

let skull, jaw, torso;
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

let particleCloudTilt = 0; // tilt the rings around X axis in degrees, 25
let particleCloudHeight = 75 // translate the rings up above the skull

// --- starfield (GPU animated) ---
let starField = null;
let starGeo = null;
let starMat = null;

let cameraPosition = { // camera position (X - horizontal, Y - height, Z - depth)
    x: -100, // 0
    y: -400, // -150
    z: 400 // 250
};
let cameraTarget = { // look-at point (X - horizontal, Y - height, Z - depth)
    x: 0, // 0
    y: 0, // 75
    z: 0 // 0
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
    ringCount: 20, // 20
    pointsPerRing: 1000, // 2000
    baseRadius: 50,
    ringSpacing: 25,
    ringSpacingNonLin: 1.2, // 1.2

    // Gaussian grit
    radialSigma: 1.0, // 2.0
    radialSigmaNonLin: 1.1, // will be multiplied by idx in shader - 1.1
    verticalSigma: 1.0, // 1.0
    verticalSigmaNonLin: 1.0, // NEW: extra fuzz scaling with idx - 0.35

    // Perlin controls
    noiseRadialAmp: 5.0, // how strong distortions are radially - 5.0
    noiseVerticalAmp: 5.0, // how strong distortions are vertically - 3.0
    noiseThetaFreq: 1.0, // how detailed distortions are around the circle - 2.75
    noiseRingFreqU: 0.22, // whether rings share the same distortions or gradually drift - 0.22
    noiseRingFreqV: 0.31, // whether rings share the same distortions or gradually drift - 0.31
    noiseOffsetU: Math.random() * 1000.0, // random “starting point” in the noise space, avoids repetition
    noiseOffsetV: Math.random() * 1000.0, // random “starting point” in the noise space, avoids repetition

    // global time-based drift (noise-space units per second)
    noiseDriftU: 0.5,   // drift along the U axis of the noise field - 0.05
    noiseDriftV: 0.3,   // drift along the V axis of the noise field - 0.03

    // phase
    ringPhaseStep: 0.17,

    // appearance
    sizePx: 5 * window.devicePixelRatio, // 6 * window.devicePixelRatio
    color: 0xffffff,
    opacity: 0.5, // 0.85

    // glitch / birth
    birthWidth: 1.5, // 2.0
    segments: 40.0,
    glitchSpeed: 100.0, // 3.0
    glitchIntensity: 0.85
};



// ----------- STARFIELD PARAMETERS -----------
const STARFIELD = {
    planeZ: -250,          // z coordinate of the star plane

    // random walk branches
    nrOfBranches: 200,       // number of random walk branches - 200
    branchPoints: 1500,     // stars in each branch - 3000
    stepSizeInit: 30.0,      // initial step size per branch - 30.0
    stepSizeDecay: 0.975,    // step size shrink factor for each branch - 0.95, 0.975
    startOffsetX: 600,       // starting X offset range - 750
    startOffsetY: 350,       // starting Y offset range - 400
    biasStrength: 3.0,      // vertical bias strength (smearing upward) - 0.75, 0.2

    // GPU animation controls
    trailSpeed: 0.15,     // how fast a “lit window” travels along each branch (0..1 steps/sec)
    trailWidth: 0.5,     // size of the lit window along the branch (0..1)
    glitchIntensity: 0.85,// 0 = no gating, 1 = heavy gating
    glitchSegments: 36.0, // angular wedges for gating (XY plane)
    glitchSpeed: 100.0,     // how fast segments update - 2.0
    blinkSpeed: 8.0,      // per-star stochastic flicker speed
    jitterAmp: 0.75,      // subtle per-frame position jitter
    driftX: 0.0,          // constant plane drift (pixels/sec in world units)
    driftY: 0.0,

    // extra stars (uniform random distribution)
    extraStars: 0, // 2500
    extraSpreadX: 2500,
    extraSpreadY: 1500,

    // appearance
    sizePx: 4 * window.devicePixelRatio, // 3 * window.devicePixelRatio
    color: 0x808080, // 0x00ccff - EVA HUD light blue
    opacity: 0.5, // 0.85, 0.5, 0.75

    // transform (optional tilt/shift)
    tiltX: THREE.MathUtils.degToRad(45), // 25
    tiltY: THREE.MathUtils.degToRad(-16),
    offsetX: -100, //
    offsetY: -425 // 250
};




// Gaussian helper
function randNormal(mean = 0, sigma = 1) {
    let u = 1 - Math.random(), v = 1 - Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + sigma * z;
}


// helper function for calculating random-walk branch length in the starfield
function branchLength(b, nrOfBranches, branchPoints) {
    // Example: linearly scale from 50% to 150% of branchPoints
    const factor = 0.5 + (b / (nrOfBranches - 1));
    return Math.floor(branchPoints * factor);
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
        const [skullGltf, jawGltf, torsoGltf] = await Promise.all([
            loader.loadAsync('assets/skull_model_01_06_skull.glb'),
            loader.loadAsync('assets/skull_model_01_06_jaw.glb'),
            loader.loadAsync('assets/skull_jaw_torso_01.glb')
        ]);

        skull = skullGltf.scene;
        jaw = jawGltf.scene;
        torso = torsoGltf.scene;

        // Apply material
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

        // Attach jaw under skull
        skull.add(jaw);

        // Add skull + torso to main head group
        head.add(skull);
        head.add(torso);

        console.log('Head parts loaded: skull + jaw + torso (hierarchy applied)');
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
    const total = RINGS.ringCount * RINGS.pointsPerRing;
    const positions = new Float32Array(total * 3);
    const ringIndex = new Float32Array(total);

    let idx = 0;
    for (let r = 0; r < RINGS.ringCount; r++) {
        for (let j = 0; j < RINGS.pointsPerRing; j++) {
            const theta = (j / RINGS.pointsPerRing) * Math.PI * 2.0;
            positions[idx * 3 + 0] = Math.cos(theta); // unit circle
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

            // motion
            uBaseRadius: { value: RINGS.baseRadius },
            uSpacing: { value: RINGS.ringSpacing },
            uSpacingNonLin: { value: RINGS.ringSpacingNonLin },
            uRingCount: { value: RINGS.ringCount },
            uSpeed: { value: 10.0 },

            // Gaussian grit
            uRadialSigma: { value: RINGS.radialSigma },
            uRadialSigmaNonLin: { value: RINGS.radialSigmaNonLin },
            uVerticalSigma: { value: RINGS.verticalSigma },
            uVerticalSigmaNonLin: { value: RINGS.verticalSigmaNonLin },

            // Perlin noise
            uNoiseRadialAmp: { value: RINGS.noiseRadialAmp },
            uNoiseVerticalAmp: { value: RINGS.noiseVerticalAmp },
            uNoiseThetaFreq: { value: RINGS.noiseThetaFreq },
            uNoiseRingFreqU: { value: RINGS.noiseRingFreqU },
            uNoiseRingFreqV: { value: RINGS.noiseRingFreqV },
            uNoiseOffsetU: { value: RINGS.noiseOffsetU },
            uNoiseOffsetV: { value: RINGS.noiseOffsetV },
            uNoiseDriftU: { value: RINGS.noiseDriftU },
            uNoiseDriftV: { value: RINGS.noiseDriftV },

            // phase
            uRingPhaseStep: { value: RINGS.ringPhaseStep },

            // glitch
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

      // --- Simplex noise (GLSL1, 2D) ---
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

        // birth factor
        float d0 = min(idx, uRingCount - idx);
        vBirth = smoothstep(0.0, max(0.0001,uBirthWidth), d0);

        // spacing
        float radial = uBaseRadius + idx*uSpacing + pow(idx,1.0+uSpacingNonLin);

        // angle
        float ang = atan(position.z, position.x) + ringIndex*uRingPhaseStep;
        vAng = ang;

        // Gaussian grit with non-linear scaling
        float rSigma = uRadialSigma + idx*uRadialSigmaNonLin;
        radial += gaussJitter(vec2(ang,idx)) * rSigma;

        float vSigma = uVerticalSigma + idx*uVerticalSigmaNonLin;
        float y = gaussJitter(vec2(idx,ang)) * vSigma;

        // Periodic Perlin (θ mapped to cos/sin) with ring drift + offsets + TIME DRIFT
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

        // glitch segmentation
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
    scene.add(particleCloud);
}


// Build once (re-run if you tweak RINGS)
buildRingParticles();




// ----------- STAR FIELD PARTICLE CLOUD -----------

function addStarField() {
    const {
        planeZ,
        nrOfBranches, branchPoints,
        stepSizeInit, stepSizeDecay, startOffsetX, startOffsetY, biasStrength,
        extraStars, extraSpreadX, extraSpreadY,
        sizePx, color, opacity,
        tiltX, tiltY, offsetX, offsetY,

        // NEW animation controls
        trailSpeed, trailWidth,
        glitchIntensity, glitchSegments, glitchSpeed,
        blinkSpeed, jitterAmp,
        driftX, driftY
    } = STARFIELD;

    // 1) compute total number of branch stars (variable branch lengths)
    let perBranchCounts = new Array(nrOfBranches);
    let totalBranchStars = 0;
    for (let b = 0; b < nrOfBranches; b++) {
        const steps = branchLength(b, nrOfBranches, branchPoints);
        perBranchCounts[b] = steps;
        totalBranchStars += steps;
    }
    const totalStars = totalBranchStars + extraStars;

    // 2) allocate attributes
    const positions = new Float32Array(totalStars * 3);
    const aBranch = new Float32Array(totalStars); // branch id
    const aT = new Float32Array(totalStars); // 0..1 along branch
    const aSeed = new Float32Array(totalStars); // per-point seed (for flicker/jitter)

    // 3) fill branches (same biased random walk as before)
    let idx = 0;
    for (let b = 0; b < nrOfBranches; b++) {
        const steps = perBranchCounts[b];
        let stepSize = stepSizeInit * Math.pow(stepSizeDecay, b);
        let p = new THREE.Vector3(
            (Math.random() * 2 - 1) * startOffsetX,
            (Math.random() * 2 - 1) * startOffsetY,
            planeZ
        );

        //const biasUp = (b % 2) * biasStrength / Math.sqrt(b + 1);
        //const biasDown = -((b + 1) % 2) * biasStrength / Math.sqrt(b + 1);
        const bias = STARFIELD.biasStrength / Math.sqrt(b + 1);

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
            aT[idx] = steps > 1 ? (i / (steps - 1)) : 0.0;   // normalized position along branch
            aSeed[idx] = Math.random() * 1000.0;                // random seed
            idx++;
        }
    }

    // 4) sprinkle extra random stars (treated as branch = -1 → optional gating)
    for (let i = 0; i < extraStars; i++) {
        positions[3 * idx + 0] = (Math.random() - 0.5) * extraSpreadX;
        positions[3 * idx + 1] = (Math.random() - 0.5) * extraSpreadY;
        positions[3 * idx + 2] = planeZ;

        aBranch[idx] = -1.0;        // specials
        aT[idx] = Math.random();
        aSeed[idx] = Math.random() * 1000.0;
        idx++;
    }

    // 5) geometry + shader material
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

            // glitching & sweep
            uTrailSpeed: { value: trailSpeed },
            uTrailWidth: { value: trailWidth },
            uGlitchIntensity: { value: glitchIntensity },
            uGlitchSegments: { value: glitchSegments },
            uGlitchSpeed: { value: glitchSpeed },
            uBlinkSpeed: { value: blinkSpeed },

            // small motion
            uJitterAmp: { value: jitterAmp },
            uDrift: { value: new THREE.Vector2(driftX, driftY) }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`
        attribute float aBranch;   // branch id (-1 for extra stars)
        attribute float aT;        // 0..1 position along branch
        attribute float aSeed;     // per-point random seed

        uniform float uTime;
        uniform float uSize;
        uniform float uJitterAmp;

        // trail controls
        uniform float uTrailSpeed;   // how fast the head travels
        uniform float uTrailWidth;   // trail length as fraction of [0..1] (0.05..0.3 works well)

        // (optional drift kept but set to 0 via uniforms)
        uniform vec2  uDrift;

        varying float vVis;   // visibility/tail fade to fragment

        float hash(float x){ return fract(sin(x*12.9898)*43758.5453); }

        void main() {
        vec3 pos = position;

        // (optional) plane drift – set uniforms to 0 to disable
        pos.x += uDrift.x * uTime;
        pos.y += uDrift.y * uTime;

        // tiny per-frame jitter (sparkle)
        float jx = (hash(aSeed + floor(uTime*37.0)) - 0.5) * uJitterAmp;
        float jy = (hash(aSeed + floor(uTime*29.0) + 7.0) - 0.5) * uJitterAmp;
        pos.x += jx;
        pos.y += jy;

        // ---- moving HEAD/TAIL along branch (non-wrapping look) ----
        // Head advances in [0,1) with a per-branch phase.
        float branchPhase = hash(aBranch + 13.37);
        float head = fract(uTime * uTrailSpeed + branchPhase);

        // forward distance from this point to the head, wrapping on [0,1)
        float forward = head - aT;
        if (forward < 0.0) forward += 1.0; // wrap so 0 = head, 1 = just behind tail

        // inside trail if forward ∈ [0, uTrailWidth]
        float inside = 1.0 - step(uTrailWidth, forward);

        // soft fade near the tail (so points "decay" as they leave the head)
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

        // angular segmentation for glitch gating (optional stylistic effect)
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

    // ---------- ORIENTATION SPLIT ----------
    // Keep the container neutral so torso doesn't inherit mouse-follow
    if (head) head.rotation.set(0, 0, 0);

    // Shared idle sway
    const idleX = idle.ampX * Math.sin(t * idle.speedX * Math.PI * 2.0);
    const idleY = idle.ampY * Math.sin(t * idle.speedY * Math.PI * 2.0 + Math.PI / 3);

    // ---------- SKULL (+jaw via hierarchy) follows mouse + idle/reset ----------
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

    // ---------- TORSO: wobble only (no mouse-follow) ----------
    if (torso) {
        const torsoLerp = 0.05; // gentle smoothing for torso wobble
        torso.rotation.x += (idleX - torso.rotation.x) * torsoLerp;
        torso.rotation.y += (idleY - torso.rotation.y) * torsoLerp;
    }


    // ---------- JAW ANIMATION (random only when mouse inside; closed when outside) ----------
    if (jaw) {
        // If mouse is outside, force closed and push next event a bit
        if (!mouseInWindow) {
            targetJawOpen = 0;
            nextJawEvent = t + 0.4;
        } else {
            // Mouse inside: allow random open/close timing
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

        // Smooth jaw openness toward target (0..1)
        jawOpen += (targetJawOpen - jawOpen) * 0.05;

        const maxOpen = THREE.MathUtils.degToRad(28);

        // No idle chatter when closed OR when mouse is outside
        const openFactor = (mouseInWindow) ? THREE.MathUtils.smoothstep(jawOpen, 0.05, 0.30) : 0.0;
        const idleAmp = THREE.MathUtils.degToRad(mouseInWindow ? 0.5 : 0.0) * openFactor;
        const idleSpeed = 2.2;
        const idleOffset = idleAmp * Math.sin(t * idleSpeed * Math.PI * 2.0);

        // Final hinge angle (relative to skull)
        const angle = (jawOpen * maxOpen) + idleOffset;
        jaw.rotation.x = angle;
    }


    // ---------- PARTICLE ANIMATION ----------
    if (particleCloud) {
        particleCloud.rotation.y += 0.001; // keep gentle rotation
        particleCloud.material.uniforms.uTime.value = t;
    }

    // ---------- STARFIELD ANIMATION ----------
    if (starMat) {
        starMat.uniforms.uTime.value = t;
    }




    controls.update();


    // ---------- POST-PROCESSING PIPELINE ----------

    // render the chain: RenderPass → UnrealBloomPass → QuantizeDitherShader (to screen)
    bloomComposer.render();

}



animate();
