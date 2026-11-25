// Line icons from the design draft, drawn as SVG in one color and tinted
// natively (`tintColor`), so they follow the theme's tokens and the
// appearance. Each is a 20 × 20 box.
import { Image, type JSX } from "nsh";

const STROKE = 'fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  search: `<g ${STROKE} stroke-width="2"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></g>`,
  doc: `<g ${STROKE} stroke-width="1.7"><path d="M5 2.5h6.5L15 6v11.5H5z"/><path d="M11.5 2.5V6H15M7.5 10h5M7.5 13h3.5"/></g>`,
  spark: `<path fill="#000" d="M10 1.5l1.6 5.3 5.4-1.9-3.6 4.4 3.6 4.4-5.4-1.9L10 17.1l-1.6-5.3-5.4 1.9 3.6-4.4L3 4.9l5.4 1.9z"/>`,
  plus: `<g ${STROKE} stroke-width="2"><path d="M10 4v12M4 10h12"/></g>`,
  list: `<g ${STROKE} stroke-width="1.7"><path d="m3 5.5 1.5 1.5L7 4.5M3 12.5 4.5 14 7 11.5M10 6h7M10 13h7"/></g>`,
  check: `<g ${STROKE} stroke-width="2.6"><path d="m5 10.5 3.2 3L15 6.5"/></g>`,
  bell: `<g ${STROKE} stroke-width="1.8"><path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13z"/><path d="M8.3 17.2a1.9 1.9 0 0 0 3.4 0"/></g>`,
  alarm: `<g ${STROKE} stroke-width="1.8"><circle cx="10" cy="11" r="6"/><path d="M10 8v3.2l2 1.3M3.5 4.5 5.5 3M16.5 4.5 14.5 3"/></g>`,
  pen: `<g ${STROKE} stroke-width="1.7"><path d="M4 15.5 13.8 5.7a1.6 1.6 0 0 1 2.3 2.3L6.3 17.8 3 18.5z"/><path d="M12.4 7.1l2.3 2.3"/></g>`,
  mic: `<g ${STROKE} stroke-width="1.8"><rect x="7" y="2.2" width="6" height="10.3" rx="3"/><path d="M4.4 9.6a5.6 5.6 0 0 0 11.2 0M10 15.2v2.6"/></g>`,
  // A note iCloud Drive is downloading: a cloud with an arrow down.
  cloud: `<g ${STROKE} stroke-width="1.6"><path d="M6.2 15.5H14a3.6 3.6 0 0 0 .5-7.15A5 5 0 0 0 4.9 9.1 3.2 3.2 0 0 0 6.2 15.5z"/><path d="M10 9.3v4.4M8.2 12l1.8 1.8 1.8-1.8"/></g>`,
  eye: `<g ${STROKE} stroke-width="1.8"><path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.6"/></g>`,
  // The settings' toolbar and rows.
  gear: `<g ${STROKE} stroke-width="1.6"><circle cx="10" cy="10" r="2.6"/><path d="M10 1.8v2.3M10 15.9v2.3M18.2 10h-2.3M4.1 10H1.8M15.8 4.2l-1.6 1.6M5.8 14.2l-1.6 1.6M15.8 15.8l-1.6-1.6M5.8 5.8 4.2 4.2"/><circle cx="10" cy="10" r="5.4"/></g>`,
  appearance: `<g ${STROKE} stroke-width="1.6"><circle cx="10" cy="10" r="7.4"/></g><path fill="#000" d="M10 2.6a7.4 7.4 0 0 1 0 14.8z"/>`,
  info: `<g ${STROKE} stroke-width="1.7"><circle cx="10" cy="10" r="7.4"/><path d="M10 9v4.6"/></g><circle fill="#000" cx="10" cy="6.3" r="1.05"/>`,
  folder: `<g ${STROKE} stroke-width="1.6"><path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.8 2H16a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 16 16.5H4A1.5 1.5 0 0 1 2.5 15z"/><path d="M2.5 8.5h15"/></g>`,
  copy: `<g ${STROKE} stroke-width="1.6"><rect x="6.5" y="6.5" width="10" height="10" rx="2"/><path d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5"/></g>`,
  external: `<g ${STROKE} stroke-width="1.7"><path d="M8 4.5H5A1.5 1.5 0 0 0 3.5 6v9A1.5 1.5 0 0 0 5 16.5h9a1.5 1.5 0 0 0 1.5-1.5v-3"/><path d="M11 3.5h5.5V9M16.5 3.5 9 11"/></g>`,
  trash: `<g ${STROKE} stroke-width="1.6"><path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6"/></g>`,
  chevron: `<g ${STROKE} stroke-width="1.8"><path d="m8 4.5 5.5 5.5L8 15.5"/></g>`,
  chevrons: `<g ${STROKE} stroke-width="1.7"><path d="m6.5 8 3.5-3.5L13.5 8M6.5 12l3.5 3.5 3.5-3.5"/></g>`,
  // The settings sidebar's tiles: filled glyphs, white on a colored square (drawn on a 16 grid).
  tileGear: `<path fill="#000" transform="scale(1.25)" d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm6 3.6V7.2l-1.7-.4-.4-1 .9-1.5-1.1-1.1-1.5.9-1-.4L8.8 2H7.2l-.4 1.7-1 .4-1.5-.9-1.1 1.1.9 1.5-.4 1L2 7.2v1.6l1.7.4.4 1-.9 1.5 1.1 1.1 1.5-.9 1 .4.4 1.7h1.6l.4-1.7 1-.4 1.5.9 1.1-1.1-.9-1.5.4-1Z"/>`,
  tileOption: `<g ${STROKE} stroke-width="1.7" transform="scale(1.25)"><path d="M2 4.5h3.5l4 7H14M10 4.5h4"/></g>`,
  tileMic: `<g transform="scale(1.25)"><rect fill="#000" x="5.5" y="1.5" width="5" height="8.5" rx="2.5"/><path ${STROKE} stroke-width="1.5" d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"/></g>`,
  tileBell: `<path fill="#000" transform="scale(1.25)" d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v3L2 11.5h12L12.5 9V6A4.5 4.5 0 0 0 8 1.5ZM6 12.5a2 2 0 0 0 4 0Z"/>`,
  tileAppearance: `<g transform="scale(1.25)"><circle ${STROKE} stroke-width="1.5" cx="8" cy="8" r="5.5"/><path fill="#000" d="M8 2.5a5.5 5.5 0 0 1 0 11Z"/></g>`,
  tileSpark: `<path fill="#000" transform="scale(1.25)" d="M8 1.5l1.3 4.2 4.2 1.3-4.2 1.3L8 12.5 6.7 8.3 2.5 7l4.2-1.3Z"/>`,
} as const;

/** The icons Jot draws. */
export type IconName = keyof typeof PATHS;

const sources = new Map<IconName, string>();

/** The icon as a `data:` URL (a template: only its shape counts). */
export function iconSource(name: IconName): string {
  let src = sources.get(name);
  if (!src) {
    src = `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">${PATHS[name]}</svg>`,
    )}`;
    sources.set(name, src);
  }
  return src;
}

/** An icon `size` points square in `tint` (a color, as `token()` gives it). */
export function Icon(props: { name: IconName; size?: number; tint: string; opacity?: number }): JSX.Element {
  return (
    <Image
      src={iconSource(props.name)}
      accessible={false}
      style={{
        pointerEvents: "none",
        width: props.size ?? 16,
        height: props.size ?? 16,
        tintColor: props.tint,
        opacity: props.opacity ?? 1,
      }}
    />
  );
}
