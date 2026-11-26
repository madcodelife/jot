// The open note, headless: text an AI app appends while the note is open comes
// in at its end and leaves the caret where it was, even at the very end;
// Return goes on with a list, a to-do or a quote, and ends one on an empty
// item, one undo taking it back; ⇧↩ is a plain break; ⌘↩ ticks the caret's
// to-do; brackets and quotes typed are one character. The live preview hides
// the Markdown off the caret (all of it without the focus), sizes headings,
// sets code in the code font, and draws a to-do's box, which a press ticks.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

const MODULES = { "jot/native": { ...STAND_INS } };

/** Opens Jot on a fresh folder holding the note `title`, opens the note and puts the caret at its end. */
async function openNote(title: string, body: string) {
  const dir = `/tmp/jot-paper-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const notes = new Notes(dir);
  notes.create(title, body);
  const app = await open("../App.tsx", { platform: "macos", width: 1200, height: 800, reducedMotion: true, locale: "zh-CN", storage: { "jot.dir": dir }, modules: MODULES });
  await app.waitFor("id:search");
  await app.type("id:search", title);
  await app.submit("id:search");
  await app.waitFor("id:paper");
  await app.wait(500);
  await app.keyboard.press("mod+down");
  return { app, notes };
}

/** Types `keys`, one keystroke each, and waits for the save. */
async function keys(app: Awaited<ReturnType<typeof openNote>>["app"], ...pressed: string[]) {
  for (const key of pressed) await app.keyboard.press(key);
  await app.wait(1000);
}

test("text appended from outside leaves a caret at the note's end where it was", async () => {
  const { app, notes } = await openNote("日记", "第一行");
  await keys(app, "x");
  expect(notes.read("日记")?.body).toBe("第一行x");

  notes.append("日记", "AI 加的一段");
  await app.waitFor("id:paper-notice", { timeout: 3000 });
  // The caret is still after "x", not after the new text.
  await keys(app, "y");
  expect(notes.read("日记")?.body).toBe("第一行xy\n\nAI 加的一段\n");
});

test("Return on a to-do starts an open one without its time; Return on the empty one ends the list", async () => {
  const { app, notes } = await openNote("清单", "- [x] 交房租 ⏰ 2026-11-14 09:00 ✅ 2026-11-13");
  await keys(app, "enter", "a", "enter", "enter", "b");
  expect(notes.read("清单")?.body).toBe("- [x] 交房租 ⏰ 2026-11-14 09:00 ✅ 2026-11-13\n- [ ] a\nb");
});

test("Return goes on with a bullet, a number and a quote, at the item's indent", async () => {
  const { app, notes } = await openNote("列表", "  * one\n1. first\n> said");
  await keys(app, "enter", "x");
  expect(notes.read("列表")?.body).toBe("  * one\n1. first\n> said\n> x");
  await keys(app, "up", "up", "end", "enter", "y");
  expect(notes.read("列表")?.body).toBe("  * one\n1. first\n2. y\n> said\n> x");
  await keys(app, "up", "up", "end", "enter", "z");
  expect(notes.read("列表")?.body).toBe("  * one\n  * z\n1. first\n2. y\n> said\n> x");
});

test("Return is a plain line break on prose and in fenced code", async () => {
  const { app, notes } = await openNote("代码", "```\n- [ ] code\n```\nplain");
  await keys(app, "enter", "a");
  expect(notes.read("代码")?.body).toBe("```\n- [ ] code\n```\nplain\na");
  await keys(app, "up", "up", "up", "end", "enter", "b");
  expect(notes.read("代码")?.body).toBe("```\n- [ ] code\nb\n```\nplain\na");
});

test("undo after Return on a list line takes the new item back in one step", async () => {
  const { app, notes } = await openNote("撤销", "- 牛奶");
  await keys(app, "enter");
  expect(notes.read("撤销")?.body).toBe("- 牛奶\n- ");
  await keys(app, "mod+z");
  expect(notes.read("撤销")?.body).toBe("- 牛奶");
});

test("Shift-Return on a list line is a plain line break", async () => {
  const { app, notes } = await openNote("软换行", "- 牛奶");
  await keys(app, "shift+enter", "x");
  expect(notes.read("软换行")?.body).toBe("- 牛奶\nx");
});

test("⌘↩ in the text ticks the caret's to-do and unticks it again; on another line it does nothing", async () => {
  const { app, notes } = await openNote("勾选", "- [ ] 交房租\n散文");
  await keys(app, "up", "mod+enter");
  expect(notes.read("勾选")?.body).toMatch(/^- \[x\] 交房租 ✅ \d{4}-\d\d-\d\d\n散文$/);
  await keys(app, "mod+enter");
  expect(notes.read("勾选")?.body).toBe("- [ ] 交房租\n散文");
  await keys(app, "down", "mod+enter");
  expect(notes.read("勾选")?.body).toBe("- [ ] 交房租\n散文");
  await keys(app, "x");
  expect(notes.read("勾选")?.body).toBe("- [ ] 交房租\n散文x");
});

test("brackets and quotes typed in a note are one character, not a pair", async () => {
  const { app, notes } = await openNote("括号", "");
  await keys(app, "shift+9", "a", "shift+'", "[");
  expect(notes.read("括号")?.body).toBe('(a"[');
});

/** The editor's rows as the screen reads them: a label stands in its row as `￼`, and its own text is a text of its own. */
const rows = (app: Awaited<ReturnType<typeof openNote>>["app"]) => app.texts();

test("the live preview hides the Markdown off the caret and shows it where the caret is; the file stays as written", async () => {
  const body = "# 标题\n- 项目\n1. 第一\n> 引用\n**粗** 和 `码` 和 [链接](https://example.com)";
  const { app, notes } = await openNote("预览", body);
  // The caret at the end, on the link: its brackets and target show; the bold's and the code's marks hide.
  let shown = rows(app);
  for (const row of ["￼标题", "￼ 项目", "•", "1. 第一", "￼引用", "￼粗￼ 和 ￼码￼ 和 [链接](https://example.com)"]) expect(shown).toContain(row);
  // On the heading: its `# ` shows; the link's syntax hides again.
  await keys(app, "up", "up", "up", "up");
  shown = rows(app);
  for (const row of ["# 标题", "￼粗￼ 和 ￼码￼ 和 ￼链接￼"]) expect(shown).toContain(row);
  // In the bold words: both of its marks.
  await keys(app, "down", "down", "down", "down", "home", "right", "right", "right");
  expect(rows(app)).toContain("**粗** 和 ￼码￼ 和 ￼链接￼");
  await keys(app, "down");
  expect(notes.read("预览")?.body).toBe(body);
});

