// The editor's Markdown (app/markdown.ts): which parts of a line are syntax
// and which are a heading's, a link's, code's or emphasis's words; what the
// live preview shows in place of the syntax, by where the caret is; fenced
// code; tables, drawn as cells; what Return does on a list. Pure functions, no app.
import { expect, test } from "nsh/test";
import { cellText, codeBlocks, continuation, fenceMark, fencedLines, isQuote, lineMarks, tableBlocks, tableMarks, tableSyntax, textWidth, type Mark } from "../markdown";

/**
 * The marks as `kind:text`, in order, with `→label` where the preview shows a label in place of the text (`→` alone:
 * hidden). `carets` are columns of carets on the line, or `[start, end]` of selections.
 */
const shown = (line: string, ...carets: (number | [number, number])[]) =>
  lineMarks(
    line,
    carets.map((c) => (typeof c === "number" ? { start: c, end: c } : { start: c[0], end: c[1] })),
  ).map((m: Mark) => `${m.kind}:${line.slice(m.start, m.end)}${m.label !== undefined ? `→${m.label}` : ""}`);

test("a heading's hashes and space hide and its words are a heading's; up to three spaces before, a space after", () => {
  expect(shown("## 二级标题 Heading 2")).toEqual(["syntax:## →", "heading:二级标题 Heading 2"]);
  expect(shown("   ###### six")).toEqual(["syntax:###### →", "heading:six"]);
  expect(shown("#")).toEqual(["syntax:#"]);
  expect(shown("# ")).toEqual(["syntax:# "]);
  expect(shown("#hashtag")).toEqual([]);
  expect(shown("####### seven")).toEqual([]);
  expect(shown("> ## quoted")).toEqual(["syntax:> →", "syntax:## →", "heading:quoted"]);
  expect(lineMarks("## two").map((m) => m.level)).toEqual([2, 2]);
  expect(lineMarks("> #### four").map((m) => m.level)).toEqual([undefined, 4, 4]);
});

test("a heading's marks show while the caret or a selection is anywhere on its line", () => {
  expect(shown("## 标题", 5)).toEqual(["syntax:## ", "heading:标题"]);
  expect(shown("## 标题", 0)).toEqual(["syntax:## ", "heading:标题"]);
  expect(shown("> ## quoted", [0, 11])).toEqual(["syntax:> ", "syntax:## ", "heading:quoted"]);
});

test("a heading's words have their inline Markdown too", () => {
  expect(shown("# **粗** 标题")).toEqual(["syntax:# →", "heading:**粗** 标题", "syntax:**→", "strong:粗", "syntax:**→"]);
  // On the line, away from the bold words: the heading's marks show, the bold's stay hidden.
  expect(shown("# **粗** 标题", 9)).toEqual(["syntax:# ", "heading:**粗** 标题", "syntax:**→", "strong:粗", "syntax:**→"]);
});

test("a bullet stands for •, a number stays, a quote's marks hide; all show with the caret on the line", () => {
  expect(shown("- 无序列表第一项")).toEqual(["syntax:-→•"]);
  expect(shown("  * nested")).toEqual(["syntax:*→•"]);
  expect(shown("+ plus")).toEqual(["syntax:+→•"]);
  expect(shown("12. twelfth")).toEqual(["syntax:12."]);
  expect(shown("> 引用：好的工具应该安静")).toEqual(["syntax:> →"]);
  expect(shown("> > deeper")).toEqual(["syntax:> > →"]);
  expect(shown("> - item")).toEqual(["syntax:> →", "syntax:-→•"]);
  expect(shown("- item", 6)).toEqual(["syntax:-"]);
  expect(shown("> - item", 8)).toEqual(["syntax:> ", "syntax:-"]);
  expect(shown("---")).toEqual(["syntax:---"]);
  expect(shown("* * *")).toEqual(["syntax:* * *"]);
  expect(shown("-not a list")).toEqual([]);
  expect(isQuote("> said")).toBe(true);
  expect(isQuote("   >said")).toBe(true);
  expect(isQuote("a > b")).toBe(false);
});

