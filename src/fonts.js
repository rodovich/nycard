import { measureWidth } from './text.js';

// Latin-script fonts that ship with macOS. Symbol fonts and fonts for other
// scripts are left out.
const MACOS_FONTS = [
  'American Typewriter', 'Andale Mono', 'Apple Chancery', 'Arial', 'Arial Black', 'Arial Narrow',
  'Arial Rounded MT Bold', 'Athelas', 'Avenir', 'Avenir Next', 'Avenir Next Condensed', 'Baskerville',
  'Big Caslon', 'Bodoni 72', 'Bodoni 72 Oldstyle', 'Bodoni 72 Smallcaps', 'Bradley Hand', 'Brush Script MT',
  'Chalkboard', 'Chalkboard SE', 'Chalkduster', 'Charter', 'Cochin', 'Comic Sans MS', 'Copperplate',
  'Courier', 'Courier New', 'Didot', 'DIN Alternate', 'DIN Condensed', 'Futura', 'Geneva', 'Georgia',
  'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Herculanum', 'Hoefler Text', 'Impact', 'Iowan Old Style',
  'Lucida Grande', 'Luminari', 'Marion', 'Marker Felt', 'Menlo', 'Monaco', 'Noteworthy', 'Optima',
  'Palatino', 'Papyrus', 'Party LET', 'Phosphate', 'Rockwell', 'Savoye LET', 'Seravek', 'SignPainter',
  'Skia', 'Snell Roundhand', 'Superclarendon', 'Tahoma', 'Times', 'Times New Roman', 'Trattatello',
  'Trebuchet MS', 'Verdana', 'Zapfino',
];

/** A missing font falls back to the generic family, so a width that differs from any fallback means it's installed. */
function isInstalled(family) {
  const sample = 'mmmmmmmmmmlli WQ@#';
  return ['monospace', 'serif', 'sans-serif'].some(
    (fallback) => measureWidth(`72px "${family}", ${fallback}`, sample) !== measureWidth(`72px ${fallback}`, sample),
  );
}

let available = 'queryLocalFonts' in window;
let families = MACOS_FONTS.filter(isInstalled);

export const fontFamilies = () => families;
export const defaultFamily = () => (families.includes('Didot') ? 'Didot' : (families[0] ?? 'serif'));
export const canListLocalFonts = () => available;

/** Prompts for permission the first time. After it succeeds or is denied, `canListLocalFonts` is false. */
export async function listLocalFonts() {
  available = false;
  const fonts = await window.queryLocalFonts();
  families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
}

/** Lists installed fonts without prompting if the user already granted access. */
export async function listLocalFontsIfGranted() {
  if (!available) return;
  const { state } = await navigator.permissions.query({ name: 'local-fonts' });
  if (state === 'granted') await listLocalFonts();
}
