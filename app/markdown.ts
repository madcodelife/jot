// The open note's live preview, as Typora draws Markdown: what the editor
// styles of a line beyond the built-in highlighting, and which of its syntax
// it hides or stands in for, by where the caret is. The words show as they
// read (a heading large, bold words bold, a link's words in the link colour,
// inline code in a monospaced font) and the syntax around them hides: a
// heading's `#`, a quote's `>`, emphasis and code marks, a link's brackets
// and target. It comes back where the caret or a selection is: the line's
// leading syntax while it is on the line, a span's marks (both of them)
// while it is in the span or at either end. A bullet shows as `•`, a to-do's
// `- [ ]` as a box. The file's text never changes: the editor shows a label
// in place of a range (app/ui/Paper.tsx). Fenced code is left to the built-in
// highlighter (a `# comment` in a shell snippet is no heading); its fences
// hide, but for the language's name, while the caret is outside the block.
import { taskLine, type Span } from "./tasks";

/** What a part of a line is: syntax, or words drawn as a heading's, a link's, code, bold, italic or struck through; a to-do's box. */
export type MarkKind = "syntax" | "heading" | "link" | "code" | "strong" | "em" | "strike" | "box";

/** A part of one line, UTF-16 columns. */
export interface Mark extends Span {
  kind: MarkKind;
  /**
   * What the live preview shows in place of the range: `""` hides it, `"•"` stands for a bullet, a to-do's box is
   * `""` (open) or `"✓"` (ticked), a fence its language. None: its text shows (the caret is there, or it never hides).
   */
  label?: string;
  /** A heading's level, 1 to 6, on its marker and its words: their size. */
  level?: number;
  /** A to-do's box is ticked. */
  done?: boolean;
}

/** A fence's opening or closing line: three or more backticks or tildes, indented up to three spaces. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** `line` opens or closes a fenced code block. */
export const isFence = (line: string) => FENCE.test(line);

/** A fenced code block, by lines: its opening fence's, its last (the closing fence's, or the text's last when it is not closed). */
export interface CodeBlock {
  start: number;
  end: number;
  /** It has a closing fence, on line `end`. */
  closed: boolean;
}

/** The fenced code blocks of `lines`, in order (an unclosed fence runs to the end). */
export function codeBlocks(lines: readonly string[]): CodeBlock[] {
  const out: CodeBlock[] = [];
  let open: { fence: string; start: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line)?.[1] ?? null;
    if (open === null) {
      if (fence) open = { fence, start: i };
      continue;
    }
    // A closing fence: the same character, at least as long, nothing after it.
    if (fence && fence[0] === open.fence[0] && fence.length >= open.fence.length && line.trim() === fence) {
      out.push({ start: open.start, end: i, closed: true });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open.start, end: lines.length - 1, closed: false });
  return out;
}

/** For each line, whether it is in a fenced code block, its fences included (an unclosed fence runs to the end). */
export function fencedLines(lines: readonly string[]): boolean[] {
  const out = lines.map(() => false);
  for (const block of codeBlocks(lines)) for (let i = block.start; i <= block.end; i++) out[i] = true;
  return out;
}

/**
 * A fence's line as the preview draws it: syntax, which shows while the caret is in its block (`shown`); else the
 * opening fence stands for its language's name (`rust` for "```rust"), and a closing one, or one without a name,
 * hides.
 */
export function fenceMark(line: string, shown: boolean): Mark {
  const mark: Mark = { start: 0, end: line.length, kind: "syntax" };
  if (shown) return mark;
  const info = line.replace(FENCE, "").trim().split(/\s+/)[0] ?? "";
  return { ...mark, label: info };
}

