// To-do lines in a note's Markdown, for the editor: where the box, the
// reminder (` ⏰ 2026-11-14 09:00`), the repeat (` 🔁 every month`) and the
// done stamp (` ✅ 2026-11-14`) are, and a line ticked or unticked. The file format is the store's
// (docs/todos.md "To-dos"); the store parses the same lines for `todos()`.
import { absolute, isoDay } from "./time";

const TASK = /^(\s*)[-*] \[( |x|X)\] /;
const DUE = / ?⏰ (\d{4}-\d\d-\d\d \d\d:\d\d)/;
/** ` 🔁 every month`: one of the five rules the store reads (`store/src/repeat.rs`), the word ending there. */
const REPEAT = / ?🔁 every (day|weekday|week|month|year)(?=\s|$)/i;
const DONE = / ?✅ \d{4}-\d\d-\d\d\s*$/;

/** A column range of one line, UTF-16 units. */
export interface Span {
  start: number;
  end: number;
}

/** A task line's parts. */
export interface TaskLine {
  /** `[ ]` or `[x]`, brackets included. */
  box: Span;
  done: boolean;
  /** The text after the box, up to the line's end. */
  rest: Span;
  /** ` ⏰ …`'s date and time, when it has one. */
  due: (Span & { at: string }) | null;
  /** ` 🔁 every …`, from 🔁, and its rule, when it has one. */
  repeat: (Span & { rule: Repeat }) | null;
  /** ` ✅ …`, when it has one. */
  stamp: Span | null;
}

/** A rule: `🔁 every day`, `every weekday`, `every week`, `every month`, `every year`. */
export type Repeat = "day" | "weekday" | "week" | "month" | "year";

/** The parts of `text` (one line) when it is a task, else `null`. */
export function taskLine(text: string): TaskLine | null {
  const m = TASK.exec(text);
  if (!m) return null;
  const boxStart = m[1].length + 2;
  const done = m[2] !== " ";
  const due = DUE.exec(text);
  const repeat = REPEAT.exec(text);
  const stamp = DONE.exec(text);
  return {
    box: { start: boxStart, end: boxStart + 3 },
    done,
    rest: { start: m[0].length, end: text.length },
    due: due ? { start: due.index + (due[0].startsWith(" ") ? 1 : 0), end: due.index + due[0].length, at: due[1] } : null,
    repeat: repeat
      ? { start: repeat.index + (repeat[0].startsWith(" ") ? 1 : 0), end: repeat.index + repeat[0].length, rule: repeat[1].toLowerCase() as Repeat }
      : null,
    stamp: stamp ? { start: stamp.index + (stamp[0].startsWith(" ") ? 1 : 0), end: text.length } : null,
  };
}

/** The task's text alone: without the box, the reminder, the repeat and the stamp. */
export function taskText(text: string): string {
  return text.replace(TASK, "").replace(DUE, "").replace(REPEAT, "").replace(DONE, "").trim();
}

/** `text` without `span` (a reminder or a repeat, from its marker) and the space before it; one right after the box
 * leaves no space at the text's start, and none is left at the line's end. */
function cut(text: string, rest: number, span: Span): string {
  const start = span.start > rest && text[span.start - 1] === " " ? span.start - 1 : span.start;
  const head = text.slice(0, start);
  const tail = text.slice(span.end);
  const after = start === rest ? tail.replace(/^[ \t]+/, "") : tail;
  return after ? head + after : head.replace(/[ \t]+$/, "");
}

/** `text` (a task line) without its repeat: the store's `set_todo_repeat(None)` for the open note's editor. */
export function withoutRepeat(text: string): string {
  const task = taskLine(text);
  return task?.repeat ? cut(text, task.rest.start, task.repeat) : text;
}

/** `text` (a task line) ticked (`- [x] … ✅ today`) or unticked (`- [ ] …`). */
export function toggledLine(text: string, done: boolean, today: Date): string {
  const m = TASK.exec(text);
  if (!m) return text;
  const body = text.slice(m[0].length).replace(DONE, "");
  const box = `${m[1]}- [${done ? "x" : " "}] `;
  return done ? `${box}${body} ✅ ${isoDay(today)}` : `${box}${body}`;
}

/**
 * `text` (a task line) with its reminder at `due`, or without one (nor its repeat: a repeat repeats a time) for
 * `null`: the store's `set_todo_due` for the open note's editor. A time it has is replaced where it is written; a
 * new one goes at the end, before a repeat and a done stamp.
 */
