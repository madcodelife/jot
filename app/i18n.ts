// The languages Jot speaks and the words that depend on them: which of its
// translations shows (`locales/`, read by `nsh/i18n`), counts said as each
// language says them, and the to-do view's keywords.
import { computed, localeSettings } from "nsh";
import { t } from "nsh/i18n";

/** A language Jot has translations in, as the settings name it (BCP 47). */
export type Language = "zh-Hans" | "en" | "zh-Hant" | "ja";

/** The languages, each named in itself (a menu of languages reads the same in every language). */
export const LANGUAGES: readonly { value: Language; name: string }[] = [
  { value: "zh-Hans", name: "简体中文" },
  { value: "en", name: "English" },
  { value: "zh-Hant", name: "繁體中文" },
  { value: "ja", name: "日本語" },
];

/**
 * Which of Jot's languages a tag reads as, the way `nsh/i18n` falls back
 * (the tag, then shorter ones): `zh-Hant…` is traditional, any other
 * `zh…` simplified (the `zh` file), `ja…`, `en…`; `null` for the rest.
 */
export function languageOf(tag: string): Language | null {
  const lower = tag.toLowerCase();
  if (lower === "zh-hant" || lower.startsWith("zh-hant-")) return "zh-Hant";
  if (lower === "zh" || lower.startsWith("zh-")) return "zh-Hans";
  if (lower === "ja" || lower.startsWith("ja-")) return "ja";
  if (lower === "en" || lower.startsWith("en-")) return "en";
  return null;
}

/**
 * The language Jot's text shows in: the first of the user's languages Jot
 * has (`setLocale` puts the one chosen in the settings first), else
 * English, as `t` picks it. Dates, times and the time phrases follow it.
 */
export const shownLanguage = computed<Language>(() => {
  for (const tag of localeSettings().languages) {
    const language = languageOf(tag);
    if (language) return language;
  }
  return "en";
});

/** `key`'s text for `count`: its `one` form for 1, `other` otherwise (English says "1 note", "2 notes"). */
export function tn(key: string, count: number, args: Record<string, unknown> = {}): string {
  return t(`${key}.${count === 1 ? "one" : "other"}`, { ...args, count });
}

/** The words that open the to-do view in the language shown (`待办`, `todo`, `やること`), and `/todo` in any. */
export const todoKeywords = computed(() => [
  ...t("todo.keywords")
    .split("|")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean),
  "/todo",
]);

/** The word the menu and the notifications type into the field for the to-do view. */
export const todoKeyword = () => todoKeywords()[0];
