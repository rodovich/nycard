import { putBlob, getBlob, deleteBlob } from './blobs.js';
import { bleedRect, canvasSize, ptToPx, SIDES, trimRect } from './specs.js';
import { defaultFamily } from './fonts.js';
import { containRect, coverRect, offsetRect } from './geometry.js';
import { textHeight } from './text.js';

const KEY = 'nycard.design.v2';
const V1_KEY = 'nycard.design.v1';

/**
 * Item geometry is in print pixels, with the origin at the center of the card.
 * `frame` is the visible (cropped) rectangle; `image` is where the whole
 * source image sits, so cropping is the part of `image` inside `frame`.
 * Text items (`kind: 'text'`) have no `image`; their frame height follows the wrapped text.
 */
function initialState() {
  return {
    orientation: 'portrait',
    backgrounds: Object.fromEntries(SIDES.map((side) => [side, '#ffffff'])),
    assets: [],
    items: [],
    selectedIds: [],
    cropId: null,
    showGuides: true,
  };
}

let state = load();
const listeners = new Set();
const urls = new Map();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) ?? fromV1(JSON.parse(localStorage.getItem(V1_KEY)));
    return { ...initialState(), ...saved };
  } catch (e) {
    console.warn('Discarding unreadable saved design', e);
    return initialState();
  }
}

/** v1 measured from the top-left corner of the bleed and had a single selection. */
function fromV1(v1) {
  if (!v1) return null;
  const { w, h } = v1.canvas ?? canvasSize(v1.orientation);
  const { selectedId, canvas, ...rest } = v1;
  const items = rest.items.map((item) => ({ ...item, ...offsetItem(item, -w / 2, -h / 2) }));
  return { ...rest, items, selectedIds: selectedId ? [selectedId] : [] };
}

export function offsetItem({ frame, image }, dx, dy) {
  return { frame: offsetRect(frame, dx, dy), ...(image && { image: offsetRect(image, dx, dy) }) };
}

export const isText = (item) => item.kind === 'text';
/** An empty photo slot left by a layout. It isn't exported. */
export const isPlaceholder = (item) => item.kind === 'placeholder';
export const isImage = (item) => !isText(item) && !isPlaceholder(item);

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
export const selectedItems = () => state.items.filter((i) => state.selectedIds.includes(i.id));

export function updateItems(patches) {
  update(() => {
    for (const [id, patch] of patches) {
      const item = getItem(id);
      if (!item) continue;
      Object.assign(item, patch);
      if (isText(item)) fitText(item);
    }
  });
}

const fitText = (item) => (item.frame = { ...item.frame, h: textHeight(item) });

export const refitText = () => update((s) => s.items.filter(isText).forEach(fitText));

export const updateItem = (id, patch) => updateItems([[id, patch]]);

export function select(ids) {
  update((s) => {
    s.selectedIds = [...ids];
    if (s.selectedIds.length !== 1 || s.selectedIds[0] !== s.cropId) s.cropId = null;
  });
}

export function toggleSelected(id) {
  const ids = state.selectedIds;
  select(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
}

export function toggleCrop(id) {
  update((s) => {
    s.cropId = s.cropId === id ? null : id;
    if (s.cropId) s.selectedIds = [id];
  });
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
  removeItems(state.items.filter((i) => i.assetId === id).map((i) => i.id));
  update((s) => (s.assets = s.assets.filter((a) => a.id !== id)));
  URL.revokeObjectURL(urls.get(id));
  urls.delete(id);
  deleteBlob(id);
}

function pruneSelection(s) {
  s.selectedIds = s.selectedIds.filter((id) => s.items.some((i) => i.id === id));
  if (!s.selectedIds.includes(s.cropId)) s.cropId = null;
}

export function removeItems(ids) {
  update((s) => {
    s.items = s.items.filter((i) => !ids.includes(i.id));
    pruneSelection(s);
  });
}

const coverFrame = (assetId, frame) => ({ frame, image: coverRect(getAsset(assetId), frame) });

export function fillCard(id) {
  updateItem(id, coverFrame(getItem(id).assetId, bleedRect(state.orientation)));
}

/** Returns false if the placeholder is gone, e.g. filled or replaced while a photo was loading. */
export function fillPlaceholder(id, assetId) {
  const index = state.items.findIndex((i) => i.id === id && isPlaceholder(i));
  if (index < 0) return false;
  const { side, frame } = state.items[index];
  update((s) => (s.items[index] = { id, side, assetId, ...coverFrame(assetId, frame) }));
  select([id]);
  return true;
}

export function placeAsset(assetId, side, at) {
  const asset = getAsset(assetId);
  const placeholder = !at && itemsOnSide(side).find(isPlaceholder);
  if (placeholder) return void fillPlaceholder(placeholder.id, assetId);
  at ??= { x: 0, y: 0 };
  if (!itemsOnSide(side).length) return void addItem({ assetId, side, ...coverFrame(assetId, bleedRect(state.orientation)) });
  const { w, h } = trimRect(state.orientation);
  const rect = containRect(asset, { x: at.x - w / 4, y: at.y - h / 4, w: w / 2, h: h / 2 });
  addItem({ assetId, side, frame: rect, image: { ...rect } });
}

const newText = (side) => ({
  kind: 'text',
  side,
  text: 'Happy New Year',
  font: defaultFamily(),
  size: ptToPx(28),
  color: '#1d1d1f',
  align: 'center',
  bold: false,
  italic: false,
});

function fitTextToSlot(text, slot) {
  text.frame = { x: slot.x, y: 0, w: slot.w, h: 0 };
  fitText(text);
  text.frame.y = slot.y + (slot.h - text.frame.h) / 2;
  return text;
}

export function addText(side) {
  const { w } = trimRect(state.orientation);
  return addItem(fitTextToSlot(newText(side), { x: -w * 0.4, y: 0, w: w * 0.8, h: 0 }));
}

export function applyLayout(side, slots) {
  const byArea = (a, b) => b.w * b.h - a.w * a.h;
  const items = itemsOnSide(side);
  const photos = items.filter(isImage).sort((a, b) => byArea(a.frame, b.frame));
  const texts = items.filter(isText).sort((a, b) => a.frame.y - b.frame.y);
  // Larger slots go first so smaller, inset photos stack on top.
  const pictures = [...slots.images].sort(byArea).map((frame, i) => {
    const photo = photos[i];
    if (!photo) return { id: crypto.randomUUID(), kind: 'placeholder', side, frame };
    return { ...photo, ...coverFrame(photo.assetId, frame) };
  });
  const words = slots.texts.map(({ slot, text, ...style }, i) =>
    fitTextToSlot({ ...(texts[i] ?? { id: crypto.randomUUID(), ...newText(side), text }), ...style }, slot),
  );
  update((s) => {
    s.items = [...s.items.filter((i) => i.side !== side), ...pictures, ...words];
    pruneSelection(s);
  });
}

function addItem(item) {
  const id = crypto.randomUUID();
  update((s) => s.items.push({ id, ...item }));
  select([id]);
  return id;
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

export function setOrientation(orientation) {
  update((s) => (s.orientation = orientation));
}
