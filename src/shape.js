import { clamp } from './geometry.js';

// Left and right sides stay vertical; only the top and bottom edges slant.
// A positive `shape.drop` moves the left end of each slanted edge that many
// print px in toward the middle; a negative drop moves the right end instead.
// The parallelogram's bottom edge is mirrored so its edges stay parallel.
export const SHAPES = {
  rect: 'Rectangle',
  parallelogram: 'Parallelogram',
  trapezoid: 'Trapezoid',
  top: 'Angled top',
  bottom: 'Angled bottom',
};

export const slantedEdges = (type) => ({ parallelogram: 1, trapezoid: 2, top: 1, bottom: 1 })[type] ?? 0;
export const shapeType = (item) => item.shape?.type ?? 'rect';
export const isShaped = (item) => slantedEdges(shapeType(item)) > 0;

/** Leaves at least a tenth of an image's height on each vertical side. */
export const imageDropLimit = (item, type) => (0.9 * item.frame.h) / slantedEdges(type);

// Applied when drawing as well as when editing, since cropping can shorten an image after its drop is set.
function effectiveDrop(item) {
  const { type, drop = 0 } = item.shape ?? {};
  if (!slantedEdges(type)) return 0;
  if (item.kind === 'text') return drop;
  const limit = imageDropLimit(item, type);
  return clamp(drop, -limit, limit);
}

/** How far each end of the top edge sits below the frame top, and each end of the bottom edge above the frame bottom. */
export function shapeInsets(item) {
  const d = effectiveDrop(item);
  const slant = [Math.max(d, 0), Math.max(-d, 0)];
  const flat = [0, 0];
  const insets = {
    parallelogram: { top: slant, bottom: [slant[1], slant[0]] },
    trapezoid: { top: slant, bottom: slant },
    top: { top: slant, bottom: flat },
    bottom: { top: flat, bottom: slant },
  };
  return insets[item.shape?.type] ?? { top: flat, bottom: flat };
}

export const slantHeight = (item) => slantedEdges(item.shape?.type) * Math.abs(item.shape?.drop ?? 0);

/** Corners relative to the frame's top-left, clockwise from top-left. */
export function shapePolygon(item) {
  const { w, h } = item.frame;
  const { top: [tl, tr], bottom: [bl, br] } = shapeInsets(item);
  return [[0, tl], [w, tr], [w, h - br], [0, h - bl]];
}

/** The top and bottom edges in card coordinates, each as [[x0, y0], [x1, y1]] from left to right. */
export function topAndBottomEdges(item) {
  const { x, y } = item.frame;
  const [tl, tr, br, bl] = shapePolygon(item).map(([px, py]) => [x + px, y + py]);
  return [[tl, tr], [bl, br]];
}

export const edgeSlope = ([[x0, y0], [x1, y1]]) => (y1 - y0) / (x1 - x0);

/**
 * The drop that gives the item's angle-handle edge this slope. A positive drop lowers
 * the left end of a top edge (negative slope) and raises the left end of a bottom edge.
 */
export const dropForSlope = (item, slope) => (shapeType(item) === 'bottom' ? 1 : -1) * slope * item.frame.w;

/** Points near each end of the slanted edge, set in from the corners so they don't cover the resize handles. */
export function angleHandlePoints(item) {
  const [tl, tr, br, bl] = shapePolygon(item);
  const [[x0, y0], [x1, y1]] = shapeType(item) === 'bottom' ? [bl, br] : [tl, tr];
  return [0.15, 0.85].map((t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
}
