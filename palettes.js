// PALETTES - colors in the scene will be "snapped" to the closest of these

// 🎮 CGA 8-color (IBM PC, 1981)
const palette_cga8 = [
    '#000000', // black
    '#55ffff', // cyan
    '#ff55ff', // magenta
    '#ffffff', // white
    '#555555', // dark gray
    '#55ff55', // green
    '#ff5555', // red
    '#ffff55'  // yellow
];

// 🕹️ Commodore 64 base colors
const palette_c64 = [
    '#000000', // black
    '#ffffff', // white
    '#880000', // red
    '#aaffee', // cyan
    '#cc44cc', // purple
    '#00cc55', // green
    '#0000aa', // blue
    '#eeee77'  // yellow
];

// 📺 Game Boy 4-tone monochrome (pea-soup LCD)
const palette_gameboy = [
    '#0f380f', // darkest green
    '#306230', // dark green
    '#8bac0f', // light green
    '#9bbc0f'  // lightest green
];

// 🌈 ZX Spectrum bright set
const palette_zx_spectrum = [
    '#000000', // black
    '#ff0000', // bright red
    '#00ff00', // bright green
    '#0000ff', // bright blue
    '#ffff00', // bright yellow
    '#ff00ff', // bright magenta
    '#00ffff', // bright cyan
    '#ffffff'  // white
];

// 🖥️ Windows / EGA 16-color cutdown
const palette_ega8 = [
    '#000000', // black
    '#800000', // maroon
    '#008000', // green
    '#808000', // olive
    '#000080', // navy
    '#800080', // purple
    '#008080', // teal
    '#c0c0c0'  // silver
];

// 🎨 VGA 16-color (standard DOS palette)
const palette_vga16 = [
    '#000000', // black
    '#0000AA', // blue
    '#00AA00', // green
    '#00AAAA', // cyan
    '#AA0000', // red
    '#AA00AA', // magenta
    '#AA5500', // brown
    '#AAAAAA', // light gray
    '#555555', // dark gray
    '#5555FF', // bright blue
    '#55FF55', // bright green
    '#55FFFF', // bright cyan
    '#FF5555', // bright red
    '#FF55FF', // bright magenta
    '#FFFF55', // bright yellow
    '#FFFFFF'  // white
];

// 🕹️ Commodore 64 full 16-color palette
const palette_c64_16 = [
    '#000000', // black
    '#FFFFFF', // white
    '#880000', // red
    '#AAFFEE', // cyan
    '#CC44CC', // purple
    '#00CC55', // green
    '#0000AA', // blue
    '#EEEE77', // yellow
    '#DD8855', // orange
    '#664400', // brown
    '#FF7777', // light red
    '#333333', // dark gray
    '#777777', // medium gray
    '#AAFF66', // light green
    '#0088FF', // light blue
    '#BBBBBB'  // light gray
];

// 🌈 ZX Spectrum 16-color (bright + normal versions)
const palette_zx_spectrum16 = [
    '#000000', // black
    '#0000D7', // blue
    '#D70000', // red
    '#D700D7', // magenta
    '#00D700', // green
    '#00D7D7', // cyan
    '#D7D700', // yellow
    '#D7D7D7', // white (bright gray)
    '#1a1a1a', // dark gray
    '#0000FF', // bright blue
    '#FF0000', // bright red
    '#FF00FF', // bright magenta
    '#00FF00', // bright green
    '#00FFFF', // bright cyan
    '#FFFF00', // bright yellow
    '#FFFFFF'  // bright white
];

// 🖥️ EGA 16-color (classic PC graphics)
const palette_ega16 = [
    '#000000', // black
    '#0000AA', // blue
    '#00AA00', // green
    '#00AAAA', // cyan
    '#AA0000', // red
    '#AA00AA', // magenta
    '#AA5500', // brown
    '#AAAAAA', // light gray
    '#555555', // dark gray
    '#5555FF', // bright blue
    '#55FF55', // bright green
    '#55FFFF', // bright cyan
    '#FF5555', // bright red
    '#FF55FF', // bright magenta
    '#FFFF55', // bright yellow
    '#FFFFFF'  // white
];

