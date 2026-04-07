import * as THREE from 'three';
import { getTrackedRingPosition, getRingBirth, RING_COUNT } from './particles.js';

// --- Config ---
const BIRTH_SHOW_THRESHOLD = 0.15; // birth value above which tag appears
const BIRTH_HIDE_THRESHOLD = 0.05; // birth value below which tag hides (hysteresis)
const BOX_LERP = 0.03;             // box follows slowly
const MARKER_LERP = 0.12;          // marker tracks faster
const BOX_OFFSET_DISTANCE = 120;   // screen pixels — how far box sits from ring point

// Each ring gets a different theta so tags spread around the circle.
// Golden angle spacing avoids clustering.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~2.399 radians

let container = null;
let svgLayer = null;
let tagElements = [];
const projVec = new THREE.Vector3();

// Palette color for tag styling
function secondLightestColor(hexArray) {
    if (!hexArray || hexArray.length < 2) return '#cccccc';
    const withLum = hexArray.map((hex) => {
        const c = new THREE.Color(hex);
        const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        return { hex, lum };
    });
    withLum.sort((a, b) => b.lum - a.lum);
    return withLum[1].hex;
}

function createTagElement(ringIdx) {
    const box = document.createElement('div');
    box.className = 'tag-box';

    const title = document.createElement('div');
    title.className = 'tag-title';
    title.textContent = `RING_${String(ringIdx + 1).padStart(2, '0')}`;

    const subtitle = document.createElement('div');
    subtitle.className = 'tag-subtitle';
    subtitle.textContent = `CYCLE ${String(ringIdx + 1).padStart(2, '0')} — ACTIVE`;

    box.appendChild(title);
    box.appendChild(subtitle);

    const marker = document.createElement('div');
    marker.className = 'tag-marker';

    return { box, marker };
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
        const { box, marker } = createTagElement(i);
        const line = createSvgLine(defaultColor);

        container.appendChild(box);
        container.appendChild(marker);

        // Each ring gets a unique theta via golden angle — maximizes angular separation
        const theta = i * GOLDEN_ANGLE;

        // Box offset direction varies per ring (radially outward from projected center).
        // We compute the actual offset direction per frame, but store a base angle here.
        const offsetAngle = theta;

        tagElements.push({
            box,
            marker,
            line,
            ringIdx: i,
            theta,
            offsetAngle,
            // Smoothed screen positions
            boxX: 0,
            boxY: 0,
            markerX: 0,
            markerY: 0,
            initialized: false,
            visible: false
        });

        // Start hidden
        box.style.display = 'none';
        marker.style.display = 'none';
        line.setAttribute('visibility', 'hidden');
    }
}

export function updateTags(camera, time) {
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;

    tagElements.forEach((tag) => {
        const birth = getRingBirth(tag.ringIdx, time);

        // Hysteresis: show when birth rises above threshold, hide when drops below
        if (!tag.visible && birth > BIRTH_SHOW_THRESHOLD) {
            tag.visible = true;
            tag.initialized = false; // snap to new position on reappearance
        } else if (tag.visible && birth < BIRTH_HIDE_THRESHOLD) {
            tag.visible = false;
        }

        if (!tag.visible) {
            tag.box.style.display = 'none';
            tag.marker.style.display = 'none';
            tag.line.setAttribute('visibility', 'hidden');
            return;
        }

        // Get ring world position
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

        // Off-screen check
        if (targetX < -200 || targetX > window.innerWidth + 200 ||
            targetY < -200 || targetY > window.innerHeight + 200) {
            tag.box.style.display = 'none';
            tag.marker.style.display = 'none';
            tag.line.setAttribute('visibility', 'hidden');
            return;
        }

        // Compute box offset direction: radially outward from screen center
        const dx = targetX - halfW;
        const dy = targetY - halfH;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const idealBoxX = targetX + (dx / len) * BOX_OFFSET_DISTANCE;
        const idealBoxY = targetY + (dy / len) * BOX_OFFSET_DISTANCE;

        // Initialize (snap) or lerp
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

        // Fade opacity with birth — tags fade in as ring forms
        const opacity = Math.min(1.0, (birth - BIRTH_SHOW_THRESHOLD) / (0.5 - BIRTH_SHOW_THRESHOLD));

        // Position box
        tag.box.style.display = 'block';
        tag.box.style.left = `${tag.boxX}px`;
        tag.box.style.top = `${tag.boxY}px`;
        tag.box.style.opacity = opacity;

        // Position marker
        tag.marker.style.display = 'block';
        tag.marker.style.left = `${tag.markerX - 3}px`;
        tag.marker.style.top = `${tag.markerY - 3}px`;
        tag.marker.style.opacity = opacity;

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
        tag.line.setAttribute('opacity', opacity);
    });
}

export function updateTagColors(hexArray) {
    const color = secondLightestColor(hexArray);

    if (container) {
        container.style.setProperty('--tag-color', color);
        container.style.setProperty('--tag-color-dim', color);
    }

    tagElements.forEach((tag) => {
        tag.line.setAttribute('stroke', color);
    });
}
