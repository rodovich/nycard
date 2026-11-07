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

/** Matches CSS line-box layout: the glyphs' ascent and descent are centered in each line. */
export function drawText(ctx, t) {
  const { frame: f } = t;
  ctx.font = fontSpec(t);
  ctx.fillStyle = t.color;
  ctx.textAlign = t.align;
  ctx.textBaseline = 'alphabetic';
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = ctx.measureText('');
  const lineHeight = t.size * LINE_HEIGHT;
  const x = { left: f.x, center: f.x + f.w / 2, right: f.x + f.w }[t.align];
  layoutLines(t).forEach((line, i) => {
    ctx.fillText(line, x, f.y + i * lineHeight + (lineHeight - ascent - descent) / 2 + ascent);
  });
}