// 🟢 Game Boy 16-color (expanded pea-soup)
const palette_gameboy16 = [
    '#0f380f', '#183c16', '#306230', '#467d47',
    '#5b985c', '#72b273', '#89cd8a', '#a1e5a2',
    '#0c280c', '#204620', '#397239', '#4e8d4e',
    '#66a766', '#7dc07d', '#94d894', '#b2f0b2'
];

// 🟤 LCARS Style (Star Trek UI color scheme)
const palette_lcars = [
    '#000000', '#ff9966', '#ffcc66', '#ff6699',
    '#cc66ff', '#9966ff', '#6699ff', '#66ccff',
    '#66ffcc', '#66ff99', '#99ff66', '#ccff66',
    '#ffcc99', '#ff99cc', '#ff66cc', '#ffffff'
];

// 🟠 Retro EVA / Magi System (inspired by Neon Genesis Evangelion HUDs)
const palette_eva = [
    '#000000', '#ff3300', '#ff6600', '#ff9900',
    '#ffcc00', '#ffff00', '#00ffcc', '#00ffff',
    '#00ccff', '#0099ff', '#0066ff', '#0033ff',
    '#ff0033', '#ff0066', '#ff0099', '#ffffff'
];

// 🟢 Classic Monochrome Green CRT (8 shades)
const palette_green_mono = [
    '#000000', '#003300', '#006600', '#00aa00',
    '#00cc00', '#00ff00', '#aaffaa', '#ffffff'
];

// 🟡 Amber Monochrome CRT (8 shades)
// with BMAS color '#f29b30'
const palette_amber_mono = [
    '#000000', '#663300', '#ff5c00',
    '#cc6600', '#f29b30', '#ffff00'
];

// old Amber Monochrome CRT
/*const palette_amber_mono = [
    '#000000', '#331900', '#663300', '#ff5c00',
    '#cc6600', '#ffaa55', '#ffd4aa', '#ffffff'
];*/

// 🟣 Magenta / Pink Monochrome (8 shades)
const palette_magenta_mono = [
    '#000000', '#330033', '#660066', '#990099',
    '#cc00cc', '#ff00ff', '#ff99ff', '#ffffff'
];

// 🔵 Classic Monochrome Blue CRT (8 shades)
const palette_blue_mono = [
    '#000000', '#000033', '#000066', '#0000aa',
    '#0000cc', '#0000ff', '#aaaaff', '#ffffff'
];

// 🔵 Cyan-Tinted Monochrome CRT (8 shades)
const palette_cyan_mono = [
    '#000000', '#003333', '#006666', '#009999',
    '#00cccc', '#00ffff', '#aaffff', '#ffffff'
];

// ⚫️⚪️ Black & white (2 shades)
const palette_mono = [
    '#000000', '#ffffff'
];


// register palette names so we can select them from a menu
const PALETTES = {
    'CGA 8': palette_cga8,
    'VGA 16': palette_vga16,

    'C64 8': palette_c64,
    'C64 16': palette_c64_16,

    'Game Boy 4': palette_gameboy,
    'Game Boy 16': palette_gameboy16,

    'ZX Spectrum 8': palette_zx_spectrum,
    'ZX Spectrum 16': palette_zx_spectrum16,

    'EGA 8': palette_ega8,
    'EGA 16': palette_ega16,

    'LCARS': palette_lcars,
    'EVA HUD': palette_eva,

    'Green Mono 8': palette_green_mono,
    'Amber Mono 8': palette_amber_mono,
    'Magenta Mono 8': palette_magenta_mono,
    'Blue Mono 8': palette_blue_mono,
    'Cyan Mono 8': palette_cyan_mono,
    'Mono 2': palette_mono
};