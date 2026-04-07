import { PALETTES } from './palettes.js';
import { setPalette } from './postprocessing.js';
import { setMaterialType } from './skull.js';
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

    // Init palettes GUI - sets default palette at random
    makePaletteGUI(Object.keys(PALETTES)[Math.floor(Math.random() * Object.keys(PALETTES).length)]);
    makeMaterialGUI('Lambert');
}
