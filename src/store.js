import { blobIds, deleteBlob, getBlob, putBlob } from './blobs.js';
import { bleedRect, canvasSize, ptToPx, SIDES, trimRect } from './specs.js';
import { defaultFamily } from './fonts.js';
import { clamp, containRect, coverRect, growToCover, offsetRect, scaleRect } from './geometry.js';
import { textHeight } from './text.js';
import { imageDropLimit, isDrawn, slantedEdges, slantHeight } from './shape.js';

const KEY = 'nycard.design.v2';
const V1_KEY = 'nycard.design.v1';

/**
 * Item geometry is in print pixels, with the origin at the center of the card.
 * `frame` is the visible (cropped) rectangle; `image` is where the whole
 * source image sits, so cropping is the part of `image` inside `frame`.
 * Text items (`kind: 'text'`) have no `image`; their frame height follows the wrapped text.
 * Drawn items (`kind: 'shape' | 'circle' | 'line'`) have no `image` either. A line runs corner to
 * corner across its frame, from top-left to bottom-right unless `rising` is set.
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

/** State that isn't part of the design, so undo leaves it alone. */
const VIEW_KEYS = ['selectedIds', 'cropId', 'showGuides'];

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
export const isImage = (item) => !isText(item) && !isPlaceholder(item) && !isDrawn(item);
export const holdsPhoto = (item) => isImage(item) || isPlaceholder(item);

export const getState = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

// Saving synchronously on every change means a reload from the dev server never loses the latest edit.
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  for (const fn of listeners) fn(state);
}

export function update(mutate, { undoable = true } = {}) {
  mutate(state);
  if (undoable) recordHistory();
  else current = content(state);
  save();
}

const content = (s) => JSON.stringify(s, (key, value) => (VIEW_KEYS.includes(key) ? undefined : value));
const MERGE_MS = 500;
const MAX_UNDO = 200;
const undoStack = [];
const redoStack = [];
let current = content(state);
let lastChangeAt = -Infinity;
let gesture = null;

function recordHistory() {
  const next = content(state);
  if (next === current) return;
  const separate = gesture ? !gesture.recorded : performance.now() - lastChangeAt > MERGE_MS;
  if (separate) {
    undoStack.push(current);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    if (gesture) gesture.recorded = true;
  }
  current = next;
  lastChangeAt = performance.now();
}

/** Groups every change until `endGesture` into one undo step, e.g. for a drag. */
export const beginGesture = () => (gesture = { recorded: false });
export const endGesture = () => {
  gesture = null;
  lastChangeAt = -Infinity;
};

function restore(from, to) {
  if (!from.length) return;
  to.push(current);
  current = from.pop();
  Object.assign(state, JSON.parse(current));
  pruneSelection(state);
  gesture = null;
  lastChangeAt = -Infinity;
  save();
}

export const undo = () => restore(undoStack, redoStack);
export const redo = () => restore(redoStack, undoStack);

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

const fitText = (item) => (item.frame = { ...item.frame, h: textHeight(item) + slantHeight(item) });

export function clampDrop(item, type, drop) {
  const limit = isText(item) ? (4 * textHeight(item)) / slantedEdges(type) : imageDropLimit(item, type);
  return clamp(drop, -limit, limit);
}

function quadShape(item, type) {
  if (type === 'rect') return undefined;
  return { type, drop: clampDrop(item, type, item.shape?.drop || item.frame.w * 0.12) };
}

export const setShape = (id, type) => updateItem(id, { shape: quadShape(getItem(id), type) });

/** Re-measures text without adding an undo step, since fonts can measure differently than when the design was saved. */
export const refitText = () => update((s) => s.items.filter(isText).forEach(fitText), { undoable: false });

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

// The file and its URL are kept so undo can bring the asset back; deleteUnusedBlobs deletes the file on the next load.
export function removeAsset(id) {
  update((s) => {
    s.assets = s.assets.filter((a) => a.id !== id);
    s.items = s.items.filter((i) => i.assetId !== id);
    pruneSelection(s);
  });
}

