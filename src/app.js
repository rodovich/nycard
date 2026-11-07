import {
  addFiles,
  addText,
  applyLayout,
  clampDrop,
  assetUrl,
  fillCard,
  fillPlaceholder,
  getAsset,
  getItem,
  getState,
  isImage,
  isPlaceholder,
  isText,
  itemsOnSide,
  loadAssetUrls,
  offsetItem,
  placeAsset,
  refitText,
  removeAsset,
  removeItems,
  restack,
  select,
  selectedItems,
  setOrientation,
  setShape,
  subscribe,
  toggleCrop,
  toggleSelected,
  update,
  updateItem,
  updateItems,
} from './store.js';
import { bleedRect, canvasSize, DPI, ptToPx, pxToPt, safeRect, SIDES, specSummary, trimRect } from './specs.js';
import { alignLines, clamp, intersects, offsetRect, rectFromPoints, scaleRect, unionRect } from './geometry.js';
import { snapper } from './snap.js';
import { PALETTE } from './palette.js';
import { LAYOUTS, layoutSlots } from './layouts.js';
import { downloadCard } from './export.js';
import { fontSpec, lineGeometry, LINE_HEIGHT } from './text.js';
import { angleHandlePoints, isShaped, shapePolygon, SHAPES, shapeType } from './shape.js';
import { canListLocalFonts, fontFamilies, listLocalFonts, listLocalFontsIfGranted } from './fonts.js';

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
/** The text item being edited in place, if any. */
let editingId = null;

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

/** `onOpen` runs before the panel shows. */
function attachPopover(trigger, panel, onOpen) {
  panel.classList.add('popover-panel');
  panel.popover = 'auto';
  trigger.popoverTargetElement = panel;
  panel.addEventListener('click', (e) => e.target.closest('button') && panel.hidePopover());
  panel.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    onOpen?.();
    const r = trigger.getBoundingClientRect();
    const top = r.bottom + 6;
    Object.assign(panel.style, { left: `${r.left}px`, top: `${top}px`, maxHeight: `${window.innerHeight - top - 8}px` });
  });
  // Its width is only known once it's shown.
  panel.addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    const overflow = panel.getBoundingClientRect().right - (window.innerWidth - 8);
    if (overflow > 0) panel.style.left = `${Math.max(8, parseFloat(panel.style.left) - overflow)}px`;
  });
}

