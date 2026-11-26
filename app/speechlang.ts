// Which language dictation listens for, and the languages a running session
// switches between. Pure, so tests call it alone; `app/voice.ts` feeds it
// the settings, the input source and the user's languages when a session
// starts.
import { languageOf, type Language } from "./i18n";
import type { SpeechLanguageChoice } from "./settings";

/** Each of Jot's languages as the recognizer usually names it. */
export const REGION: Record<Language, string> = { "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", en: "en-US", ja: "ja-JP" };

/** What decides the language a session listens for. */
export interface SpeechLangInputs {
  /** The settings' choice: "auto", or a recognizer language. */
  choice: SpeechLanguageChoice;
  /** The language switched to while listening (⌘L, the language tag), for this run; null when none was. */
  switched: string | null;
  /** The language of the keyboard input source selected now (`InputSource.language()`: `zh-Hans`, `ja`, `en`), or null. */
  input: string | null;
  /** The user's languages, most preferred first (`localeSettings().languages`: `en-CN`, `zh-Hans-CN`). */
  languages: readonly string[];
  /** The language Jot shows in. */
  shown: Language;
}

/**
 * The recognizer language for a session: the one switched to while
 * listening, else the one chosen in the settings; on "auto", the input
 * source's when it types Chinese or Japanese (the user types what they
 * speak), else the first of the user's languages that is Chinese, Japanese
 * or English and names a region (`en-GB`, `zh-Hant-HK` → `zh-HK`), else
 * Jot's language in its usual region.
 */
export function chooseSpeechLang(inputs: SpeechLangInputs): string {
  if (inputs.switched) return inputs.switched;
  if (inputs.choice !== "auto") return inputs.choice;
  const typed = inputs.input ? inputSpeechLang(inputs.input) : null;
  if (typed) return typed;
  for (const tag of inputs.languages) {
    if (!languageOf(tag)) continue;
    const parts = tag.split(/[-_]/);
    const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
    if (region) return `${parts[0].toLowerCase()}-${region.toUpperCase()}`;
  }
  return REGION[inputs.shown];
}

/**
 * The recognizer language an input source's language says, for Chinese and
 * Japanese only (an English layout says nothing: people type English with
 * it whatever they speak): `zh-Hans` → `zh-CN`, `zh-Hant` → `zh-TW`, `yue`
 * (Cantonese) → `zh-HK`, `ja` → `ja-JP`; a region the tag names stays
 * (`zh-Hant-HK` → `zh-HK`).
 */
export function inputSpeechLang(tag: string): string | null {
  const parts = tag.split(/[-_]/);
  const base = parts[0].toLowerCase();
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p))?.toUpperCase();
  const script = parts.slice(1).find((p) => /^[A-Za-z]{4}$/.test(p))?.toLowerCase();
  if (base === "yue") return "zh-HK";
  if (base === "ja") return "ja-JP";
  if (base !== "zh") return null;
  if (region) return `zh-${region}`;
  return script === "hant" ? "zh-TW" : "zh-CN";
}

/** The languages the language tag goes through, in order. */
export const SWITCH_ORDER = ["zh-CN", "en-US", "ja-JP", "zh-TW"] as const;

/** Which of the switch's languages a recognizer language counts as. */
function family(lang: string): (typeof SWITCH_ORDER)[number] {
  const lower = lang.toLowerCase();
  if (lower.startsWith("en")) return "en-US";
  if (lower.startsWith("ja")) return "ja-JP";
  if (lower.startsWith("yue") || /^zh-(tw|hk|mo|hant)/.test(lower)) return "zh-TW";
  return "zh-CN";
}

/** The language after `lang` in the switch's order (`zh-CN` → `en-US` → `ja-JP` → `zh-TW` → `zh-CN`). */
export function nextSpeechLang(lang: string): string {
  const at = SWITCH_ORDER.indexOf(family(lang));
  return SWITCH_ORDER[(at + 1) % SWITCH_ORDER.length];
}

/** The language tag's text: `中`, `EN`, `日`, `繁` (and `粵` for Cantonese). */
export function speechLangMark(lang: string): string {
  if (lang.toLowerCase() === "zh-hk" || lang.toLowerCase().startsWith("yue")) return "粵";
  return { "zh-CN": "中", "en-US": "EN", "ja-JP": "日", "zh-TW": "繁" }[family(lang)];
}

/** A recognizer language's name in itself, for the tag's accessibility label. */
export function speechLangName(lang: string): string {
  if (lang.toLowerCase() === "zh-hk" || lang.toLowerCase().startsWith("yue")) return "粵語";
  return { "zh-CN": "简体中文", "en-US": "English", "ja-JP": "日本語", "zh-TW": "繁體中文" }[family(lang)];
}
