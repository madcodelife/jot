// Jot's settings: each a signal, kept in NSH's Storage under its own key
// (`jot.*`), and applied the moment it changes: the language (`setLocale`),
// the appearance and the theme, the reminders' channels and their default
// time, and dictation's hold key and language. The notes folder is the store's (`jot.dir`, `app/store.ts`).
// Whether AI apps may move notes to the Trash and rewrite them lives in a file `jot-mcp` reads too (`AiAccess`).
import { batch, signal, Storage, untracked } from "nsh";
import { setLocale } from "nsh/i18n";
import { AiAccess } from "jot/native";
import { applyAppearance, applyTheme, RETIRED, themeFromStored, type Appearance, type ThemeName } from "./ui/themes";
import { LANGUAGES, shownLanguage, type Language } from "./i18n";

/** "system": the user's language; otherwise one of Jot's. */
export type LanguageChoice = "system" | Language;

/** The settings' storage keys. */
export const KEYS = {
  language: "jot.language",
  appearance: "jot.appearance",
  theme: "jot.theme",
  notifications: "jot.notifications",
  island: "jot.island",
  defaultTime: "jot.defaultTime",
  holdToTalk: "jot.voice.hold",
  speechLanguage: "jot.voice.language",
} as const;

/** The language Jot shows in. */
export const language = signal<LanguageChoice>("system");
/** Light, dark, or the system's. */
export const appearance = signal<Appearance>("system");
/** The palette. */
export const theme = signal<ThemeName>("default");
/** Due to-dos show a system notification. */
export const notificationsOn = signal(true);
/** Due to-dos and Claude's notes show at the notch (macOS). */
export const islandOn = signal(true);
/** Holding ⌥ dictates (in the panel and the note), and a double press held does anywhere (macOS). */
export const holdToTalk = signal(true);
/** The language dictation listens for: "auto" follows the input source (`app/speechlang.ts`), else one of `SPEECH_LANGUAGES`. */
export const speechLanguage = signal<SpeechLanguageChoice>("auto");

/** The languages dictation offers, as the recognizer names them, each in itself. */
export const SPEECH_LANGUAGES = [
  { value: "zh-CN", name: "简体中文（中国大陆）" },
  { value: "zh-TW", name: "繁體中文（台灣）" },
  { value: "en-US", name: "English (US)" },
  { value: "ja-JP", name: "日本語" },
] as const;
export type SpeechLanguageChoice = "auto" | (typeof SPEECH_LANGUAGES)[number]["value"];

/** AI apps may move notes to the Trash and rewrite whole notes (`trash_note`, `replace_note`). Off until the user turns it on. */
export const aiTrashAndRewrite = signal(false);

/** The time a reminder written with a date alone ("明天") is due, `HH:mm`. */
export const defaultTime = signal("09:00");

const isLanguage = (v: string | null): v is LanguageChoice => v === "system" || LANGUAGES.some((l) => l.value === v);
const isAppearance = (v: string | null): v is Appearance => v === "system" || v === "light" || v === "dark";
const isTime = (v: string | null): v is string => v !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isSpeechLanguage = (v: string | null): v is SpeechLanguageChoice => v === "auto" || SPEECH_LANGUAGES.some((l) => l.value === v);
const flag = (v: string | null, fallback: boolean) => (v === null ? fallback : v === "1");

/** Reads the stored settings and applies them, before the app shows anything. */
export async function loadSettings() {
  const [lang, look, palette, notify, island, time, hold, speech] = await Promise.all([
    Storage.getItem(KEYS.language),
    Storage.getItem(KEYS.appearance),
    Storage.getItem(KEYS.theme),
    Storage.getItem(KEYS.notifications),
    Storage.getItem(KEYS.island),
    Storage.getItem(KEYS.defaultTime),
    Storage.getItem(KEYS.holdToTalk),
    Storage.getItem(KEYS.speechLanguage),
  ]);
  batch(() => {
    if (isLanguage(lang)) language.set(lang);
    if (isAppearance(look)) appearance.set(look);
    theme.set(themeFromStored(palette));
    notificationsOn.set(flag(notify, true));
    islandOn.set(flag(island, true));
    if (isTime(time)) defaultTime.set(time);
    holdToTalk.set(flag(hold, true));
    if (isSpeechLanguage(speech)) speechLanguage.set(speech);
    aiTrashAndRewrite.set(AiAccess.allowsTrashAndRewrite());
  });
  applyLanguage(untracked(language));
  applyAppearance(untracked(appearance), { animate: false });
  applyTheme(untracked(theme), { animate: false });
  // A retired theme is stored as its successor from now on. A name Jot does not know (a later version's theme)
  // shows as the default but stays stored, so that version still finds it.
  if (palette !== null && Object.prototype.hasOwnProperty.call(RETIRED, palette)) void Storage.setItem(KEYS.theme, untracked(theme));
}

function applyLanguage(choice: LanguageChoice) {
  setLocale(choice === "system" ? null : choice);
}

/** Shows Jot in `choice` from now on (the menus and the open windows at once). */
export function setLanguage(choice: LanguageChoice) {
  language.set(choice);
  applyLanguage(choice);
  void Storage.setItem(KEYS.language, choice);
  // `jot-mcp` names a rewritten note's previous version in the language shown.
  if (untracked(aiTrashAndRewrite)) {
    try {
      AiAccess.set(true, untracked(shownLanguage));
    } catch {
      // Kept as it was: the name is in the language before, nothing more.
    }
  }
}

/** Lets AI apps move notes to the Trash and rewrite them, or stops them; `jot-mcp` follows at its next call. Throws when it cannot be saved (the switch stays as it was). */
export function setAiTrashAndRewrite(on: boolean) {
  AiAccess.set(on, untracked(shownLanguage));
  aiTrashAndRewrite.set(on);
}

export function setAppearance(value: Appearance) {
  appearance.set(value);
  applyAppearance(value);
  void Storage.setItem(KEYS.appearance, value);
}

export function setThemeName(value: ThemeName) {
  theme.set(value);
  applyTheme(value);
  void Storage.setItem(KEYS.theme, value);
}

export function setNotifications(on: boolean) {
  notificationsOn.set(on);
  void Storage.setItem(KEYS.notifications, on ? "1" : "0");
}

export function setIsland(on: boolean) {
  islandOn.set(on);
  void Storage.setItem(KEYS.island, on ? "1" : "0");
}

export function setDefaultTime(value: string) {
  if (!isTime(value)) return;
  defaultTime.set(value);
  void Storage.setItem(KEYS.defaultTime, value);
}

export function setHoldToTalk(on: boolean) {
  holdToTalk.set(on);
  void Storage.setItem(KEYS.holdToTalk, on ? "1" : "0");
}

export function setSpeechLanguage(value: SpeechLanguageChoice) {
  speechLanguage.set(value);
  void Storage.setItem(KEYS.speechLanguage, value);
}

/** What the time phrases are read with: the language shown (the words it knows, its labels) and the default time of a date alone. */
export const whenOptions = () => ({ locale: untracked(shownLanguage), defaultTime: untracked(defaultTime) });
