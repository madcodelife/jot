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
// A table (GFM's) is drawn as cells of fixed widths, its pipes and its
// delimiter row hidden, while no caret or selection is in it; touched
// anywhere, all of it shows as written (`tableBlocks`, `tableMarks`).
import { taskLine, type Span } from "./tasks";

/**
 * What a part of a line is: syntax, or words drawn as a heading's, a link's, code, bold, italic or struck through; a
 * to-do's box; a table's cell (its header's: `head`) and the rule its delimiter row stands for.
 */
export type MarkKind = "syntax" | "heading" | "link" | "code" | "strong" | "em" | "strike" | "box" | "cell" | "head" | "rule";

/** How a table's column sets its words in its cells. */
export type Align = "left" | "center" | "right";

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
  /** A table's cell or rule: the width of its box, in points (the room after its words included). */
  width?: number;
  /** A table's cell: the room after its words, inside `width` (the gap before the next column). */
  gap?: number;
  /** A table's cell: how its words sit in it. */
  align?: Align;
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

// Tables, as GFM has them: a header row, a delimiter row of as many cells (`| --- | :---: | ---: |`), then rows up to
// a blank line, a line with no pipe, a heading or fenced code, all in the same quote. The pipes at either end of a row
// may be left out; `\|` is a pipe in a cell's words.

/** A table, by lines: its header's (its delimiter row is the next line), its last row's; how each column's words sit. */
export interface TableBlock {
  start: number;
  end: number;
  align: Align[];
}

/** A table's row: its pipes between cells, the one at its end (if any), and each cell's words, trimmed, by column. */
interface Row {
  between: number[];
  trail: number | null;
  cells: Span[];
}

/** How many quotes `line` is in (`> >`: 2), and where its quote markers end. */
function quoteOf(line: string) {
  const markers = QUOTE.exec(line)?.[0] ?? "";
  return { depth: (markers.match(/>/g) ?? []).length, end: markers.length };
}

/** `line` read as a table's row (after its quote markers), or `null` when it has no pipe. */
function tableRow(line: string): Row | null {
  const from = quoteOf(line).end;
  const pipes: number[] = [];
  for (let i = from; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "|") pipes.push(i);
  }
  if (pipes.length === 0) return null;
  const first = line.length - line.slice(from).trimStart().length;
  const last = line.trimEnd().length - 1;
  const lead = pipes[0] === first;
  const trail = pipes[pipes.length - 1] === last && !(lead && pipes.length === 1) ? last : null;
  const between = pipes.slice(lead ? 1 : 0, trail === null ? pipes.length : -1);
  const starts = [lead ? first + 1 : from, ...between.map((p) => p + 1)];
  const ends = [...between, trail ?? line.length];
  const cells = starts.map((start, k) => {
    const raw = line.slice(start, ends[k]);
    const words = start + raw.length - raw.trimStart().length;
    return { start: words, end: Math.max(words, start + raw.trimEnd().length) };
  });
  return { between, trail, cells };
}

const DELIMITER = /^:?-+:?$/;

/** How the columns of the delimiter row `line` set their words, or `null` when it is not one. */
function delimiterRow(line: string): Align[] | null {
  const row = tableRow(line);
  if (!row) return null;
  const cells = row.cells.map((c) => line.slice(c.start, c.end));
  if (!cells.every((c) => DELIMITER.test(c))) return null;
  return cells.map((c) => (c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : "left"));
}

/** The tables of `lines`, in order (none in fenced code). */
export function tableBlocks(lines: readonly string[]): TableBlock[] {
  const fenced = fencedLines(lines);
  const out: TableBlock[] = [];
  /** `line` goes on a table in `depth` quotes. */
  const rowOf = (line: number, depth: number) => {
    const text = lines[line];
    const quote = quoteOf(text);
    if (fenced[line] || quote.depth !== depth || !text.slice(quote.end).trim() || HEADING.test(text.slice(quote.end))) return null;
    return tableRow(text);
  };
  for (let i = 0; i + 1 < lines.length; i++) {
    const depth = quoteOf(lines[i]).depth;
    const head = rowOf(i, depth);
    const align = head && rowOf(i + 1, depth) ? delimiterRow(lines[i + 1]) : null;
    if (!head || !align || align.length !== head.cells.length) continue;
    let end = i + 1;
    while (end + 1 < lines.length && rowOf(end + 1, depth)) end++;
    out.push({ start: i, end, align });
    i = end;
  }
  return out;
}

/** A cell's words as they read: the marks of its inline Markdown dropped, escapes undone, a `<br>` a space. */
export function cellText(words: string): string {
  const dropped = new Set<number>();
  for (const m of inlineMarks(words, 0, [])) if (m.label === "") for (let i = m.start; i < m.end; i++) dropped.add(i);
  let out = "";
  for (let i = 0; i < words.length; i++) if (!dropped.has(i)) out += words[i];
  return out.replace(/<br\s*\/?>/gi, " ").replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/** Wide characters: CJK, Hangul, kana and the full-width forms, an em each. */
const WIDE = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];
/** Latin's narrow and wide letters, by ems of the system's font (San Francisco). */
const EMS: [string, number][] = [
  [" ", 0.27],
  ["il.,:;'!|`I", 0.27],
  ['jfrt()[]{}"/\\', 0.37],
  ["mwMW", 0.88],
  ["ABCDEFGHJKLNOPQRSTUVXYZ", 0.68],
  ["0123456789", 0.6],
  ["abcdeghknopqsuvxyz", 0.57],
];