test("headings are large and bold, code monospaced, emphasis bold, italic or struck", async () => {
  const { app } = await openNote("样式", "# 一级\n## 二级\n### 三级\n#### 四级\n**粗** *斜* ~~删~~ `码`\n```\nfenced\n```");
  const style = (text: string) => app.spanStyle(`id:editor >> text:${text}`);
  expect([style("一级")?.fontSize, style("二级")?.fontSize, style("三级")?.fontSize, style("四级")?.fontSize]).toEqual([24, 21, 18.5, 16]);
  expect(style("一级")?.fontWeight).toBe(700);
  expect(style("四级")?.fontWeight).toBe(700);
  // A heading's row is taller with its text.
  expect(style("一级")?.lineHeight).toBeGreaterThan(26);
  expect(style("粗")?.fontWeight).toBe(700);
  expect(style("斜")?.italic).toBe(true);
  expect(style("删")?.lineThrough).toBe(true);
  expect(style("码")?.fontFamily).toBe("ui-monospace");
  expect(style("fenced")?.fontFamily).toBe("ui-monospace");
});

test("a fenced block's fences show while the caret is in it; outside, the opening one is its language's name", async () => {
  const { app } = await openNote("代码块", "```js\nlet a\n```\nafter");
  expect(rows(app)).toContain("js");
  expect(rows(app)).not.toContain("```js");
  await keys(app, "up", "up");
  expect(rows(app)).toContain("```js");
  expect(rows(app)).toContain("```");
});

test("a to-do's `- [ ]` is a drawn box: a press on it ticks it and leaves it drawn, and ticks it off again", async () => {
  const { app, notes } = await openNote("勾选框", "- [ ] 交房租\n散文");
  expect(rows(app)).toContain("￼ 交房租");
  await app.press("id:editor >> label:- [ ]");
  await app.wait(1000);
  expect(notes.read("勾选框")?.body).toMatch(/^- \[x\] 交房租 ✅ \d{4}-\d\d-\d\d\n散文$/);
  // The caret went before the words: the ticked box is still drawn.
  expect(rows(app)).toContain("✓");
  await app.press("id:editor >> label:- [x]");
  await app.wait(1000);
  expect(notes.read("勾选框")?.body).toBe("- [ ] 交房租\n散文");
});

test("while the text has no focus, everything shows rendered, the caret's line too", async () => {
  const { app } = await openNote("失焦", "- [ ] 交房租\n# 标题");
  expect(rows(app)).toContain("# 标题");
  // The reminder time picker takes the keys from the text.
  await keys(app, "up", "mod+shift+d");
  await app.waitFor("id:due-picker");
  await app.wait(300);
  expect(rows(app)).toContain("￼标题");
  expect(rows(app)).toContain("￼ 交房租");
});
