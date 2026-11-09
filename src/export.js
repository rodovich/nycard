import { getState, isPlaceholder, isText, itemsOnSide } from './store.js';
import { drawText } from './text.js';
import { drawnPath, isDrawn, itemRotation, shapePolygon } from './shape.js';
import { getBlob } from './blobs.js';
import { canvasSize, DPI, SIDES } from './specs.js';
import { rectCenter } from './geometry.js';

function drawShape(ctx, item) {
  ctx.save();
  ctx.translate(item.frame.x, item.frame.y);
  ctx.globalAlpha = item.opacity;
  const path = new Path2D(drawnPath(item));
  if (item.stroked) {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.strokeWidth;
    ctx.stroke(path);
  } else {
    ctx.fillStyle = item.color;
    ctx.fill(path);
  }
  ctx.restore();
}

async function drawPhoto(ctx, item) {
  const { assetId, frame: f, image: r } = item;
  const bitmap = await createImageBitmap(await getBlob(assetId));
  ctx.save();
  ctx.beginPath();
  for (const [x, y] of shapePolygon(item)) ctx.lineTo(f.x + x, f.y + y);
  ctx.clip();
  ctx.drawImage(bitmap, r.x, r.y, r.w, r.h);
  ctx.restore();
  bitmap.close();
}

async function renderSide(design, side) {
  const { w, h } = canvasSize(design);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = design.backgrounds[side];
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(w / 2, h / 2);
  for (const item of itemsOnSide(side, design)) {
    if (isPlaceholder(item)) continue;
    const center = rectCenter(item.frame);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(itemRotation(item));
    ctx.translate(-center.x, -center.y);
    if (isText(item)) drawText(ctx, item);
    else if (isDrawn(item)) drawShape(ctx, item);
    else await drawPhoto(ctx, item);
    ctx.restore();
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  return setJpegDpi(new Uint8Array(await blob.arrayBuffer()), DPI);
}

/** Writes the density fields of the JFIF APP0 header that canvas.toBlob emits. */
function setJpegDpi(bytes, dpi) {
  const isJfif = bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.slice(6, 10)) === 'JFIF';
  if (isJfif) {
    bytes[13] = 1; // units: dots per inch
    bytes[14] = bytes[16] = dpi >> 8;
    bytes[15] = bytes[17] = dpi & 0xff;
  }
  return new Blob([bytes], { type: 'image/jpeg' });
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export async function downloadCard() {
  const design = structuredClone(getState());
  const files = [];
  for (const side of SIDES) files.push([await renderSide(design, side), `new-years-card-${side}.jpg`]);
  for (const [blob, name] of files) download(blob, name);
}
