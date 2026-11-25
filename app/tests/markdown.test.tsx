// The editor's Markdown marks (app/markdown.ts): which parts of a line are
// syntax, drawn muted, and which are a heading's, a link's or code's words.
// Pure functions, no app.
import { expect, test } from "nsh/test";
import { continuation, fencedLines, lineMarks, type Mark } from "../markdown";

/** The marks as `kind:text`, in order. */
const shown = (line: string) => lineMarks(line).map((m: Mark) => `${m.kind}:${line.slice(m.start, m.end)}`);

test("a heading's hashes are syntax and its words a heading's; up to three spaces before, a space after", () => {
  expect(shown("## 二级标题 Heading 2")).toEqual(["syntax:##", "heading:二级标题 Heading 2"]);
  expect(shown("   ###### six")).toEqual(["syntax:######", "heading:six"]);
  expect(shown("#")).toEqual(["syntax:#"]);
  expect(shown("#hashtag")).toEqual([]);
  expect(shown("####### seven")).toEqual([]);
  expect(shown("> ## quoted")).toEqual(["syntax:> ", "syntax:##", "heading:quoted"]);
});

test("list, quote and rule markers are syntax; a to-do's dash too, not its box", () => {
  expect(shown("- 无序列表第一项")).toEqual(["syntax:-"]);
  expect(shown("  * nested")).toEqual(["syntax:*"]);
  expect(shown("12. twelfth")).toEqual(["syntax:12."]);
  expect(shown("> 引用：好的工具应该安静")).toEqual(["syntax:> "]);
  expect(shown("> > deeper")).toEqual(["syntax:> > "]);
  expect(shown("- [ ] 交房租 ⏰ 2026-11-14 09:00")).toEqual(["syntax:-"]);
  expect(shown("---")).toEqual(["syntax:---"]);
  expect(shown("* * *")).toEqual(["syntax:* * *"]);
  expect(shown("-not a list")).toEqual([]);
});

test("emphasis keeps its words and mutes its marks; a lone star or an identifier's underscore is text", () => {
  expect(shown("今天把 **Jot** 的编辑器走一遍，看看 *Markdown*")).toEqual(["syntax:**", "syntax:**", "syntax:*", "syntax:*"]);
  expect(shown("~~旧的~~ and __bold__ and _it_")).toEqual(["syntax:~~", "syntax:~~", "syntax:__", "syntax:__", "syntax:_", "syntax:_"]);
  expect(shown("2 * 3 * 4")).toEqual([]);
  expect(shown("call snake_case_name here")).toEqual([]);
});

test("inline code is code between muted backticks, and nothing inside it is Markdown", () => {
  expect(shown("用 `inline code` 也在")).toEqual(["syntax:`", "code:inline code", "syntax:`"]);
  expect(shown("`*not emphasis*` and ``a ` tick``")).toEqual(["syntax:`", "code:*not emphasis*", "syntax:`", "syntax:``", "code:a ` tick", "syntax:``"]);
});

test("a link's words are a link's, its brackets and target syntax", () => {
  expect(shown("带一个 [链接](https://example.com)")).toEqual(["syntax:[", "link:链接", "syntax:](https://example.com)"]);
  expect(shown("![logo](a.png)")).toEqual(["syntax:![", "link:logo", "syntax:](a.png)"]);
  expect(shown("[x] alone")).toEqual([]);
});

test("a fence's line is syntax", () => {
  expect(shown("```rust")).toEqual(["syntax:```rust"]);
  expect(shown("~~~")).toEqual(["syntax:~~~"]);
});

test("fenced code runs from its fence to the matching one, or to the end", () => {
  expect(fencedLines(["a", "```sh", "# install", "```", "# heading"])).toEqual([false, true, true, true, false]);
  // A closing fence is as long as the opening one at least, of the same character, alone on its line.
  expect(fencedLines(["````", "```", "~~~", "```` x", "````"])).toEqual([true, true, true, true, true]);
  expect(fencedLines(["~~~", "```", "~~~", "after"])).toEqual([true, true, true, false]);
  expect(fencedLines(["```", "never closed", "# still code"])).toEqual([true, true, true]);
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
