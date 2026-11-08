import { normalizeAngle } from './geometry.js';

/** The closest of `targets` within `tolerance` of `angle`, or `angle` if there is none. All in radians. */
export const snapAngle = (angle, targets, tolerance) =>
  snapper(targets.map((t) => angle + normalizeAngle(t - angle)), tolerance).snap(angle);

/** Snaps positions on one axis to the nearest of `lines` within `threshold`. */
export function snapper(lines, threshold) {
  // The shift that puts the closest of `values` on a line, or 0 if none is within the threshold.
  const delta = (values) => {
    let best = 0;
    let bestDist = threshold;
    for (const v of values) {
      for (const t of lines) {
        const d = Math.abs(t - v);
        if (d <= bestDist) {
          bestDist = d;
          best = t - v;
        }
      }
    }
    return best;
  };
  return {
    delta,
    snap: (v) => v + delta([v]),
    // Lines that `values` sit on, for drawing guides.
    touching: (values) => lines.filter((t) => values.some((v) => Math.abs(t - v) < 0.5)),
  };
}
