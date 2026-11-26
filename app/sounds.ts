// Jot's own sound effects, which the app plays itself (NSH's `Sound`): a soft
// pluck as the user ticks a to-do (`assets/done.wav`, made by
// design/sound/build.py), wherever they tick it: the to-do view, the island's
// reminder, a box in the open note. Not for a to-do an AI app or a
// notification's "Done" completes, and never on unticking. The settings' "Sound
// Effects" turns them off, and so does macOS's "Play user interface sound
// effects". The reminders' chime is their notifications' (App.tsx, `remind`).
import { Sound, untracked } from "nsh";
import { SoundEffects } from "jot/native";
import { soundEffectsOn } from "./settings";
import doneSrc from "../assets/done.wav";

/** Loaded ahead (`loadSounds`), so it plays the moment the check is drawn; null until then, or where nothing plays. */
let done: Sound | null = null;

/** Decodes the sounds into memory, once, as the app starts. Where nothing plays sound, nothing does. */
export function loadSounds() {
  if (done) return;
  Sound.load(doneSrc).then(
    (sound) => {
      done = sound;
    },
    () => {
      // No speaker here, or no sound to read: the ticks stay silent.
    },
  );
}

/** A to-do was just ticked by the user: its sound, as the check is drawn, unless the user or the system turned sound effects off. */
export function playDone() {
  if (!done || !untracked(soundEffectsOn) || !SoundEffects.systemAllows()) return;
  done.play();
}
