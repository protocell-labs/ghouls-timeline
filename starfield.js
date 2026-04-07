import * as THREE from 'three';

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
    trailSpeed: 0.15,     // how fast a "lit window" travels along each branch (0..1 steps/sec)
    trailWidth: 0.5,     // size of the lit window along the branch (0..1)
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


// helper function for calculating random-walk branch length in the starfield
function branchLength(b, nrOfBranches, branchPoints) {
    // Example: linearly scale from 50% to 150% of branchPoints
    const factor = 0.5 + (b / (nrOfBranches - 1));
    return Math.floor(branchPoints * factor);
}


// Module-level references
let starField = null;
let starGeo = null;
let starMat = null;


export function addStarField() {
    const {
        planeZ,
        nrOfBranches, branchPoints,
        stepSizeInit, stepSizeDecay, startOffsetX, startOffsetY, biasStrength,
        extraStars, extraSpreadX, extraSpreadY,
        sizePx, color, opacity,
        tiltX, tiltY, offsetX, offsetY,

        // NEW animation controls
        trailSpeed, trailWidth,
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
    const oldGeo = starGeo;
    const oldMat = starMat;

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

            // trail & drift
            uTrailSpeed: { value: trailSpeed },
            uTrailWidth: { value: trailWidth },
            uDrift: { value: new THREE.Vector2(driftX, driftY) }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        vertexShader: /* glsl */`
        attribute float aBranch;   // branch id (-1 for extra stars)
        attribute float aT;        // 0..1 position along branch
        attribute float aSeed;     // per-point random seed

        uniform float uTime;
        uniform float uSize;

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

        varying float vVis;

        void main() {
        vec2 uv = gl_PointCoord - 0.5;
        if (dot(uv,uv) > 0.25) discard;

        float alpha = uOpacity * vVis;
        if (alpha <= 0.0) discard;

        gl_FragColor = vec4(uColor, alpha);
        }

    `
    });

    // Dispose old geometry/material if they exist
    if (starField) {
        oldGeo.dispose();
        oldMat.dispose();
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

// Read a star's baked position from the geometry buffer and return world coords.
const _starPos = new THREE.Vector3();
export function getTrackedStarPosition(starIndex) {
    if (!starField || !starGeo) return _starPos.set(0, 0, 0);
    const positions = starGeo.getAttribute('position');
    if (starIndex >= positions.count) return _starPos.set(0, 0, 0);
    _starPos.set(
        positions.getX(starIndex),
        positions.getY(starIndex),
        positions.getZ(starIndex)
    );
    starField.localToWorld(_starPos);
    return _starPos;
}

// Find the star index whose projected screen position is closest to (targetSX, targetSY).
// targetSX/targetSY are in pixels from top-left. Call after starfield is built.
// excludeIdx: optional star index to exclude (and its neighbors within minSeparationPx).
const _findVec = new THREE.Vector3();
const _localPos = new THREE.Vector3();
const _exclVec = new THREE.Vector3();
export function findStarNearScreenPos(camera, targetSX, targetSY, excludeIdx, minSeparationPx) {
    if (!starField || !starGeo) return 0;
    const positions = starGeo.getAttribute('position');
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;
    const sepSq = (minSeparationPx || 0) * (minSeparationPx || 0);

    // Pre-compute excluded star's screen position
    let exclSX = -99999, exclSY = -99999;
    if (excludeIdx !== undefined && excludeIdx >= 0) {
        _exclVec.set(positions.getX(excludeIdx), positions.getY(excludeIdx), positions.getZ(excludeIdx));
        starField.localToWorld(_exclVec);
        _exclVec.project(camera);
        if (_exclVec.z <= 1) {
            exclSX = (_exclVec.x * halfW) + halfW;
            exclSY = -(_exclVec.y * halfH) + halfH;
        }
    }

    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < positions.count; i++) {
        _localPos.set(positions.getX(i), positions.getY(i), positions.getZ(i));
        _findVec.copy(_localPos);
        starField.localToWorld(_findVec);
        _findVec.project(camera);

        if (_findVec.z > 1) continue; // behind camera

        const sx = (_findVec.x * halfW) + halfW;
        const sy = -(_findVec.y * halfH) + halfH;

        // Skip stars too close to the excluded star
        if (sepSq > 0) {
            const edx = sx - exclSX;
            const edy = sy - exclSY;
            if (edx * edx + edy * edy < sepSq) continue;
        }

        const dx = sx - targetSX;
        const dy = sy - targetSY;
        const dist = dx * dx + dy * dy;

        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }
    return bestIdx;
}
