// Dictation: one speech session at a time (NSH's `Speech`), and where its
// words go: the search field, the open note at its caret, or a quick note
// filed from the island. A place that takes the words is a `VoiceSink`; this
// module starts and ends the session and tells the sink what was heard.
//
// Holding ⌥ dictates while the panel has the focus: the key down starts a
// short timer, and a key up or any other key before it fires is no hold (a
// double press summons, ⌥ with a letter types). The double press held
// anywhere is the native side's (`Summon.onDoubleTapHold`, App.tsx).
import { batch, localeSettings, signal, Speech, untracked, type KeyEvent, type SpeechErrorCode, type SpeechSession } from "nsh";
import { t } from "nsh/i18n";
import { languageOf, shownLanguage, type Language } from "./i18n";
import { holdToTalk, speechLanguage } from "./settings";
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

const REGION: Record<Language, string> = { "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", en: "en-US", ja: "ja-JP" };

/**
 * The language the recognizer listens for: the one chosen in the settings,
 * else Jot's language in the user's own region when one of their languages
 * names it (`en-GB`, `zh-Hant-HK` → `zh-HK`), else its usual one.
 */
export function speechLang(): string {
  const choice = untracked(speechLanguage);
  if (choice !== "auto") return choice;
  const shown = untracked(shownLanguage);
  for (const tag of untracked(localeSettings).languages) {
    if (languageOf(tag) !== shown) continue;
    const parts = tag.split(/[-_]/);
    const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
    if (region) return `${parts[0].toLowerCase()}-${region.toUpperCase()}`;
  }
  return REGION[shown];
}

/** What the user is told when a session fails. */
export const voiceError = (error: SpeechErrorCode) => t(`voice.error.${error}`);

/** The settings page where the microphone and speech recognition are granted. */
export const PRIVACY_URL = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  speech: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
} as const;

let session: SpeechSession | null = null;
let sink: VoiceSink | null = null;

/** Starts dictating into `target`; false when speech is unavailable or a session already runs. */
export function startVoice(target: VoiceTarget, into: VoiceSink, options: { byHold?: boolean } = {}): boolean {
  if (!untracked(speechAvailable) || session) return false;
  let started: SpeechSession;
  try {
    started = Speech.start({ lang: speechLang(), interim: true });
  } catch {
    // Refused before it ran (the capability, a language tag it cannot take).
    into.fail("not-allowed", "");
    return false;
  }
  session = started;
  sink = into;
  batch(() => {
    listening.set(target);
    listeningByHold.set(options.byHold ?? false);
  });
  started.on("start", () => speechDenied.set(false));
  started.on("result", ({ text }) => {
    if (session === started) into.update(clean(text));
  });
  started.on("end", ({ text, error }) => {
    // Cancelled: its sink already put things back.
    if (session !== started) return;
    session = null;
    sink = null;
    batch(() => {
      listening.set(null);
      listeningByHold.set(false);
    });
    if (error === "not-allowed") speechDenied.set(true);
    // Stopping before a word was said is "no-speech": nothing to file, nothing to say.
    if (error && !(error === "no-speech" && !clean(text))) into.fail(error, clean(text));
    else into.finish(clean(text));
  });
  return true;
}

/** Stops listening: the recognizer finishes what it heard, and the sink gets the final transcript. */
export function stopVoice() {
  session?.stop();
}

/** Escape while listening: the session ends at once and its words go. Returns whether one was running. */
export function cancelVoice(target?: VoiceTarget): boolean {
  if (!session || (target && untracked(listening) !== target)) return false;
  const ending = session;
  const was = sink;
  session = null;
  sink = null;
  batch(() => {
    listening.set(null);
    listeningByHold.set(false);
  });
  ending.abort();
  was?.cancel();
  return true;
}

/** The microphone button: starts, or stops the session running. */
export function toggleVoice(target: VoiceTarget, into: () => VoiceSink) {
  if (session) stopVoice();
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
  if (!untracked(holdToTalk) || !untracked(speechAvailable) || session) return;
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