test("a to-do's `- [ ]` is a box, open or ticked, shown as text only while a caret or a selection touches it", () => {
  expect(shown("- [ ] 交房租 ⏰ 2026-11-14 09:00")).toEqual(["syntax:-", "box:- [ ]→"]);
  expect(shown("  * [x] done ✅ 2026-11-12")).toEqual(["syntax:*", "box:* [x]→✓"]);
  expect(lineMarks("- [X] done").find((m) => m.kind === "box")?.done).toBe(true);
  // Typing its words keeps the box: the caret after its space touches it not.
  expect(shown("- [ ] 交房租", 6)).toEqual(["syntax:-", "box:- [ ]→"]);
  expect(shown("- [ ] 交房租", 9)).toEqual(["syntax:-", "box:- [ ]→"]);
  expect(shown("- [ ] 交房租", 5)).toEqual(["syntax:-", "box:- [ ]"]);
  expect(shown("- [ ] 交房租", 0)).toEqual(["syntax:-", "box:- [ ]"]);
  expect(shown("- [ ] 交房租", [3, 8])).toEqual(["syntax:-", "box:- [ ]"]);
  // Its words' Markdown, after the box.
  expect(shown("- [ ] 买 **牛奶**")).toEqual(["syntax:-", "box:- [ ]→", "syntax:**→", "strong:牛奶", "syntax:**→"]);
  // A box in a quote is no to-do.
  expect(shown("> - [ ] quoted")).toEqual(["syntax:> →", "syntax:-→•"]);
});

test("emphasis's marks hide around its words, bold, italic or struck; a lone star or an identifier's underscore is text", () => {
  expect(shown("今天把 **Jot** 的编辑器走一遍，看看 *Markdown*")).toEqual([
    "syntax:**→",
    "strong:Jot",
    "syntax:**→",
    "syntax:*→",
    "em:Markdown",
    "syntax:*→",
  ]);
  expect(shown("~~旧的~~ and __bold__ and _it_")).toEqual([
    "syntax:~~→",
    "strike:旧的",
    "syntax:~~→",
    "syntax:__→",
    "strong:bold",
    "syntax:__→",
    "syntax:_→",
    "em:it",
    "syntax:_→",
  ]);
  expect(shown("2 * 3 * 4")).toEqual([]);
  expect(shown("call snake_case_name here")).toEqual([]);
});

test("a span's marks both show while the caret is in it or at either end, or a selection touches it; the others stay hidden", () => {
  const line = "a **b** *c*";
  const hidden = ["syntax:*→", "em:c", "syntax:*→"];
  expect(shown(line, 4)).toEqual(["syntax:**", "strong:b", "syntax:**", ...hidden]);
  expect(shown(line, 2)).toEqual(["syntax:**", "strong:b", "syntax:**", ...hidden]);
  expect(shown(line, 7)).toEqual(["syntax:**", "strong:b", "syntax:**", ...hidden]);
  expect(shown(line, 1)).toEqual(["syntax:**→", "strong:b", "syntax:**→", ...hidden]);
  expect(shown(line, 8)).toEqual(["syntax:**→", "strong:b", "syntax:**→", "syntax:*", "em:c", "syntax:*"]);
  expect(shown(line, [0, 3])).toEqual(["syntax:**", "strong:b", "syntax:**", ...hidden]);
  // Two carets, one in each.
  expect(shown(line, 4, 9)).toEqual(["syntax:**", "strong:b", "syntax:**", "syntax:*", "em:c", "syntax:*"]);
});

test("inline code is code between hidden backticks, and nothing inside it is Markdown", () => {
  expect(shown("用 `inline code` 也在")).toEqual(["syntax:`→", "code:inline code", "syntax:`→"]);
  expect(shown("`*not emphasis*` and ``a ` tick``")).toEqual(["syntax:`→", "code:*not emphasis*", "syntax:`→", "syntax:``→", "code:a ` tick", "syntax:``→"]);
  expect(shown("用 `code` 也在", 6)).toEqual(["syntax:`", "code:code", "syntax:`"]);
});

test("a link or an image shows its words alone, in the link's colour; its brackets and target show with the caret in it", () => {
  expect(shown("带一个 [链接](https://example.com)")).toEqual(["syntax:[→", "link:链接", "syntax:](https://example.com)→"]);
  expect(shown("![logo](a.png)")).toEqual(["syntax:![→", "link:logo", "syntax:](a.png)→"]);
  expect(shown("[x] alone")).toEqual([]);
  expect(shown("带一个 [链接](https://example.com)", 4)).toEqual(["syntax:[", "link:链接", "syntax:](https://example.com)"]);
  expect(shown("带一个 [链接](https://example.com)", 28)).toEqual(["syntax:[", "link:链接", "syntax:](https://example.com)"]);
});

