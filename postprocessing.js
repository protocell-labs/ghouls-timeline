import * as THREE from 'three';
import { EffectComposer } from 'EffectComposer';
import { RenderPass } from 'RenderPass';
import { UnrealBloomPass } from 'UnrealBloomPass';
import { ShaderPass } from 'ShaderPass';
import { MAX_COLORS, PALETTE_DITHER_GLSL } from './palette-glsl.js';

const QuantizeDitherShader = {
    uniforms: {
        tDiffuse: { value: null },

        palette: { value: new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0)) },
        paletteSize: { value: 0 },

        screenSize: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        pxFactor: { value: 3 },
        ditherStrength: { value: 0.5 },
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

    uniform sampler2D tDiffuse;

    uniform vec3  palette[${MAX_COLORS}];
    uniform int   paletteSize;

    uniform vec2  screenSize;
    uniform float pxFactor;
    uniform float ditherStrength;
    uniform float uTime;

    varying vec2 vUv;

    ${PALETTE_DITHER_GLSL}

    vec2 pixelateUv(vec2 uv) {
      vec2 grid = screenSize / max(pxFactor, 1.0);
      vec2 cell = floor(uv * grid) + 0.5;
      return cell / grid;
    }

    void main() {
      // 1) Pixelate
      vec2 uvPix = pixelateUv(vUv);
      vec3 c = texture2D(tDiffuse, uvPix).rgb;

      // 2) Bayer dither — use pixelated grid coordinates
      vec2 grid = screenSize / max(pxFactor, 1.0);
      vec2 cellCoord = floor(vUv * grid);
      float n = bayer4x4(cellCoord);

      // 3) Palette pick with two-nearest blend
      vec3 outColor = palettePick(c, n, ditherStrength);
      gl_FragColor = vec4(outColor, 1.0);
    }
  `
};


export function initPostProcessing(renderer, scene, camera) {
    // Use actual drawing buffer size (accounts for devicePixelRatio)
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());

    const bloomComposer = new EffectComposer(renderer);
    const scenePass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
        buf,
        1.0,   // strength
        0.1,   // radius
        0.70   // threshold
    );

    bloomComposer.addPass(scenePass);
    bloomComposer.addPass(bloomPass);

    // Set composer size to match actual buffer
    bloomComposer.setSize(buf.x, buf.y);

    const quantizePass = new ShaderPass(QuantizeDitherShader);
    quantizePass.renderToScreen = true;
    quantizePass.uniforms.screenSize.value.copy(buf);

    bloomComposer.addPass(quantizePass);

    return { bloomComposer, bloomPass, quantizePass };
}


export function setPalette(quantizePass, hexArray) {
    const size = Math.min(hexArray.length, MAX_COLORS);
    const vecs = new Array(MAX_COLORS).fill(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < size; i++) {
        const c = new THREE.Color(hexArray[i]);
        vecs[i] = new THREE.Vector3(c.r, c.g, c.b);
    }
    quantizePass.uniforms.palette.value = vecs;
    quantizePass.uniforms.paletteSize.value = size;
}
