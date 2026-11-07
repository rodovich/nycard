import { bleedRect, ptToPx, trimRect } from './specs.js';

// Rects are [x, y, w, h] as fractions of the trim box. An edge at 0 or 1 runs
// out through the bleed, so a rect touching the trim edge prints full-bleed.
// Text slots are [x, y, w, h, pt, align, light?]; text is centered vertically in its slot.
const DARK = '#1d1d1f';
const LIGHT = '#ffffff';
const HEADING = 'Happy New Year';
const SIGNATURE = 'With love from all of us';

const layout = (name, images, texts) => ({ name, images, texts });

const PORTRAIT = [
  layout('Full bleed, title over photo', [[0, 0, 1, 1]], [[0.08, 0.78, 0.84, 0.14, 32, 'center', true]]),
  layout('Photo above, title and signature', [[0, 0, 1, 0.72]], [
    [0.08, 0.75, 0.84, 0.11, 30, 'center'],
    [0.08, 0.86, 0.84, 0.08, 14, 'center'],
  ]),
  layout('Framed photo', [[0.08, 0.08, 0.84, 0.68]], [[0.08, 0.8, 0.84, 0.12, 28, 'center']]),
  layout('Square photo between lines', [[0.12, 0.2, 0.76, 0.556]], [
    [0.08, 0.05, 0.84, 0.12, 26, 'center'],
    [0.08, 0.81, 0.84, 0.1, 16, 'center'],
  ]),
  layout('Title above full-bleed photo', [[0, 0.3, 1, 0.7]], [[0.08, 0.06, 0.84, 0.2, 34, 'center']]),
  layout('Tall photo, title beside', [[0.34, 0, 0.66, 1]], [[0.05, 0.1, 0.26, 0.5, 20, 'left']]),

  layout('Stacked, title over lower photo', [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]], [
    [0.08, 0.84, 0.84, 0.1, 28, 'center', true],
  ]),
  layout('Stacked with margins', [[0.06, 0.05, 0.88, 0.38], [0.06, 0.45, 0.88, 0.38]], [
    [0.06, 0.85, 0.88, 0.11, 26, 'center'],
  ]),
  layout('Full bleed with inset', [[0, 0, 1, 1], [0.55, 0.06, 0.39, 0.28]], [
    [0.06, 0.8, 0.88, 0.14, 32, 'left', true],
  ]),
  layout('Side by side', [[0.06, 0.22, 0.43, 0.56], [0.51, 0.22, 0.43, 0.56]], [
    [0.06, 0.05, 0.88, 0.14, 30, 'center'],
    [0.06, 0.82, 0.88, 0.1, 16, 'center'],
  ]),
  layout('Overlapping', [[0.06, 0.06, 0.6, 0.42], [0.34, 0.4, 0.6, 0.42]], [
    [0.06, 0.86, 0.88, 0.1, 22, 'right'],
  ]),

  layout('Large photo, two below', [[0, 0, 1, 0.6], [0.06, 0.63, 0.43, 0.24], [0.51, 0.63, 0.43, 0.24]], [
    [0.06, 0.89, 0.88, 0.09, 20, 'center'],
  ]),
  layout('Three bands', [[0, 0, 1, 0.333], [0, 0.333, 1, 0.334], [0, 0.667, 1, 0.333]], [
    [0.08, 0.43, 0.84, 0.14, 30, 'center', true],
  ]),
  layout('Column and two photos', [[0.06, 0.06, 0.52, 0.7], [0.6, 0.06, 0.34, 0.34], [0.6, 0.42, 0.34, 0.34]], [
    [0.06, 0.79, 0.88, 0.1, 28, 'left'],
    [0.06, 0.89, 0.88, 0.07, 14, 'left'],
  ]),
  layout('Scattered', [[0.08, 0.06, 0.5, 0.3], [0.42, 0.33, 0.5, 0.3], [0.08, 0.6, 0.5, 0.3]], [
    [0.62, 0.68, 0.32, 0.24, 20, 'left'],
  ]),
  layout('Row of three', [[0.06, 0.36, 0.28, 0.24], [0.36, 0.36, 0.28, 0.24], [0.66, 0.36, 0.28, 0.24]], [
    [0.06, 0.1, 0.88, 0.2, 34, 'center'],
    [0.06, 0.66, 0.88, 0.1, 16, 'center'],
  ]),

  layout('Grid, title over center', [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]], [
    [0.12, 0.43, 0.76, 0.14, 28, 'center', true],
  ]),
  layout('Grid with margins', [
    [0.06, 0.05, 0.43, 0.35], [0.51, 0.05, 0.43, 0.35], [0.06, 0.42, 0.43, 0.35], [0.51, 0.42, 0.43, 0.35],
  ], [
    [0.06, 0.79, 0.88, 0.11, 28, 'center'],
    [0.06, 0.9, 0.88, 0.07, 14, 'center'],
  ]),
  layout('Large photo, three below', [
    [0, 0, 1, 0.62], [0.06, 0.65, 0.28, 0.21], [0.36, 0.65, 0.28, 0.21], [0.66, 0.65, 0.28, 0.21],
  ], [[0.06, 0.88, 0.88, 0.09, 18, 'center']]),
  layout('Filmstrip', [
    [0.06, 0.04, 0.3, 0.22], [0.06, 0.28, 0.3, 0.22], [0.06, 0.52, 0.3, 0.22], [0.06, 0.76, 0.3, 0.2],
  ], [
    [0.42, 0.28, 0.52, 0.26, 30, 'left'],
    [0.42, 0.56, 0.52, 0.14, 14, 'left'],
  ]),
  layout('Mosaic', [[0, 0, 0.62, 0.45], [0.62, 0, 0.38, 0.45], [0, 0.45, 0.38, 0.55], [0.38, 0.45, 0.62, 0.55]], [
    [0.42, 0.84, 0.52, 0.11, 22, 'right', true],
  ]),
];