test("labelled marks never overlap, whatever the line", () => {
  for (const line of ["***x***", "*a **b** c*", "> ## **h** `c` [l](u)", "- [ ] **a**_b_ ~~c~~", "__a__b__", "`a` `b`"]) {
    const labelled = lineMarks(line).filter((m) => m.label !== undefined);
    for (let i = 1; i < labelled.length; i++) expect(labelled[i].start >= labelled[i - 1].end).toBe(true);
  }
});

test("a fence's line is syntax; outside its block it is its language's name, or hidden", () => {
  expect(shown("```rust")).toEqual(["syntax:```rust"]);
  expect(shown("~~~")).toEqual(["syntax:~~~"]);
  expect(fenceMark("```rust", false).label).toBe("rust");
  expect(fenceMark("  ~~~~ python title=\"a.py\"", false).label).toBe("python");
  expect(fenceMark("```", false).label).toBe("");
  expect(fenceMark("```rust", true).label).toBeUndefined();
  expect(fenceMark("```rust", true)).toEqual({ start: 0, end: 7, kind: "syntax" });
});

test("fenced code runs from its fence to the matching one, or to the end", () => {
  expect(fencedLines(["a", "```sh", "# install", "```", "# heading"])).toEqual([false, true, true, true, false]);
  // A closing fence is as long as the opening one at least, of the same character, alone on its line.
  expect(fencedLines(["````", "```", "~~~", "```` x", "````"])).toEqual([true, true, true, true, true]);
  expect(fencedLines(["~~~", "```", "~~~", "after"])).toEqual([true, true, true, false]);
  expect(fencedLines(["```", "never closed", "# still code"])).toEqual([true, true, true]);
  expect(codeBlocks(["a", "```sh", "x", "```", "b", "~~~", "y"])).toEqual([
    { start: 1, end: 3, closed: true },
    { start: 5, end: 6, closed: false },
  ]);
  expect(codeBlocks(["```"])).toEqual([{ start: 0, end: 0, closed: false }]);
});

/** The line after Return at the end of `line` (or at `column`), the caret shown as `|`. */
function enter(line: string, column = line.length): string | null {
  const next = continuation(line, column);
  if (!next) return null;
  const lines = next.text.split("\n");
  const at = lines[next.caret.line];
  lines[next.caret.line] = `${at.slice(0, next.caret.column)}|${at.slice(next.caret.column)}`;
  return lines.join("\n");
}

test("Return goes on with a list item's marker, at its indent; an ordered one with the next number", () => {
  expect(enter("- 牛奶")).toBe("- 牛奶\n- |");
  expect(enter("* eggs")).toBe("* eggs\n* |");
  expect(enter("+ bread")).toBe("+ bread\n+ |");
  expect(enter("    - nested")).toBe("    - nested\n    - |");
  expect(enter("\t- tab")).toBe("\t- tab\n\t- |");
  expect(enter("1. first")).toBe("1. first\n2. |");
  expect(enter("9) ninth")).toBe("9) ninth\n10) |");
  expect(enter("-  wide")).toBe("-  wide\n-  |");
});

test("Return on a to-do starts an open one, its reminder and stamp left where they were", () => {
  expect(enter("- [ ] 交房租")).toBe("- [ ] 交房租\n- [ ] |");
  expect(enter("- [ ] 交房租 ⏰ 2026-11-14 09:00")).toBe("- [ ] 交房租 ⏰ 2026-11-14 09:00\n- [ ] |");
  expect(enter("- [x] 写周报 ✅ 2026-11-12")).toBe("- [x] 写周报 ✅ 2026-11-12\n- [ ] |");
  expect(enter("  * [X] done")).toBe("  * [X] done\n  * [ ] |");
  // In the middle of the words: the words after the caret move on, the time stays.
  expect(enter("- [ ] 买牛奶 鸡蛋 ⏰ 2026-11-14 09:00", "- [ ] 买牛奶".length)).toBe("- [ ] 买牛奶 ⏰ 2026-11-14 09:00\n- [ ] |鸡蛋");
});

test("Return on a quote line goes on with the quote, a list in it too", () => {
  expect(enter("> 好的工具应该安静")).toBe("> 好的工具应该安静\n> |");
  expect(enter("> > deeper")).toBe("> > deeper\n> > |");
  expect(enter("> - item")).toBe("> - item\n> - |");
});

test("Return on an empty item takes its marker away: the list or quote ends", () => {
  expect(enter("- ")).toBe("|");
  expect(enter("  - ")).toBe("|");
  expect(enter("3. ")).toBe("|");
  expect(enter("- [ ] ")).toBe("|");
  expect(enter("- [ ]")).toBe("|");
  expect(enter("> ")).toBe("|");
  expect(enter(">")).toBe("|");
  expect(enter("> - ")).toBe("> |");
});

