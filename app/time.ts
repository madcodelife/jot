// Times as Jot shows them: a note's age in the list ("10 分钟前", "昨天"),
// a to-do's due time as a chip, and the to-do view's groups. Due times are
// local wall-clock times, as the notes store them ("2026-11-14T09:00").
import type { Todo } from "jot/native";

const WEEKDAYS = "日一二三四五六";
const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

/** `HH:mm`. */
export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** `YYYY-MM-DD HH:mm`, as the file writes it after ⏰. */
export const absolute = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(d)}`;

/** Today's date as the file writes it after ✅. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A due time from the store (`"2026-11-14T09:00"`, or with a space), as a local date. */
export function parseDue(due: string | null | undefined): Date | null {
  if (!due) return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(due);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole days from `now`'s day to `d`'s. */
export const daysFrom = (d: Date, now: Date) => Math.round((startOfDay(d) - startOfDay(now)) / DAY);

/** A day said the way people say it: 今天, 明天, 后天, 昨天, 周五 within the week, else 11月20日. */
export function relativeDay(d: Date, now: Date): string {
  const n = daysFrom(d, now);
  if (n === 0) return "今天";
  if (n === 1) return "明天";
  if (n === 2) return "后天";
  if (n === -1) return "昨天";
  if (n > 0 && n < 7) return `周${WEEKDAYS[d.getDay()]}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** The weekday, `周五`. */
export const weekday = (d: Date) => `周${WEEKDAYS[d.getDay()]}`;

/** A note's age in the list: 刚刚, 10 分钟前, 今天 09:40, 昨天, 11月8日, 2025年3月2日. */
export function age(modified: number, now: number): string {
  const diff = now - modified;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const d = new Date(modified);
  const today = new Date(now);
  const n = daysFrom(d, today);
  if (n === 0) return `今天 ${hm(d)}`;
  if (n === -1) return "昨天";
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** The to-do view's groups, in order. */
export type TodoGroup = "late" | "today" | "tomorrow" | "later" | "none";

/** The groups' headers. */
export const GROUP_LABELS: Record<TodoGroup, string> = {
  late: "已过期",
  today: "今天",
  tomorrow: "明天",
  later: "以后",
  none: "没有时间",
};

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
