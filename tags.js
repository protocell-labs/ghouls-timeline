import * as THREE from 'three';
import { getTrackedRingPosition, getRingBirth, RING_COUNT } from './particles.js';

// --- Config ---
const BIRTH_SHOW_THRESHOLD = 0.15; // birth value above which tag appears
const BIRTH_HIDE_THRESHOLD = 0.05; // birth value below which tag hides (hysteresis)
const GLITCH_PHASE_END = 0.6;      // birth value at which glitch-in completes (fully stable)
const BOX_LERP = 0.03;
const MARKER_LERP = 0.12;
const BOX_OFFSET_DISTANCE = 120;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

let container = null;
let svgLayer = null;
let tagElements = [];
const projVec = new THREE.Vector3();

// Palette colors
let tagColor = '#cccccc';
let tagBgColor = '#000000';

function secondLightestColor(hexArray) {
    if (!hexArray || hexArray.length < 2) return '#cccccc';
    const withLum = hexArray.map((hex) => {
        const c = new THREE.Color(hex);
        const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        return { hex, lum };
    });
    withLum.sort((a, b) => b.lum - a.lum);
    // For 2-color palettes, 2nd lightest would be the darkest — use brightest instead
    if (hexArray.length <= 2) return withLum[0].hex;
    return withLum[1].hex;
}

function darkestColor(hexArray) {
    if (!hexArray || hexArray.length < 1) return '#000000';
    let darkest = hexArray[0];
    let minLum = Infinity;
    hexArray.forEach((hex) => {
        const c = new THREE.Color(hex);
        const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        if (lum < minLum) { minLum = lum; darkest = hex; }
    });
    return darkest;
}

// Wrap each character in a span for per-letter glitch
function createGlitchText(text) {
    const wrapper = document.createElement('span');
    for (let i = 0; i < text.length; i++) {
        const span = document.createElement('span');
        span.textContent = text[i];
        span.style.display = 'inline-block';
        wrapper.appendChild(span);
    }
    return wrapper;
}

// Simple seeded hash for deterministic per-frame randomness
function hash(a, b) {
    return ((Math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1 + 1) % 1;
}

function createTagElement(ringIdx) {
    const box = document.createElement('div');
    box.className = 'tag-box';

    const title = document.createElement('div');
    title.className = 'tag-title';
    const titleText = createGlitchText(`RING_${String(ringIdx + 1).padStart(2, '0')}`);
    title.appendChild(titleText);

    const subtitle = document.createElement('div');
    subtitle.className = 'tag-subtitle';
    const subtitleText = createGlitchText(`CYCLE ${String(ringIdx + 1).padStart(2, '0')} — ACTIVE`);
    subtitle.appendChild(subtitleText);

    box.appendChild(title);
    box.appendChild(subtitle);

    const marker = document.createElement('div');
    marker.className = 'tag-marker';

    // Collect all character spans for glitch animation
    const charSpans = [
        ...titleText.querySelectorAll('span'),
        ...subtitleText.querySelectorAll('span')
    ];

    return { box, marker, charSpans };
}

function createSvgLine(color) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1');
    svgLayer.appendChild(line);
    return line;
}

export function initTags() {
    container = document.createElement('div');
    container.id = 'tag-container';
    document.body.appendChild(container);

    svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLayer.id = 'tag-svg';
    svgLayer.setAttribute('width', '100%');
    svgLayer.setAttribute('height', '100%');
    svgLayer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    document.body.appendChild(svgLayer);

    const defaultColor = 'rgba(200,200,200,0.4)';

    for (let i = 0; i < RING_COUNT; i++) {
        const { box, marker, charSpans } = createTagElement(i);
        const line = createSvgLine(defaultColor);

        container.appendChild(box);
        container.appendChild(marker);

        const theta = i * GOLDEN_ANGLE;

        tagElements.push({
            box,
            marker,
            line,
            charSpans,
            ringIdx: i,
            theta,
            boxX: 0,
            boxY: 0,
            markerX: 0,
            markerY: 0,
            initialized: false,
            visible: false,
            glitchSeed: i * 17.3 // per-tag seed for varied glitch patterns
        });

        box.style.display = 'none';
        marker.style.display = 'none';
        line.setAttribute('visibility', 'hidden');
    }
}

