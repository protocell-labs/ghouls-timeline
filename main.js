import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { GLTFLoader } from 'GLTFLoader';




let model = null; // holds the loaded skull
const mouse = { x: 0, y: 0 };          // current mouse position in NDC
const targetRotation = { x: 0, y: 0 }; // desired model rotation based on mouse
const rotationLerpSpeed = 0.05;        // controls how fast the skull follows (0.01 = slow, 1 = instant)
let mouseInWindow = true; // checks if the mouse is inside the window
let resetTimer = null; // timer for the skull rotation reset when the mouse leaves the screen
let shouldReset = false; // trigger for the skull rotation reset when the mouse leaves the screen
let pxFactor = 3; // ↑ bigger = chunkier pixels (try 3–8)


let jawOpen = 0;          // smoothed value (0 closed .. 1 open)
let targetJawOpen = 0;    // current target
let nextJawEvent = 0;     // time until we change state again
let skull, jaw, skullMirror, jawMirror;


export function setJawOpen01(v) {
    targetJawOpen = THREE.MathUtils.clamp(v, 0, 1);
}



// Choose your own colors here (hex). Examples:
const userPalette = [
    '#0b0b0b', '#1b1b3a', '#6930c3', '#80ffdb',
    '#48bfe3', '#64dfdf', '#ffd166', '#ef476f',
    '#f8f9fa', '#06d6a0', '#118ab2', '#073b4c'
];



const clock = new THREE.Clock();

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



window.addEventListener('mousemove', (event) => {
    // Convert to normalized device coordinates [-1, 1]
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    const maxRotation = Math.PI / 6; // 30 degrees
    targetRotation.x = -mouse.y * maxRotation; // <-- Y is inverted - up-down mouse tracking
    targetRotation.y = mouse.x * maxRotation;
});




document.body.addEventListener('mouseenter', () => {
    // console.log('🟢 enter');
    mouseInWindow = true;
    shouldReset = false;
    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
});

document.body.addEventListener('mouseleave', () => {
    // console.log('🔴 leave');
    mouseInWindow = false;
    scheduleReset(500); // delay before reset starts
});



// helper
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




// Extra robustness (optional):
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




// ---------- Pixelation: render-to-texture setup ----------
let rt = makeRenderTarget(window.innerWidth, window.innerHeight, pxFactor);



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





// Load GLB model
const loader = new GLTFLoader();

// Parent group to move/rotate/scale the whole head together
const head = new THREE.Group();
scene.add(head);


(async function loadHeadParts() {
    try {
        const [skullGltf, jawGltf] = await Promise.all([
            loader.loadAsync('skull_model_01_05_skull.glb'),
            loader.loadAsync('skull_model_01_05_jaw.glb'),
        ]);

        // Base halves
        skull = skullGltf.scene;
        jaw = jawGltf.scene;

        // Apply Normal material (DoubleSide so mirrored geometry draws correctly)
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

        // ----- Mirror across YZ plane (flip X) -----
        skullMirror = skull.clone();
        skullMirror.scale.x *= -1;

        jawMirror = jaw.clone();
        jawMirror.scale.x *= -1;

        // Add all to the head group
        head.add(skull);
        head.add(skullMirror);
        head.add(jaw);
        head.add(jawMirror);

        console.log('Head parts loaded: skull + mirrored, jaw + mirrored');

    } catch (e) {
        console.error('Error loading head parts:', e);
    }
})();




// A tiny post scene with an orthographic camera and a full-screen quad
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);



