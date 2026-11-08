import {
  addFiles,
  addShape,
  addText,
  applyLayout,
  clampDrop,
  assetUrl,
  beginGesture,
  deleteUnusedBlobs,
  endGesture,
  fillCard,
  setPhoto,
  getAsset,
  getItem,
  getState,
  holdsPhoto,
  isImage,
  isPlaceholder,
  isText,
  itemsOnSide,
  loadAssetUrls,
  offsetItem,
  photoZoom,
  placeAsset,
  redo,
  refitText,
  removeAsset,
  removeItems,
  restack,
  select,
  selectedItems,
  setOrientation,
  setPhotoZoom,
  setShape,
  subscribe,
  toggleCrop,
  toggleSelected,
  update,
  updateItem,
  updateItems,
  undo,
} from './store.js';
import { bleedRect, canvasSize, DPI, ptToPx, pxToPt, safeRect, SIDES, specSummary, trimRect } from './specs.js';
import { alignLines, clamp, growToCover, intersects, rectEdges, offsetRect, rectFromPoints, scaleRect, unionRect } from './geometry.js';
import { snapper } from './snap.js';
import { PALETTE } from './palette.js';
import { LAYOUTS, layoutSlots } from './layouts.js';
import { downloadCard } from './export.js';
import { fontSpec, lineGeometry, LINE_HEIGHT } from './text.js';
import { angledEdges, angleHandlePoints, angleHandleShown, angleHandleSign, drawnPath, dropForSlope, edgeAngle, edgeSlope, isCircle, isDrawn, isLine, isParallel, isShaped, lineEnds, lineFromEnds, lineLocalEnds, nearestAngle, shapePolygon, SHAPES, shapeType } from './shape.js';
import { canListLocalFonts, fontFamilies, listLocalFonts, listLocalFontsIfGranted } from './fonts.js';
import { icon } from './icons.js';

const ASSET_MIME = 'application/x-nycard-asset';
const MIN_SIZE = 30; // print px
const LOW_DPI = 200;
const SNAP_SCREEN_PX = 6;
const CLICK_SLOP_PX = 3;
const MAX_PHOTO_ZOOM = 2;
const TOOLBAR_GAP_PX = 8;
const $ = (sel, root = document) => root.querySelector(sel);

const cards = {};
let scale = 1;
/** Feedback drawn on one side during a pointer drag: `{ side, lines?: { x, y }, edges?: [[p0, p1]], marquee?: rect }`. */
let dragHints = null;
/** The text item being edited in place, if any. */
let editingId = null;
/** The side the user last clicked, dropped onto, or used the controls of; Cmd+A selects within it. */
let lastSide = SIDES[0];

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

function toolButton(parent, iconName, label, onClick, className = '') {
  const b = button(parent, '', onClick, `tool ${className}`);
  b.append(icon(iconName), label);
  return b;
}

function iconButton(parent, iconName, title, onClick, className = '') {
  const b = toolButton(parent, iconName, '', onClick, `icon-only ${className}`);
  b.title = title;
  return b;
}

const divider = (parent) => el('span', 'divider', parent);

function svgEl(tag, className, parent) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (className) e.classList.add(className);
  parent.append(e);
  return e;
}

function slider(parent, name, range, onInput) {
  const label = el('label', 'slider', parent);
  label.append(name);
  const input = el('input', null, label);
  Object.assign(input, { type: 'range', ...range });
  input.addEventListener('input', () => onInput(input.valueAsNumber));
  // The keyboard shortcuts ignore keys pressed while an input has focus.
  input.addEventListener('pointerdown', () => untilPointerEnd(() => input.blur()));
  return input;
}

