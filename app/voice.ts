// Dictation: one speech session at a time (NSH's `Speech`), and where its
// words go: the search field, the open note at its caret, or a quick note
// filed from the island. A place that takes the words is a `VoiceSink`; this
// module starts and ends the session and tells the sink what was heard.
//
// On "auto" a session listens for the language of the input source the user
// types with (`InputSource`, read when it starts: they may have just
// switched), so it begins one hop after the press. While it listens, the
// language tag (or ⌘L) switches to the next language: the session restarts
// in it and the words heard so far stay.
//
// Holding ⌥ dictates while the panel has the focus: the key down starts a
// short timer, and a key up or any other key before it fires is no hold (a
// double press summons, ⌥ with a letter types). The double press held
// anywhere is the native side's (`Summon.onDoubleTapHold`, App.tsx).
import { batch, localeSettings, signal, Speech, untracked, type KeyEvent, type SpeechErrorCode, type SpeechSession } from "nsh";
import { t } from "nsh/i18n";
import { InputSource } from "jot/native";
import { shownLanguage } from "./i18n";
import { holdToTalk, speechLanguage, type SpeechLanguageChoice } from "./settings";
import { chooseSpeechLang, nextSpeechLang } from "./speechlang";
import { joinSpoken } from "./spoken";

export { joinSpoken };
import { notice, query, setQuery } from "./store";

/** Where the words go. */
export type VoiceTarget = "field" | "editor" | "quick";

/** What a target does with a session: the transcript as it grows, then how it ended. */
export interface VoiceSink {
  /** The whole transcript so far (not final). */
  update(text: string): void;
  /** The session finished: its final transcript (maybe empty). */
  finish(text: string): void;
  /** The session failed: why, and what was heard before. */
  fail(error: SpeechErrorCode, text: string): void;
  /** The user cancelled (Escape): what was heard goes, what was there before comes back. */
  cancel(): void;
}

/** How long ⌥ is held before it dictates, in milliseconds. */
export const HOLD_MS = 350;

/** Whether this platform recognizes speech (macOS, iOS): without it, no microphone shows anywhere. */
export const speechAvailable = signal(false);
/** The target listening now, or null. */
export const listening = signal<VoiceTarget | null>(null);
/** The session runs because ⌥ is held (the hints say "release"), not because the microphone was pressed. */
export const listeningByHold = signal(false);
/** The last session was refused the microphone or speech recognition: the settings offer to grant them. */
export const speechDenied = signal(false);

/** Asks once at start whether speech can be recognized here. */
export async function detectSpeech() {
  try {
    speechAvailable.set(await Speech.available());
  } catch {
    speechAvailable.set(false);
  }
}

/** The language the running session listens for (null while none runs, or while it reads the input source). */
export const listeningLang = signal<string | null>(null);

/** The language switched to while listening, kept for this run while the settings' choice stays what it was then. */
let switched: { lang: string; under: SpeechLanguageChoice } | null = null;

/** The language switched to, while the settings still say what they said then. */
function switchedLang(): string | null {
  return switched && switched.under === untracked(speechLanguage) ? switched.lang : null;
}

/** The language a session starting now listens for, given the input source's (`input`). */
export function speechLang(input: string | null): string {
  return chooseSpeechLang({
    choice: untracked(speechLanguage),
    switched: switchedLang(),
    input,
    languages: untracked(localeSettings).languages,
    shown: untracked(shownLanguage),
  });
}

/** The input source's language, or null when it cannot be read. */
async function inputLanguage(): Promise<string | null> {
  try {
    return await InputSource.language();
  } catch {
    return null;
  }
}

/** What the user is told when a session fails. */
export const voiceError = (error: SpeechErrorCode) => t(`voice.error.${error}`);

/** The settings page where the microphone and speech recognition are granted. */
export const PRIVACY_URL = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  speech: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
} as const;

/** A dictation from its press to its end: where the words go, and the recognizer's session. */
interface Run {
  target: VoiceTarget;
  sink: VoiceSink;
  /** The session listening now; null while the input source is read, and once it is let go (cancelled, switched away from). */
  session: SpeechSession | null;
  /** The words of the sessions it switched away from. */
  kept: string;
  /** The words of the session listening now. */
  heard: string;
}

let run: Run | null = null;

/**
 * Starts dictating into `target`: false when speech is unavailable or a
 * session already runs (the sink hears nothing then); otherwise the sink
 * hears how it goes, a failure to start included.
 */
export function startVoice(target: VoiceTarget, into: VoiceSink, options: { byHold?: boolean } = {}): boolean {
  if (!untracked(speechAvailable) || run) return false;
  const r: Run = { target, sink: into, session: null, kept: "", heard: "" };
  run = r;
  batch(() => {
    listening.set(target);
    listeningByHold.set(options.byHold ?? false);
  });
  // Only "auto" asks the input source; a language chosen or switched to starts at once.
  if (untracked(speechLanguage) !== "auto" || switchedLang()) begin(r, speechLang(null));
  else
    void inputLanguage().then((input) => {
      if (run === r) begin(r, speechLang(input));
    });
  return true;
}

