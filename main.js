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

const MAX_COLORS = 32; // for use in quantization shader

const materialOptions = {
  type: 'Normal', // default
};


const clock = new THREE.Clock();




// --- Blue-noise texture (tiling) ---
const noiseTex = new THREE.TextureLoader().load('HDR_L_15.png', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
});




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

// Lighting
//const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
//scene.add(hemiLight);

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



// this will traverse both skull + jaw meshes and swap their material when we switch from GUI

function updateMaterial() {
  let mat;
  switch (materialOptions.type) {
    case 'Lambert':
      mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      break;
    case 'Normal':
    default:
      mat = new THREE.MeshNormalMaterial();
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




// DOM container for the GUI elements - top-right
/*const guiWrap = document.createElement('div');
guiWrap.style.position = 'absolute';
guiWrap.style.top = '10px';
guiWrap.style.right = '10px';
guiWrap.style.padding = '8px';
guiWrap.style.background = 'rgba(0,0,0,0.4)';
guiWrap.style.borderRadius = '6px';
guiWrap.style.zIndex = '10';
document.body.appendChild(guiWrap);
*/

// Create one container for all GUI controls
const guiWrap = document.createElement('div');
guiWrap.id = 'gui-container';
document.body.appendChild(guiWrap);



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


function makeMaterialGUI(defaultKey = 'Normal') {
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
makeMaterialGUI('Normal'); // init materials GUI






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
