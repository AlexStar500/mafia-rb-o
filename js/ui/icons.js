import { raw } from "./dom.js";

/**
 * Inline line icons. Path data is trusted and never receives user input.
 * Keeping them inline makes the game work offline without an icon font.
 */
const PATHS = {
  play: '<path d="M8 5.5v13l10-6.5-10-6.5Z"/>',
  users:
    '<path d="M16 20v-1.6a4 4 0 0 0-4-4H6.5a4 4 0 0 0-4 4V20"/><circle cx="9.2" cy="7.2" r="3.4"/><path d="M17 4.5a3.3 3.3 0 0 1 0 6.4M21.5 20v-1.6a4 4 0 0 0-3-3.8"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.4 4.4"/>',
  bot:
    '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8.5 12h.01M15.5 12h.01M9 16h6M2 12v3M22 12v3"/>',
  eye:
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  mask:
    '<path d="M4 7.5c3-1.5 5-1 8 0 3-1 5-1.5 8 0-.4 6.5-3 11.5-8 11.5S4.4 14 4 7.5Z"/><path d="M7.5 11.5h2M14.5 11.5h2M9.5 15.5c1.5 1 3.5 1 5 0"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3.1 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 6 6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  share:
    '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.4 10.8 7.2-4.4M8.4 13.2l7.2 4.4"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  chat: '<path d="M21 11.5a8 8 0 0 1-8.5 8 9.7 9.7 0 0 1-3-.5L4 21l1.5-4.4a7.8 7.8 0 0 1-1-3.9 8 8 0 0 1 8.5-8 8 8 0 0 1 8 7.8Z"/>',
  send: '<path d="M21 3 10.5 13.5M21 3l-6.4 18-4.1-7.5L3 9.4 21 3Z"/>',
  moon: '<path d="M20.5 14.2A8.8 8.8 0 0 1 9.8 3.5 8.9 8.9 0 1 0 20.5 14.2Z"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  vote:
    '<path d="m5 11 4-4 4 4M9 7v9M4 20h16"/><path d="M15 20v-5.5a2 2 0 0 1 4 0V20"/>',
  gavel:
    '<path d="m13.5 4.5 6 6M16 2l6 6M14.5 7.5l2 2M8 12l4 4-5.5 5.5L2 17l6-5Z"/><path d="m11 9 4 4"/>',
  skull:
    '<path d="M5 10a7 7 0 1 1 14 0v2.2a2 2 0 0 1-1.2 1.8l-.8.3V18a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-3.7l-.8-.3A2 2 0 0 1 5 12.2V10Z"/><path d="M9 10h.01M15 10h.01M9.5 14h5"/>',
  crown: '<path d="m3 7 4.2 3.3L12 4l4.8 6.3L21 7l-1.6 11H4.6L3 7Z"/>',
  check: '<path d="m5 12.5 4.4 4.4L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.4 2"/>',
  volume:
    '<path d="M4 9h3l4-3.5v13L7 15H4V9Z"/><path d="M15 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  volumeOff: '<path d="M4 9h3l4-3.5v13L7 15H4V9Z"/><path d="m16 9 5 5M21 9l-5 5"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.7M20 5v6h-6"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.7 5.2 3.7 8.5S14.5 18.2 12 20.5C9.5 18.2 8.3 15.3 8.3 12S9.5 5.8 12 3.5Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  wifi: '<path d="M4 9a12 12 0 0 1 16 0M7 12.5a8 8 0 0 1 10 0M10 16a3.5 3.5 0 0 1 4 0"/><circle cx="12" cy="19" r=".7" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 2.9 7.7 7 9.5 4.1-1.8 7-5.2 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4.5"/>',
  blade: '<path d="m4 20 5.5-5.5M14 4l6 6-7.5 1.5L10 19l-1.5-4.5L4 13l8-8Z"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.1 1-1.1 2.1M12 17h.01"/>',
  spark: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="m18.5 16 .8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z"/>',
  joker: '<path d="M12 4 4 9l2 9h12l2-9-8-5Z"/><path d="M9 12h.01M15 12h.01M9.5 16c1.5-1.2 3.5-1.2 5 0"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
  fast: '<path d="m4 6 7 6-7 6V6ZM13 6l7 6-7 6V6Z"/>',
  download: '<path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  logout: '<path d="M14 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-3M9 12h12m0 0-3-3m3 3-3 3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".7" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 3l4 4M14 6l4 4"/>',
  scroll: '<path d="M6 4h11a2 2 0 0 1 2 2v13a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2V4Z"/><path d="M6 4a2 2 0 0 0-2 2v1h2M10 9h5M10 13h5"/>',
  heart: '<path d="M12 20s-7-4.3-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.7 12 20 12 20Z"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  link: '<path d="M10 13a4.5 4.5 0 0 0 6.4 0l2-2a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 11a4.5 4.5 0 0 0-6.4 0l-2 2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  coffee: '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M16 9h2a2.5 2.5 0 0 1 0 5h-2M7 3v2M11 3v2"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  door: '<path d="M4 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M2 21h20M12 12h.01"/>',
  dots: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  arrowUp: '<path d="M12 20V4m0 0-6 6m6-6 6 6"/>',
  sliders: '<path d="M4 7h9M19 7h1M4 17h1M13 17h7"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>',
};

export function icon(name, { className = "", size = 20, label = "" } = {}) {
  const path = PATHS[name] ?? PATHS.info;
  const a11y = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"';
  return raw(
    `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"${a11y}>${path}</svg>`,
  );
}

export const ICON_NAMES = Object.freeze(Object.keys(PATHS));
