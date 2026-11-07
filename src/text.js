import { shapeInsets } from './shape.js';

export const LINE_HEIGHT = 1.2;

const measure = document.createElement('canvas').getContext('2d');

export function measureWidth(font, str) {
  measure.font = font;
  return measure.measureText(str).width;
}

export function fontSpec({ italic, bold, size, font }) {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px "${font}", serif`;
}

/** The on-card display and the export both draw these lines, so they break lines identically. */
export function layoutLines(t) {
  const font = fontSpec(t);
  const lines = [];
  for (const paragraph of t.text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(?=\s)/)) {
      const candidate = line + word;
      if (line && measureWidth(font, candidate.trimEnd()) > t.frame.w) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = candidate;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export const textHeight = (t) => layoutLines(t).length * t.size * LINE_HEIGHT;

/** Each line's vertical center within the frame and the slope to skew it by. */
export function lineGeometry(t) {
  const lines = layoutLines(t);
  const { h } = t.frame;
  const { top: [tl, tr], bottom: [bl, br] } = shapeInsets(t);
  return lines.map((text, i) => {
    const v = (i + 0.5) / lines.length;
    const left = tl + v * (h - tl - bl);
    const right = tr + v * (h - tr - br);
    return { text, cy: (left + right) / 2, slope: (right - left) / t.frame.w };
  });
}

/** Matches CSS line-box layout: the glyphs' ascent and descent are centered in each line. */
export function drawText(ctx, t) {
  const { frame: f } = t;
  ctx.font = fontSpec(t);
  ctx.fillStyle = t.color;
  ctx.textAlign = t.align;
  ctx.textBaseline = 'alphabetic';
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = ctx.measureText('');
  const lineHeight = t.size * LINE_HEIGHT;
  const x = { left: -f.w / 2, center: 0, right: f.w / 2 }[t.align];
  const baseline = -lineHeight / 2 + (lineHeight - ascent - descent) / 2 + ascent;
  for (const { text, cy, slope } of lineGeometry(t)) {
    ctx.save();
    ctx.translate(f.x + f.w / 2, f.y + cy);
    ctx.transform(1, slope, 0, 1, 0, 0);
    ctx.fillText(text, x, baseline);
    ctx.restore();
  }
}