/** Call before the page accepts new images, which are stored before they're added to the design. */
export async function deleteUnusedBlobs() {
  const ids = await blobIds();
  const used = new Set(state.assets.map((a) => a.id));
  for (const id of ids) if (!used.has(id)) await deleteBlob(id);
}

function pruneSelection(s) {
  s.selectedIds = s.selectedIds.filter((id) => s.items.some((i) => i.id === id));
  const cropped = s.items.find((i) => i.id === s.cropId);
  if (!s.selectedIds.includes(s.cropId) || !cropped || !isImage(cropped)) s.cropId = null;
}

export function removeItems(ids) {
  update((s) => {
    s.items = s.items.filter((i) => !ids.includes(i.id));
    pruneSelection(s);
  });
}

const coverFrame = (assetId, frame) => ({ frame, image: coverRect(getAsset(assetId), frame) });

export const photoZoom = ({ assetId, frame, image }) => image.w / coverRect(getAsset(assetId), frame).w;

export function setPhotoZoom(id, zoom) {
  const item = getItem(id);
  const { frame, image } = item;
  const center = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  updateItem(id, { image: growToCover(scaleRect(image, zoom / photoZoom(item), center), frame) });
}

export function fillCard(id) {
  updateItem(id, coverFrame(getItem(id).assetId, bleedRect(state.orientation)));
}

/** Returns false if the item is gone, e.g. it was removed while a photo was loading. */
export function setPhoto(id, assetId) {
  const index = state.items.findIndex((i) => i.id === id && holdsPhoto(i));
  if (index < 0) return false;
  const { side, frame, shape, assetId: current } = state.items[index];
  if (current !== assetId) {
    update((s) => (s.items[index] = { id, side, shape, assetId, ...coverFrame(assetId, frame) }));
  }
  select([id]);
  return true;
}

export function placeAsset(assetId, side, at) {
  const asset = getAsset(assetId);
  const placeholder = !at && itemsOnSide(side).find(isPlaceholder);
  if (placeholder) return void setPhoto(placeholder.id, assetId);
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

/** `type` is 'circle', 'line', or one of the quadrilaterals in SHAPES. */
export function addShape(side, type) {
  const { w, h } = trimRect(state.orientation);
  const size = Math.min(w, h) * 0.4;
  const frame = { x: -size / 2, y: -size / 2, w: size, h: size };
  const paint = { side, stroked: false, strokeWidth: ptToPx(2), color: '#1d1d1f', opacity: 1 };
  if (type === 'line') return addItem({ ...paint, kind: 'line', stroked: true, rising: false, frame: { ...frame, y: 0, h: 0 } });
  if (type === 'circle') return addItem({ ...paint, kind: 'circle', frame });
  const shape = { ...paint, kind: 'shape', frame };
  return addItem({ ...shape, shape: quadShape(shape, type) });
}

export function applyLayout(side, slots) {
  const byArea = ({ frame: a }, { frame: b }) => b.w * b.h - a.w * a.h;
  const items = itemsOnSide(side);
  const photos = items.filter(isImage).sort(byArea);
  const texts = items.filter(isText).sort((a, b) => a.frame.y - b.frame.y);
  // Larger slots go first so smaller, inset photos stack on top.
  const pictures = [...slots.images].sort(byArea).map(({ frame, shape }, i) => {
    const photo = photos[i];
    if (!photo) return { id: crypto.randomUUID(), kind: 'placeholder', side, frame, shape };
    return { ...photo, ...coverFrame(photo.assetId, frame), shape };
  });
  const words = slots.texts.map(({ slot, text, ...style }, i) =>
    fitTextToSlot({ ...(texts[i] ?? { id: crypto.randomUUID(), ...newText(side), text }), ...style }, slot),
  );
  update((s) => {
    s.items = [...s.items.filter((i) => i.side !== side), ...pictures, ...items.filter(isDrawn), ...words];
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