export function withDue(text: string, due: Date | null): string {
  const task = taskLine(text);
  if (!task) return text;
  const written = due ? `⏰ ${absolute(due)}` : null;
  if (!written) {
    // The later part first, so the earlier one's place holds.
    const spans = [task.due, task.repeat].filter((s): s is NonNullable<typeof s> => s !== null).sort((a, b) => b.start - a.start);
    return spans.reduce((line, span) => cut(line, task.rest.start, span), text);
  }
  if (task.due) {
    // The reminder's span starts at ⏰; the space before it goes with it.
    const start = task.due.start > task.rest.start && text[task.due.start - 1] === " " ? task.due.start - 1 : task.due.start;
    return `${text.slice(0, start)}${start === task.rest.start ? "" : " "}${written}${text.slice(task.due.end)}`;
  }
  const marks = [task.repeat, task.stamp].filter((s): s is Span => s !== null).map((s) => s.start - (text[s.start - 1] === " " ? 1 : 0));
  const end = Math.min(text.length, ...marks);
  const head = text.slice(0, end).replace(/[ \t]+$/, "");
  const space = head.length < task.rest.start ? "" : " ";
  const tail = text.slice(end);
  // A repeat right after the box had no space before it.
  const gap = tail && !/^[ \t]/.test(tail) ? " " : "";
  return `${head.length < task.rest.start ? text.slice(0, task.rest.start) : head}${space}${written}${gap}${tail}`;
}

/**
 * A note's preview or search snippet as the list shows it: its words alone.
 * The store's preview is the body on one line (whitespace collapsed), so the
 * Markdown is found by what precedes it: a marker counts at the start, after
 * a space or after the snippet's leading `…`. Task boxes stay, as ○ and ✓;
 * list, quote and heading markers, code fences with their language, inline
 * code's backticks, emphasis, links' targets, reminders and done stamps go.
 */
export function plainSnippet(text: string): string {
  return (
    text
      // Lines (a body not yet on one line) are joined as the list shows them.
      .replace(/[ \t]*\n+[ \t]*/g, " · ")
      // A fence, and the language right after an opening one (```sh).
      .replace(/(`{3,}|~{3,})[\w+#.-]*/g, " ")
      .replace(/(^|[\s…])[-*+] \[ \](?=\s|$)/g, "$1○")
      .replace(/(^|[\s…])[-*+] \[[xX]\](?=\s|$)/g, "$1✓")
      // Reminders and stamps, also when the snippet's end cuts into one.
      .replace(/⏰ ?\d{0,4}(?:-\d{0,2}){0,2}(?: \d{0,2}(?::\d{0,2})?)?/g, " ")
      .replace(/✅ ?\d{0,4}(?:-\d{0,2}){0,2}/g, " ")
      .replace(/🔁 ?(?:every(?: (?:day|weekday|week|month|year))?)?/gi, " ")
      // List, quote and heading markers at a line's start, nested ones too (`> - `); the store's preview is one line
      // already, so a marker after any space. Not a sign between numbers: `2 * 3`, `5 - 3`, `1 + 1` stay.
      .replace(/(^|[\s…])(?:(?:#{1,6}|>+|[-*+])(?: +|$))+/g, (markers, lead: string, at: number, all: string) =>
        /^\s[-*+] +$/.test(markers) && /[\d)]/.test(all[at - 1] ?? "") && /[\d(]/.test(all[at + markers.length] ?? "") ? markers : lead,
      )
      .replace(/!?\[([^\]]*)\]\(([^)\s]*)\)/g, "$1")
      .replace(/`+/g, "")
      // Bold and struck words keep their words; a pair of marks around them goes, a lone one (`2 ** 10`) stays.
      .replace(/(\*\*|~~)(?=\S)(.*?\S)\1/g, "$2")
      // A single star or underscore around words (`*斜体*`, `_it_`), not a lone one (`2 * 3`, `snake_case`).
      .replace(/(^|[^\w*])([*_])(?=\S)([^*_\n]*?\S)\2(?![\w*])/g, "$1$3")
      // What the removals leave: runs of spaces, empty lines, a cut mark apart from its text.
      .replace(/\s+/g, " ")
      .replace(/·(?: ·)+/g, "·")
      .replace(/^[\s·]+|[\s·]+$/g, "")
      .replace(/ …$/, "…")
      .trim()
  );
}
