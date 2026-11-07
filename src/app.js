import {
  addFiles,
  assetUrl,
  fillCard,
  getAsset,
  getItem,
  getState,
  itemsOnSide,
  loadAssetUrls,
  placeAsset,
  removeAsset,
  removeItem,
  restack,
  select,
  setOrientation,
  subscribe,
  toggleCrop,
  update,
  updateItem,
} from './store.js';
import { bleedRect, canvasSize, DPI, safeRect, SIDES, specSummary, trimRect } from './specs.js';
import { alignLines, clamp, offsetRect, scaleRect } from './geometry.js';
import { snapper } from './snap.js';
import { downloadCard } from './export.js';

const ASSET_MIME = 'application/x-nycard-asset';
const MIN_SIZE = 30; // print px
const LOW_DPI = 200;
const SNAP_SCREEN_PX = 6;
const $ = (sel, root = document) => root.querySelector(sel);

const cards = {};
let scale = 1;
/** Alignment lines to draw on one side during a drag: `{ side, x: [...], y: [...] }`. */
let snapLines = null;

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent?.append(e);
  return e;
}

function button(parent, label, onClick, className) {
  const b = el('button', className, parent);
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function place(e, r) {
  Object.assign(e.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

function setSrc(img, url) {
  if (img.getAttribute('src') !== url) img.src = url;
}

function buildCard(side) {
  const card = $(`.side[data-side="${side}"] .card`);
  const surface = el('div', 'surface', card);
  const items = el('div', 'items', surface);
  const guides = el('div', 'guides', surface);
  const trim = el('div', 'trim', guides);
  const safe = el('div', 'safe', guides);
  const overlay = el('div', 'overlay', card);
  const ghost = el('img', 'ghost', overlay);
  const lines = el('div', 'snap-lines', overlay);
  const selection = el('div', 'selection', overlay);
  for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    el('div', `handle ${h}`, selection).dataset.handle = h;
  }
  cards[side] = { card, surface, items, guides, trim, safe, overlay, ghost, lines, selection, els: new Map() };

  card.addEventListener('pointerdown', (e) => onPointerDown(e, side));
  card.addEventListener('dblclick', (e) => {
    const id = e.target.closest('.item')?.dataset.id;
    if (id) toggleCrop(id);
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    card.classList.add('drop-target');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
  card.addEventListener('drop', (e) => onCardDrop(e, side));
}

function renderCard(side) {
  const s = getState();
  const c = cards[side];
  const { w, h } = canvasSize(s.orientation);
  c.card.style.width = `${w * scale}px`;
  c.card.style.height = `${h * scale}px`;
  c.card.style.setProperty('--scale', scale);
  for (const layer of [c.surface, c.overlay]) Object.assign(layer.style, { width: `${w}px`, height: `${h}px` });
  place(c.trim, trimRect(s.orientation));
  place(c.safe, safeRect(s.orientation));
  c.guides.hidden = !s.showGuides;

  const items = itemsOnSide(side);
  const live = new Set(items.map((i) => i.id));
  for (const [id, e] of c.els) {
    if (!live.has(id)) {
      e.remove();
      c.els.delete(id);
    }
  }
  items.forEach((item, index) => {
    let e = c.els.get(item.id);
    if (!e) {
      e = el('div', 'item');
      e.dataset.id = item.id;
      el('img', null, e).draggable = false;
      c.els.set(item.id, e);
    }
    if (c.items.children[index] !== e) c.items.insertBefore(e, c.items.children[index] ?? null);
    const img = e.firstChild;
    setSrc(img, assetUrl(item.assetId));
    place(e, item.frame);
    place(img, { ...item.image, x: item.image.x - item.frame.x, y: item.image.y - item.frame.y });
    e.classList.toggle('selected', item.id === s.selectedId);
  });

  const selected = items.find((i) => i.id === s.selectedId);
  c.selection.hidden = !selected;
  const cropping = selected && selected.id === s.cropId;
  c.ghost.hidden = !cropping;
  if (selected) {
    place(c.selection, selected.frame);
    c.selection.classList.toggle('cropping', !!cropping);
  }
  if (cropping) {
    setSrc(c.ghost, assetUrl(selected.assetId));
    place(c.ghost, selected.image);
  }

  c.lines.replaceChildren();
  if (snapLines?.side === side) {
    for (const x of snapLines.x) place(el('div', 'v', c.lines), { x, y: 0, w: 0, h });
    for (const y of snapLines.y) place(el('div', 'h', c.lines), { x: 0, y, w, h: 0 });
  }
}

function onPointerDown(e, side) {
  if (e.button !== 0) return;
  const handle = e.target.dataset.handle;
  const itemId = handle ? getState().selectedId : e.target.closest('.item')?.dataset.id;
  if (!itemId) {
    select(null);
    return;
  }
  e.preventDefault();
  select(itemId);
  const item = getItem(itemId);
  const cropping = getState().cropId === itemId;
  const start = {
    x: e.clientX,
    y: e.clientY,
    frame: { ...item.frame },
    image: { ...item.image },
    mode: handle ? (cropping ? 'crop' : 'resize') : cropping ? 'pan' : 'move',
    handle,
  };
  const targets = snapTargets(side, itemId);
  const target = e.target;
  target.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dx = (ev.clientX - start.x) / scale;
    const dy = (ev.clientY - start.y) / scale;
    const snapping = !ev.altKey && start.mode !== 'pan';
    const next = drag[start.mode](start, dx, dy, snapping ? targets : null);
    snapLines = snapping
      ? { side, x: targets.x.touching(alignLines(next.frame, 'x')), y: targets.y.touching(alignLines(next.frame, 'y')) }
      : null;
    updateItem(itemId, next);
  };
  const up = () => {
    snapLines = null;
    render();
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

function snapTargets(side, itemId) {
  const { orientation } = getState();
  const others = itemsOnSide(side).filter((i) => i.id !== itemId);
  const rects = [bleedRect(orientation), trimRect(orientation), safeRect(orientation), ...others.map((i) => i.frame)];
  const axis = (a) => snapper(rects.flatMap((r) => alignLines(r, a)), SNAP_SCREEN_PX / scale);
  return { x: axis('x'), y: axis('y') };
}

// `targets` is null when snapping is off.
const drag = {
  move({ frame, image }, dx, dy, targets) {
    if (targets) {
      const moved = offsetRect(frame, dx, dy);
      dx += targets.x.delta(alignLines(moved, 'x'));
      dy += targets.y.delta(alignLines(moved, 'y'));
    }
    return { frame: offsetRect(frame, dx, dy), image: offsetRect(image, dx, dy) };
  },

  resize({ frame, image, handle }, dx, dy, targets) {
    const sx = handle.includes('w') ? -1 : 1;
    const sy = handle.includes('n') ? -1 : 1;
    const anchor = { x: sx > 0 ? frame.x : frame.x + frame.w, y: sy > 0 ? frame.y : frame.y + frame.h };
    let k = ((frame.w + sx * dx) / frame.w + (frame.h + sy * dy) / frame.h) / 2;
    if (targets) {
      // The aspect ratio is fixed, so only one of the dragged corner's two edges can snap.
      const cx = anchor.x + sx * frame.w * k;
      const cy = anchor.y + sy * frame.h * k;
      const ddx = targets.x.delta([cx]);
      const ddy = targets.y.delta([cy]);
      const useX = ddx && (!ddy || Math.abs(ddx) <= Math.abs(ddy));
      if (useX) k = (sx * (cx + ddx - anchor.x)) / frame.w;
      else if (ddy) k = (sy * (cy + ddy - anchor.y)) / frame.h;
    }
    k = Math.max(k, MIN_SIZE / Math.min(frame.w, frame.h));
    return { frame: scaleRect(frame, k, anchor), image: scaleRect(image, k, anchor) };
  },

  crop({ frame, image, handle }, dx, dy, targets) {
    const snapX = targets ? targets.x.snap : (v) => v;
    const snapY = targets ? targets.y.snap : (v) => v;
    let left = frame.x;
    let top = frame.y;
    let right = frame.x + frame.w;
    let bottom = frame.y + frame.h;
    if (handle.includes('w')) left = clamp(snapX(left + dx), image.x, right - MIN_SIZE);
    if (handle.includes('e')) right = clamp(snapX(right + dx), left + MIN_SIZE, image.x + image.w);
    if (handle.includes('n')) top = clamp(snapY(top + dy), image.y, bottom - MIN_SIZE);
    if (handle.includes('s')) bottom = clamp(snapY(bottom + dy), top + MIN_SIZE, image.y + image.h);
    return { frame: { x: left, y: top, w: right - left, h: bottom - top }, image };
  },

  // Slides the image under a fixed frame, keeping the frame covered.
  pan({ frame, image }, dx, dy) {
    const x = clamp(image.x + dx, frame.x + frame.w - image.w, frame.x);
    const y = clamp(image.y + dy, frame.y + frame.h - image.h, frame.y);
    return { frame, image: { ...image, x, y } };
  },
};

function renderToolbar() {
  const s = getState();
  const bar = $('#toolbar');
  const item = getItem(s.selectedId);
  bar.replaceChildren();
  if (!item) {
    el('span', 'hint', bar).textContent = s.items.length
      ? 'Click an image to select it. Double-click to crop. Hold Option (Alt) while dragging to stop snapping.'
      : 'Add images from the panel on the right, then place them on the front or back.';
    return;
  }
  const cropping = s.cropId === item.id;
  const other = SIDES.find((side) => side !== item.side);
  button(bar, cropping ? 'Done cropping' : 'Crop', () => toggleCrop(item.id), cropping ? 'active' : '');
  button(bar, 'Fill card', () => fillCard(item.id));
  button(bar, 'Uncrop', () => updateItem(item.id, { frame: { ...item.image } }));
  button(bar, 'Forward', () => restack(item.id, 1));
  button(bar, 'Backward', () => restack(item.id, -1));
  button(bar, `Move to ${other}`, () => updateItem(item.id, { side: other }));
  button(bar, 'Delete', () => removeItem(item.id), 'danger');

  const asset = getAsset(item.assetId);
  const dpi = Math.round(asset.width / (item.image.w / DPI));
  const res = el('span', dpi < LOW_DPI ? 'dpi low' : 'dpi', bar);
  res.textContent = `${dpi} dpi`;
  res.title = dpi < LOW_DPI ? `Below ${LOW_DPI} dpi; this image may print blurry at this size.` : 'Print resolution at this size';
}

let renderedAssetKey;
function renderTray() {
  const { assets } = getState();
  const key = assets.map((a) => a.id).join();
  if (key === renderedAssetKey) return;
  renderedAssetKey = key;
  const list = $('#assets');
  list.replaceChildren();
  for (const asset of assets) {
    const li = el('li', 'asset', list);
    const img = el('img', null, li);
    img.src = assetUrl(asset.id);
    img.alt = asset.name;
    img.draggable = true;
    img.addEventListener('dragstart', (e) => e.dataTransfer.setData(ASSET_MIME, asset.id));
    const name = el('span', 'name', li);
    name.textContent = asset.name;
    name.title = `${asset.name} (${asset.width}×${asset.height})`;
    const actions = el('div', 'actions', li);
    for (const side of SIDES) button(actions, `+ ${side}`, () => placeAsset(asset.id, side), 'side');
    button(actions, '×', () => removeAsset(asset.id), 'remove').title = 'Remove from project';
  }
}

async function onCardDrop(e, side) {
  e.preventDefault();
  e.stopPropagation();
  const { card } = cards[side];
  card.classList.remove('drop-target');
  const box = card.getBoundingClientRect();
  const at = { x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
  const assetId = e.dataTransfer.getData(ASSET_MIME);
  if (assetId) return placeAsset(assetId, side, at);
  const added = await addFiles(e.dataTransfer.files);
  added.forEach((a, i) => placeAsset(a.id, side, { x: at.x + i * 60, y: at.y + i * 60 }));
}

function setupFileInputs() {
  const input = $('#file-input');
  input.addEventListener('change', async () => {
    await addFiles(input.files);
    input.value = '';
  });
  const zone = $('#dropzone');
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.toggle('drop-target', zone.contains(e.target));
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) zone.classList.remove('drop-target');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drop-target');
    addFiles(e.dataTransfer.files);
  });
}

function renderHeader() {
  const s = getState();
  for (const b of document.querySelectorAll('#orientation button')) {
    b.classList.toggle('active', b.dataset.orientation === s.orientation);
  }
  $('#guides').checked = s.showGuides;
  $('#spec').textContent = specSummary(s.orientation);
}

function setupHeader() {
  for (const b of document.querySelectorAll('#orientation button')) {
    b.addEventListener('click', () => setOrientation(b.dataset.orientation));
  }
  $('#guides').addEventListener('change', (e) => update((s) => (s.showGuides = e.target.checked)));
  const dl = $('#download');
  dl.addEventListener('click', async () => {
    dl.disabled = true;
    try {
      await downloadCard();
    } catch (e) {
      console.error(e);
      alert(`Couldn't create the card images: ${e.message}`);
    } finally {
      dl.disabled = false;
    }
  });
}

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    const s = getState();
    const item = getItem(s.selectedId);
    if (e.key === 'Escape') {
      if (s.cropId) toggleCrop(s.cropId);
      else select(null);
    } else if (item && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      removeItem(item.id);
    } else if (item && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 30 : 3;
      const dx = { ArrowLeft: -step, ArrowRight: step }[e.key] ?? 0;
      const dy = { ArrowUp: -step, ArrowDown: step }[e.key] ?? 0;
      updateItem(item.id, drag.move(item, dx, dy));
    }
  });
}

function fitStage() {
  const stage = $('#stage');
  const style = getComputedStyle(stage);
  const gap = parseFloat(style.columnGap) || 0;
  const availW = (stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - gap) / 2;
  const caption = $('figcaption').offsetHeight + 8;
  const availH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - caption;
  const { w, h } = canvasSize(getState().orientation);
  scale = Math.max(0.05, Math.min(availW / w, availH / h));
}

function render() {
  fitStage();
  renderHeader();
  for (const side of SIDES) renderCard(side);
  renderToolbar();
  renderTray();
}

async function main() {
  await loadAssetUrls();
  SIDES.forEach(buildCard);
  setupHeader();
  setupFileInputs();
  setupKeyboard();
  subscribe(render);
  new ResizeObserver(render).observe($('#stage'));
  render();
}

main();