// palette-quantizing shader
const MAX_COLORS = 32; // safe upper bound for WebGL1/2
const postMaterial = new THREE.ShaderMaterial({
    uniforms: {
        tDiffuse: { value: rt.texture },
        palette: { value: new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0)) },
        paletteSize: { value: 0 }
    },
    vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
    fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec3 palette[${MAX_COLORS}];
    uniform int paletteSize;
    varying vec2 vUv;

    // Optional: convert to perceptual-ish space before distance.
    // For simplicity, plain linear RGB distance works and is fast.

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      float bestDist = 1e9;
      vec3  best = c;

      for (int i = 0; i < ${MAX_COLORS}; i++) {
        if (i >= paletteSize) break;
        vec3 p = palette[i];
        // Euclidean distance in linear RGB:
        vec3 d = c - p;
        float dist = dot(d, d);
        if (dist < bestDist) { bestDist = dist; best = p; }
      }

      gl_FragColor = vec4(best, 1.0);
    }
  `,
    depthTest: false,
    depthWrite: false
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));



// If your renderer/outputEncoding is left as default (linear), we can pass linear values.
// If you ever set sRGB encoding on the renderer or target, convert accordingly.
function hexToLinearVec3(hex) {
    const c = new THREE.Color(hex); // THREE.Color stores linear values by default in r,g,b (0–1)
    return new THREE.Vector3(c.r, c.g, c.b);
}

function setPalette(hexArray) {
    const size = Math.min(hexArray.length, MAX_COLORS);
    const vecs = new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0));

    for (let i = 0; i < size; i++) vecs[i] = hexToLinearVec3(hexArray[i]);

    // Important: assign a fresh array so Three uploads the uniform array properly
    postMaterial.uniforms.palette.value = vecs;
    postMaterial.uniforms.paletteSize.value = size;
}

// Call once after creating postMaterial (or anytime you change colors):
setPalette(userPalette);




// Helper to build a low-res render target with nearest upscaling
function makeRenderTarget(w, h, factor) {
    const rtW = Math.max(1, Math.floor(w / factor));
    const rtH = Math.max(1, Math.floor(h / factor));
    const target = new THREE.WebGLRenderTarget(rtW, rtH, {
        minFilter: THREE.LinearFilter,     // low-res sampling
        magFilter: THREE.NearestFilter,    // chunky pixel look
        format: THREE.RGBAFormat,
        depthBuffer: true,
        stencilBuffer: false
    });
    target.texture.generateMipmaps = false; // keeps pixels clean
    return target;
}






// ---------- Resize handling ----------
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);

    // Rebuild low-res target to match new size
    rt.dispose();
    rt = makeRenderTarget(w, h, pxFactor);
    postMaterial.uniforms.tDiffuse.value = rt.texture;
});



// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const t = clock.getElapsedTime();

    // ---------- HEAD ORIENTATION (mouse tracking + idle + reset) ----------
    if (head) {
        // tiny “alive” sway
        const idleX = idle.ampX * Math.sin(t * idle.speedX * Math.PI * 2.0);
        const idleY = idle.ampY * Math.sin(t * idle.speedY * Math.PI * 2.0 + Math.PI / 3);

        let targetX, targetY, lerp;
        if (mouseInWindow) {
            targetX = targetRotation.x + idleX;
            targetY = targetRotation.y + idleY;
            lerp = trackLerp;
        } else if (!shouldReset) {
            // during delay: keep drifting toward last target
            targetX = targetRotation.x + idleX;
            targetY = targetRotation.y + idleY;
            lerp = outLerp;
        } else {
            // reset toward center, still breathing
            targetX = idleX;
            targetY = idleY;
            lerp = resetLerp;
        }

        head.rotation.x += (targetX - head.rotation.x) * lerp;
        head.rotation.y += (targetY - head.rotation.y) * lerp;
    }

    // ---------- JAW ANIMATION (random only when mouse inside; closed when outside) ----------
    if (jaw && jawMirror) {
        // If mouse is outside, force closed and push next event a bit
        if (!mouseInWindow) {
            targetJawOpen = 0;                 // force closed
            nextJawEvent = t + 0.4;            // small buffer so it doesn't pop open instantly on re-enter
        } else {
            // Mouse inside: allow random open/close timing
            if (t > nextJawEvent) {
                if (targetJawOpen === 0) {
                    targetJawOpen = 1; // open
                    nextJawEvent = t + THREE.MathUtils.randFloat(0.5, 1.5); // open duration
                } else {
                    targetJawOpen = 0; // close
                    nextJawEvent = t + THREE.MathUtils.randFloat(2.0, 5.0); // closed duration
                }
            }
        }

        // Smooth jaw openness toward target (0..1)
        jawOpen += (targetJawOpen - jawOpen) * 0.05;

        // Max opening angle (tweak to taste)
        const maxOpen = THREE.MathUtils.degToRad(28);

        // No idle chatter when closed OR when mouse is outside
        const openFactor = (mouseInWindow) ? THREE.MathUtils.smoothstep(jawOpen, 0.05, 0.30) : 0.0;
        const idleAmp = THREE.MathUtils.degToRad(mouseInWindow ? 0.5 : 0.0) * openFactor;
        const idleSpeed = 2.2;
        const idleOffset = idleAmp * Math.sin(t * idleSpeed * Math.PI * 2.0);

        // Final angle
        const angle = (jawOpen * maxOpen) + idleOffset;

        // Rotate around the horizontal hinge (use .y if your asset needs Y)
        jaw.rotation.x = angle;
        jawMirror.rotation.x = angle;
    }



    controls.update();

    // ---------- POST: pixelated two-pass render ----------
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
}


animate();
