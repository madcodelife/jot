// The editor's Markdown (app/markdown.ts): which parts of a line are syntax
// and which are a heading's, a link's, code's or emphasis's words; what the
// live preview shows in place of the syntax, by where the caret is; fenced
// code; what Return does on a list. Pure functions, no app.
import { expect, test } from "nsh/test";
import { codeBlocks, continuation, fenceMark, fencedLines, isQuote, lineMarks, type Mark } from "../markdown";

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
