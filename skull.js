// SKULL MODULE
// Owns all skull/jaw/torso state, animation, and material management.

import * as THREE from 'three';
import { GLTFLoader } from 'GLTFLoader';
import { MAX_COLORS, PALETTE_DITHER_GLSL } from './palette-glsl.js';


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

        // Apply material with glitch shader
        const mat = createMaterial();
        [skull, jaw, torso].forEach((obj) => {
            obj.traverse((child) => {
                if (child.isMesh) {
                    child.material = mat;
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


// --- Vertex glitch effect ---

// Shared uniforms — all glitched materials reference the same objects
const glitchUniforms = {
    uGlitchAmount:    { value: 0.0 },
    uGlitchSliceDir:  { value: new THREE.Vector3(0.707, 0.707, 0.0) },
    uGlitchSlicePos:  { value: 0.0 },
    uGlitchStretch:   { value: new THREE.Vector3(1, 0, 0) },
    uGlitchTime:      { value: 0.0 },
    uGlitchBandWidth: { value: 15.0 },
    uGlitchStretchMag: { value: 25.0 },
    uGlitchNoiseMag:  { value: 8.0 }
};

let glitchEnabled = true;
let nextGlitchTime = 3.0; // first glitch after 3s
let glitchStartTime = -1;
const GLITCH_DURATION = 0.35;     // seconds
const GLITCH_MIN_INTERVAL = 5.0;
const GLITCH_MAX_INTERVAL = 10.0;

// Inject glitch vertex displacement into a Three.js built-in material shader.
// Callable from a composed onBeforeCompile — takes `shader`, not the material.
function injectGlitch(shader) {
    // Add our uniforms
    shader.uniforms.uGlitchAmount = glitchUniforms.uGlitchAmount;
    shader.uniforms.uGlitchSliceDir = glitchUniforms.uGlitchSliceDir;
    shader.uniforms.uGlitchSlicePos = glitchUniforms.uGlitchSlicePos;
    shader.uniforms.uGlitchStretch = glitchUniforms.uGlitchStretch;
    shader.uniforms.uGlitchTime = glitchUniforms.uGlitchTime;
    shader.uniforms.uGlitchBandWidth = glitchUniforms.uGlitchBandWidth;
    shader.uniforms.uGlitchStretchMag = glitchUniforms.uGlitchStretchMag;
    shader.uniforms.uGlitchNoiseMag = glitchUniforms.uGlitchNoiseMag;

    // Prepend uniform declarations to vertex shader
    shader.vertexShader =
        'uniform float uGlitchAmount;\n' +
        'uniform vec3  uGlitchSliceDir;\n' +
        'uniform float uGlitchSlicePos;\n' +
        'uniform vec3  uGlitchStretch;\n' +
        'uniform float uGlitchTime;\n' +
        'uniform float uGlitchBandWidth;\n' +
        'uniform float uGlitchStretchMag;\n' +
        'uniform float uGlitchNoiseMag;\n' +
        shader.vertexShader;

    // Inject displacement after #include <begin_vertex>
    // (at this point `transformed` holds the local vertex position)
    shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */`
        #include <begin_vertex>

        // --- Diagonal slice glitch ---
        if (uGlitchAmount > 0.001) {
            // Distance from the slice plane
            float sliceDist = dot(transformed, uGlitchSliceDir) - uGlitchSlicePos;

            // Soft band: vertices within uGlitchBandWidth of the slice are affected
            float sliceMask = 1.0 - smoothstep(0.0, uGlitchBandWidth, abs(sliceDist));

            // Noise field — cheap procedural noise from vertex position + time
            float nx = sin(transformed.x * 0.8 + uGlitchTime * 12.0)
                     * cos(transformed.y * 1.1 + uGlitchTime * 9.0);
            float ny = sin(transformed.y * 0.9 + uGlitchTime * 11.0)
                     * cos(transformed.z * 0.7 + uGlitchTime * 8.0);
            float nz = sin(transformed.z * 1.0 + uGlitchTime * 10.0)
                     * cos(transformed.x * 0.6 + uGlitchTime * 7.0);

            // Stretch along slice direction
            vec3 stretchDisp = uGlitchStretch * sliceMask * uGlitchAmount * uGlitchStretchMag;

            // Noise displacement
            vec3 noiseDisp = vec3(nx, ny, nz) * sliceMask * uGlitchAmount * uGlitchNoiseMag;

            transformed += stretchDisp + noiseDisp;
        }
        `
    );
}


// --- Surface dither (world-space triplanar) ---

const ditherUniforms = {
    palette: { value: new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0)) },
    paletteSize: { value: 0 },
    uSurfacePxWorld: { value: 2.0 }
};

export function setDitherPalette(hexArray) {
    const size = Math.min(hexArray.length, MAX_COLORS);
    const vecs = new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < size; i++) {
        const c = new THREE.Color(hexArray[i]);
        vecs[i] = new THREE.Vector3(c.r, c.g, c.b);
    }
    ditherUniforms.palette.value = vecs;
    ditherUniforms.paletteSize.value = size;
}

export function setDitherSurfacePx(v) {
    ditherUniforms.uSurfacePxWorld.value = v;
}

// Inject palette quantization + Bayer dither into a Three.js built-in material shader.
// Samples Bayer in world space via dominant-axis triplanar — pattern locks to the mesh surface.
function injectDither(shader) {
    // Share the uniform objects so live updates (palette swap, surface px) propagate
    shader.uniforms.palette = ditherUniforms.palette;
    shader.uniforms.paletteSize = ditherUniforms.paletteSize;
    shader.uniforms.uSurfacePxWorld = ditherUniforms.uSurfacePxWorld;

    // Vertex: add varyings for world position + normal, computed after the glitch displacement
    shader.vertexShader =
        'varying vec3 vSurfWorldPos;\n' +
        'varying vec3 vSurfWorldNormal;\n' +
        shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        /* glsl */`
        #include <project_vertex>
        vSurfWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vSurfWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        `
    );

    // Fragment: declare uniforms + varyings, pull in shared palette GLSL, override final color
    shader.fragmentShader =
        `varying vec3 vSurfWorldPos;
        varying vec3 vSurfWorldNormal;
        uniform vec3 palette[${MAX_COLORS}];
        uniform int  paletteSize;
        uniform float uSurfacePxWorld;
        ${PALETTE_DITHER_GLSL}
        ` + shader.fragmentShader;

    // Apply after all stock fragment stages (dithering_fragment is the last built-in hook)
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        /* glsl */`
        #include <dithering_fragment>
        {
            // Dominant-axis triplanar: pick the 2D plane aligned with the face's strongest normal axis
            vec3 axN = abs(normalize(vSurfWorldNormal));
            vec2 surfUv;
            if (axN.z >= axN.x && axN.z >= axN.y)      surfUv = vSurfWorldPos.xy;
            else if (axN.y >= axN.x)                    surfUv = vSurfWorldPos.xz;
            else                                        surfUv = vSurfWorldPos.yz;

            vec2 cell = floor(surfUv / max(uSurfacePxWorld, 0.0001));
            float bayer01 = bayer4x4(cell);
            gl_FragColor.rgb = palettePick(gl_FragColor.rgb, bayer01, 1.0);
        }
        `
    );
}

