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
loader.load(
    'skull_model_01_04.glb',
    (gltf) => {
        model = gltf.scene;
        model.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshNormalMaterial();
            }
        });
        scene.add(model);
    },
    undefined,
    (error) => {
        console.error('Error loading GLB model:', error);
    }
);



// A tiny post scene with an orthographic camera and a full-screen quad
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);


// Simple shader that just samples the render target (no wobble)
const postMaterial = new THREE.ShaderMaterial({
    uniforms: {
        tDiffuse: { value: rt.texture }
    },
    vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
    fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(tDiffuse, vUv);
    }
  `,
    depthTest: false,
    depthWrite: false
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));

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


    if (model) {
        // Idle offset (small sinusoidal sway)
        const idleX = idle.ampX * Math.sin(t * idle.speedX * Math.PI * 2.0);
        const idleY = idle.ampY * Math.sin(t * idle.speedY * Math.PI * 2.0 + Math.PI / 3);

        let targetX, targetY, lerp;

        if (mouseInWindow) {
            // Follow mouse + idle
            targetX = targetRotation.x + idleX;
            targetY = targetRotation.y + idleY;
            lerp = trackLerp;
        } else if (!shouldReset) {
            // During the delay window: keep a gentle drift (no freeze)
            // Drift toward last target slowly + idle
            targetX = targetRotation.x + idleX;
            targetY = targetRotation.y + idleY;
            lerp = outLerp;
        } else {
            // Reset to center but still with idle overlay
            targetX = 0 + idleX;
            targetY = 0 + idleY;
            lerp = resetLerp;
        }

        model.rotation.x += (targetX - model.rotation.x) * lerp;
        model.rotation.y += (targetY - model.rotation.y) * lerp;
    }

    controls.update();

    // Pass 1: render the 3D scene to the low-res target
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);

    // Pass 2: render the upscaled quad to the screen
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);


}

animate();
