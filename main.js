// MODULE IMPORTS

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { buildRingParticles } from './particles.js';
import { initPostProcessing } from './postprocessing.js';
import { head, loadHeadParts, animateSkull } from './skull.js';
import { addStarField, getStarMat } from './starfield.js';
import { initGUI } from './gui.js';
import { initTags, updateTags } from './tags.js';






// GLOBALS

let cameraPosition = { // camera position (X - horizontal, Y - height, Z - depth)
    x: -100, // 0
    y: -400, // -150
    z: 400 // 250
};
let cameraTarget = { // look-at point (X - horizontal, Y - height, Z - depth)
    x: 0, // 0
    y: 0, // 75
    z: 0 // 0
};

const clock = new THREE.Clock();











// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1, // near clipping plane
    100000 // far clipping plane
);

camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z); // camera position (X, Y - height, Z - depth)


// Renderer — render at native resolution so pxFactor works in physical pixels
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

controls.target.set(cameraTarget.x, cameraTarget.y, cameraTarget.z); // look-at point
controls.update();

// Lighting
const dirLightA = new THREE.DirectionalLight(0xff0000, 0.8); // red light
dirLightA.position.set(1, 1, 1);
const dirLightB = new THREE.DirectionalLight(0x0000ff, 0.4); // blue light
dirLightB.position.set(-1, -1, 1);
const dirLightC = new THREE.DirectionalLight(0xffffff, 0.7); // white light
dirLightC.position.set(1, 0, 0);

scene.add(dirLightA);
scene.add(dirLightB);
scene.add(dirLightC);



// ----- Bloom + quantize post-processing -----
const { bloomComposer, bloomPass, quantizePass } = initPostProcessing(renderer, scene, camera);

// Initialize tags first (creates DOM), then GUI (sets palette colors on tags)
initTags();
initGUI(quantizePass);


scene.add(head);
loadHeadParts();







// ----------- RING PARTICLE CLOUD -----------

const particleCloud = buildRingParticles();
scene.add(particleCloud);




// ----------- STAR FIELD PARTICLE CLOUD -----------

const starField = addStarField();
scene.add(starField);



// ---------- Resize handling ----------
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(window.devicePixelRatio); // may change between monitors
    renderer.setSize(w, h);

    // Use actual drawing buffer size for composer + shader uniforms
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    bloomComposer.setSize(buf.x, buf.y);
    bloomPass.setSize(buf.x, buf.y);
    quantizePass.uniforms.screenSize.value.copy(buf);
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

    animateSkull(t);


    // ---------- PARTICLE ANIMATION ----------
    if (particleCloud) {
        particleCloud.rotation.y += 0.001; // keep gentle rotation
        particleCloud.material.uniforms.uTime.value = t;
    }

    // ---------- STARFIELD ANIMATION ----------
    const starMat = getStarMat();
    if (starMat) {
        starMat.uniforms.uTime.value = t;
    }




    controls.update();
    updateTags(camera, t);


    // ---------- POST-PROCESSING PIPELINE ----------

    // render the chain: RenderPass → UnrealBloomPass → QuantizeDitherShader (to screen)
    bloomComposer.render();

}



animate();
