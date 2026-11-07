import { putBlob, getBlob, deleteBlob } from './blobs.js';
import { bleedRect, canvasSize, trimRect } from './specs.js';
import { containRect, coverRect, rectCenter, scaleRect } from './geometry.js';

const KEY = 'nycard.design.v1';

/**
 * Item geometry is in print pixels on the full-bleed canvas.
 * `frame` is the visible (cropped) rectangle; `image` is where the whole
 * source image sits, so cropping is the part of `image` inside `frame`.
 */
function initialState() {
  return { orientation: 'portrait', assets: [], items: [], selectedId: null, cropId: null, showGuides: true };
}

let state = load();
const listeners = new Set();
const urls = new Map();

function load() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
  } catch (e) {
    console.warn('Discarding unreadable saved design', e);
  }
  const s = { ...initialState(), ...saved };
  const size = canvasSize(s.orientation);
  // Designs saved before a change to the print specs were laid out on a different canvas.
  if (s.canvas && (s.canvas.w !== size.w || s.canvas.h !== size.h)) {
    for (const item of s.items) stretchItem(item, s.canvas, size);
  }
  s.canvas = size;
  return s;
}

/** Scaling the image by the larger axis factor keeps it covering the stretched frame. */
function stretchItem(item, from, to) {
  const kx = to.w / from.w;
  const ky = to.h / from.h;
  const { frame, image } = item;
  const center = rectCenter(frame);
  item.frame = { x: frame.x * kx, y: frame.y * ky, w: frame.w * kx, h: frame.h * ky };
  item.image = scaleRect(image, Math.max(kx, ky), center, rectCenter(item.frame));
}

export const getState = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

// Saving synchronously on every change means a reload from the dev server never loses the latest edit.
export function update(mutate) {
  mutate(state);
  localStorage.setItem(KEY, JSON.stringify(state));
  for (const fn of listeners) fn(state);
}

export const assetUrl = (id) => urls.get(id);
export const getAsset = (id) => state.assets.find((a) => a.id === id);
export const getItem = (id) => state.items.find((i) => i.id === id);
export const itemsOnSide = (side, s = state) => s.items.filter((i) => i.side === side);

export function updateItem(id, patch) {
  update(() => Object.assign(getItem(id) ?? {}, patch));
}

export function select(id) {
  update((s) => {
    if (s.selectedId !== id) s.cropId = null;
    s.selectedId = id;
  });
}

export function toggleCrop(id) {
  update((s) => (s.cropId = s.cropId === id ? null : id));
}

/** Call once before first render. */
export async function loadAssetUrls() {
  await Promise.all(
    state.assets.map(async (a) => {
      const blob = await getBlob(a.id);
      if (blob) urls.set(a.id, URL.createObjectURL(blob));
    }),
  );
}

export async function addFiles(files) {
  const added = [];
  for (const file of [...files]) {
    if (!file.type.startsWith('image/')) continue;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      alert(`Couldn't read ${file.name}. Try a JPEG or PNG.`);
      continue;
    }
    const asset = { id: crypto.randomUUID(), name: file.name, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    await putBlob(asset.id, file);
    urls.set(asset.id, URL.createObjectURL(file));
    added.push(asset);
  }
  if (added.length) update((s) => s.assets.push(...added));
  return added;
}

export function removeAsset(id) {
  update((s) => {
    s.assets = s.assets.filter((a) => a.id !== id);
    s.items = s.items.filter((i) => i.assetId !== id);
    if (!getItem(s.selectedId)) s.selectedId = s.cropId = null;
  });
  URL.revokeObjectURL(urls.get(id));
  urls.delete(id);
  deleteBlob(id);
}

export function removeItem(id) {
  update((s) => {
    s.items = s.items.filter((i) => i.id !== id);
    s.selectedId = s.cropId = null;
  });
}

export function fillCard(id) {
  const frame = bleedRect(state.orientation);
  updateItem(id, { frame, image: coverRect(getAsset(getItem(id).assetId), frame) });
}

export function placeAsset(assetId, side, at) {
  const asset = getAsset(assetId);
  if (!itemsOnSide(side).length) {
    const frame = bleedRect(state.orientation);
    addItem({ assetId, side, frame, image: coverRect(asset, frame) });
    return;
  }
  const { w, h } = trimRect(state.orientation);
  const { x, y } = at ?? rectCenter(bleedRect(state.orientation));
  const rect = containRect(asset, { x: x - w / 4, y: y - h / 4, w: w / 2, h: h / 2 });
  addItem({ assetId, side, frame: rect, image: { ...rect } });
}

function addItem(item) {
  const id = crypto.randomUUID();
  update((s) => s.items.push({ id, ...item }));
  select(id);
}

export function restack(id, dir) {
  update((s) => {
    const item = getItem(id);
    const sameSide = itemsOnSide(item.side, s);
    const swapWith = sameSide[sameSide.indexOf(item) + dir];
    if (!swapWith) return;
    const a = s.items.indexOf(item);
    const b = s.items.indexOf(swapWith);
    [s.items[a], s.items[b]] = [s.items[b], s.items[a]];
  });
}

/** Rescales every item about the card center so the design survives an orientation change. */
export function setOrientation(orientation) {
  if (orientation === state.orientation) return;
  const from = canvasSize(state.orientation);
  const to = canvasSize(orientation);
  const k = Math.min(to.w / from.w, to.h / from.h);
  const fromCenter = { x: from.w / 2, y: from.h / 2 };
  const toCenter = { x: to.w / 2, y: to.h / 2 };
  update((s) => {
    s.orientation = orientation;
    s.canvas = to;
    for (const item of s.items) {
      item.frame = scaleRect(item.frame, k, fromCenter, toCenter);
      item.image = scaleRect(item.image, k, fromCenter, toCenter);
    }
  });
}