function triggerGlitch() {
    // Random diagonal slice direction
    const angle = Math.random() * Math.PI;
    const tilt = (Math.random() - 0.5) * 0.6;
    glitchUniforms.uGlitchSliceDir.value.set(
        Math.cos(angle),
        Math.sin(angle),
        tilt
    ).normalize();

    // Slice position: random offset through the model
    glitchUniforms.uGlitchSlicePos.value = (Math.random() - 0.5) * 60;

    // Stretch direction: perpendicular-ish to slice, with some randomness
    glitchUniforms.uGlitchStretch.value.set(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
    ).normalize();

    // Randomize magnitudes
    glitchUniforms.uGlitchBandWidth.value = 10.0 + Math.random() * 20.0;   // 10-30
    glitchUniforms.uGlitchStretchMag.value = 15.0 + Math.random() * 35.0;  // 15-50
    glitchUniforms.uGlitchNoiseMag.value = 5.0 + Math.random() * 10.0;     // 5-15
}

function updateGlitch(t) {
    glitchUniforms.uGlitchTime.value = t;

    if (!glitchEnabled) {
        glitchUniforms.uGlitchAmount.value = 0;
        return;
    }

    if (glitchStartTime < 0) {
        // Not currently glitching — check if it's time
        if (t > nextGlitchTime) {
            glitchStartTime = t;
            triggerGlitch();
        }
        glitchUniforms.uGlitchAmount.value = 0;
    } else {
        // Currently glitching
        const elapsed = t - glitchStartTime;
        if (elapsed > GLITCH_DURATION) {
            // Glitch ended
            glitchStartTime = -1;
            glitchUniforms.uGlitchAmount.value = 0;
            // Schedule next glitch
            nextGlitchTime = t + GLITCH_MIN_INTERVAL +
                Math.random() * (GLITCH_MAX_INTERVAL - GLITCH_MIN_INTERVAL);
        } else {
            // Envelope: fast attack, brief hold, fast decay
            const progress = elapsed / GLITCH_DURATION;
            let envelope;
            if (progress < 0.15) {
                envelope = progress / 0.15; // attack
            } else if (progress < 0.7) {
                envelope = 1.0; // hold
            } else {
                envelope = 1.0 - (progress - 0.7) / 0.3; // decay
            }
            glitchUniforms.uGlitchAmount.value = envelope;
        }
    }
}

export function setSkullGlitchEnabled(enabled) {
    glitchEnabled = enabled;
    if (!enabled) {
        glitchUniforms.uGlitchAmount.value = 0;
        glitchStartTime = -1;
    }
}


// --- Material management ---

function createMaterial() {
    let mat;
    const wantsDither = (materialOptions.type === 'Lambert Dithered');

    switch (materialOptions.type) {
        case 'Lambert':
        case 'Lambert Dithered':
            // flatShading intentionally omitted — MeshLambertMaterial (r138) doesn't support it
            mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
            break;
        case 'Normal':
        default:
            mat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
            break;
    }

    // onBeforeCompile is a single slot — compose glitch + (optional) dither into one callback
    mat.onBeforeCompile = (shader) => {
        injectGlitch(shader);
        if (wantsDither) injectDither(shader);
    };

    // Force a distinct program cache entry for the dithered variant — Three.js's default
    // cache key uses onBeforeCompile.toString(), which is identical between Lambert and
    // Lambert Dithered (the `wantsDither` branch is a closure variable, not in the source).
    // Without this, switching material reuses the first-compiled program and our
    // dither injection never runs.
    mat.customProgramCacheKey = () => (wantsDither ? 'lambert-dithered' : 'lambert-glitch');

    return mat;
}

// Traverse skull + torso meshes and swap their material.
export function updateMaterial() {
    const mat = createMaterial();

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
    // Update vertex glitch effect
    updateGlitch(t);

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
