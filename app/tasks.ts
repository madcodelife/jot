// To-do lines in a note's Markdown, for the editor: where the box, the
// reminder (` ⏰ 2026-11-14 09:00`) and the done stamp (` ✅ 2026-11-14`)
// are, and a line ticked or unticked. The file format is the store's
// (docs/todos.md "To-dos"); the store parses the same lines for `todos()`.
import { absolute, isoDay } from "./time";

const TASK = /^(\s*)[-*] \[( |x|X)\] /;
const DUE = / ?⏰ (\d{4}-\d\d-\d\d \d\d:\d\d)/;
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
  /** ` ✅ …`, when it has one. */
  stamp: Span | null;
}

/** The parts of `text` (one line) when it is a task, else `null`. */
export function taskLine(text: string): TaskLine | null {
  const m = TASK.exec(text);
  if (!m) return null;
  const boxStart = m[1].length + 2;
  const done = m[2] !== " ";
  const due = DUE.exec(text);
  const stamp = DONE.exec(text);
  return {
    box: { start: boxStart, end: boxStart + 3 },
    done,
    rest: { start: m[0].length, end: text.length },
    due: due ? { start: due.index + (due[0].startsWith(" ") ? 1 : 0), end: due.index + due[0].length, at: due[1] } : null,
    stamp: stamp ? { start: stamp.index + (stamp[0].startsWith(" ") ? 1 : 0), end: text.length } : null,
  };
}

/** The task's text alone: without the box, the reminder and the stamp. */
export function taskText(text: string): string {
  return text.replace(TASK, "").replace(DUE, "").replace(DONE, "").trim();
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
 * `text` (a task line) with its reminder at `due`, or without one for `null`: the store's
 * `set_todo_due` for the open note's editor. A time it has is replaced where it is written; a new one
 * goes at the end, before a done stamp.
 */
export function withDue(text: string, due: Date | null): string {
  const task = taskLine(text);
  if (!task) return text;
  const written = due ? `⏰ ${absolute(due)}` : null;
  if (task.due) {
    // The reminder's span starts at ⏰; the space before it goes with it.
    const start = task.due.start > task.rest.start && text[task.due.start - 1] === " " ? task.due.start - 1 : task.due.start;
    const head = text.slice(0, start);
    const tail = text.slice(task.due.end);
    if (written) return `${head}${start === task.rest.start ? "" : " "}${written}${tail}`;
    // A time right after the box leaves no space at the text's start; one at the end, none after the text.
    const rest = start === task.rest.start ? tail.replace(/^[ \t]+/, "") : tail;
    return rest ? head + rest : head.replace(/[ \t]+$/, "");
  }
  if (!written) return text;
  const end = task.stamp ? task.stamp.start - (text[task.stamp.start - 1] === " " ? 1 : 0) : text.length;
  const head = text.slice(0, end).replace(/[ \t]+$/, "");
  const space = head.length < task.rest.start ? "" : " ";
  return `${head.length < task.rest.start ? text.slice(0, task.rest.start) : head}${space}${written}${text.slice(end)}`;
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
