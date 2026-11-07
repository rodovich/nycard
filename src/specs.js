// Paper Culture's "5X7FLAT" DIY template: the card trims to 5.125" x 7.0" and
// each side's upload is 5.25" x 7.125", i.e. 1/16" of bleed on every edge.
// https://help.paperculture.com/hc/en-us/articles/204773288
// 400 dpi makes both dimensions whole pixels.
export const DPI = 400;
export const TRIM_SHORT_IN = 5.125;
export const TRIM_LONG_IN = 7;
export const BLEED_IN = 0.0625;
// Measured inward from the trim line.
export const SAFE_IN = 0.125;

export const BLEED_PX = BLEED_IN * DPI;
export const SAFE_PX = SAFE_IN * DPI;

export const SIDES = ['front', 'back'];

export const ptToPx = (pt) => (pt / 72) * DPI;
export const pxToPt = (px) => (px / DPI) * 72;

/** Full-bleed canvas size in print pixels. */
export function canvasSize(orientation) {
  const short = (TRIM_SHORT_IN + 2 * BLEED_IN) * DPI;
  const long = (TRIM_LONG_IN + 2 * BLEED_IN) * DPI;
  return orientation === 'landscape' ? { w: long, h: short } : { w: short, h: long };
}

const inset = (r, d) => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });

export function bleedRect(orientation) {
  const { w, h } = canvasSize(orientation);
  return { x: -w / 2, y: -h / 2, w, h };
}
export const trimRect = (orientation) => inset(bleedRect(orientation), BLEED_PX);
export const safeRect = (orientation) => inset(trimRect(orientation), SAFE_PX);

export function specSummary(orientation) {
  const { w, h } = canvasSize(orientation);
  const inches = (a, b) => `${a}×${b} in`;
  const [tw, th] = orientation === 'landscape' ? [TRIM_LONG_IN, TRIM_SHORT_IN] : [TRIM_SHORT_IN, TRIM_LONG_IN];
  return `Trims to ${inches(tw, th)} · uploads are ${inches(w / DPI, h / DPI)}, ${w}×${h} px JPEG at ${DPI} dpi`;
}