/** Starts `r`'s recognizer session in `lang`. */
function begin(r: Run, lang: string) {
  let started: SpeechSession;
  try {
    started = Speech.start({ lang, interim: true });
  } catch {
    // Refused before it ran (the capability, a language tag it cannot take).
    settle(r);
    r.sink.fail("not-allowed", r.kept);
    return;
  }
  r.session = started;
  listeningLang.set(lang);
  started.on("start", () => speechDenied.set(false));
  started.on("result", ({ text }) => {
    if (r.session !== started) return;
    r.heard = clean(text);
    r.sink.update(joinSpoken(r.kept, r.heard));
  });
  started.on("end", ({ text, error }) => {
    // Cancelled (its sink already put things back) or switched away from.
    if (r.session !== started) return;
    settle(r);
    const said = clean(text);
    const all = joinSpoken(r.kept, said);
    if (error === "not-allowed") speechDenied.set(true);
    // Stopping before a word was said is "no-speech": nothing new to file, nothing to say.
    if (error && !(error === "no-speech" && !said)) r.sink.fail(error, all);
    else r.sink.finish(all);
  });
}

/** `r` is over: nothing listens any more. */
function settle(r: Run) {
  if (run === r) run = null;
  batch(() => {
    listening.set(null);
    listeningByHold.set(false);
    listeningLang.set(null);
  });
}

/** Stops listening: the recognizer finishes what it heard, and the sink gets the final transcript. */
export function stopVoice() {
  const r = run;
  if (!r) return;
  if (r.session) {
    r.session.stop();
    return;
  }
  // Stopped while the input source was read: nothing was heard.
  settle(r);
  r.sink.finish(r.kept);
}

/** Escape while listening: the session ends at once and its words go. Returns whether one was running. */
export function cancelVoice(target?: VoiceTarget): boolean {
  const r = run;
  if (!r || (target && r.target !== target)) return false;
  const ending = r.session;
  r.session = null;
  settle(r);
  ending?.abort();
  r.sink.cancel();
  return true;
}

/**
 * Listens for the next language (中 → EN → 日 → 繁) from now on: the
 * session restarts in it, and the words heard so far stay. Remembered for
 * this run (the settings keep their choice). False when no session listens.
 */
export function switchVoiceLanguage(): boolean {
  const r = run;
  const ending = r?.session;
  const lang = untracked(listeningLang);
  if (!r || !ending || !lang) return false;
  const next = nextSpeechLang(lang);
  switched = { lang: next, under: untracked(speechLanguage) };
  r.kept = joinSpoken(r.kept, r.heard);
  r.heard = "";
  r.session = null;
  ending.abort();
  begin(r, next);
  return true;
}

/** The microphone button: starts, or stops the session running. */
export function toggleVoice(target: VoiceTarget, into: () => VoiceSink) {
  if (run) stopVoice();
  else startVoice(target, into());
}

/** A transcript on one line: the editor and the field take it as typed text. */
const clean = (text: string) => text.replace(/\s*\n\s*/g, " ");

// ——— Holding ⌥ ———

let holdTimer: ReturnType<typeof setTimeout> | undefined;
let heldSession = false;

/** A key went down in the panel: ⌥ alone starts the hold's timer; anything else means it is no hold. */
export function holdKeyDown(event: KeyEvent, begin: () => boolean) {
  if (event.key !== "Alt") {
    clearTimeout(holdTimer);
    holdTimer = undefined;
    return;
  }
  if (event.repeat || holdTimer !== undefined || heldSession) return;
  if (!untracked(holdToTalk) || !untracked(speechAvailable) || run) return;
  holdTimer = setTimeout(() => {
    holdTimer = undefined;
    heldSession = begin();
  }, HOLD_MS);
}

/** A key came up: ⌥ let go before the timer is no hold; after it, the session stops. */
export function holdKeyUp(event: KeyEvent) {
  if (event.key !== "Alt") return;
  if (holdTimer !== undefined) {
    clearTimeout(holdTimer);
    holdTimer = undefined;
    return;
  }
  if (heldSession) {
    heldSession = false;
    stopVoice();
  }
}

/** The panel lost the focus: a held key's release will not come. */
export function forgetHold() {
  clearTimeout(holdTimer);
  holdTimer = undefined;
  heldSession = false;
}

// ——— The search field ———

/** The search field as a target: the words appear after what was typed, and search as they come; Escape puts the field back. */
export function fieldSink(): VoiceSink {
  const before = untracked(query);
  return {
    update: (text) => setQuery(joinSpoken(before, text)),
    finish: (text) => setQuery(joinSpoken(before, text)),
    fail: (error, text) => {
      setQuery(joinSpoken(before, text));
      notice.set(voiceError(error));
    },
    cancel: () => setQuery(before),
  };
}
