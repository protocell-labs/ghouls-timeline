// MODULE IMPORTS

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { GLTFLoader } from 'GLTFLoader';
import { EffectComposer } from 'EffectComposer';
import { RenderPass } from 'RenderPass';
import { UnrealBloomPass } from 'UnrealBloomPass';
import { ShaderPass } from 'ShaderPass';



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

let bloomStrength = 1.0;
let bloomRadius = 0.1;
let bloomThreshold = 0.70;






// --- Blue-noise texture (tiling) ---
const noiseTex = new THREE.TextureLoader().load('HDR_L_15.png', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
});







// PALETTES - colors in the scene will be "snapped" to the closest of these

// 🎮 CGA 8-color (IBM PC, 1981)
const palette_cga8 = [
    '#000000', // black
    '#55ffff', // cyan
    '#ff55ff', // magenta
    '#ffffff', // white
    '#555555', // dark gray
    '#55ff55', // green
    '#ff5555', // red
    '#ffff55'  // yellow
];

// 🕹️ Commodore 64 base colors
const palette_c64 = [
    '#000000', // black
    '#ffffff', // white
    '#880000', // red
    '#aaffee', // cyan
    '#cc44cc', // purple
    '#00cc55', // green
    '#0000aa', // blue
    '#eeee77'  // yellow
];

// 📺 Game Boy 4-tone monochrome (pea-soup LCD)
const palette_gameboy = [
    '#0f380f', // darkest green
    '#306230', // dark green
    '#8bac0f', // light green
    '#9bbc0f'  // lightest green
];

// 🌈 ZX Spectrum bright set
const palette_zx_spectrum = [
    '#000000', // black
    '#ff0000', // bright red
    '#00ff00', // bright green
    '#0000ff', // bright blue
    '#ffff00', // bright yellow
    '#ff00ff', // bright magenta
    '#00ffff', // bright cyan
    '#ffffff'  // white
];

// 🖥️ Windows / EGA 16-color cutdown
const palette_ega8 = [
    '#000000', // black
    '#800000', // maroon
    '#008000', // green
    '#808000', // olive
    '#000080', // navy
    '#800080', // purple
    '#008080', // teal
    '#c0c0c0'  // silver
];

// 🎨 VGA 16-color (standard DOS palette)
const palette_vga16 = [
    '#000000', // black
    '#0000AA', // blue
    '#00AA00', // green
    '#00AAAA', // cyan
    '#AA0000', // red
    '#AA00AA', // magenta
    '#AA5500', // brown
    '#AAAAAA', // light gray
    '#555555', // dark gray
    '#5555FF', // bright blue
    '#55FF55', // bright green
    '#55FFFF', // bright cyan
    '#FF5555', // bright red
    '#FF55FF', // bright magenta
    '#FFFF55', // bright yellow
    '#FFFFFF'  // white
];

// 🕹️ Commodore 64 full 16-color palette
const palette_c64_16 = [
    '#000000', // black
    '#FFFFFF', // white
    '#880000', // red
    '#AAFFEE', // cyan
    '#CC44CC', // purple
    '#00CC55', // green
    '#0000AA', // blue
    '#EEEE77', // yellow
    '#DD8855', // orange
    '#664400', // brown
    '#FF7777', // light red
    '#333333', // dark gray
    '#777777', // medium gray
    '#AAFF66', // light green
    '#0088FF', // light blue
    '#BBBBBB'  // light gray
];

// 🌈 ZX Spectrum 16-color (bright + normal versions)
const palette_zx_spectrum16 = [
    '#000000', // black
    '#0000D7', // blue
    '#D70000', // red
    '#D700D7', // magenta
    '#00D700', // green
    '#00D7D7', // cyan
    '#D7D700', // yellow
    '#D7D7D7', // white (bright gray)
    '#000000', // black (bright duplicate)
    '#0000FF', // bright blue
    '#FF0000', // bright red
    '#FF00FF', // bright magenta
    '#00FF00', // bright green
    '#00FFFF', // bright cyan
    '#FFFF00', // bright yellow
    '#FFFFFF'  // bright white
];

// 🖥️ EGA 16-color (classic PC graphics)
const palette_ega16 = [
    '#000000', // black
    '#0000AA', // blue
    '#00AA00', // green
    '#00AAAA', // cyan
    '#AA0000', // red
    '#AA00AA', // magenta
    '#AA5500', // brown
    '#AAAAAA', // light gray
    '#555555', // dark gray
    '#5555FF', // bright blue
    '#55FF55', // bright green
    '#55FFFF', // bright cyan
    '#FF5555', // bright red
    '#FF55FF', // bright magenta
    '#FFFF55', // bright yellow
    '#FFFFFF'  // white
];