/** About how many ems `ch` takes: none for a joiner or a mark on the letter before. */
function charEms(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if ((code >= 0x300 && code <= 0x36f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) return 0;
  if (WIDE.some(([a, b]) => code >= a && code <= b)) return 1;
  // Emoji, a little wider than an em.
  if (code >= 0x1f000 || (code >= 0x2600 && code <= 0x27bf)) return 1.25;
  return EMS.find(([chars]) => chars.includes(ch))?.[1] ?? 0.6;
}

/**
 * About how wide `text` is, in points, set in the system's font at `size` (bold a little wider): an em for a CJK
 * character, Latin by its letters' widths. The editor cannot measure text, so a table's columns are set by this.
 */
export function textWidth(text: string, size: number, bold = false): number {
  let ems = 0;
  let joined = false;
  for (const ch of text) {
    // The emoji after a joiner is drawn with the one before it.
    ems += joined ? 0 : charEms(ch);
    joined = ch === "‍";
  }
  return ems * size * (bold ? 1.06 : 1);
}

/** What a table is set in: the room across the text, in points, and the words' size. */
export interface TableLook {
  room: number;
  size: number;
}

/**
 * The columns' widths for words `natural` wide in `room` with `gap` between columns: as they are when they fit; else
 * the narrow ones as they are and the wide ones sharing what is left (their words cut, with an ellipsis); `null` when
 * the columns would be narrower than three ems of `size` (the table then shows as written).
 */
function fitColumns(natural: number[], room: number, gap: number, size: number): number[] | null {
  const budget = room - gap * (natural.length - 1);
  if (natural.reduce((a, b) => a + b, 0) <= budget) return natural;
  if (natural.length * size * 3 > budget) return null;
  const widths = [...natural];
  let left = budget;
  const order = natural.map((_, i) => i).sort((a, b) => natural[a] - natural[b]);
  order.forEach((column, k) => {
    widths[column] = Math.min(natural[column], Math.floor(left / (order.length - k)));
    left -= widths[column];
  });
  return widths;
}

/**
 * What the live preview shows of `block`'s lines while no caret or selection is in it, a line's marks each (by the
 * block's lines, from its header), or `null` when its columns do not fit `look.room` (it shows as written). A cell
 * (its words with the pipe before it; the first one from the line's start) stands for its words, their inline Markdown
 * dropped, in a box of its column's width (`width`, the gap after it included), the columns as wide as their widest
 * words and set as the delimiter row says (`align`); a pipe ending the row hides; the delimiter row is a rule as wide
 * as the table.
 */
export function tableMarks(lines: readonly string[], block: TableBlock, look: TableLook): Mark[][] | null {
  const gap = Math.round(look.size * 1.25);
  const rows: { line: string; row: Row; words: string[] }[] = [];
  for (let i = block.start; i <= block.end; i++) {
    const line = lines[i];
    const row = tableRow(line);
    if (!row) return null;
    rows.push({ line, row, words: row.cells.map((c) => cellText(line.slice(c.start, c.end))) });
  }
  const columns = Math.max(...rows.map((r) => r.words.length));
  const natural: number[] = new Array(columns).fill(0);
  rows.forEach((r, k) => {
    if (k === 1) return;
    r.words.forEach((w, c) => (natural[c] = Math.max(natural[c], Math.ceil(textWidth(w, look.size, k === 0)) + 1)));
  });
  const widths = fitColumns(natural, look.room, gap, look.size);
  if (!widths) return null;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (columns - 1);
  return rows.map(({ line, row, words }, k) => {
    if (k === 1) return [{ start: 0, end: line.length, kind: "rule", label: "", width: total }];
    const marks: Mark[] = words.map((label, c) => {
      const after = c < columns - 1 ? gap : 0;
      return {
        start: c === 0 ? 0 : row.between[c - 1],
        end: c < row.between.length ? row.between[c] : (row.trail ?? line.length),
        kind: k === 0 ? "head" : "cell",
        label,
        width: widths[c] + after,
        gap: after,
        align: block.align[c] ?? "left",
      };
    });
    if (row.trail !== null) marks.push({ start: row.trail, end: line.length, kind: "syntax", label: "" });
    return marks;
  });
}

/** A table's line as written: its pipes (the delimiter row, all of it) syntax, muted. */
export function tableSyntax(line: string, delimiter: boolean): Mark[] {
  if (delimiter) return [{ start: 0, end: line.length, kind: "syntax" }];
  const row = tableRow(line);
  if (!row) return [];
  const pipes = [...row.between, ...(row.trail !== null ? [row.trail] : [])];
  const first = row.cells[0] ? line.slice(0, row.cells[0].start).lastIndexOf("|") : -1;
  if (first >= quoteOf(line).end && !pipes.includes(first)) pipes.unshift(first);
  return pipes.map((p) => ({ start: p, end: p + 1, kind: "syntax" }));
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
