// Links between notes, headless: `[[Title]]` in the open note draws as its
// title in the link colour (one to no note muted and underlined); ⌘↩ with
// the caret in it and "Open Link" open the note, making one that is not
// there (a ⌘-click does too, but the headless runner presses only what is
// drawn, and a link's brackets are hidden); typing `[[` lists the notes'
// titles, filtered as the title is typed, and Return or Tab puts one in with
// its `]]`; renaming a note points the links to it at the new title, but in
// a locked note, which the open note's foot says.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

const MODULES = { "jot/native": { ...STAND_INS } };

type App = Awaited<ReturnType<typeof open>>;

/** Jot on a fresh folder holding `others` (title → body) and the note `title`, which is opened, the caret at its end. */
async function openNote(title: string, body: string, others: Record<string, string> = {}) {
  const dir = `/tmp/jot-links-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const notes = new Notes(dir);
  for (const [other, text] of Object.entries(others)) notes.create(other, text);
  notes.create(title, body);
  const app = await open("../App.tsx", { platform: "macos", width: 1200, height: 800, reducedMotion: true, locale: "zh-CN", storage: { "jot.dir": dir }, modules: MODULES });
  await app.waitFor("id:search");
  await app.type("id:search", title);
  await app.submit("id:search");
  await app.waitFor("id:paper");
  await app.wait(500);
  await app.keyboard.press("mod+down");
  return { app, notes, dir };
}

/** Types `keys`, one keystroke each, and waits for the save. */
async function keys(app: App, ...pressed: string[]) {
  for (const key of pressed) await app.keyboard.press(key);
  await app.wait(1000);
}

/** The open note's title, as its header shows it. */
const openTitle = (app: App) => app.accessibility("id:paper-title")?.name;

test("a link shows its title, or its words, in the link colour; one to no note is muted and underlined", async () => {
  const { app, notes } = await openNote("日记", "见 [[计划]] 和 [[没有|这个]]\n结尾", { 计划: "要做的事" });
  expect(app.texts()).toContain("见 ￼计划￼ 和 ￼这个￼");
  const style = (text: string) => app.spanStyle(`id:editor >> text:${text}`);
  expect(style("计划")?.underline).toBeFalsy();
  expect(style("这个")?.underline).toBe(true);
  expect(style("计划")?.color).not.toBe(style("这个")?.color);
  // The caret at the first link's start: it shows as written, the other one not; the file never changed.
  await keys(app, "up");
  expect(app.texts()).toContain("见 [[计划]] 和 ￼这个￼");
  expect(notes.read("日记")?.body).toBe("见 [[计划]] 和 [[没有|这个]]\n结尾");
  app.dispose();
});

test("⌘↩ with the caret in a link opens its note; beside it, ⌘↩ ticks the to-do as ever", async () => {
  const { app, notes } = await openNote("清单", "- [ ] 问 [[小王]]", { 小王: "电话 123" });
  // At the line's end, after the `]]`: the to-do ticks.
  await keys(app, "mod+enter");
  expect(notes.read("清单")?.body).toMatch(/^- \[x\] 问 \[\[小王\]\] ✅/);
  await keys(app, "mod+enter");
  expect(notes.read("清单")?.body).toBe("- [ ] 问 [[小王]]");
  // In the link: its note opens.
  await keys(app, "left", "left", "left");
  await keys(app, "mod+enter");
  await app.waitUntil(() => openTitle(app) === "小王");
  expect(notes.read("清单")?.body).toBe("- [ ] 问 [[小王]]");
  app.dispose();
});

test("\"Open Link\" in ⌘K makes the note a link names when there is none, and opens it", async () => {
  const { app, notes } = await openNote("想法", "[[新的想法]]");
  await keys(app, "left", "left", "left");
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:open-link");
  await app.press("id:action:open-link");
  await app.waitUntil(() => openTitle(app) === "新的想法");
  expect(notes.read("新的想法")?.body).toBe("");
  app.dispose();
});

test("typing `[[` lists the notes' titles; typing on filters them, a space too; Tab or Return puts one in with its `]]`", async () => {
  const { app, notes } = await openNote("Draft", "", { "Project plan": "a", "Project review": "b", Shopping: "c" });
  await keys(app, "[", "[");
  for (const title of ["Project plan", "Project review", "Shopping"]) expect(app.shows(`text:${title}`)).toBe(true);
  // Not the open note itself.
  expect(app.shows("id:editor >> text:Draft")).toBe(false);
  await keys(app, "p", "r", "o");
  expect(app.shows("text:Shopping")).toBe(false);
  expect(app.shows("text:Project plan")).toBe(true);
  // A title of several words: the list comes back after the space, narrowed by every word typed.
  await keys(app, "space", "v");
  await app.waitUntil(() => app.shows("text:Project review"));
  expect(app.shows("text:Project plan")).toBe(false);
  await keys(app, "tab");
  expect(notes.read("Draft")?.body).toBe("[[Project review]]");
  // Return on a list line takes the suggestion, not the list's next item.
  await keys(app, "enter", "-", "space", "[", "[", "s", "h");
  await app.waitUntil(() => app.shows("text:Shopping"));
  await keys(app, "enter");
  expect(notes.read("Draft")?.body).toBe("[[Project review]]\n- [[Shopping]]");
  app.dispose();
});

test("Escape closes the suggestions and leaves the note open; in fenced code `[[` lists nothing", async () => {
  const { app, notes } = await openNote("Code", "```\n\n```", { Other: "x" });
  await keys(app, "up", "[", "[");
  expect(app.shows("text:Other")).toBe(false);
  await keys(app, "down", "end", "enter", "[", "[");
  await app.waitUntil(() => app.shows("text:Other"));
  await keys(app, "escape");
  expect(app.shows("text:Other")).toBe(false);
  expect(openTitle(app)).toBe("Code");
  expect(notes.read("Code")?.body).toBe("```\n[[\n```\n[[");
  app.dispose();
});

test("renaming a note points the links to it at the new title; a locked note's keep the old one, which the note's foot says", async () => {
  const { app, notes, dir } = await openNote("计划", "本周", { 日记: "看 [[计划]] 和 [[计划|它]]\n", 合同: "[[计划]]" });
  notes.lock("合同");
  await app.wait(500);
  await app.press("id:paper-title-edit");
  await app.waitFor("id:rename");
  await app.clear("id:rename");
  await app.type("id:rename", "路线图");
  await app.submit("id:rename");
  await app.waitUntil(() => openTitle(app) === "路线图");
  const after = new Notes(dir);
  expect(after.read("日记")?.body).toBe("看 [[路线图]] 和 [[路线图|它]]\n");
  expect(after.read("合同")?.body).toBe("[[计划]]");
  // The footer is not shown with a note open: the note's foot says it.
  await app.waitFor("id:paper-notice");
  expect(app.texts()).toContain("锁定笔记里的 1 个链接仍用旧标题");
  notes.unlock("合同");
  app.dispose();
});

test("renamed from the list, the footer says how many links took the new title", async () => {
  const dir = `/tmp/jot-links-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const notes = new Notes(dir);
  notes.create("日记", "[[护照]] 和 [[护照|它]]");
  notes.create("护照", "明年五月");
  const app = await open("../App.tsx", { platform: "macos", width: 1200, height: 800, reducedMotion: true, locale: "zh-CN", storage: { "jot.dir": dir }, modules: MODULES });
  await app.waitFor("id:row:护照");
  await app.rightClick("id:row:护照");
  await app.waitFor("id:action:rename");
  await app.press("id:action:rename");
  await app.waitFor("id:rename");
  await app.clear("id:rename");
  await app.type("id:rename", "护照续签");
  await app.submit("id:rename");
  await app.waitFor("id:footer-status");
  expect(app.texts()).toContain("已更新 2 个指向「护照续签」的链接");
  expect(notes.read("日记")?.body).toBe("[[护照续签]] 和 [[护照续签|它]]");
  app.dispose();
});
