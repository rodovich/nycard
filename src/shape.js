import { clamp, rectFromPoints, rotatedBounds, rotateVector } from './geometry.js';

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

/** The top and bottom edges in card coordinates, each as [[x0, y0], [x1, y1]] from the item's own left to its right. */
export function topAndBottomEdges(item) {
  const { x, y, w, h } = item.frame;
  const [tl, tr, br, bl] = shapePolygon(item).map(([px, py]) => {
    const [rx, ry] = rotateVector(px - w / 2, py - h / 2, itemRotation(item));
    return [x + w / 2 + rx, y + h / 2 + ry];
  });
  return [[tl, tr], [bl, br]];
}

/**
 * The drop that gives the item's angle-handle edge this slope. A positive drop lowers
 * the left end of a top edge (negative slope) and raises the left end of a bottom edge.
 */
export const dropForSlope = (item, slope) => (shapeType(item) === 'bottom' ? 1 : -1) * slope * item.frame.w;

/** The sign of the drop that insets the handle's own end. */
export const angleHandleSign = (handle) => (handle === 'angle-left' ? 1 : -1);

export const angleHandleShown = (item, handle) =>
  isShaped(item) && angleHandleSign(handle) * item.shape.drop >= 0;

/** Points near each end of the slanted edge, set in from the corners so they don't cover the resize handles. */
export function angleHandlePoints(item) {
  const [tl, tr, br, bl] = shapePolygon(item);
  const [[x0, y0], [x1, y1]] = shapeType(item) === 'bottom' ? [bl, br] : [tl, tr];
  return [0.15, 0.85].map((t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
}

export const isLine = (item) => item.kind === 'line';
export const isCircle = (item) => item.kind === 'circle';
export const isDrawn = (item) => item.kind === 'shape' || isCircle(item) || isLine(item);

/** Radians clockwise about the frame's center. */
export const itemRotation = (item) => item.rotation ?? 0;
/** A circle looks the same at any angle, and dragging a line's ends already turns it. */
export const canRotate = (item) => !isCircle(item) && !isLine(item);
export const itemBounds = (item) => rotatedBounds(item.frame, itemRotation(item));

/** The rotations that line the item up with the card or with any of `angles`, at every quarter turn. */
export function rotationTargets(item, angles) {
  const own = ownEdgeAngles(item);
  return [0, ...angles].flatMap((angle) => own.flatMap((o) => [0, 1, 2, 3].map((k) => angle - o + (k * Math.PI) / 2)));
}

/** The angles of the item's edges, before its rotation; 0 is the frame's own horizontal. */
export function ownEdgeAngles(item) {
  return [0, ...topAndBottomEdges({ ...item, rotation: 0 }).map(edgeAngle)];
}

/** A line's two ends relative to its frame's top-left, left end first. */
export function lineLocalEnds({ frame: { w, h }, rising }) {
  return rising ? [[0, h], [w, 0]] : [[0, 0], [w, h]];
}

/** A line's two ends in card coordinates, left end first. */
export const lineEnds = (item) => lineLocalEnds(item).map(([x, y]) => [item.frame.x + x, item.frame.y + y]);

/** The frame and direction of a line between two points given in either order. */
export function lineFromEnds([x0, y0], [x1, y1]) {
  return { frame: rectFromPoints({ x: x0, y: y0 }, { x: x1, y: y1 }), rising: (x1 - x0) * (y1 - y0) < 0 };
}

export function angledEdges(item) {
  if (isLine(item)) return [lineEnds(item)];
  return isShaped(item) || item.rotation ? topAndBottomEdges(item) : [];
}

export const edgeAngle = ([[x0, y0], [x1, y1]]) => Math.atan2(y1 - y0, x1 - x0);

export const isParallel = (a, b) => Math.abs(Math.sin(a - b)) < 1e-6;

/**
 * The one of `angles` (radians) whose line through `from` passes closest to `to`,
 * or null if none passes within `tolerance`.
 */
export function nearestAngle(from, to, angles, tolerance) {
  let best = null;
  let bestDist = tolerance;
  for (const angle of angles) {
    const dist = Math.abs((to[0] - from[0]) * Math.sin(angle) - (to[1] - from[1]) * Math.cos(angle));
    if (dist <= bestDist) {
      bestDist = dist;
      best = angle;
    }
  }
  return best;
}

/** SVG path data for a drawn item, relative to its frame's top-left. */
export function drawnPath(item) {
  const { w, h } = item.frame;
  if (isLine(item)) return `M${lineLocalEnds(item).join('L')}`;
  if (isCircle(item)) return `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`;
  return `M${shapePolygon(item).join('L')}Z`;
}