test("Return is a plain line break elsewhere: prose, headings, rules, fences, a caret in the marker", () => {
  expect(enter("plain text")).toBeNull();
  expect(enter("## 标题")).toBeNull();
  expect(enter("-not a list")).toBeNull();
  expect(enter("*emphasis* at the start")).toBeNull();
  expect(enter("- - -")).toBeNull();
  expect(enter("***")).toBeNull();
  expect(enter("```sh")).toBeNull();
  expect(enter("- item", 0)).toBeNull();
  expect(enter("1. item", 1)).toBeNull();
  // A caret after the marker, before the words: they move on.
  expect(enter("- item", 2)).toBe("- \n- |item");
});

/** A table's lines as the preview draws them, each mark as `kind:text→label`, a cell's `@width` and its alignment if not left. */
function drawn(text: string, room = 460) {
  const lines = text.split("\n");
  const [block] = tableBlocks(lines);
  const marks = tableMarks(lines, block, { room, size: 16 });
  if (!marks) return null;
  return marks.map((row, k) =>
    row.map((m) => {
      const line = lines[block.start + k];
      const look = m.width !== undefined ? `@${m.width}` : "";
      return `${m.kind}:${line.slice(m.start, m.end)}→${m.label}${look}${m.align && m.align !== "left" ? `:${m.align}` : ""}`;
    }),
  );
}

test("a table is a header, a delimiter row of as many cells and its rows, up to a line with no pipe", () => {
  const lines = ["前言", "| 周一 | 有氧 |", "| --- | --- |", "| 周二 | 力量 |", "|周三|休息|", "后记 没有竖线", "| a | b |"];
  expect(tableBlocks(lines)).toEqual([{ start: 1, end: 4, align: ["left", "left"] }]);
  // The pipes at either end may be left out.
  expect(tableBlocks(["a | b", "--- | ---", "1 | 2"])).toEqual([{ start: 0, end: 2, align: ["left", "left"] }]);
  // One column; no rows after the delimiter.
  expect(tableBlocks(["| a |", "| --- |"])).toEqual([{ start: 0, end: 1, align: ["left"] }]);
  // A blank line ends it.
  expect(tableBlocks(["| a |", "|---|", "| 1 |", "", "| 2 |"])).toEqual([{ start: 0, end: 2, align: ["left"] }]);
  // Two tables, one after the other.
  expect(tableBlocks(["|a|", "|-|", "", "|b|", "|-|"]).map((b) => b.start)).toEqual([0, 3]);
});

test("not a table: a delimiter row of another count, no delimiter row, no pipe, a rule, fenced code", () => {
  expect(tableBlocks(["| a | b |", "| --- |"])).toEqual([]);
  expect(tableBlocks(["| a | b |", "| 1 | 2 |"])).toEqual([]);
  expect(tableBlocks(["a", "---"])).toEqual([]);
  expect(tableBlocks(["| a | b |", "| -- | x |"])).toEqual([]);
  expect(tableBlocks(["| a |", "| :: |"])).toEqual([]);
  expect(tableBlocks(["# 标题 | b", "--- | ---"])).toEqual([]);
  expect(tableBlocks(["```", "| a | b |", "| --- | --- |", "```"])).toEqual([]);
  // A fence right after the header: the fenced lines are no rows.
  expect(tableBlocks(["| a |", "| - |", "| 1 |", "```", "| 2 |", "```"])).toEqual([{ start: 0, end: 2, align: ["left"] }]);
  // Only the last line: no delimiter row.
  expect(tableBlocks(["| a |"])).toEqual([]);
});

test("a table in a quote stays in it: its rows are the lines in as many quotes", () => {
  expect(tableBlocks(["> | a |", "> | - |", "> | 1 |", "| 2 |"])).toEqual([{ start: 0, end: 2, align: ["left"] }]);
  expect(tableBlocks(["> | a |", "| - |"])).toEqual([]);
});

test("the delimiter row sets each column: `:-:` centered, `-:` on the right, `:-` and `-` on the left", () => {
  expect(tableBlocks(["| a | b | c | d |", "| :---: | ---: | :--- | - |"])[0].align).toEqual(["center", "right", "left", "left"]);
});

