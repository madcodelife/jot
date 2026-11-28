// Pinned notes, headless: ⌘K → "置顶" (or ⇧⌘P) pins a note, which then leads
// the recent list in a "置顶" section under today's card, newest first, each
// row with a small pin; "取消置顶" puts it back among the date groups. The
// pin is `pinned: true` in the note's frontmatter, its modification time
// kept. A search ranks a pinned note as any other (it keeps its pin), and a
// locked note offers neither "置顶" nor "取消置顶". The list holds pinned
// notes however old.
//
// Each test unlocks its notes before it ends: a locked file (the system's flag)
// could not be deleted with its temporary folder otherwise.
import { expect, open, test } from "nsh/test";
import { Notes, type NoteMeta } from "jot/native";
import type { ListRow } from "../store";
import { listItems } from "../ui/NoteList";
import { STAND_INS } from "./native";

const DAY = 86_400_000;

const folder = (name: string) => `/tmp/jot-pin-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Opens Jot on `dir`; `later` moves the app's clock that far past the notes' times. */
const openJot = async (dir: string, later = 0) => {
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: { "jot/native": { ...STAND_INS } },
    ...(later ? { clock: { time: Date.now() + later } } : {}),
  });
  await app.waitFor("id:search");
  return app;
};

type App = Awaited<ReturnType<typeof openJot>>;

/** The top of each of these, in the panel. */
const tops = (app: App, ids: string[]) => ids.map((id) => app.layout(`id:${id}`)?.y ?? Number.NaN);

/** Whether `ids` are laid out top to bottom in this order. */
function inOrder(app: App, ids: string[]): boolean {
  const ys = tops(app, ids);
  return ys.every((y, i) => !Number.isNaN(y) && (i === 0 || y > ys[i - 1]));
}

/** Unlocks every note of the folder, so it can be deleted. */
function unlockAll(dir: string) {
  const n = new Notes(dir);
  for (const m of n.list()) if (m.locked) n.unlock(m.title);
}

test("⌘K pins a note: it leads the list under today's card, in a section of its own, with a pin; Unpin puts it back", async () => {
  const dir = folder("actions");
  const n = new Notes(dir);
  n.create("路由器", "密码在背面");
  n.create("账单", "- [ ] 交电费 ⏰ 2020-01-01 09:00");
  n.create("购物清单", "牛奶");
  const modified = n.read("路由器")!.meta.modified;
  const app = await openJot(dir);
  await app.waitFor("id:row:路由器");
  expect(app.shows("id:day:pinned")).toBe(false);
  expect(inOrder(app, ["row:summary", "day:today", "row:购物清单", "row:账单", "row:路由器"])).toBe(true);

  await app.rightClick("id:row:路由器");
  await app.waitFor("id:action:pin");
  expect(app.shows("id:action:unpin")).toBe(false);
  expect(app.texts()).toContain("置顶");
  await app.press("id:action:pin");
  await app.waitFor("id:day:pinned");
  expect(app.texts()).toContain("已置顶「路由器」");

  // In the file: `pinned: true`, the body and the modification time as they were.
  const meta = new Notes(dir).read("路由器")!;
  expect(meta.meta.pinned).toBe(true);
  expect(meta.body).toBe("密码在背面");
  expect(meta.meta.modified).toBe(modified);

  // Today's card first, then the pinned section, then the date groups; the pin in its row, and only there.
  expect(inOrder(app, ["row:summary", "day:pinned", "row:路由器", "day:today", "row:购物清单", "row:账单"])).toBe(true);
  expect(app.spanStyle("id:day:pinned >> text:置顶").fontSize).toBe(11);
  expect(app.shows("id:row:路由器 >> id:note-pinned")).toBe(true);
  expect(app.accessibility("id:row:路由器 >> id:note-pinned")?.label).toBe("已置顶");
  expect(app.shows("id:row:购物清单 >> id:note-pinned")).toBe(false);
  // The selection followed the note to its place.
  expect(app.accessibility("id:row:路由器")?.selected).toBe(true);

  // Unpinned: the frontmatter goes, and the note goes back to its day.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:unpin");
  expect(app.shows("id:action:pin")).toBe(false);
  await app.press("id:action:unpin");
  await app.waitUntil(() => !app.shows("id:day:pinned"));
  expect(app.texts()).toContain("已取消置顶「路由器」");
  expect(new Notes(dir).read("路由器")?.meta.pinned).toBe(false);
  expect(new Notes(dir).read("路由器")?.meta.modified).toBe(modified);
  expect(app.shows("id:row:路由器 >> id:note-pinned")).toBe(false);
  expect(inOrder(app, ["row:summary", "day:today", "row:购物清单", "row:账单", "row:路由器"])).toBe(true);
  app.dispose();
});

test("⇧⌘P pins the selected note, and the open one; pinned notes come newest first", async () => {
  const dir = folder("keys");
  const n = new Notes(dir);
  n.create("一号", "a");
  n.create("二号", "b");
  n.create("三号", "c");
  n.pin("一号");
  const app = await openJot(dir);
  await app.waitFor("id:day:pinned");
  // Down to the last row, 二号 (一号 is pinned, at the top), and pinned with its key.
  await app.keyboard.press("down");
  await app.keyboard.press("down");
  await app.waitUntil(() => app.accessibility("id:row:二号")?.selected === true);
  await app.keyboard.press("mod+shift+p");
  await app.waitUntil(() => new Notes(dir).read("二号")?.meta.pinned === true);
  // Among the pinned, the newest first.
  await app.waitUntil(() => inOrder(app, ["day:pinned", "row:二号", "row:一号", "day:today", "row:三号"]));

  // The open note: ⌘K offers it, and the same key unpins it.
  await app.press("id:row:二号");
  await app.waitFor("id:paper");
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:unpin");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:actions"));
  expect(app.shows("id:row:二号 >> id:note-pinned")).toBe(true);
  await app.keyboard.press("mod+shift+p");
  await app.waitUntil(() => new Notes(dir).read("二号")?.meta.pinned === false);
  await app.waitUntil(() => !app.shows("id:row:二号 >> id:note-pinned"));
  // Still open, and its text as it was.
  expect(app.shows("id:paper")).toBe(true);
  expect(new Notes(dir).read("二号")?.body).toBe("b");
  app.dispose();
});

test("a pinned note's time names its day, as the pinned section's header names none", async () => {
  const dir = folder("time");
  const n = new Notes(dir);
  n.create("路由器", "x");
  n.create("购物清单", "y");
  n.pin("路由器");
  const app = await openJot(dir, DAY);
  await app.waitFor("id:day:yesterday");
  // "昨天" twice: the date group's header (its note's time the clock alone) and the pinned note's time.
  expect(app.texts().filter((s) => s === "昨天").length).toBe(2);
  expect(app.shows("id:row:路由器 >> text:昨天")).toBe(true);
  expect(app.texts().some((s) => /^\d{1,2}:\d{2}$/.test(s))).toBe(true);
  app.dispose();
});

test("a search gives a pinned note no boost, but shows its pin", async () => {
  const dir = folder("search");
  const n = new Notes(dir);
  n.create("周报 一月", "x");
  n.create("周报 二月", "y");
  n.pin("周报 一月");
  const app = await openJot(dir);
  await app.waitFor("id:day:pinned");
  await app.type("id:search", "周报");
  await app.waitFor("id:row:create");
  expect(app.shows("id:day:pinned")).toBe(false);
  // The newer note first, as without a pin.
  expect(inOrder(app, ["row:周报 二月", "row:周报 一月"])).toBe(true);
  expect(app.shows("id:row:周报 一月 >> id:note-pinned")).toBe(true);
  expect(app.shows("id:row:周报 二月 >> id:note-pinned")).toBe(false);
  app.dispose();
});

test("a locked note offers no Pin or Unpin, and a pinned note locked stays pinned", async () => {
  const dir = folder("locked");
  const n = new Notes(dir);
  n.create("合同", "第三条");
  n.create("护照", "E123");
  n.lock("合同");
  n.pin("护照");
  n.lock("护照");
  const before = new Notes(dir).read("合同");
  const app = await openJot(dir);
  await app.waitFor("id:row:护照 >> id:note-pinned");
  expect(app.shows("id:row:护照 >> id:note-locked")).toBe(true);
  expect(app.shows("id:day:pinned")).toBe(true);

  for (const title of ["合同", "护照"]) {
    await app.rightClick(`id:row:${title}`);
    await app.waitFor("id:action:unlock");
    expect(app.shows("id:action:pin")).toBe(false);
    expect(app.shows("id:action:unpin")).toBe(false);
    await app.keyboard.press("escape");
    await app.waitUntil(() => !app.shows("id:actions"));
  }

  // Its key does nothing either.
  await app.rightClick("id:row:合同");
  await app.waitFor("id:action:unlock");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:actions"));
  await app.keyboard.press("mod+shift+p");
  await app.wait(300);
  expect(new Notes(dir).read("合同")).toEqual(before);
  expect(app.shows("id:notice")).toBe(false);
  app.dispose();
  unlockAll(dir);
});

test("the list holds the pinned notes however old, and the latest others up to a hundred", async () => {
  const dir = folder("limit");
  const n = new Notes(dir);
  n.create("最早的", "x");
  for (let i = 0; i < 105; i++) n.create(`笔记 ${i}`, "x");
  n.pin("最早的");
  const app = await openJot(dir);
  await app.waitFor("id:row:最早的");
  expect(app.count("id:note-title")).toBe(100);
  expect(app.shows("id:row:笔记 104")).toBe(true);
  expect(app.shows("id:row:笔记 5")).toBe(false);
  app.dispose();
});

const noteRow = (title: string, modified: number, index: number, pinned = false): ListRow => ({
  row: { kind: "note", meta: { title, modified, source: null, preview: "", downloading: false, locked: false, icon: null, pinned } as NoteMeta, snippet: "", terms: [] },
  index,
  leaving: false,
});

test("the list's items: the pinned notes' header before them, then the date groups; none with a query", () => {
  const now = new Date(2026, 10, 26, 15, 0).getTime();
  const rows: ListRow[] = [
    { row: { kind: "summary" }, index: 0, leaving: false },
    noteRow("p1", now - 60_000, 1, true),
    noteRow("p2", now - 40 * DAY, 2, true),
    noteRow("a", now - 3_600_000, 3),
    noteRow("b", now - 1.2 * DAY, 4),
  ];
  const shape = listItems(rows, true, now, 1).map((i) => (i.kind === "day" ? `[${i.group}@${i.next}]` : i.item.row.kind === "note" ? i.item.row.meta.title : i.item.row.kind));
  expect(shape).toEqual(["summary", "[pinned@1]", "p1", "p2", "[today@3]", "a", "[yesterday@4]", "b"]);
  expect(listItems(rows, false, now, 1).every((i) => i.kind === "row")).toBe(true);
});