const LANDSCAPE = [
  layout('Full bleed, title over photo', [[0, 0, 1, 1]], [[0.06, 0.7, 0.6, 0.22, 34, 'left', true]]),
  layout('Photo left, words right', [[0, 0, 0.6, 1]], [
    [0.64, 0.28, 0.32, 0.26, 30, 'center'],
    [0.64, 0.56, 0.32, 0.16, 14, 'center'],
  ]),
  layout('Framed photo', [[0.06, 0.08, 0.88, 0.7]], [[0.06, 0.81, 0.88, 0.13, 26, 'center']]),
  layout('Square photo, title beside', [[0.35, 0.08, 0.615, 0.84]], [[0.04, 0.3, 0.28, 0.4, 24, 'left']]),
  layout('Banner photo', [[0, 0.25, 1, 0.5]], [
    [0.06, 0.04, 0.88, 0.18, 30, 'center'],
    [0.06, 0.79, 0.88, 0.16, 16, 'center'],
  ]),

  layout('Side by side, title over both', [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]], [
    [0.1, 0.76, 0.8, 0.16, 30, 'center', true],
  ]),
  layout('Two framed photos', [[0.05, 0.08, 0.44, 0.7], [0.51, 0.08, 0.44, 0.7]], [
    [0.05, 0.81, 0.9, 0.13, 26, 'center'],
  ]),
  layout('Full bleed with inset', [[0, 0, 1, 1], [0.68, 0.08, 0.27, 0.4]], [
    [0.05, 0.74, 0.55, 0.2, 32, 'left', true],
  ]),
  layout('Overlapping', [[0.05, 0.08, 0.5, 0.58], [0.4, 0.34, 0.5, 0.58]], [
    [0.05, 0.74, 0.32, 0.2, 20, 'left'],
  ]),
  layout('Photos at the edges', [[0, 0, 0.33, 1], [0.67, 0, 0.33, 1]], [
    [0.35, 0.28, 0.3, 0.28, 28, 'center'],
    [0.35, 0.58, 0.3, 0.16, 14, 'center'],
  ]),

  layout('Large photo, two stacked', [[0, 0, 0.62, 1], [0.62, 0, 0.38, 0.5], [0.62, 0.5, 0.38, 0.5]], [
    [0.05, 0.76, 0.52, 0.17, 28, 'left', true],
  ]),
  layout('Three columns', [[0.05, 0.2, 0.28, 0.6], [0.36, 0.2, 0.28, 0.6], [0.67, 0.2, 0.28, 0.6]], [
    [0.05, 0.03, 0.9, 0.15, 28, 'center'],
    [0.05, 0.83, 0.9, 0.13, 14, 'center'],
  ]),
  layout('Three bands', [[0, 0, 0.333, 1], [0.333, 0, 0.334, 1], [0.667, 0, 0.333, 1]], [
    [0.1, 0.41, 0.8, 0.18, 32, 'center', true],
  ]),
  layout('Scattered', [[0.04, 0.08, 0.38, 0.44], [0.3, 0.48, 0.38, 0.44], [0.58, 0.06, 0.38, 0.44]], [
    [0.72, 0.58, 0.25, 0.32, 20, 'left'],
  ]),
  layout('Row under a title', [[0.05, 0.38, 0.28, 0.4], [0.36, 0.38, 0.28, 0.4], [0.67, 0.38, 0.28, 0.4]], [
    [0.05, 0.06, 0.9, 0.26, 36, 'center'],
  ]),

  layout('Grid, title over center', [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]], [
    [0.2, 0.41, 0.6, 0.18, 30, 'center', true],
  ]),
  layout('Grid, words beside', [
    [0.04, 0.06, 0.3, 0.43], [0.36, 0.06, 0.3, 0.43], [0.04, 0.51, 0.3, 0.43], [0.36, 0.51, 0.3, 0.43],
  ], [
    [0.7, 0.28, 0.26, 0.26, 28, 'left'],
    [0.7, 0.56, 0.26, 0.16, 14, 'left'],
  ]),
  layout('Large photo, three stacked', [
    [0, 0, 0.7, 1], [0.72, 0.04, 0.25, 0.29], [0.72, 0.355, 0.25, 0.29], [0.72, 0.67, 0.25, 0.29],
  ], [[0.05, 0.78, 0.6, 0.16, 28, 'left', true]]),
  layout('Row of four', [
    [0.04, 0.3, 0.22, 0.42], [0.28, 0.3, 0.22, 0.42], [0.52, 0.3, 0.22, 0.42], [0.76, 0.3, 0.22, 0.42],
  ], [
    [0.04, 0.05, 0.92, 0.2, 32, 'center'],
    [0.04, 0.78, 0.92, 0.15, 14, 'center'],
  ]),
  layout('Mosaic', [[0, 0, 0.4, 0.6], [0.4, 0, 0.6, 0.6], [0, 0.6, 0.6, 0.4], [0.6, 0.6, 0.4, 0.4]], [
    [0.45, 0.05, 0.5, 0.16, 24, 'right', true],
  ]),
];

export const LAYOUTS = { portrait: PORTRAIT, landscape: LANDSCAPE };

export function layoutSlots({ images, texts }, orientation) {
  const t = trimRect(orientation);
  const b = bleedRect(orientation);
  const EDGE = 0.001;
  const toCard = ([x, y, w, h]) => {
    const left = x <= EDGE ? b.x : t.x + x * t.w;
    const top = y <= EDGE ? b.y : t.y + y * t.h;
    const right = x + w >= 1 - EDGE ? b.x + b.w : t.x + (x + w) * t.w;
    const bottom = y + h >= 1 - EDGE ? b.y + b.h : t.y + (y + h) * t.h;
    return { x: left, y: top, w: right - left, h: bottom - top };
  };
  return {
    images: images.map(toCard),
    texts: texts.map(([x, y, w, h, pt, align, light], i) => ({
      slot: toCard([x, y, w, h]),
      size: ptToPx(pt),
      align,
      color: light ? LIGHT : DARK,
      text: i === 0 ? HEADING : SIGNATURE,
    })),
  };
}