/** Call `set` on the result to show the current color. */
function colorPicker(parent, label, onPick) {
  const root = el('div', 'color-picker', parent);
  root.append(label);
  const current = button(root, '', null, 'swatch');
  current.title = label;
  const palette = el('div', 'palette', root);
  attachPopover(current, palette);
  const swatches = PALETTE.map((color) => {
    const b = button(palette, '', () => onPick(color), 'swatch');
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

function layoutPicker(parent, side) {
  const trigger = button(parent, 'Layouts');
  const panel = el('div', 'layout-panel', parent);
  attachPopover(trigger, panel, () => {
    const { orientation } = getState();
    panel.replaceChildren();
    const layouts = LAYOUTS[orientation];
    for (const count of [...new Set(layouts.map((l) => l.images.length))].sort((a, b) => a - b)) {
      el('h3', null, panel).textContent = count === 1 ? '1 photo' : `${count} photos`;
      const row = el('div', 'layout-row', panel);
      for (const layout of layouts.filter((l) => l.images.length === count)) {
        const b = button(row, '', () => applyLayout(side, layoutSlots(layout, orientation)), 'layout-thumb');
        b.title = layout.name;
        drawThumb(b, layout, orientation);
      }
    }
  });
}

function drawThumb(parent, { images, texts }, orientation) {
  const { w, h } = trimRect(orientation);
  parent.style.aspectRatio = `${w} / ${h}`;
  const pct = ([x, y, rw, rh]) => ({ left: `${x * 100}%`, top: `${y * 100}%`, width: `${rw * 100}%`, height: `${rh * 100}%` });
  for (const r of images) Object.assign(el('div', 'thumb-photo', parent).style, pct(r));
  for (const [x, y, tw, th, pt, align, light] of texts) {
    const slot = el('div', 'thumb-text', parent);
    Object.assign(slot.style, pct([x, y, tw, th]), { justifyContent: JUSTIFY[align] });
    const bar = el('div', light ? 'light' : null, slot);
    bar.style.height = `${(ptToPx(pt) / h) * 100}%`;
  }
}

/** Resolves to [] if canceled. */
function pickImages(multiple) {
  return new Promise((resolve) => {
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.addEventListener('change', async () => resolve(await addFiles(input.files)));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

async function choosePhotoFor(placeholderId) {
  const [asset] = await pickImages(false);
  if (asset) fillPlaceholder(placeholderId, asset.id);
}

function imagePicker(parent, side) {
  const trigger = button(parent, 'Add image');
  const panel = el('div', 'image-panel', parent);
  attachPopover(trigger, panel, () => {
    panel.replaceChildren();
    const { assets } = getState();
    if (assets.length) {
      const grid = el('div', 'image-grid', panel);
      for (const asset of assets) {
        const b = button(grid, '', () => placeAsset(asset.id, side));
        b.title = asset.name;
        const img = el('img', null, b);
        img.src = assetUrl(asset.id);
        img.alt = asset.name;
      }
    }
    button(panel, 'Upload new…', async () => {
      (await pickImages(true)).forEach((asset, i) => {
        const fillsPlaceholder = itemsOnSide(side).some(isPlaceholder);
        placeAsset(asset.id, side, fillsPlaceholder ? undefined : { x: i * 60, y: i * 60 });
      });
    });
  });
}

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };
const textStyle = (t) => ({
  font: fontSpec(t),
  lineHeight: String(LINE_HEIGHT),
  color: t.color,
  textAlign: t.align,
  justifyContent: JUSTIFY[t.align],
});

function renderText(e, t) {
  Object.assign(e.style, textStyle(t));
  const lines = lineGeometry(t);
  const lineHeight = t.size * LINE_HEIGHT;
  while (e.children.length > lines.length) e.lastChild.remove();
  lines.forEach(({ text, cy, slope }, i) => {
    const div = e.children[i] ?? el('div', null, e);
    div.textContent = text;
    Object.assign(div.style, {
      top: `${cy - lineHeight / 2}px`,
      height: `${lineHeight}px`,
      transform: slope ? `matrix(1, ${slope}, 0, 1, 0, 0)` : '',
    });
  });
}

const polygonPoints = (item) => shapePolygon(item).map(([x, y]) => `${x},${y}`).join(' ');

function startEditing(id) {
  editingId = id;
  select([id]);
  const { editor } = cards[getItem(id).side];
  editor.focus();
  editor.select();
}

function stopEditing() {
  editingId = null;
  render();
}

function buildCard(side) {
  const figure = $(`.side[data-side="${side}"]`);
  const card = $('.card', figure);
  const caption = $('figcaption', figure);
  imagePicker(caption, side);
  button(caption, 'Add text', () => startEditing(addText(side)));
  layoutPicker(caption, side);
  const picker = colorPicker(caption, 'Background', (color) => update((s) => (s.backgrounds[side] = color)));
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
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  outline.classList.add('shape-outline');
  const outlinePolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  outline.append(outlinePolygon);
  selection.append(outline);
  for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    el('div', `handle ${h}`, selection).dataset.handle = h;
  }
  const angleHandles = ['angle-left', 'angle-right'].map((h) => {
    const handle = el('div', 'handle angle', selection);
    handle.dataset.handle = h;
    handle.title = 'Drag to change the angle';
    return handle;
  });
  const marquee = el('div', 'marquee', overlayOrigin);
  const editor = el('textarea', 'text-editor', overlayOrigin);
  editor.addEventListener('input', () => updateItem(editingId, { text: editor.value }));
  editor.addEventListener('keydown', (e) => e.key === 'Escape' && editor.blur());
  // Switching to another window also blurs the editor; editing resumes when the window regains focus.
  editor.addEventListener('blur', () => document.hasFocus() && stopEditing());
  cards[side] = {
    card, picker, surface, items, guides, trim, safe, overlay, ghost, lines, outlines, selection, marquee, editor,
    outline, outlinePolygon, angleHandles, els: new Map(),
  };

  card.addEventListener('pointerdown', (e) => onPointerDown(e, side));
  card.addEventListener('dblclick', (e) => {
    const item = getItem(e.target.closest('.item')?.dataset.id);
    if (!item) return;
    if (isText(item)) startEditing(item.id);
    else if (isPlaceholder(item)) choosePhotoFor(item.id);
    else toggleCrop(item.id);
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
  // Keeps the toolbar above the card from widening the side beyond the card; it wraps instead.
  c.card.parentElement.style.width = c.card.style.width;
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
    const kind = item.kind ?? 'image';
    let e = c.els.get(item.id);
    // Filling a placeholder keeps its id but changes its kind.
    if (e?.dataset.kind !== kind) {
      e?.remove();
      e = el('div', `item ${kind}`);
      e.dataset.id = item.id;
      e.dataset.kind = kind;
      if (kind === 'image') el('img', null, e).draggable = false;
      if (kind === 'placeholder') el('span', null, e).textContent = 'Drop a photo here or double-click';
      c.els.set(item.id, e);
    }
    if (c.items.children[index] !== e) c.items.insertBefore(e, c.items.children[index] ?? null);
    place(e, item.frame);
    if (!isText(item)) e.style.clipPath = isShaped(item) ? `polygon(${shapePolygon(item).map(([x, y]) => `${x}px ${y}px`)})` : '';
    if (isText(item)) {
      renderText(e, item);
      e.style.visibility = item.id === editingId ? 'hidden' : '';
    } else if (isImage(item)) {
      const img = e.firstChild;
      setSrc(img, assetUrl(item.assetId));
      place(img, { ...item.image, x: item.image.x - item.frame.x, y: item.image.y - item.frame.y });
    }
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
    c.selection.classList.toggle('text', isText(single));
    c.selection.classList.toggle('shaped', isShaped(single));
    c.outline.style.display = isShaped(single) ? '' : 'none';
    c.outlinePolygon.setAttribute('points', polygonPoints(single));
    const points = angleHandlePoints(single);
    c.angleHandles.forEach((handle, i) => {
      handle.hidden = !isShaped(single);
      Object.assign(handle.style, { left: `${points[i][0]}px`, top: `${points[i][1]}px` });
    });
  }
  const editing = items.find((i) => i.id === editingId);
  c.editor.hidden = !editing;
  if (editing) {
    place(c.editor, editing.frame);
    Object.assign(c.editor.style, textStyle(editing));
    if (c.editor.value !== editing.text) c.editor.value = editing.text;
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
  if (e.button !== 0 || e.target === cards[side].editor) return;
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
    .map((i) => ({ ...structuredClone(i), handle }));
  const cropping = starts.length === 1 && cropId === starts[0].id;
  const textWidth = handle === 'e' || handle === 'w';
  const mode = !handle
    ? cropping ? 'pan' : 'move'
    : handle.startsWith('angle') ? 'angle' : cropping ? 'crop' : textWidth ? 'width' : 'resize';
  const bounds = unionRect(starts.map((st) => st.frame));
  const targets = snapTargets(side, selectedIds);
  trackPointer(e, (ev) => {
    const dx = (ev.clientX - e.clientX) / scale;
    const dy = (ev.clientY - e.clientY) / scale;
    const snapping = !ev.altKey && mode !== 'pan' && mode !== 'angle';
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
  resize({ frame, image, size, shape, handle }, dx, dy, targets) {
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
    const frameNext = scaleRect(frame, k, anchor);
    return {
      frame: frameNext,
      ...(image && { image: scaleRect(image, k, anchor) }),
      ...(size && { size: size * k }),
      ...(shape && { shape: { ...shape, drop: shape.drop * k } }),
    };
  },

  // A drop moves an end inward, which is down on a top edge and up on a bottom edge,
  // so these signs tilt the edge as though the dragged end moved with the pointer.
  angle(start, dx, dy) {
    const { type, drop } = start.shape;
    const shown = clampDrop(start, type, drop);
    const towardLeft = start.handle === 'angle-left' ? 1 : -1;
    const fromTop = type === 'bottom' ? -1 : 1;
    return { shape: { type, drop: clampDrop(start, type, shown + towardLeft * fromTop * dy) } };
  },

  // Text only: changes the wrap width, keeping the font size.
  width({ frame, handle }, dx, dy, targets) {
    const snapX = targets ? targets.x.snap : (v) => v;
    let left = frame.x;
    let right = frame.x + frame.w;
    if (handle === 'w') left = Math.min(snapX(left + dx), right - MIN_SIZE);
    else right = Math.max(snapX(right + dx), left + MIN_SIZE);
    return { frame: { ...frame, x: left, w: right - left } };
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

let toolbarKey;
let refreshToolbar;

// Rebuilding the controls on every render would take focus from the size field while typing in it.
function renderToolbar() {
  const s = getState();
  const items = selectedItems();
  const key = JSON.stringify([
    s.selectedIds, s.cropId, items.map((i) => [i.side, i.kind]), !s.items.length, canListLocalFonts(),
  ]);
  if (key !== toolbarKey) {
    toolbarKey = key;
    refreshToolbar = buildToolbar(items);
  }
  refreshToolbar?.();
}

function buildToolbar(items) {
  const s = getState();
  const bar = $('#toolbar');
  bar.replaceChildren();
  if (!items.length) {
    el('span', 'hint', bar).textContent = s.items.length
      ? 'Click to select; Shift-click or drag a box to select several. Double-click an image to crop it, or text to edit it. Hold Option (Alt) while dragging to stop snapping.'
      : 'Use the buttons above each side to add photos, text, or a layout.';
    return;
  }
  const [item] = items;
  const { id } = item;
  const refreshers = [];
  if (items.length > 1) {
    el('span', 'hint', bar).textContent = `${items.length} items selected`;
  } else if (isText(item)) {
    refreshers.push(textControls(bar, id));
  } else if (isPlaceholder(item)) {
    button(bar, 'Choose photo…', () => choosePhotoFor(id));
  } else {
    const cropping = s.cropId === id;
    button(bar, cropping ? 'Done cropping' : 'Crop', () => toggleCrop(id), cropping ? 'active' : '');
    button(bar, 'Fill card', () => fillCard(id));
    button(bar, 'Uncrop', () => updateItem(id, { frame: { ...getItem(id).image } }));
  }
  if (items.length === 1) {
    const shape = el('select', 'shape', bar);
    shape.title = 'Shape';
    for (const [type, label] of Object.entries(SHAPES)) {
      const option = el('option', null, shape);
      option.value = type;
      option.textContent = label;
    }
    shape.addEventListener('change', () => setShape(id, shape.value));
    refreshers.push(() => (shape.value = shapeType(getItem(id))));
    button(bar, 'Forward', () => restack(id, 1));
    button(bar, 'Backward', () => restack(id, -1));
  }
  const sides = new Set(items.map((i) => i.side));
  const other = sides.size === 1 && SIDES.find((side) => !sides.has(side));
  if (other) button(bar, `Move to ${other}`, () => updateItems(items.map((i) => [i.id, { side: other }])));
  button(bar, 'Delete', () => removeItems(items.map((i) => i.id)), 'danger');
  if (items.length === 1 && isImage(item)) {
    const res = el('span', 'dpi', bar);
    refreshers.push(() => {
      const { assetId, image } = getItem(id);
      const dpi = Math.round(getAsset(assetId).width / (image.w / DPI));
      res.textContent = `${dpi} dpi`;
      res.classList.toggle('low', dpi < LOW_DPI);
      res.title = dpi < LOW_DPI ? `Below ${LOW_DPI} dpi; this image may print blurry at this size.` : 'Print resolution at this size';
    });
  }
  return () => refreshers.forEach((fn) => fn());
}

function textControls(bar, id) {
  button(bar, 'Edit text', () => startEditing(id));

  const font = el('select', 'font', bar);
  const fonts = fontFamilies();
  const current = getItem(id).font;
  for (const family of fonts.includes(current) ? fonts : [current, ...fonts]) {
    const option = el('option', null, font);
    option.value = option.textContent = family;
    option.style.fontFamily = `"${family}"`;
  }
  if (canListLocalFonts()) {
    const showAll = el('option', null, font);
    showAll.value = '';
    showAll.textContent = 'Show all installed fonts…';
  }
  font.addEventListener('change', async () => {
    if (font.value) return updateItem(id, { font: font.value });
    try {
      await listLocalFonts();
    } catch (e) {
      console.warn('Could not list installed fonts', e);
    }
    render();
  });

  const size = el('input', 'size', bar);
  size.type = 'number';
  size.min = '1';
  size.title = 'Font size in points';
  size.addEventListener('input', () => size.valueAsNumber > 0 && updateItem(id, { size: ptToPx(size.valueAsNumber) }));
  el('span', 'unit', bar).textContent = 'pt';

  const color = colorPicker(bar, 'Color', (c) => updateItem(id, { color: c }));
  const toggle = (label, prop) => button(bar, label, () => updateItem(id, { [prop]: !getItem(id)[prop] }));
  const bold = toggle('Bold', 'bold');
  const italic = toggle('Italic', 'italic');
  const alignGroup = el('div', 'segmented', bar);
  const ALIGNS = ['left', 'center', 'right'];
  const aligns = ALIGNS.map((align) => button(alignGroup, align, () => updateItem(id, { align }), 'capitalize'));

  return () => {
    const t = getItem(id);
    font.value = t.font;
    if (document.activeElement !== size) size.value = Math.round(pxToPt(t.size) * 10) / 10;
    color.set(t.color);
    bold.classList.toggle('active', t.bold);
    italic.classList.toggle('active', t.italic);
    aligns.forEach((b, i) => b.classList.toggle('active', ALIGNS[i] === t.align));
  };
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
    button(li, '×', () => removeAsset(asset.id), 'remove').title = 'Remove from project';
  }
}

async function onCardDrop(e, side) {
  e.preventDefault();
  e.stopPropagation();
  cards[side].card.classList.remove('drop-target');
  const at = cardPoint(side, e);
  const target = getItem(e.target.closest('.item')?.dataset.id);
  const put = (assetId, i) =>
    (i === 0 && target && fillPlaceholder(target.id, assetId)) ||
    placeAsset(assetId, side, { x: at.x + i * 60, y: at.y + i * 60 });
  const assetId = e.dataTransfer.getData(ASSET_MIME);
  if (assetId) return put(assetId, 0);
  const added = await addFiles(e.dataTransfer.files);
  added.forEach((a, i) => put(a.id, i));
}

function setupFileInputs() {
  const zone = $('#dropzone');
  zone.addEventListener('click', () => pickImages(true));
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
    const empty = getState().items.filter(isPlaceholder).length;
    const warning = `${empty === 1 ? '1 photo slot is' : `${empty} photo slots are`} still empty and won't print. Download anyway?`;
    if (empty && !confirm(warning)) return;
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
    if (e.target.closest('input, textarea, select') || document.querySelector(':popover-open')) return;
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
  await Promise.all([
    loadAssetUrls(),
    listLocalFontsIfGranted().catch((e) => console.warn('Could not list installed fonts', e)),
  ]);
  // Fonts can measure differently than when the design was saved.
  refitText();
  SIDES.forEach(buildCard);
  setupHeader();
  setupFileInputs();
  setupKeyboard();
  subscribe(render);
  const resizes = new ResizeObserver(render);
  resizes.observe($('#stage'));
  resizes.observe($('figcaption'));
  render();
}

main();
