// Jot's logo written with one pen stroke: the stroke of app/ui/tray.svg drawn from its start to its end, as a pen
// would, then the dot. Each frame is that SVG as a `data:` URL with the stroke dashed up to where the pen is. The tray's
// icon writes itself with it (app/trayink.ts), and so does the island's avatar for AI apps' writes (app/ui/Island.tsx).

/** The stroke's length in the SVG's units (432.4), a little over so the dash leaves no gap. */
const LENGTH = 433;
/** The dot's radius at rest. */
const DOT = 19;
/** About a display frame. */
const TICK_MS = 16;

/** How long the pen writes the stroke, then how long the dot takes to land, in ms. */
export interface Pen {
  writeMs: number;
  dotMs: number;
}

/**
 * tray.svg with `drawn` (0 to 1) of the stroke written and the dot at `dot` (0 to over 1) of its radius, in `color`,
 * `size` points square (the size it is decoded at).
 */
export function inkFrame(drawn: number, dot: number, color = "#000", size = 18): string {
  const offset = (LENGTH * (1 - drawn)).toFixed(1);
  const circle = dot > 0 ? `<circle cx="214" cy="188" r="${(DOT * dot).toFixed(1)}" fill="${color}"/>` : "";
  // The markup of app/ui/tray.svg: keep the two the same.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">` +
    `<g transform="translate(-6 0) scale(1.08) translate(-4 -6)">` +
    `<g transform="translate(-16 -1) translate(0 186) skewX(-10) translate(0 -186)">` +
    `<path d="M56 188C98 188 162 150 162 100C162 66 140 50 119 50C94 50 78 70 78 98C78 150 122 188 164 188" ` +
    `fill="none" stroke="${color}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" ` +
    `stroke-dasharray="${LENGTH} ${LENGTH}" stroke-dashoffset="${offset}"/>` +
    circle +
    `</g></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A pen's pace: slow to start, quick through the loop, slowing into the end. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** The dot lands a touch too big and settles. */
function easeOutBack(t: number): number {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

const made = new Map<string, readonly string[]>();

/**
 * The frames of the writing, one per display frame (`TICK_MS`), the last the whole logo: made once for each color,
 * size and pace, and kept, so a writing played again builds nothing.
 */
export function inkFrames(pen: Pen, color = "#000", size = 18): readonly string[] {
  const key = `${pen.writeMs} ${pen.dotMs} ${color} ${size}`;
  const kept = made.get(key);
  if (kept) return kept;
  const count = Math.ceil((pen.writeMs + pen.dotMs) / TICK_MS);
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const elapsed = i * TICK_MS;
    const drawn = easeInOut(Math.min(elapsed / pen.writeMs, 1));
    const dot = elapsed > pen.writeMs ? easeOutBack((elapsed - pen.writeMs) / pen.dotMs) : 0;
    frames.push(inkFrame(drawn, dot, color, size));
  }
  frames.push(inkFrame(1, 1, color, size));
  made.set(key, frames);
  return frames;
}

/**
 * Plays `frames`: `show` gets the first at once, then each as its time comes, `delay` ms from now, at most one a
 * display frame (a late timer skips to the frame of the time); `onEnd` once the last is shown. Gives a function that
 * stops it where it is.
 */
export function playInk(frames: readonly string[], show: (frame: string) => void, options: { delay?: number; onEnd?: () => void } = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start = 0;
  let at = 0;
  const last = frames.length - 1;
  const step = () => {
    const i = Math.min(Math.floor((Date.now() - start) / TICK_MS), last);
    if (i !== at) {
      at = i;
      show(frames[i]);
    }
    if (i < last) timer = setTimeout(step, TICK_MS);
    else {
      timer = undefined;
      options.onEnd?.();
    }
  };
  show(frames[0]);
  timer = setTimeout(
    () => {
      start = Date.now();
      step();
    },
    options.delay ?? 0,
  );
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}
