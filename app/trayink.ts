// The tray's icon writes itself again when clicked, with Jot's pen (app/ink.ts): the stroke of app/ui/tray.svg drawn
// from its start to its end, then the dot. Its frames are black, so the icon stays a template the menu bar paints in
// its text color.
import { reduceMotion, signal, untracked } from "nsh";
import { inkFrames, playInk } from "./ink";
import trayIcon from "./ui/tray.svg";

/** The pen's pace for the tray: 420 ms for the stroke, then 160 ms for the dot. */
const PEN = { writeMs: 420, dotMs: 160 };

/** The tray's icon: tray.svg at rest, a frame of the writing while it plays. */
export const trayInk = signal<typeof trayIcon | string>(trayIcon);

let stop: (() => void) | undefined;

/** Writes the tray's icon once (again from the start when it is writing); nothing when the user asked for less motion. */
export function writeTrayIcon() {
  if (untracked(reduceMotion)) return;
  stop?.();
  stop = playInk(inkFrames(PEN), (frame) => trayInk.set(frame), {
    onEnd: () => {
      stop = undefined;
      trayInk.set(trayIcon);
    },
  });
}
