// The tray's icon writes itself again when clicked: the stroke of app/ui/tray.svg drawn from its start to its end, as
// a pen would, then the dot. Each frame is the same SVG with the stroke dashed up to where the pen is, so it stays a
// template the menu bar paints in its text color.
import { reduceMotion, signal, untracked } from "nsh";
import trayIcon from "./ui/tray.svg";

/** The stroke's length in the SVG's units (432.4), a little over so the dash leaves no gap. */
const LENGTH = 433;
/** The dot's radius at rest. */
const DOT = 19;
/** How long the pen writes the stroke, then how long the dot takes to land, in ms. */
const WRITE_MS = 420;
const DOT_MS = 160;
/** About a frame of the menu bar. */
const TICK_MS = 16;

/** The tray's icon: tray.svg at rest, a frame of the writing while it plays. */
export const trayInk = signal<typeof trayIcon | string>(trayIcon);

/** tray.svg with `drawn` (0 to 1) of the stroke written and the dot at `dot` (0 to over 1) of its radius. */
export function inkFrame(drawn: number, dot: number): string {
  const offset = (LENGTH * (1 - drawn)).toFixed(1);
  const circle = dot > 0 ? `<circle cx="214" cy="188" r="${(DOT * dot).toFixed(1)}" fill="#000"/>` : "";
  // The markup of app/ui/tray.svg: keep the two the same.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256">` +
    `<g transform="translate(-6 0) scale(1.08) translate(-4 -6)">` +
    `<g transform="translate(-16 -1) translate(0 186) skewX(-10) translate(0 -186)">` +
    `<path d="M56 188C98 188 162 150 162 100C162 66 140 50 119 50C94 50 78 70 78 98C78 150 122 188 164 188" ` +
    `fill="none" stroke="#000" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" ` +
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

let timer: ReturnType<typeof setTimeout> | undefined;

/** Writes the tray's icon once (again from the start when it is writing); nothing when the user asked for less motion. */
export function writeTrayIcon() {
  if (untracked(reduceMotion)) return;
  if (timer !== undefined) clearTimeout(timer);
  const start = Date.now();
  const step = () => {
    const elapsed = Date.now() - start;
    if (elapsed >= WRITE_MS + DOT_MS) {
      timer = undefined;
      trayInk.set(trayIcon);
      return;
    }
    const drawn = easeInOut(Math.min(elapsed / WRITE_MS, 1));
    const dot = elapsed > WRITE_MS ? easeOutBack((elapsed - WRITE_MS) / DOT_MS) : 0;
    trayInk.set(inkFrame(drawn, dot));
    timer = setTimeout(step, TICK_MS);
  };
  step();
}
