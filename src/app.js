import {
  addFiles,
  assetUrl,
  fillCard,
  getAsset,
  getItem,
  getState,
  itemsOnSide,
  loadAssetUrls,
  offsetItem,
  placeAsset,
  removeAsset,
  removeItems,
  restack,
  select,
  selectedItems,
  setOrientation,
  subscribe,
  toggleCrop,
  toggleSelected,
  update,
  updateItem,
  updateItems,
} from './store.js';
import { bleedRect, canvasSize, DPI, safeRect, SIDES, specSummary, trimRect } from './specs.js';
import { alignLines, clamp, intersects, offsetRect, rectFromPoints, scaleRect, unionRect } from './geometry.js';
import { snapper } from './snap.js';
import { PALETTE } from './palette.js';
import { downloadCard } from './export.js';

const ASSET_MIME = 'application/x-nycard-asset';
const MIN_SIZE = 30; // print px
const LOW_DPI = 200;
const SNAP_SCREEN_PX = 6;
const CLICK_SLOP_PX = 3;
const $ = (sel, root = document) => root.querySelector(sel);

const cards = {};
let scale = 1;
/** Feedback drawn on one side during a pointer drag: `{ side, lines?: { x, y }, marquee?: rect }`. */
let dragHints = null;

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent?.append(e);
  return e;
}

function button(parent, label, onClick, className) {
  const b = el('button', className, parent);
  b.textContent = label;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function place(e, r) {
  Object.assign(e.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

function setSrc(img, url) {
  if (img.getAttribute('src') !== url) img.src = url;
}

function cardPoint(side, ev) {
  const box = cards[side].card.getBoundingClientRect();
  return { x: (ev.clientX - box.left - box.width / 2) / scale, y: (ev.clientY - box.top - box.height / 2) / scale };
}

/** Call `set` on the result to show the current color. */
function colorPicker(parent, label, onPick) {
  const root = el('div', 'color-picker', parent);
  root.append(label);
  const current = button(root, '', null, 'swatch');
  current.title = label;
  const palette = el('div', 'palette', root);
  palette.popover = 'auto';
  current.popoverTargetElement = palette;
  palette.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const r = current.getBoundingClientRect();
    Object.assign(palette.style, { left: `${r.left}px`, top: `${r.bottom + 6}px` });
  });
  const swatches = PALETTE.map((color) => {
    const b = button(palette, '', () => {
      palette.hidePopover();
      onPick(color);
    }, 'swatch');
    b.style.background = b.title = color;
    return b;
  });
  return {
    set(color) {
      current.style.background = color;
      swatches.forEach((b, i) => b.classList.toggle('chosen', PALETTE[i] === color));
    },
  };
}

function buildCard(side) {
  const figure = $(`.side[data-side="${side}"]`);
  const card = $('.card', figure);
  const picker = colorPicker($('figcaption', figure), 'Background', (color) =>
    update((s) => (s.backgrounds[side] = color)),
  );
  const surface = el('div', 'surface', card);
  const surfaceOrigin = el('div', 'origin', surface);
  const items = el('div', 'items', surfaceOrigin);
  const guides = el('div', 'guides', surfaceOrigin);
  const trim = el('div', 'trim', guides);
  const safe = el('div', 'safe', guides);
  const overlay = el('div', 'overlay', card);
  const overlayOrigin = el('div', 'origin', overlay);
  const ghost = el('img', 'ghost', overlayOrigin);
  const lines = el('div', 'snap-lines', overlayOrigin);
  const outlines = el('div', 'outlines', overlayOrigin);
  const selection = el('div', 'selection', overlayOrigin);
  for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    el('div', `handle ${h}`, selection).dataset.handle = h;
  }
  const marquee = el('div', 'marquee', overlayOrigin);
  cards[side] = { card, picker, surface, items, guides, trim, safe, overlay, ghost, lines, outlines, selection, marquee, els: new Map() };

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
  c.surface.style.background = s.backgrounds[side];
  c.picker.set(s.backgrounds[side]);
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
  });

  const selected = selectedItems().filter((i) => i.side === side);
  const single = s.selectedIds.length === 1 ? selected[0] : undefined;
  c.outlines.replaceChildren();
  if (!single) for (const i of selected) place(el('div', null, c.outlines), i.frame);
  c.selection.hidden = !single;
  const cropping = single && single.id === s.cropId;
  c.ghost.hidden = !cropping;
  if (single) {
    place(c.selection, single.frame);
    c.selection.classList.toggle('cropping', !!cropping);
  }
  if (cropping) {
    setSrc(c.ghost, assetUrl(single.assetId));
    place(c.ghost, single.image);
  }

  const hints = dragHints?.side === side ? dragHints : {};
  c.lines.replaceChildren();
  const card = bleedRect(s.orientation);
  for (const x of hints.lines?.x ?? []) place(el('div', null, c.lines), { ...card, x, w: 0 });
  for (const y of hints.lines?.y ?? []) place(el('div', null, c.lines), { ...card, y, h: 0 });
  c.marquee.hidden = !hints.marquee;
  if (hints.marquee) place(c.marquee, hints.marquee);
}