const HEADING = /^( {0,3})(#{1,6})([ \t]+|$)/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** Quote markers (`>`, `> >`), then a list marker (`-`, `*`, `+`, `1.`, `1)`) and its space. */
const QUOTE = /^( {0,3}>[ \t]?)+/;
const BULLET = /^([ \t]*)([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;

/** `line` is a quote's (outside fenced code): the preview tints its row. */
export const isQuote = (line: string) => QUOTE.test(line);

/** Whether a caret or a selection of `touched` is in `start`..`end` or at either end. */
const touches = (touched: readonly Span[], start: number, end: number) => touched.some((t) => t.start <= end && t.end >= start);

/**
 * The Markdown marks of `line`, a line outside fenced code, by column, and what the live preview shows of each.
 * `touched` is what of the line the carets and selections cover (a caret is an empty span; a line inside a selection
 * is covered whole); empty when none is on the line, or the editor has no focus: then all of its syntax hides.
 * Marks with a label never overlap one another; a heading's or emphasis's words lie over the syntax inside them.
 */
export function lineMarks(line: string, touched: readonly Span[] = []): Mark[] {
  if (FENCE.test(line)) return [{ start: 0, end: line.length, kind: "syntax" }];
  // A rule stays as it is, muted (the editor draws no line across).
  if (RULE.test(line)) return [{ start: 0, end: line.length, kind: "syntax" }];
  /** The caret or a selection is on the line: its leading syntax shows. */
  const here = touched.length > 0;
  const lead = (mark: Mark, label = ""): Mark => (here ? mark : { ...mark, label });
  const out: Mark[] = [];
  let at = 0;
  const quote = QUOTE.exec(line);
  if (quote) {
    out.push(lead({ start: 0, end: quote[0].length, kind: "syntax" }));
    at = quote[0].length;
  }
  const heading = HEADING.exec(line.slice(at));
  if (heading) {
    const level = heading[2].length;
    const start = at + heading[1].length;
    const words = at + heading[0].length;
    const marker: Mark = { start, end: words, kind: "syntax", level };
    // A heading with no words keeps its `#`: there would be nothing to see.
    if (words < line.length) {
      out.push(lead(marker));
      out.push({ start: words, end: line.length, kind: "heading", level });
      out.push(...inlineMarks(line, words, touched));
    } else out.push(marker);
    return out.sort((a, b) => a.start - b.start);
  }
  // A to-do (not in a quote, as the store reads it): its `- [ ]` is a box, which shows its text only while the caret
  // or a selection touches it, so the box stays while its words are typed.
  const task = at === 0 ? taskLine(line) : null;
  if (task) {
    const dash = task.box.start - 2;
    out.push({ start: dash, end: dash + 1, kind: "syntax" });
    const box: Mark = { start: dash, end: task.box.end, kind: "box", done: task.done };
    out.push(touches(touched, box.start, box.end) ? box : { ...box, label: task.done ? "✓" : "" });
    out.push(...inlineMarks(line, task.rest.start, touched));
    return out.sort((a, b) => a.start - b.start);
  }
  const bullet = BULLET.exec(line.slice(at));
  if (bullet) {
    const start = at + bullet[1].length;
    const marker: Mark = { start, end: start + bullet[2].length, kind: "syntax" };
    // A bullet stands for `•`; a number stays, muted.
    out.push(/\d/.test(bullet[2]) ? marker : lead(marker, "•"));
    at = marker.end;
  }
  out.push(...inlineMarks(line, at, touched));
  return out.sort((a, b) => a.start - b.start);
}

/** Inline code, links and emphasis of `line` from column `from`: each one's marks hide unless `touched` touches it. */
function inlineMarks(line: string, from: number, touched: readonly Span[]): Mark[] {
  const out: Mark[] = [];
  /** The marks of a span `start`..`end`: both hide, or both show. */
  const marks = (start: number, end: number, ...parts: Mark[]) => {
    const shown = touches(touched, start, end);
    for (const part of parts) out.push(part.kind !== "syntax" || shown ? part : { ...part, label: "" });
  };
  // Code spans first: what is inside them is no Markdown.
  const taken: Span[] = [];
  const code = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
  code.lastIndex = from;
  for (let m = code.exec(line); m; m = code.exec(line)) {
    const ticks = m[1].length;
    const end = m.index + m[0].length;
    marks(
      m.index,
      end,
      { start: m.index, end: m.index + ticks, kind: "syntax" },
      { start: m.index + ticks, end: end - ticks, kind: "code" },
      { start: end - ticks, end, kind: "syntax" },
    );
    taken.push({ start: m.index, end });
  }
  const free = (start: number, end: number) => taken.every((t) => end <= t.start || start >= t.end);
  // Links and images: `[words](target)`, the words in the link colour, the rest syntax (an image shows its words too).
  const link = /(!?\[)([^\]\n]+)(\]\([^)\s]*(?:\s+"[^"]*")?\))/g;
  link.lastIndex = from;
  for (let m = link.exec(line); m; m = link.exec(line)) {
    const end = m.index + m[0].length;
    if (!free(m.index, end)) continue;
    const words = m.index + m[1].length;
    marks(
      m.index,
      end,
      { start: m.index, end: words, kind: "syntax" },
      { start: words, end: words + m[2].length, kind: "link" },
      { start: words + m[2].length, end, kind: "syntax" },
    );
    taken.push({ start: m.index, end });
  }
  // Emphasis: `**` / `__` bold, `*` / `_` italic, `~~` struck, in pairs around words (not `snake_case`, not `2 * 3`).
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
    const kind: MarkKind = mark === "~~" ? "strike" : mark.length === 2 ? "strong" : "em";
    marks(
      m.index,
      end,
      { start: m.index, end: m.index + mark.length, kind: "syntax" },
      { start: m.index + mark.length, end: end - mark.length, kind },
      { start: end - mark.length, end, kind: "syntax" },
    );
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