// 🟢 Game Boy 16-color (expanded pea-soup)
const palette_gameboy16 = [
    '#0f380f', '#183c16', '#306230', '#467d47',
    '#5b985c', '#72b273', '#89cd8a', '#a1e5a2',
    '#0c280c', '#204620', '#397239', '#4e8d4e',
    '#66a766', '#7dc07d', '#94d894', '#b2f0b2'
];

// 🟤 LCARS Style (Star Trek UI color scheme)
const palette_lcars = [
    '#000000', '#ff9966', '#ffcc66', '#ff6699',
    '#cc66ff', '#9966ff', '#6699ff', '#66ccff',
    '#66ffcc', '#66ff99', '#99ff66', '#ccff66',
    '#ffcc99', '#ff99cc', '#ff66cc', '#ffffff'
];

// 🟠 Retro EVA / Magi System (inspired by Neon Genesis Evangelion HUDs)
const palette_eva = [
    '#000000', '#ff3300', '#ff6600', '#ff9900',
    '#ffcc00', '#ffff00', '#00ffcc', '#00ffff',
    '#00ccff', '#0099ff', '#0066ff', '#0033ff',
    '#ff0033', '#ff0066', '#ff0099', '#ffffff'
];

// 🟢 Classic Monochrome Green CRT (8 shades)
const palette_green_mono = [
    '#000000', '#003300', '#006600', '#00aa00',
    '#00cc00', '#00ff00', '#aaffaa', '#ffffff'
];

// 🟡 Amber Monochrome CRT (8 shades)
const palette_amber_mono = [
    '#000000', '#331900', '#663300', '#ff5c00',
    '#cc6600', '#ffaa55', '#ffd4aa', '#ffffff'
];

// 🟣 Magenta / Pink Monochrome (8 shades)
const palette_magenta_mono = [
    '#000000', '#330033', '#660066', '#990099',
    '#cc00cc', '#ff00ff', '#ff99ff', '#ffffff'
];


// register palette names so we can select them from a menu
const PALETTES = {
    'CGA 8': palette_cga8,
    'VGA 16': palette_vga16,

    'C64 8': palette_c64,
    'C64 16': palette_c64_16,

    'Game Boy 4': palette_gameboy,
    'Game Boy 16': palette_gameboy16,

    'ZX Spectrum 8': palette_zx_spectrum,
    'ZX Spectrum 16': palette_zx_spectrum16,

    'EGA 8': palette_ega8,
    'EGA 16': palette_ega16,

    'LCARS': palette_lcars,
    'EVA HUD': palette_eva,

    'Green Mono 8': palette_green_mono,
    'Amber Mono 8': palette_amber_mono,
    'Magenta Mono 8': palette_magenta_mono,
};




const clock = new THREE.Clock();


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
camera.position.set(0, 0, 300); // (0, 1, 3)

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lighting (optional)
const light = new THREE.HemisphereLight(0xffffff, 0x444444);
scene.add(light);




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
            loader.loadAsync('skull_model_01_06_skull.glb'),
            loader.loadAsync('skull_model_01_06_jaw.glb'),
        ]);

        // Base halves
        skull = skullGltf.scene;
        jaw = jawGltf.scene;

        // Apply Normal material (DoubleSide so geometry draws correctly)
        [skull, jaw].forEach((obj) => {
            obj.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
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







// A tiny post scene with an orthographic camera and a full-screen quad
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);




const MAX_COLORS = 32;

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





function makePaletteGUI(defaultKey = 'CGA 8') {
    const wrap = document.createElement('div');
    wrap.id = 'palette-gui';
    wrap.innerHTML = `
    <label style="display:block;font:12px/1 system-ui, sans-serif;margin-bottom:6px;color:#ddd">
      PALETTE
    </label>
  `;
    const select = document.createElement('select');
    for (const name of Object.keys(PALETTES)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    }
    select.value = defaultKey;
    wrap.appendChild(select);
    document.body.appendChild(wrap);

    // apply initial palette
    setPalette(PALETTES[select.value]);

    // change handler
    select.addEventListener('change', () => {
        setPalette(PALETTES[select.value]);
    });
}

// sets default palette at random
makePaletteGUI(Object.keys(PALETTES)[Math.floor(Math.random() * Object.keys(PALETTES).length)]); // manual override - makePaletteGUI('ZX Spectrum 8');





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
    bloomPass.resolution.set(w, h);

    quantizePass.uniforms.screenSize.value.set(w, h);

});




// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const t = clock.getElapsedTime();
    quantizePass.uniforms.uTime.value = t; // advance animated grain
    //postMaterial.uniforms.uTime.value = t; // advance animated grain


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

    controls.update();


    // ---------- POST-PROCESSING PIPELINE ----------

    // render the chain: RenderPass → UnrealBloomPass → QuantizeDitherShader (to screen)
    bloomComposer.render();

}



animate();