/** A length field in points. Call `set` on the result with a length in print px to show it. */
function pointsField(parent, title, onInput) {
  const input = el('input', 'size', parent);
  input.type = 'number';
  input.min = '1';
  input.title = title;
  input.addEventListener('input', () => input.valueAsNumber > 0 && onInput(ptToPx(input.valueAsNumber)));
  el('span', 'unit', parent).textContent = 'pt';
  return {
    set(px) {
      if (document.activeElement !== input) input.value = Math.round(pxToPt(px) * 10) / 10;
    },
  };
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
  const trigger = toolButton(parent, 'layout', 'Layout');
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

function shapePicker(parent, side) {
  const trigger = toolButton(parent, 'shape', 'Shape');
  const menu = el('div', 'more-menu', parent);
  attachPopover(trigger, menu);
  for (const [type, label] of Object.entries({ circle: 'Circle', line: 'Line', ...SHAPES })) {
    toolButton(menu, type, label, () => addShape(side, type));
  }
}

function drawThumb(parent, { images, texts }, orientation) {
  const { w, h } = trimRect(orientation);
  parent.style.aspectRatio = `${w} / ${h}`;
  const pct = ([x, y, rw, rh]) => ({ left: `${x * 100}%`, top: `${y * 100}%`, width: `${rw * 100}%`, height: `${rh * 100}%` });
  for (const [x, y, rw, rh, type, drop] of images) {
    const photo = el('div', 'thumb-photo', parent);
    Object.assign(photo.style, pct([x, y, rw, rh]));
    // In the photo's own percentages; a layout's drop is a fraction of the trim height.
    const local = { frame: { w: 100, h: 100 }, shape: type && { type, drop: (drop / rh) * 100 } };
    if (type) photo.style.clipPath = `polygon(${shapePolygon(local).map(([px, py]) => `${px}% ${py}%`)})`;
  }
  for (const [x, y, tw, th, pt, align, light, type, drop] of texts) {
    const slot = el('div', 'thumb-text', parent);
    Object.assign(slot.style, pct([x, y, tw, th]), { justifyContent: JUSTIFY[align] });
    const bar = el('div', light ? 'light' : null, slot);
    bar.style.height = `${(ptToPx(pt) / h) * 100}%`;
    if (type === 'parallelogram') bar.style.transform = `matrix(1, ${-(drop * h) / (tw * w)}, 0, 1, 0, 0)`;
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

async function choosePhotoFor(id) {
  const [asset] = await pickImages(false);
  if (asset) setPhoto(id, asset.id);
}

function imagePicker(parent, side) {
  const trigger = toolButton(parent, 'image', 'Photo');
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

function renderDrawn(e, item) {
  const [paint, hit] = e.firstChild.children;
  const d = drawnPath(item);
  paint.setAttribute('d', d);
  hit.setAttribute('d', d);
  Object.assign(paint.style, {
    fill: item.stroked ? 'none' : item.color,
    stroke: item.stroked ? item.color : 'none',
    strokeWidth: `${item.strokeWidth}px`,
  });
  e.style.opacity = item.opacity;
}

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
  for (const type of ['pointerdown', 'drop']) figure.addEventListener(type, () => (lastSide = side), true);
  const card = $('.card', figure);
  const caption = $('figcaption', figure);
  imagePicker(caption, side);
  toolButton(caption, 'text', 'Text', () => startEditing(addText(side)));
  shapePicker(caption, side);
  layoutPicker(caption, side);
  divider(caption);
  const picker = colorPicker(caption, 'Background color', (color) => update((s) => (s.backgrounds[side] = color)));
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
  const outline = svgEl('svg', 'shape-outline', selection);
  const outlinePolygon = svgEl('polygon', null, outline);
  for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    el('div', `handle ${h}`, selection).dataset.handle = h;
  }
  const angleHandles = ['angle-left', 'angle-right'].map((h) => {
    const handle = el('div', 'handle angle', selection);
    handle.dataset.handle = h;
    handle.title = 'Drag to change the angle';
    return handle;
  });
  const lineHandles = ['line-start', 'line-end'].map((h) => {
    const handle = el('div', 'handle end', selection);
    handle.dataset.handle = h;
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
    outline, outlinePolygon, angleHandles, lineHandles, els: new Map(),
  };

  card.addEventListener('pointerdown', (e) => onPointerDown(e, side));
  card.addEventListener('dblclick', (e) => {
    const item = getItem(e.target.closest('.item')?.dataset.id);
    if (!item) return;
    if (isText(item)) startEditing(item.id);
    else if (isPlaceholder(item)) choosePhotoFor(item.id);
    else if (isImage(item)) toggleCrop(item.id);
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    showDropTarget(side, true, photoElementAt(e));
  });
  card.addEventListener('dragleave', () => showDropTarget(side, false));
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
      if (isDrawn(item)) {
        const svg = svgEl('svg', null, e);
        svgEl('path', null, svg);
        svgEl('path', 'hit', svg);
      }
      c.els.set(item.id, e);
    }
    if (c.items.children[index] !== e) c.items.insertBefore(e, c.items.children[index] ?? null);
    place(e, item.frame);
    if (holdsPhoto(item)) e.style.clipPath = isShaped(item) ? `polygon(${shapePolygon(item).map(([x, y]) => `${x}px ${y}px`)})` : '';
    if (isText(item)) {
      renderText(e, item);
      e.style.visibility = item.id === editingId ? 'hidden' : '';
    } else if (isImage(item)) {
      const img = e.firstChild;
      setSrc(img, assetUrl(item.assetId));
      place(img, { ...item.image, x: item.image.x - item.frame.x, y: item.image.y - item.frame.y });
    } else if (isDrawn(item)) {
      renderDrawn(e, item);
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
    c.selection.classList.toggle('circle', isCircle(single));
    c.selection.classList.toggle('line', isLine(single));
    if (isLine(single)) {
      lineLocalEnds(single).forEach(([x, y], i) => Object.assign(c.lineHandles[i].style, { left: `${x}px`, top: `${y}px` }));
    }
    c.outline.style.display = isShaped(single) ? '' : 'none';
    c.outlinePolygon.setAttribute('points', polygonPoints(single));
    const points = angleHandlePoints(single);
    c.angleHandles.forEach((handle, i) => {
      handle.hidden = !angleHandleShown(single, handle.dataset.handle);
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
  for (const [[x0, y0], [x1, y1]] of hints.edges ?? []) {
    const line = el('div', null, c.lines);
    place(line, { x: x0, y: y0, w: Math.hypot(x1 - x0, y1 - y0), h: 0 });
    Object.assign(line.style, { transformOrigin: '0 0', transform: `rotate(${edgeAngle([[x0, y0], [x1, y1]])}rad)` });
  }
  c.marquee.hidden = !hints.marquee;
  if (hints.marquee) place(c.marquee, hints.marquee);
}

function untilPointerEnd(onEnd) {
  beginGesture();
  const end = () => {
    endGesture();
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onEnd();
  };
  // On the window so the drag still ends if the captured element is removed mid-drag, e.g. by Delete.
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

function trackPointer(e, onMove, onClick) {
  const target = e.target;
  target.setPointerCapture(e.pointerId);
  let moved = false;
  const move = (ev) => {
    moved ||= Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > CLICK_SLOP_PX;
    if (moved) {
      $('#toolbar').style.visibility = 'hidden';
      onMove(ev);
    }
  };
  window.addEventListener('pointermove', move);
  untilPointerEnd(() => {
    $('#toolbar').style.visibility = '';
    dragHints = null;
    if (!moved) onClick?.();
    render();
    window.removeEventListener('pointermove', move);
  });
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
  const edge = handle?.length === 1;
  const mode = !handle
    ? cropping ? 'pan' : 'move'
    : handle.startsWith('angle') ? 'angle' : handle.startsWith('line') ? 'line' : cropping ? 'crop' : edge ? 'stretch' : 'resize';
  const bounds = unionRect(starts.map((st) => st.frame));
  const targets = snapTargets(side, selectedIds);
  const otherEdges = itemsOnSide(side).filter((i) => !selectedIds.includes(i.id)).flatMap(angledEdges);
  const lineAngles = [0, Math.PI / 2, ...otherEdges.map(edgeAngle)];
  const edgeDrops = mode === 'angle'
    ? otherEdges
      .filter((edge) => edgeSlope(edge) !== 0)
      .map((edge) => [edge, dropForSlope(starts[0], edgeSlope(edge))])
    : [];
  const angleSnap = snapper([0, ...edgeDrops.map(([, drop]) => drop)], SNAP_SCREEN_PX / scale);
  trackPointer(e, (ev) => {
    const dx = (ev.clientX - e.clientX) / scale;
    const dy = (ev.clientY - e.clientY) / scale;
    if (mode === 'angle') {
      const [start] = starts;
      const next = drag.angle(start, dx, dy, ev.altKey ? null : angleSnap);
      const matched = angleSnap.touching([next.shape.drop]);
      const edges = edgeDrops.filter(([, drop]) => matched.includes(drop)).map(([edge]) => edge);
      dragHints = ev.altKey ? null : { side, edges };
      return updateItems([[start.id, next]]);
    }
    if (mode === 'line') {
      const [start] = starts;
      const { fixed, end, angle } = moveLineEnd(start, dx, dy, ev.altKey ? null : targets, lineAngles);
      if (Math.hypot(end[0] - fixed[0], end[1] - fixed[1]) < MIN_SIZE) return;
      const edges = angle === undefined ? [] : [[fixed, end], ...otherEdges.filter((edge) => isParallel(edgeAngle(edge), angle))];
      dragHints = ev.altKey ? null : { side, edges, lines: { x: targets.x.touching([end[0]]), y: targets.y.touching([end[1]]) } };
      return updateItems([[start.id, lineFromEnds(fixed, end)]]);
    }
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

/** `targets` is null when snapping is off. The result has an `angle` if the line snapped to one of `angles`. */
function moveLineEnd(start, dx, dy, targets, angles) {
  const ends = lineEnds(start);
  const moving = start.handle === 'line-start' ? 0 : 1;
  const fixed = ends[1 - moving];
  const pointer = [ends[moving][0] + dx, ends[moving][1] + dy];
  if (!targets) return { fixed, end: pointer };
  const tolerance = SNAP_SCREEN_PX / scale;
  const angle = nearestAngle(fixed, pointer, angles, tolerance);
  if (angle === null) return { fixed, end: [targets.x.snap(pointer[0]), targets.y.snap(pointer[1])] };
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  const along = (pointer[0] - fixed[0]) * ux + (pointer[1] - fixed[1]) * uy;
  const onRay = [fixed[0] + along * ux, fixed[1] + along * uy];
  // Sliding along the ray can align the end with other items without changing the angle.
  const [slide = 0] = [targets.x.delta([onRay[0]]) / ux, targets.y.delta([onRay[1]]) / uy]
    .filter((s) => s && Math.abs(s) <= 2 * tolerance)
    .sort((a, b) => Math.abs(a) - Math.abs(b));
  return { fixed, end: [onRay[0] + slide * ux, onRay[1] + slide * uy], angle };
}

function snapTargets(side, excludeIds) {
  const { orientation } = getState();
  const others = itemsOnSide(side).filter((i) => !excludeIds.includes(i.id));
  const rects = [bleedRect(orientation), trimRect(orientation), safeRect(orientation), ...others.map((i) => i.frame)];
  const axis = (a) => snapper(rects.flatMap((r) => alignLines(r, a)), SNAP_SCREEN_PX / scale);
  return { x: axis('x'), y: axis('y') };
}

const NO_LIMIT = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

function moveEdges(frame, handle, dx, dy, targets, limit = NO_LIMIT) {
  const snapX = targets ? targets.x.snap : (v) => v;
  const snapY = targets ? targets.y.snap : (v) => v;
  let { left, top, right, bottom } = rectEdges(frame);
  if (handle.includes('w')) left = clamp(snapX(left + dx), limit.left, right - MIN_SIZE);
  if (handle.includes('e')) right = clamp(snapX(right + dx), left + MIN_SIZE, limit.right);
  if (handle.includes('n')) top = clamp(snapY(top + dy), limit.top, bottom - MIN_SIZE);
  if (handle.includes('s')) bottom = clamp(snapY(bottom + dy), top + MIN_SIZE, limit.bottom);
  return rectFromPoints({ x: left, y: top }, { x: right, y: bottom });
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

  // A drop moves an end inward, which is down on a top edge and up on a bottom edge, so these
  // signs move the dragged end with the pointer. Each handle insets only its own end and stops
  // at level; slanting the other way takes the other handle.
  angle(start, dx, dy, snap) {
    const { type, drop } = start.shape;
    const shown = clampDrop(start, type, drop);
    const sign = angleHandleSign(start.handle);
    const fromTop = type === 'bottom' ? -1 : 1;
    const moved = shown + sign * fromTop * dy;
    const snapped = snap ? snap.snap(moved) : moved;
    const ownSide = sign * Math.max(0, sign * snapped);
    return { shape: { type, drop: clampDrop(start, type, ownSide) } };
  },

  // The photo isn't distorted: it grows only if the frame outgrows it.
  // Text height follows its lines, so for text this sets the wrap width.
  stretch({ frame, image, handle }, dx, dy, targets) {
    const next = moveEdges(frame, handle, dx, dy, targets);
    return { frame: next, ...(image && { image: growToCover(image, next) }) };
  },

  crop({ frame, image, handle }, dx, dy, targets) {
    return { frame: moveEdges(frame, handle, dx, dy, targets, rectEdges(image)), image };
  },

  // Slides the image under a fixed frame, keeping the frame covered.
  pan({ frame, image }, dx, dy) {
    return { frame, image: growToCover(offsetRect(image, dx, dy), frame) };
  },
};

let toolbarKey;
let refreshToolbar;

// Rebuilding the controls on every render would take focus from the size field while typing in it.
function renderToolbar() {
  const s = getState();
  const items = selectedItems();
  const key = JSON.stringify([
    s.selectedIds, s.cropId, items.map((i) => [i.side, i.kind, i.stroked]), !s.items.length, canListLocalFonts(),
  ]);
  if (key !== toolbarKey) {
    toolbarKey = key;
    refreshToolbar = buildToolbar(items);
  }
  refreshToolbar?.();
  placeToolbar(items);
}

function placeToolbar(items) {
  if (!items.length) return;
  const bar = $('#toolbar');
  const stage = $('#stage').getBoundingClientRect();
  const box = unionRect(items.map((i) => {
    const { x, y, width: w, height: h } = cards[i.side].els.get(i.id).getBoundingClientRect();
    return { x, y, w, h };
  }));
  const { offsetWidth: w, offsetHeight: h } = bar;
  const above = box.y - TOOLBAR_GAP_PX - h;
  const below = box.y + box.h + TOOLBAR_GAP_PX;
  const ceiling = $('figcaption').getBoundingClientRect().bottom;
  const preferred = above >= ceiling ? above
    : below + h <= stage.bottom ? below
    : box.y + TOOLBAR_GAP_PX;
  const top = clamp(preferred, ceiling, stage.bottom - h);
  const left = clamp(box.x + box.w / 2 - w / 2, stage.left + TOOLBAR_GAP_PX, stage.right - w - TOOLBAR_GAP_PX);
  Object.assign(bar.style, { left: `${left - stage.left}px`, top: `${top - stage.top}px` });
}

function buildToolbar(items) {
  const s = getState();
  const bar = $('#toolbar');
  const hint = $('#hint');
  bar.replaceChildren();
  bar.hidden = !items.length;
  hint.hidden = !!items.length;
  if (!items.length) {
    hint.textContent = s.items.length
      ? 'Click to select; Shift-click or drag a box to select several. Double-click an image to crop it, or text to edit it. Hold Option (Alt) while dragging to stop snapping.'
      : 'Use the buttons above each side to add photos, text, shapes, or a layout.';
    return;
  }
  const [item] = items;
  const { id } = item;
  const ids = items.map((i) => i.id);
  const sides = new Set(items.map((i) => i.side));
  const other = sides.size === 1 && SIDES.find((side) => !sides.has(side));
  const moveToOther = (parent) => toolButton(parent, 'flip', `Move to ${other}`, () => updateItems(ids.map((i) => [i, { side: other }])));
  const deleteSelected = () => iconButton(bar, 'trash', 'Delete', () => removeItems(ids), 'danger');
  if (items.length > 1) {
    el('span', 'count', bar).textContent = `${items.length} items`;
    divider(bar);
    if (other) moveToOther(bar);
    deleteSelected();
    return;
  }
  const refreshers = [];
  if (isText(item)) {
    refreshers.push(textControls(bar, id));
  } else if (isPlaceholder(item)) {
    toolButton(bar, 'image', 'Choose photo…', () => choosePhotoFor(id));
  } else if (isDrawn(item)) {
    refreshers.push(shapeControls(bar, id));
  } else {
    refreshers.push(photoControls(bar, id));
  }
  divider(bar);
  refreshers.push(moreMenu(bar, id, moveToOther));
  deleteSelected();
  return () => refreshers.forEach((fn) => fn());
}

function photoControls(bar, id) {
  const cropping = getState().cropId === id;
  toolButton(bar, 'crop', cropping ? 'Done' : 'Crop', () => toggleCrop(id), cropping ? 'active' : '');
  toolButton(bar, 'fill', 'Fill card', () => fillCard(id));
  toolButton(bar, 'full', 'Full photo', () => updateItem(id, { frame: { ...getItem(id).image } }));
  divider(bar);
  const zoom = slider(bar, 'Zoom', { min: 1, max: MAX_PHOTO_ZOOM, step: 0.01 }, (value) => setPhotoZoom(id, value));
  divider(bar);
  const res = el('span', 'dpi', bar);
  return () => {
    const photo = getItem(id);
    zoom.value = photoZoom(photo);
    const dpi = Math.round(getAsset(photo.assetId).width / (photo.image.w / DPI));
    res.textContent = `${dpi} dpi`;
    res.classList.toggle('low', dpi < LOW_DPI);
    res.title = dpi < LOW_DPI ? `Below ${LOW_DPI} dpi; this image may print blurry at this size.` : 'Print resolution at this size';
  };
}

function shapeControls(bar, id) {
  const { stroked } = getItem(id);
  if (!isLine(getItem(id))) {
    const paintMode = (name, title, value) => iconButton(bar, name, title, () => updateItem(id, { stroked: value }), stroked === value ? 'active' : '');
    paintMode('solid', 'Fill', false);
    paintMode('outline', 'Stroke', true);
    divider(bar);
  }
  const width = stroked && pointsField(bar, 'Stroke width in points', (strokeWidth) => updateItem(id, { strokeWidth }));
  if (stroked) divider(bar);
  const color = colorPicker(bar, 'Color', (c) => updateItem(id, { color: c }));
  const opacity = slider(bar, 'Opacity', { min: 0, max: 1, step: 0.01 }, (value) => updateItem(id, { opacity: value }));
  return () => {
    const item = getItem(id);
    color.set(item.color);
    opacity.value = item.opacity;
    if (width) width.set(item.strokeWidth);
  };
}

function moreMenu(bar, id, moveToOther) {
  const trigger = iconButton(bar, 'more', 'More');
  const menu = el('div', 'more-menu', bar);
  attachPopover(trigger, menu);
  const hasCorners = !isCircle(getItem(id)) && !isLine(getItem(id));
  const shape = hasCorners && el('select', null, menu);
  if (shape) {
    shape.title = 'Shape';
    for (const [type, label] of Object.entries(SHAPES)) {
      const option = el('option', null, shape);
      option.value = type;
      option.textContent = label;
    }
    shape.addEventListener('change', () => setShape(id, shape.value));
  }
  toolButton(menu, 'forward', 'Bring forward', () => restack(id, 1));
  toolButton(menu, 'backward', 'Send backward', () => restack(id, -1));
  moveToOther(menu);
  return () => {
    if (shape) shape.value = shapeType(getItem(id));
  };
}

function textControls(bar, id) {
  toolButton(bar, 'edit', 'Edit', () => startEditing(id));
  divider(bar);

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

  const size = pointsField(bar, 'Font size in points', (px) => updateItem(id, { size: px }));

  divider(bar);
  const color = colorPicker(bar, 'Text color', (c) => updateItem(id, { color: c }));
  const toggle = (name, title) => iconButton(bar, name, title, () => updateItem(id, { [name]: !getItem(id)[name] }));
  const bold = toggle('bold', 'Bold');
  const italic = toggle('italic', 'Italic');
  divider(bar);
  const ALIGNS = ['left', 'center', 'right'];
  const aligns = ALIGNS.map((align) => iconButton(bar, align, `Align ${align}`, () => updateItem(id, { align })));

  return () => {
    const t = getItem(id);
    font.value = t.font;
    size.set(t.size);
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

/**
 * Looks past text so a photo can be dropped onto a picture with a title over it.
 * Holding Option (Alt) finds nothing, so the drop adds a photo instead of replacing one.
 */
function photoElementAt(ev) {
  if (ev.altKey) return undefined;
  return document
    .elementsFromPoint(ev.clientX, ev.clientY)
    .find((e) => e.matches('.item') && holdsPhoto(getItem(e.dataset.id)));
}

function showDropTarget(side, over, target) {
  const { card } = cards[side];
  card.classList.toggle('drop-target', over && !target);
  for (const i of card.querySelectorAll('.item')) i.classList.toggle('drop-target', i === target);
}

async function onCardDrop(e, side) {
  e.preventDefault();
  e.stopPropagation();
  showDropTarget(side, false);
  const at = cardPoint(side, e);
  const targetId = photoElementAt(e)?.dataset.id;
  const put = (assetId, i) =>
    (i === 0 && targetId && setPhoto(targetId, assetId)) ||
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
  $('#guides').classList.toggle('active', s.showGuides);
}

function setupHeader() {
  const history = $('#history');
  iconButton(history, 'undo', 'Undo', () => undo());
  iconButton(history, 'redo', 'Redo', () => redo());
  for (const b of document.querySelectorAll('#orientation button')) {
    b.prepend(icon(b.dataset.orientation));
    b.addEventListener('click', () => setOrientation(b.dataset.orientation));
  }
  const guides = $('#guides');
  guides.prepend(icon('guides'));
  guides.addEventListener('click', () => update((s) => (s.showGuides = !s.showGuides)));
  const specTrigger = iconButton($('#spec'), 'info', 'Print specs');
  const specPanel = el('div', 'spec-panel', $('#spec'));
  attachPopover(specTrigger, specPanel, () => (specPanel.textContent = specSummary(getState().orientation)));
  const dl = $('#download');
  dl.prepend(icon('download'));
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
    if (document.querySelector(':popover-open')) return;
    const inTextField = e.target.closest('textarea, input');
    const inControl = e.target.closest('textarea, input, select');
    const command = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (command && (key === 'z' || key === 'a')) {
      if (inTextField) return;
      e.preventDefault();
      if (key === 'a') select(itemsOnSide(lastSide).map((i) => i.id));
      else if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (inControl) return;
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
  if (editingId && !getItem(editingId)) editingId = null;
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
    deleteUnusedBlobs().catch((e) => console.warn('Could not clean up stored images', e)),
  ]);
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
