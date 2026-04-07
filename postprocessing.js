import * as THREE from 'three';
import { EffectComposer } from 'EffectComposer';
import { RenderPass } from 'RenderPass';
import { UnrealBloomPass } from 'UnrealBloomPass';
import { ShaderPass } from 'ShaderPass';

const MAX_COLORS = 32;

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

    vec2 pixelateUv(vec2 uv) {
      vec2 grid = screenSize / max(pxFactor, 1.0);
      vec2 cell = floor(uv * grid) + 0.5;
      return cell / grid;
    }

    // 4x4 Bayer matrix (normalized to 0..1)
    float bayer4x4(vec2 pos) {
      int x = int(mod(pos.x, 4.0));
      int y = int(mod(pos.y, 4.0));
      int index = x + y * 4;
      if (index == 0) return  0.0/16.0;
      if (index == 1) return  8.0/16.0;
      if (index == 2) return  2.0/16.0;
      if (index == 3) return 10.0/16.0;
      if (index == 4) return 12.0/16.0;
      if (index == 5) return  4.0/16.0;
      if (index == 6) return 14.0/16.0;
      if (index == 7) return  6.0/16.0;
      if (index == 8) return  3.0/16.0;
      if (index == 9) return 11.0/16.0;
      if (index == 10) return 1.0/16.0;
      if (index == 11) return 9.0/16.0;
      if (index == 12) return 15.0/16.0;
      if (index == 13) return  7.0/16.0;
      if (index == 14) return 13.0/16.0;
      if (index == 15) return  5.0/16.0;
      return 0.0;
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
      // 1) Pixelate
      vec2 uvPix = pixelateUv(vUv);
      vec3 c = texture2D(tDiffuse, uvPix).rgb;

      // 2) Find two nearest palette colors
      int iBest, iSecond; float dBest, dSecond;
      findTwoNearest(c, iBest, iSecond, dBest, dSecond);
      vec3 pBest = palette[iBest];
      vec3 pSecond = palette[iSecond];

      // 3) Bayer dither — use pixelated grid coordinates
      vec2 grid = screenSize / max(pxFactor, 1.0);
      vec2 cellCoord = floor(vUv * grid);
      float n = bayer4x4(cellCoord);

      // 4) Blend between two nearest based on distance ratio + dither
      float a = sqrt(max(dBest,   0.0));
      float b = sqrt(max(dSecond, 0.0));
      float total = max(a + b, 1e-6);
      float probSecond = mix(0.0, a / total, clamp(ditherStrength, 0.0, 1.0));

      vec3 outColor = (n < probSecond) ? pSecond : pBest;
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