function trackPointer(e, onMove, onClick) {
  const target = e.target;
  target.setPointerCapture(e.pointerId);
  let moved = false;
  const move = (ev) => {
    moved ||= Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > CLICK_SLOP_PX;
    if (moved) onMove(ev);
  };
  const end = () => {
    dragHints = null;
    if (!moved) onClick?.();
    render();
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

function onPointerDown(e, side) {
  if (e.button !== 0) return;
  e.preventDefault();
  document.activeElement?.blur();
  const handle = e.target.dataset.handle;
  const hitId = e.target.closest('.item')?.dataset.id;
  if (handle) return startDrag(e, side, handle);
  if (!hitId) return startMarquee(e, side);
  if (e.shiftKey) return toggleSelected(hitId);
  if (!getState().selectedIds.includes(hitId)) select([hitId]);
  // Keep a multi-selection so it can be dragged as a group; a click without dragging narrows it.
  startDrag(e, side, null, () => select([hitId]));
}

function startMarquee(e, side) {
  const base = e.shiftKey ? getState().selectedIds : [];
  const from = cardPoint(side, e);
  select(base);
  trackPointer(e, (ev) => {
    const marquee = rectFromPoints(from, cardPoint(side, ev));
    const hits = itemsOnSide(side).filter((i) => intersects(i.frame, marquee));
    dragHints = { side, marquee };
    select(new Set([...base, ...hits.map((i) => i.id)]));
  });
}

function startDrag(e, side, handle, onClick) {
  const { selectedIds, cropId } = getState();
  const starts = selectedItems()
    .filter((i) => i.side === side)
    .map((i) => ({ id: i.id, frame: { ...i.frame }, image: { ...i.image }, handle }));
  const cropping = starts.length === 1 && cropId === starts[0].id;
  const mode = handle ? (cropping ? 'crop' : 'resize') : cropping ? 'pan' : 'move';
  const bounds = unionRect(starts.map((st) => st.frame));
  const targets = snapTargets(side, selectedIds);
  trackPointer(e, (ev) => {
    const dx = (ev.clientX - e.clientX) / scale;
    const dy = (ev.clientY - e.clientY) / scale;
    const snapping = !ev.altKey && mode !== 'pan';
    let patches;
    let shown;
    if (mode === 'move') {
      let mx = dx;
      let my = dy;
      if (snapping) {
        const moved = offsetRect(bounds, dx, dy);
        mx += targets.x.delta(alignLines(moved, 'x'));
        my += targets.y.delta(alignLines(moved, 'y'));
      }
      patches = starts.map((st) => [st.id, offsetItem(st, mx, my)]);
      shown = offsetRect(bounds, mx, my);
    } else {
      const next = drag[mode](starts[0], dx, dy, snapping ? targets : null);
      patches = [[starts[0].id, next]];
      shown = next.frame;
    }
    dragHints = snapping
      ? { side, lines: { x: targets.x.touching(alignLines(shown, 'x')), y: targets.y.touching(alignLines(shown, 'y')) } }
      : null;
    updateItems(patches);
  }, onClick);
}

function snapTargets(side, excludeIds) {
  const { orientation } = getState();
  const others = itemsOnSide(side).filter((i) => !excludeIds.includes(i.id));
  const rects = [bleedRect(orientation), trimRect(orientation), safeRect(orientation), ...others.map((i) => i.frame)];
  const axis = (a) => snapper(rects.flatMap((r) => alignLines(r, a)), SNAP_SCREEN_PX / scale);
  return { x: axis('x'), y: axis('y') };
}

// `targets` is null when snapping is off.
const drag = {
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
    return { frame: rectFromPoints({ x: left, y: top }, { x: right, y: bottom }), image };
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
  const items = selectedItems();
  bar.replaceChildren();
  if (!items.length) {
    el('span', 'hint', bar).textContent = s.items.length
      ? 'Click an image to select it; Shift-click or drag a box to select several. Double-click to crop. Hold Option (Alt) while dragging to stop snapping.'
      : 'Add images from the panel on the right, then place them on the front or back.';
    return;
  }
  const [item] = items;
  if (items.length > 1) {
    el('span', 'hint', bar).textContent = `${items.length} images selected`;
  } else {
    const cropping = s.cropId === item.id;
    button(bar, cropping ? 'Done cropping' : 'Crop', () => toggleCrop(item.id), cropping ? 'active' : '');
    button(bar, 'Fill card', () => fillCard(item.id));
    button(bar, 'Uncrop', () => updateItem(item.id, { frame: { ...item.image } }));
    button(bar, 'Forward', () => restack(item.id, 1));
    button(bar, 'Backward', () => restack(item.id, -1));
  }
  const sides = new Set(items.map((i) => i.side));
  const other = sides.size === 1 && SIDES.find((side) => !sides.has(side));
  if (other) button(bar, `Move to ${other}`, () => updateItems(items.map((i) => [i.id, { side: other }])));
  button(bar, 'Delete', () => removeItems(items.map((i) => i.id)), 'danger');
  if (items.length > 1) return;

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
  cards[side].card.classList.remove('drop-target');
  const at = cardPoint(side, e);
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
    if (e.target.closest('input, textarea') || document.querySelector(':popover-open')) return;
    const s = getState();
    const items = selectedItems();
    if (e.key === 'Escape') {
      if (s.cropId) toggleCrop(s.cropId);
      else select([]);
    } else if (items.length && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      removeItems(items.map((i) => i.id));
    } else if (items.length && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 30 : 3;
      const dx = { ArrowLeft: -step, ArrowRight: step }[e.key] ?? 0;
      const dy = { ArrowUp: -step, ArrowDown: step }[e.key] ?? 0;
      updateItems(items.map((i) => [i.id, offsetItem(i, dx, dy)]));
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
