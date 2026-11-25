// What the open note's editor styles of a line's Markdown beyond the built-in
// highlighting: where the syntax is (heading and list markers, a quote's `>`,
// a rule, fences, emphasis and code marks, a link's brackets and target),
// drawn muted so the words lead, as Bear draws them; a heading's words; a
// link's words; inline code. Fenced code is left to the built-in highlighter:
// a `# comment` in a shell snippet is no heading.
import { taskLine, type Span } from "./tasks";

/** What a part of a line is. */
export type MarkKind = "syntax" | "heading" | "link" | "code";

/** A part of one line, UTF-16 columns. */
export interface Mark extends Span {
  kind: MarkKind;
}

/** A fence's opening or closing line: three or more backticks or tildes, indented up to three spaces. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** `line` opens or closes a fenced code block. */
export const isFence = (line: string) => FENCE.test(line);

/** For each line, whether it is in a fenced code block, its fences included (an unclosed fence runs to the end). */
export function fencedLines(lines: readonly string[]): boolean[] {
  let open: string | null = null;
  return lines.map((line) => {
    const fence = FENCE.exec(line)?.[1] ?? null;
    if (open === null) {
      if (fence) open = fence;
      return fence !== null;
    }
    // A closing fence: the same character, at least as long, nothing after it.
    if (fence && fence[0] === open[0] && fence.length >= open.length && line.trim() === fence) open = null;
    return true;
  });
}

