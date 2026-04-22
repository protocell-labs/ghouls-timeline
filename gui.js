import { PALETTES } from './palettes.js';
import { setPalette } from './postprocessing.js';
import { setMaterialType, setSkullGlitchEnabled } from './skull.js';
import { updateTagColors } from './tags.js';

export function initGUI(quantizePass) {
    // Create one container for all GUI controls
    const guiWrap = document.createElement('div');
    guiWrap.id = 'gui-container';
    document.body.appendChild(guiWrap);

    // Palette GUI
    function makePaletteGUI(defaultKey = 'CGA 8') {
        const wrap = document.createElement('div');

        const label = document.createElement('label');
        label.textContent = 'PALETTE';
        wrap.appendChild(label);

        const select = document.createElement('select');
        for (const name of Object.keys(PALETTES)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        }
        select.value = defaultKey;
        wrap.appendChild(select);

        // append into main container
        guiWrap.appendChild(wrap);

        // apply initial palette
        setPalette(quantizePass, PALETTES[select.value]);
        updateTagColors(PALETTES[select.value]);

        select.addEventListener('change', () => {
            setPalette(quantizePass, PALETTES[select.value]);
            updateTagColors(PALETTES[select.value]);
        });
    }

    // Material GUI
    function makeMaterialGUI(defaultKey = 'Lambert') {
        const wrap = document.createElement('div');

        const label = document.createElement('label');
        label.textContent = 'MATERIAL';
        wrap.appendChild(label);

        const select = document.createElement('select');
        const materialTypes = ['Normal', 'Lambert'];

        materialTypes.forEach((name) => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });

        select.value = defaultKey;
        wrap.appendChild(select);

        // append into main container
        guiWrap.appendChild(wrap);

        // update material via skull module
        setMaterialType(select.value);

        select.addEventListener('change', () => {
            setMaterialType(select.value);
        });
    }

    // Dither GUI
    function makeDitherGUI() {
        const wrap = document.createElement('div');

        // Toggle
        const toggleLabel = document.createElement('label');
        toggleLabel.style.display = 'flex';
        toggleLabel.style.alignItems = 'center';
        toggleLabel.style.gap = '6px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        toggleLabel.appendChild(checkbox);
        toggleLabel.appendChild(document.createTextNode('DITHER'));
        wrap.appendChild(toggleLabel);

        let savedStrength = quantizePass.uniforms.ditherStrength.value;

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                quantizePass.uniforms.ditherStrength.value = savedStrength;
            } else {
                savedStrength = quantizePass.uniforms.ditherStrength.value;
                quantizePass.uniforms.ditherStrength.value = 0.0;
            }
        });

        // Pixel size
        const pxLabel = document.createElement('label');
        pxLabel.textContent = 'PX SIZE';
        wrap.appendChild(pxLabel);

        const pxInput = document.createElement('input');
        pxInput.type = 'number';
        pxInput.min = '1';
        pxInput.max = '20';
        pxInput.step = '1';
        pxInput.value = String(quantizePass.uniforms.pxFactor.value);
        wrap.appendChild(pxInput);

        pxInput.addEventListener('input', () => {
            const val = parseFloat(pxInput.value);
            if (val >= 1 && val <= 20) {
                quantizePass.uniforms.pxFactor.value = val;
            }
        });

        guiWrap.appendChild(wrap);
    }

    // Glitch GUI
    function makeGlitchGUI() {
        const wrap = document.createElement('div');
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '6px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', () => {
            setSkullGlitchEnabled(checkbox.checked);
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode('GLITCH'));
        wrap.appendChild(label);
        guiWrap.appendChild(wrap);
    }

    // Init palettes GUI - sets default palette at random
    makePaletteGUI(Object.keys(PALETTES)[Math.floor(Math.random() * Object.keys(PALETTES).length)]);
    makeMaterialGUI('Lambert');
    makeDitherGUI();
    makeGlitchGUI();
}
