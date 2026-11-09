// Paper Culture's flat-card DIY templates, keyed by template name. Sizes are in
// inches: the card trims to short x long, and each side's upload adds `bleed`
// on every edge (5X7FLAT uploads are 5.25" x 7.125", 6X4FLAT 6.25" x 4.55").
// `safe` is measured inward from the trim line.
// https://help.paperculture.com/hc/en-us/articles/204773288
export const TEMPLATES = {
  '5X7FLAT': { short: 5.125, long: 7, bleed: 0.0625, safe: 0.35 },
  '6X4FLAT': { short: 4.3, long: 6, bleed: 0.125, safe: 0.25 },
};
export const DEFAULT_TEMPLATE = '5X7FLAT';
// 400 dpi makes every template's dimensions whole pixels.
export const DPI = 400;

export const SIDES = ['front', 'back'];

export const ptToPx = (pt) => (pt / 72) * DPI;
export const pxToPt = (px) => (px / DPI) * 72;

export function canvasSize({ template, orientation }) {
  const { short: trimShort, long: trimLong, bleed } = TEMPLATES[template];
  const short = Math.round((trimShort + 2 * bleed) * DPI);
  const long = Math.round((trimLong + 2 * bleed) * DPI);
  return orientation === 'landscape' ? { w: long, h: short } : { w: short, h: long };
}

const inset = (r, d) => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });

export function bleedRect(design) {
  const { w, h } = canvasSize(design);
  return { x: -w / 2, y: -h / 2, w, h };
}
export const trimRect = (design) => inset(bleedRect(design), TEMPLATES[design.template].bleed * DPI);
export const safeRect = (design) => inset(trimRect(design), TEMPLATES[design.template].safe * DPI);

export function specSummary(design) {
  const { w, h } = canvasSize(design);
  const trim = trimRect(design);
  const inches = (a, b) => `${a}×${b} in`;
  return `Trims to ${inches(trim.w / DPI, trim.h / DPI)} · uploads are ${inches(w / DPI, h / DPI)}, ${w}×${h} px JPEG at ${DPI} dpi`;
}
