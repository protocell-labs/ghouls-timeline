// SKULL MODULE
// Owns all skull/jaw/torso state, animation, and material management.

import * as THREE from 'three';
import { GLTFLoader } from 'GLTFLoader';


// --- State ---

const mouse = { x: 0, y: 0 };          // current mouse position in NDC
const targetRotation = { x: 0, y: 0 }; // desired model rotation based on mouse

let skull, jaw, torso;
let jawOpen = 0;          // smoothed value (0 closed .. 1 open)
let targetJawOpen = 0;    // current target
let nextJawEvent = 0;     // time until we change state again

let mouseInWindow = true; // checks if the mouse is inside the window
let resetTimer = null; // timer for the skull rotation reset when the mouse leaves the screen
let shouldReset = false; // trigger for the skull rotation reset when the mouse leaves the screen

const materialOptions = {
    type: 'Lambert', // default
};


// --- Constants ---

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


// --- Head group (exported so main.js can add it to the scene) ---

export const head = new THREE.Group();


// --- Helper functions ---

export function setJawOpen01(v) {
    targetJawOpen = THREE.MathUtils.clamp(v, 0, 1);
}

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


// --- Event listeners ---

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
    mouseInWindow = true;
    shouldReset = false;
    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
});

// skull animation
document.body.addEventListener('mouseleave', () => {
    mouseInWindow = false;
    scheduleReset(500); // delay before reset starts
});

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


// --- GLB loader ---

export async function loadHeadParts() {
    try {
        const loader = new GLTFLoader();
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
                        side: THREE.DoubleSide,
                        flatShading: true
                    });
                }
            });
        });

        // Attach jaw under skull
        skull.add(jaw);

        // Add skull + torso to main head group
        head.add(skull);
        head.add(torso);

        // Find left shoulder vertex for tag tracking
        findShoulderVertex();

        console.log('Head parts loaded: skull + jaw + torso (hierarchy applied)');
    } catch (e) {
        console.error('Error loading head parts:', e);
    }
}

// --- Shoulder vertex for tag tracking ---
// Finds a vertex on the skeleton's left shoulder (viewer's right) from the torso mesh.
const _shoulderLocal = new THREE.Vector3();
let shoulderMesh = null; // the specific child mesh that owns the vertex
let shoulderFound = false;

function findShoulderVertex() {
    if (!torso) return;
    let bestVertex = null;
    let bestScore = -Infinity;
    let bestMesh = null;

    torso.traverse((child) => {
        if (!child.isMesh) return;
        const geo = child.geometry;
        const pos = geo.getAttribute('position');
        if (!pos) return;

        // Convert a few vertices to world space to understand the mesh orientation.
        // Score in world space so we account for any mesh transforms.
        const worldVec = new THREE.Vector3();

        for (let i = 0; i < pos.count; i++) {
            worldVec.set(pos.getX(i), pos.getY(i), pos.getZ(i));
            child.localToWorld(worldVec);

            // Skeleton's left shoulder (viewer's right):
            // positive world X, and not too far above or below origin (shoulder height).
            // Score: prefer large +X, penalize extreme Y.
            const score = worldVec.x * 2.0 - Math.abs(worldVec.y) * 0.5;

            if (score > bestScore) {
                bestScore = score;
                bestVertex = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
                bestMesh = child;
            }
        }
    });

    if (bestVertex && bestMesh) {
        _shoulderLocal.set(bestVertex.x, bestVertex.y, bestVertex.z);
        shoulderMesh = bestMesh;
        shoulderFound = true;
        // Log world position for tuning
        const worldCheck = new THREE.Vector3().copy(_shoulderLocal);
        bestMesh.localToWorld(worldCheck);
        console.log('Shoulder vertex found — world pos:', worldCheck);
    }
}

const _shoulderWorld = new THREE.Vector3();
export function getShoulderPosition() {
    if (!shoulderFound || !shoulderMesh) return new THREE.Vector3(40, -20, 0);
    _shoulderWorld.copy(_shoulderLocal);
    shoulderMesh.localToWorld(_shoulderWorld);
    return _shoulderWorld;
}


// --- Material management ---

// Traverse skull + torso meshes and swap their material.
export function updateMaterial() {
    let mat;
    switch (materialOptions.type) {
        case 'Lambert':
            mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, flatShading: true });
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
    // Keep the container neutral so torso doesn't inherit mouse-follow
    head.rotation.set(0, 0, 0);

    // Shared idle sway
    const idleX = idle.ampX * Math.sin(t * idle.speedX * Math.PI * 2.0);
    const idleY = idle.ampY * Math.sin(t * idle.speedY * Math.PI * 2.0 + Math.PI / 3);

    // Skull (+jaw via hierarchy) follows mouse + idle/reset
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

    // Torso: wobble only (no mouse-follow)
    if (torso) {
        const torsoLerp = 0.05; // gentle smoothing for torso wobble
        torso.rotation.x += (idleX - torso.rotation.x) * torsoLerp;
        torso.rotation.y += (idleY - torso.rotation.y) * torsoLerp;
    }

    // Jaw animation (random only when mouse inside; closed when outside)
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
}
