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
const renderer = new THREE.WebGLRenderer({ antialias: true });
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


// Resize handling
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    if (model) { // ensure the model finished loading before we use it
        if (mouseInWindow) {
            // smoothly interpolate toward the target rotation
            model.rotation.x += (targetRotation.x - model.rotation.x) * rotationLerpSpeed;
            model.rotation.y += (targetRotation.y - model.rotation.y) * rotationLerpSpeed;
        } else if (shouldReset) {
            model.rotation.x += (0 - model.rotation.x) * rotationLerpSpeed;
            model.rotation.y += (0 - model.rotation.y) * rotationLerpSpeed;
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

animate();
