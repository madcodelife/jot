// Times as Jot shows them: a note's age in the list ("10 分钟前", "Yesterday"),
// a to-do's due time as a chip, and the to-do view's groups. Due times are
// local wall-clock times, as the notes store them ("2026-11-14T09:00"); what
// the files hold (`absolute`, `isoDay`) never depends on the language.
//
// Words come from the translations, weekdays, months and clock times from
// `Intl` in the language shown, on the user's 12- or 24-hour clock.
import { localeSettings } from "nsh";
import { t } from "nsh/i18n";
import type { Todo } from "jot/native";
import { shownLanguage, tn, type Language } from "./i18n";

const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

/** `HH:mm`, as files write it. */
const hm24 = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** `YYYY-MM-DD HH:mm`, as the file writes it after ⏰. */
export const absolute = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm24(d)}`;

/** Today's date as the file writes it after ✅. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const formats = new Map<string, Intl.DateTimeFormat>();

/** A formatter per language and options, made once: `Intl` objects are costly to make, cheap to reuse. */
function format(language: Language, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${language}|${JSON.stringify(options)}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(language, options);
    formats.set(key, f);
  }
  return f;
}

/** The time of day as the user reads it: `09:00` in Chinese, `9:00` in Japanese, `9:00 AM` in English on a 12-hour clock. */
export function hm(d: Date): string {
  const language = shownLanguage();
  const hourCycle = localeSettings().hourCycle;
  const twelve = hourCycle === "h12" || hourCycle === "h11";
  const twoDigits = !twelve && (language === "zh-Hans" || language === "zh-Hant");
  return format(language, { hour: twoDigits ? "2-digit" : "numeric", minute: "2-digit", hourCycle: twelve ? "h12" : "h23" }).format(d);
}

/** The weekday: `周五`, `週五`, `Fri`, `金曜日`. */
export const weekday = (d: Date) => format(shownLanguage(), { weekday: shownLanguage() === "ja" ? "long" : "short" }).format(d);

/** The month and day: `11月20日`, `Nov 20`. */
const monthDay = (d: Date) => format(shownLanguage(), { month: "short", day: "numeric" }).format(d);

/** The date with its year: `2025年3月2日`, `Mar 2, 2025`. */
const fullDate = (d: Date) => format(shownLanguage(), { year: "numeric", month: "short", day: "numeric" }).format(d);

/** A due time from the store (`"2026-11-14T09:00"`, or with a space), as a local date. */
export function parseDue(due: string | null | undefined): Date | null {
  if (!due) return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(due);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/** `d` as the store takes a due time: `"2026-11-14T09:00"`, local. */
export function dueValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A quick choice: Things', Reminders' and Raycast's first rows. */
export interface QuickChoice {
  id: "hour" | "tonight" | "tomorrow" | "monday";
  at: Date;
}

/**
 * The reminder time picker's quick choices: in an hour (to the minute), this evening at 20:00, tomorrow morning
 * and next Monday morning (at `morning`, the settings' time for a date alone, 9:00 unless changed), those still
 * to come; one at the same time as one before it (next Monday is tomorrow on a Sunday) is left out.
 */
export function quickChoices(now: Date, morning = "09:00"): QuickChoice[] {
  const [h, m] = morning.split(":").map(Number);
  const day = (days: number, hour: number, minute = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, minute);
  const hour = new Date(now.getTime() + 3_600_000);
  hour.setSeconds(0, 0);
  // Monday after today: 1 day on a Sunday, 7 on a Monday.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  const all: QuickChoice[] = [
    { id: "hour", at: hour },
    { id: "tonight", at: day(0, 20) },
    { id: "tomorrow", at: day(1, h, m) },
    { id: "monday", at: day(toMonday, h, m) },
  ];
  const seen = new Set<number>();
  return all.filter((c) => {
    const time = c.at.getTime();
    if (time <= now.getTime() || seen.has(time)) return false;
    seen.add(time);
    return true;
  });
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole days from `now`'s day to `d`'s. */
export const daysFrom = (d: Date, now: Date) => Math.round((startOfDay(d) - startOfDay(now)) / DAY);

/** A day said the way people say it: today, tomorrow, the day after, yesterday, the weekday within the week, else the month and day. */
export function relativeDay(d: Date, now: Date): string {
  const n = daysFrom(d, now);
  if (n === 0) return t("time.today");
  if (n === 1) return t("time.tomorrow");
  if (n === 2) return t("time.day_after");
  if (n === -1) return t("time.yesterday");
  if (n > 0 && n < 7) return weekday(d);
  return monthDay(d);
}

/** A note's age in the list: just now, 10 minutes ago, today at 09:40, yesterday, the month and day, the date with its year. */
export function age(modified: number, now: number): string {
  const diff = now - modified;
  if (diff < 60_000) return t("time.just_now");
  if (diff < 3_600_000) return tn("time.minutes_ago", Math.floor(diff / 60_000));
  const d = new Date(modified);
  const today = new Date(now);
  const n = daysFrom(d, today);
  if (n === 0) return t("time.today_at", { time: hm(d) });
  if (n === -1) return t("time.yesterday");
  if (d.getFullYear() === today.getFullYear()) return monthDay(d);
  return fullDate(d);
}

/** The to-do view's groups, in order. */
export type TodoGroup = "late" | "today" | "tomorrow" | "later" | "none";

/** A group's header. */
export const groupLabel = (group: TodoGroup) => t(`todo.group.${group}`);

/** Which group an open to-do goes in. */
export function groupOf(due: Date | null, now: Date): TodoGroup {
  if (!due) return "none";
  if (due.getTime() < now.getTime()) return "late";
  const n = daysFrom(due, now);
  return n === 0 ? "today" : n === 1 ? "tomorrow" : "later";
}

/** A due chip's text: the time alone where the group's header says the day. */
export function dueLabel(due: Date, group: TodoGroup | null, now: Date): string {
  return group === "today" || group === "tomorrow" ? hm(due) : `${relativeDay(due, now)} ${hm(due)}`;
}

/** What the list's first row says about today's to-dos. */
export interface TodaySummary {
  /** To-dos due today, done or not. */
  total: number;
  /** Of those, not done yet. */
  left: number;
  /** Open to-dos already past due. */
  late: number;
  /** The next open one due today. */
  next: { text: string; due: Date } | null;
  /** One dot per to-do due today, done ones first. */
  dots: boolean[];
}

/** Today's to-dos at a glance. */
export function todaySummary(todos: readonly Todo[], now: Date): TodaySummary {
  const today = todos.filter((t) => {
    const due = parseDue(t.due);
    return due !== null && daysFrom(due, now) === 0;
  });
  const open = today.filter((t) => !t.done);
  const late = todos.filter((t) => {
    const due = parseDue(t.due);
    return !t.done && due !== null && due.getTime() < now.getTime();
  }).length;
  const next = open
    .map((t) => ({ text: t.text, due: parseDue(t.due)! }))
    .filter((t) => t.due.getTime() >= now.getTime())
    .sort((a, b) => a.due.getTime() - b.due.getTime())[0] ?? null;
  const dots = today.map((t) => t.done).sort((a, b) => Number(b) - Number(a));
  return { total: today.length, left: open.length, late, next, dots };
}