const HEADING = /^( {0,3})(#{1,6})([ \t]+|$)/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** Quote markers (`>`, `> >`), then a list marker (`-`, `*`, `+`, `1.`, `1)`) and its space. */
const QUOTE = /^( {0,3}>[ \t]?)+/;
const BULLET = /^([ \t]*)([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;

/** The Markdown marks of `line`, a line outside fenced code, by column; none overlap. */
export function lineMarks(line: string): Mark[] {
  if (FENCE.test(line)) return [{ start: 0, end: line.length, kind: "syntax" }];
  if (RULE.test(line)) return [{ start: 0, end: line.length, kind: "syntax" }];
  const out: Mark[] = [];
  let at = 0;
  const quote = QUOTE.exec(line);
  if (quote) {
    out.push({ start: 0, end: quote[0].length, kind: "syntax" });
    at = quote[0].length;
  }
  const heading = HEADING.exec(line.slice(at));
  if (heading) {
    const start = at + heading[1].length;
    const words = at + heading[0].length;
    out.push({ start, end: start + heading[2].length, kind: "syntax" });
    if (words < line.length) out.push({ start: words, end: line.length, kind: "heading" });
    return out;
  }
  const bullet = BULLET.exec(line.slice(at));
  if (bullet) {
    const start = at + bullet[1].length;
    out.push({ start, end: start + bullet[2].length, kind: "syntax" });
    at = start + bullet[2].length;
  }
  out.push(...inlineMarks(line, at));
  return out;
}

/** Inline code, links and emphasis of `line` from column `from`. */
function inlineMarks(line: string, from: number): Mark[] {
  const out: Mark[] = [];
  // Code spans first: what is inside them is no Markdown.
  const taken: Span[] = [];
  const code = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
  code.lastIndex = from;
  for (let m = code.exec(line); m; m = code.exec(line)) {
    const ticks = m[1].length;
    const end = m.index + m[0].length;
    out.push({ start: m.index, end: m.index + ticks, kind: "syntax" });
    out.push({ start: m.index + ticks, end: end - ticks, kind: "code" });
    out.push({ start: end - ticks, end, kind: "syntax" });
    taken.push({ start: m.index, end });
  }
  const free = (start: number, end: number) => taken.every((t) => end <= t.start || start >= t.end);
  // Links and images: `[words](target)`, the words in the link colour, the rest muted.
  const link = /(!?\[)([^\]\n]+)(\]\([^)\s]*(?:\s+"[^"]*")?\))/g;
  link.lastIndex = from;
  for (let m = link.exec(line); m; m = link.exec(line)) {
    const end = m.index + m[0].length;
    if (!free(m.index, end)) continue;
    const words = m.index + m[1].length;
    out.push({ start: m.index, end: words, kind: "syntax" });
    out.push({ start: words, end: words + m[2].length, kind: "link" });
    out.push({ start: words + m[2].length, end, kind: "syntax" });
    taken.push({ start: m.index, end });
  }
  // Emphasis marks: `**`, `__`, `~~` and a single `*` or `_`, in pairs around words (not `snake_case`, not `2 * 3`).
  const emphasis = /(\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/g;
  emphasis.lastIndex = from;
  for (let m = emphasis.exec(line); m; m = emphasis.exec(line)) {
    const mark = m[1];
    const end = m.index + m[0].length;
    if (mark.includes("_")) {
      // Underscores only at a word's edges.
      const before = line[m.index - 1] ?? " ";
      const after = line[end] ?? " ";
      if (/\w/.test(before) || /\w/.test(after)) {
        emphasis.lastIndex = m.index + 1;
        continue;
      }
    }
    if (!free(m.index, end)) {
      emphasis.lastIndex = m.index + 1;
      continue;
    }
    out.push({ start: m.index, end: m.index + mark.length, kind: "syntax" });
    out.push({ start: end - mark.length, end, kind: "syntax" });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** What Return does on a list item, a to-do or a quote line: the line's new text (with the line break) and where the caret goes. */
export interface Continuation {
  /** What replaces the whole line: the line up to the caret, a break and the next item's start, or the line without its marker. */
  text: string;
  /** The caret's place, by lines after the line's start and column. */
  caret: { line: number; column: number };
}

/** Indent, quote markers, then a list marker with its space and a to-do's box. */
const ITEM = /^([ \t]*)((?:>[ \t]?)*)(?:([-*+]|(\d{1,9})([.)]))([ \t]+|$)(\[[ xX]\](?:[ \t]+|$))?)?/;

/**
 * What Return does with the caret at `column` of `line` (outside fenced code), as Bear and Notes have it, or `null`
 * for a plain line break: a list item goes on with the same marker (an ordered one with the next number), at its
 * indent and in its quote; a to-do with an open box, its reminder and stamp kept where they were; a quote line with
 * `> `. An empty item (its marker alone) loses the marker: the list ends. A caret in the marker breaks the line.
 */
export function continuation(line: string, column: number): Continuation | null {
  const m = ITEM.exec(line);
  if (!m) return null;
  const [prefix, indent, quote, marker, number, delimiter, gap, box] = m;
  if (!quote && !marker) return null;
  // A rule (`- - -`, `***`) or a fence is no item; neither is a heading.
  if (RULE.test(line) || FENCE.test(line)) return null;
  if (column < prefix.length || column > line.length) return null;
  const rest = line.slice(prefix.length);
  if (!rest.trim()) {
    // The marker alone: it goes, and the list ends (a list item in a quote stays in the quote).
    const kept = marker && quote ? indent + quote : "";
    return { text: kept, caret: { line: 0, column: kept.length } };
  }
  const next = marker ? (number !== undefined ? `${Number(number) + 1}${delimiter}` : marker) : "";
  const start = indent + quote + (marker ? next + (gap || " ") + (box ? `[ ]${box.slice(3) || " "}` : "") : "");
  // A to-do's reminder and done stamp stay with it: the words before them move on, they do not.
  const task = box ? taskLine(line) : null;
  const metaAt = Math.min(task?.due?.start ?? Infinity, task?.stamp?.start ?? Infinity);
  // Spaces the caret leaves behind it go; the marker's own stay.
  let head = prefix + line.slice(prefix.length, column).trimEnd();
  let tail = line.slice(column);
  if (metaAt < line.length && column <= metaAt) {
    const meta = line.slice(metaAt);
    head = `${head}${head.length > prefix.length ? " " : ""}${meta}`;
    tail = line.slice(column, metaAt);
  } else if (metaAt < column) {
    head = line;
    tail = "";
  }
  tail = tail.trim();
  return { text: `${head}\n${start}${tail}`, caret: { line: 1, column: start.length } };
}