test("a cell's words read without their inline Markdown, escapes undone", () => {
  expect(cellText("**粗体**")).toBe("粗体");
  expect(cellText("`code` and [链接](https://example.com)")).toBe("code and 链接");
  expect(cellText("~~删~~ *斜*")).toBe("删 斜");
  expect(cellText("2 \\| 3")).toBe("2 | 3");
  expect(cellText("一<br>二")).toBe("一 二");
  expect(cellText("snake_case")).toBe("snake_case");
});

test("text widths: CJK an em, Latin narrower by letter, bold a little wider, emoji one each", () => {
  expect(textWidth("周一", 16)).toBe(32);
  expect(textWidth("ＡＢ", 10)).toBe(20);
  expect(textWidth("ii", 16)).toBeLessThan(textWidth("mm", 16));
  expect(textWidth("abc", 16)).toBeGreaterThan(16 * 1.5);
  expect(textWidth("abc", 16)).toBeLessThan(16 * 2);
  expect(textWidth("周一", 16, true)).toBeGreaterThan(32);
  expect(textWidth("👨‍👩‍👧", 16)).toBe(textWidth("👍", 16));
  expect(textWidth("", 16)).toBe(0);
});

test("a table's cells: each stands for its words in a box its column's width, the pipe ending a row hidden", () => {
  expect(drawn("| 周一 | 有氧 |\n| --- | --- |\n| 周二 | 力量训练 |")).toEqual([
    ["head:| 周一 →周一@55", "head:| 有氧 →有氧@65", "syntax:|→"],
    ["rule:| --- | --- |→@120"],
    ["cell:| 周二 →周二@55", "cell:| 力量训练 →力量训练@65", "syntax:|→"],
  ]);
  // Columns: as wide as the widest words (the header's bold), 20 points between them (on the left one's box).
  const w = (text: string, bold = false) => Math.ceil(textWidth(text, 16, bold)) + 1;
  expect(55).toBe(w("周一", true) + 20);
  expect(65).toBe(w("力量训练"));
});

test("a table's cells without the pipes at either end, and with inline Markdown", () => {
  expect(drawn("**名** | 值\n--- | ---:\n`x` | [1](u)")).toEqual([
    ["head:**名** →名@38", "head:| 值→值@18:right"],
    ["rule:--- | ---:→@56"],
    ["cell:`x` →x@38", "cell:| [1](u)→1@18:right"],
  ]);
});

test("a row with fewer cells leaves the rest empty; one with more has columns of its own", () => {
  const marks = drawn("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |")!;
  expect(marks[2]).toEqual(["cell:| 1 →1@31", "syntax:|→"]);
  expect(marks[3].length).toBe(4);
  expect(marks[3][2]).toBe("cell:| 3 →3@11");
  // Empty cells are empty boxes.
  expect(drawn("| a |  |\n|---|---|")![0][1]).toBe("head:|  →@1");
});

test("a table too wide for the paper: the wide columns share what is left, the narrow ones keep their width", () => {
  const long = "很长很长很长很长很长很长很长很长很长很长很长很长很长";
  const marks = drawn(`| 短 | ${long} | ${long} |\n| - | - | - |`, 300)!;
  const widths = marks[0].slice(0, 3).map((m) => Number(m.split("@")[1]));
  // 短's column (17 points of bold, 20 to the next), and the two long ones splitting the rest.
  expect(widths[0]).toBe(Math.ceil(textWidth("短", 16, true)) + 1 + 20);
  expect(widths[1] - 20).toBe(widths[2]);
  expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(300);
  // The rule is as wide as the cells.
  expect(Number(marks[1][0].split("@")[1])).toBe(widths.reduce((a, b) => a + b, 0));
  // Too many columns for three ems each: it shows as written.
  const many = Array.from({ length: 12 }, (_, i) => `c${i}`);
  expect(drawn(`| ${many.join(" | ")} |\n|${" - |".repeat(12)}`)).toBeNull();
});

test("a table's syntax as written: its pipes, and all of its delimiter row", () => {
  const syntax = (line: string, delimiter = false) => tableSyntax(line, delimiter).map((m) => `${m.start}-${m.end}`);
  expect(syntax("| a | b |")).toEqual(["0-1", "4-5", "8-9"]);
  expect(syntax("a | b")).toEqual(["2-3"]);
  expect(syntax("| a \\| b |")).toEqual(["0-1", "9-10"]);
  expect(syntax("> | a |")).toEqual(["2-3", "6-7"]);
  expect(syntax("| --- |", true)).toEqual(["0-7"]);
});
