// Jot's own sound effects, which the app plays itself (NSH's `Sound`), for what
// AI apps do, as the island says it (app/ui/Island.tsx), never for the user's
// own actions: a bright glass tap as an AI app's new note opens the island
// (`assets/new.wav`), a soft one as the check pops in for a to-do an AI app
// completed (`assets/done.wav`); both made by design/sound/build.py. The
// settings' "Sound Effects" turns them off, and so does macOS's "Play user
// interface sound effects". The reminders' chime is their notifications'
// (App.tsx, `remind`).
import { Sound, untracked } from "nsh";
import { SoundEffects } from "jot/native";
import { soundEffectsOn } from "./settings";
import doneSrc from "../assets/done.wav";
import newSrc from "../assets/new.wav";

/** Loaded ahead (`loadSounds`), so each plays the moment the island shows it; null until then, or where nothing plays. */
let created: Sound | null = null;
let done: Sound | null = null;

/** Decodes the sounds into memory, once, as the app starts. Where nothing plays sound, nothing does. */
export function loadSounds() {
  if (created && done) return;
  load(newSrc, (sound) => (created = sound));
  load(doneSrc, (sound) => (done = sound));
}

function load(src: string, loaded: (sound: Sound) => void) {
  Sound.load(src).then(loaded, () => {
    // No speaker here, or no sound to read: the island stays silent.
  });
}

function play(sound: Sound | null) {
  if (!sound || !untracked(soundEffectsOn) || !SoundEffects.systemAllows()) return;
  sound.play();
}

/** An AI app's new note: its sound, as the island opens on it, unless the user or the system turned sound effects off. */
export function playNew() {
  play(created);
}

/** A to-do an AI app completed: its sound, as the island's check pops in, unless the user or the system turned sound effects off. */
export function playDone() {
  play(done);
}