// Apply glitch effect based on birth progress (0 = full glitch, 1 = fully stable)
function applyGlitch(tag, birth, time) {
    // Normalize: 0 at BIRTH_SHOW_THRESHOLD, 1 at GLITCH_PHASE_END
    const glitchProgress = Math.max(0, Math.min(1,
        (birth - BIRTH_SHOW_THRESHOLD) / (GLITCH_PHASE_END - BIRTH_SHOW_THRESHOLD)
    ));

    // Frame-varying seed (changes every ~3 frames for a stuttery feel)
    const frameSeed = Math.floor(time * 20) + tag.glitchSeed;

    if (glitchProgress >= 1.0) {
        // Fully stable — all visible, all borders on
        tag.box.style.borderTopColor = '';
        tag.box.style.borderRightColor = '';
        tag.box.style.borderBottomColor = '';
        tag.box.style.borderLeftColor = '';
        tag.charSpans.forEach((span) => { span.style.visibility = 'visible'; });
        tag.marker.style.visibility = 'visible';
        tag.line.setAttribute('opacity', '1');
        return;
    }

    // Probability that each element is visible this frame
    const charProb = glitchProgress * glitchProgress; // starts very low, accelerates
    const borderProb = glitchProgress * 0.8 + 0.2;    // borders flicker in faster

    // Flicker individual borders
    const transparent = 'transparent';
    tag.box.style.borderTopColor = hash(frameSeed, 0.1) < borderProb ? '' : transparent;
    tag.box.style.borderRightColor = hash(frameSeed, 0.2) < borderProb ? '' : transparent;
    tag.box.style.borderBottomColor = hash(frameSeed, 0.3) < borderProb ? '' : transparent;
    tag.box.style.borderLeftColor = hash(frameSeed, 0.4) < borderProb ? '' : transparent;

    // Flicker individual characters
    tag.charSpans.forEach((span, idx) => {
        const charHash = hash(frameSeed + idx * 3.7, tag.glitchSeed);
        span.style.visibility = charHash < charProb ? 'visible' : 'hidden';
    });

    // Marker flickers
    tag.marker.style.visibility = hash(frameSeed, 0.5) < borderProb ? 'visible' : 'hidden';

    // Line opacity flickers
    const lineVis = hash(frameSeed, 0.6) < borderProb ? '1' : '0';
    tag.line.setAttribute('opacity', lineVis);
}

export function updateTags(camera, time) {
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;

    tagElements.forEach((tag) => {
        const birth = getRingBirth(tag.ringIdx, time);

        if (!tag.visible && birth > BIRTH_SHOW_THRESHOLD) {
            tag.visible = true;
            tag.initialized = false;
        } else if (tag.visible && birth < BIRTH_HIDE_THRESHOLD) {
            tag.visible = false;
        }

        if (!tag.visible) {
            tag.box.style.display = 'none';
            tag.marker.style.display = 'none';
            tag.line.setAttribute('visibility', 'hidden');
            return;
        }

        const worldPos = getTrackedRingPosition(tag.ringIdx, tag.theta, time);
        projVec.copy(worldPos);
        projVec.project(camera);

        if (projVec.z > 1) {
            tag.box.style.display = 'none';
            tag.marker.style.display = 'none';
            tag.line.setAttribute('visibility', 'hidden');
            return;
        }

        const targetX = (projVec.x * halfW) + halfW;
        const targetY = -(projVec.y * halfH) + halfH;

        if (targetX < -200 || targetX > window.innerWidth + 200 ||
            targetY < -200 || targetY > window.innerHeight + 200) {
            tag.box.style.display = 'none';
            tag.marker.style.display = 'none';
            tag.line.setAttribute('visibility', 'hidden');
            return;
        }

        // Box offset: radially outward from screen center
        const dx = targetX - halfW;
        const dy = targetY - halfH;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const idealBoxX = targetX + (dx / len) * BOX_OFFSET_DISTANCE;
        const idealBoxY = targetY + (dy / len) * BOX_OFFSET_DISTANCE;

        if (!tag.initialized) {
            tag.boxX = idealBoxX;
            tag.boxY = idealBoxY;
            tag.markerX = targetX;
            tag.markerY = targetY;
            tag.initialized = true;
        } else {
            tag.boxX += (idealBoxX - tag.boxX) * BOX_LERP;
            tag.boxY += (idealBoxY - tag.boxY) * BOX_LERP;
            tag.markerX += (targetX - tag.markerX) * MARKER_LERP;
            tag.markerY += (targetY - tag.markerY) * MARKER_LERP;
        }

        // Show elements
        tag.box.style.display = 'block';
        tag.box.style.left = `${tag.boxX}px`;
        tag.box.style.top = `${tag.boxY}px`;

        tag.marker.style.display = 'block';
        tag.marker.style.left = `${tag.markerX - 3}px`;
        tag.marker.style.top = `${tag.markerY - 3}px`;

        // SVG line
        const boxRect = tag.box.getBoundingClientRect();
        const boxCenterX = tag.boxX + boxRect.width / 2;
        let lineStartX, lineStartY;

        if (tag.markerY > tag.boxY + boxRect.height) {
            lineStartX = boxCenterX;
            lineStartY = tag.boxY + boxRect.height;
        } else if (tag.markerY < tag.boxY) {
            lineStartX = boxCenterX;
            lineStartY = tag.boxY;
        } else {
            if (tag.markerX > boxCenterX) {
                lineStartX = tag.boxX + boxRect.width;
                lineStartY = tag.boxY + boxRect.height / 2;
            } else {
                lineStartX = tag.boxX;
                lineStartY = tag.boxY + boxRect.height / 2;
            }
        }

        tag.line.setAttribute('x1', lineStartX);
        tag.line.setAttribute('y1', lineStartY);
        tag.line.setAttribute('x2', tag.markerX);
        tag.line.setAttribute('y2', tag.markerY);
        tag.line.setAttribute('visibility', 'visible');

        // Apply glitch-in effect
        applyGlitch(tag, birth, time);
    });
}

export function updateTagColors(hexArray) {
    tagColor = secondLightestColor(hexArray);
    tagBgColor = darkestColor(hexArray);

    if (container) {
        container.style.setProperty('--tag-color', tagColor);
        container.style.setProperty('--tag-color-dim', tagColor);
        container.style.setProperty('--tag-bg', tagBgColor);
    }

    tagElements.forEach((tag) => {
        tag.line.setAttribute('stroke', tagColor);
    });
}
