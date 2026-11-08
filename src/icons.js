const PATHS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  portrait: '<rect x="7" y="3" width="10" height="18" rx="1.5"/>',
  landscape: '<rect x="3" y="7" width="18" height="10" rx="1.5"/>',
  guides: '<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 3"/><rect x="8" y="8" width="8" height="8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5"/><path d="M12 8h.01"/>',
  download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 21h16"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>',
  text: '<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M10 10v11"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  fill: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
  full: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="8" y="9" width="8" height="6" stroke-dasharray="2 2"/>',
  forward: '<rect x="9" y="9" width="12" height="12" rx="2" fill="currentColor"/><path d="M15 5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2"/>',
  backward: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M15 5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2" stroke-dasharray="3 3"/>',
  flip: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7Z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7Z"/>',
  italic: '<path d="M10 5h8"/><path d="M6 19h8"/><path d="m14 5-4 14"/>',
  left: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/>',
  center: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M6 18h12"/>',
  right: '<path d="M4 6h16"/><path d="M10 12h10"/><path d="M7 18h13"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name];
  return svg;
}
