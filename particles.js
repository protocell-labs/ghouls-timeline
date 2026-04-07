import * as THREE from 'three';

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
    noiseOffsetU: Math.random() * 1000.0, // random "starting point" in the noise space, avoids repetition
    noiseOffsetV: Math.random() * 1000.0, // random "starting point" in the noise space, avoids repetition

    // global time-based drift (noise-space units per second)
    noiseDriftU: 0.5,   // drift along the U axis of the noise field - 0.05
    noiseDriftV: 0.3,   // drift along the V axis of the noise field - 0.03

    // phase
    ringPhaseStep: 0.17,

    // appearance
    sizePx: 5 * window.devicePixelRatio, // 6 * window.devicePixelRatio
    color: 0xffffff,
    opacity: 0.5, // 0.85

    // birth
    birthWidth: 1.5, // 2.0

    // birth gating (segmented appearance during emergence)
    segments: 40.0,
    glitchSpeed: 100.0,
};

let particleCloudTilt = 0; // tilt the rings around X axis in degrees, 25
let particleCloudHeight = 75; // translate the rings up above the skull

// Gaussian helper
function randNormal(mean = 0, sigma = 1) {
    let u = 1 - Math.random(), v = 1 - Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + sigma * z;
}

let particleCloud = null;

export function buildRingParticles() {
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

            // birth
            uBirthWidth: { value: RINGS.birthWidth },

            // birth gating
            uSegments: { value: RINGS.segments },
            uGlitchSpeed: { value: RINGS.glitchSpeed }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
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

        // Gaussian grit — hash uses ringIndex (stable) to prevent per-frame
        // position flickering, but sigma scales with idx (animated) so spread
        // grows as rings move outward from center
        float rSigma = uRadialSigma + idx*uRadialSigmaNonLin;
        radial += gaussJitter(vec2(ang,ringIndex)) * rSigma;

        float vSigma = uVerticalSigma + idx*uVerticalSigmaNonLin;
        float y = gaussJitter(vec2(ringIndex,ang)) * vSigma;

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

      varying float vBirth;
      varying float vAng;

      float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }

      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        if(dot(uv,uv)>0.25) discard;

        // Birth-only gating: segmented appearance during emergence,
        // fully solid once the ring is formed
        float seg = floor((vAng+3.14159265)/(6.2831853/max(1.0,uSegments)));
        float gate = hash(vec2(seg, floor(uGlitchSpeed*vBirth)));
        // mask = 1 when vBirth is high (formed), gated when vBirth is low (emerging)
        float mask = step(gate, vBirth);

        float alpha = uOpacity * mask;
        if(alpha<=0.0) discard;

        gl_FragColor = vec4(uColor, alpha);
      }
    `
    });

    if (particleCloud) {
        particleCloud.geometry.dispose();
        particleCloud.material.dispose();
    }
    particleCloud = new THREE.Points(geo, mat);
    particleCloud.rotation.x = THREE.MathUtils.degToRad(particleCloudTilt);
    particleCloud.position.y = particleCloudHeight;
    return particleCloud;
}

export function getParticleCloud() {
    return particleCloud;
}

// --- CPU-side ring math for tag tracking ---
// Replicates the vertex shader's core calculations.

export const RING_COUNT = RINGS.ringCount;

function ringPhaseIdx(ringIdx, time) {
    const speed = 10.0;
    const phase = time * (speed / Math.max(RINGS.ringSpacing, 1e-5));
    return ((ringIdx + phase) % RINGS.ringCount + RINGS.ringCount) % RINGS.ringCount;
}

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// Returns 0..1 birth value for a ring (0 = just born/invisible, 1 = fully formed).
export function getRingBirth(ringIdx, time) {
    const idx = ringPhaseIdx(ringIdx, time);
    const d0 = Math.min(idx, RINGS.ringCount - idx);
    return smoothstep(0, Math.max(0.0001, RINGS.birthWidth), d0);
}

// Returns world position of a point on a ring.
const _ringPos = new THREE.Vector3();
export function getTrackedRingPosition(ringIdx, theta, time) {
    const idx = ringPhaseIdx(ringIdx, time);

    const radial = RINGS.baseRadius + idx * RINGS.ringSpacing + Math.pow(idx, 1.0 + RINGS.ringSpacingNonLin);
    const ang = theta + ringIdx * RINGS.ringPhaseStep;

    _ringPos.set(
        radial * Math.cos(ang),
        0,
        radial * Math.sin(ang)
    );

    if (particleCloud) {
        particleCloud.localToWorld(_ringPos);
    }
    return _ringPos;
}
