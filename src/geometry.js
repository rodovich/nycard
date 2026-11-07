export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const offsetRect = (r, dx, dy) => ({ ...r, x: r.x + dx, y: r.y + dy });

/** Scales `r` by `k` about point `from`, then moves `from` to `to` (default: stays put). */
export const scaleRect = (r, k, from, to = from) => ({
  x: to.x + (r.x - from.x) * k,
  y: to.y + (r.y - from.y) * k,
  w: r.w * k,
  h: r.h * k,
});

export function unionRect(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

export const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The rectangle spanning two corner points, in either order. */
export const rectFromPoints = (p, q) => ({
  x: Math.min(p.x, q.x),
  y: Math.min(p.y, q.y),
  w: Math.abs(p.x - q.x),
  h: Math.abs(p.y - q.y),
});

/** Start, center and end of `r` along `axis` ('x' or 'y'). */
export const alignLines = (r, axis) =>
  axis === 'x' ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h];

export function coverRect(size, box) {
  return centeredIn(size, Math.max(box.w / size.width, box.h / size.height), box);
}

export function containRect(size, box) {
  return centeredIn(size, Math.min(box.w / size.width, box.h / size.height), box);
}

function centeredIn(size, k, box) {
  const w = size.width * k;
  const h = size.height * k;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
