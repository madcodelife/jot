// A note's version history in the panel, headless: "版本历史…" in ⌘K lists the
// note's earlier versions, newest first, with what differs from it now; the
// selected one shows read-only beside them; "恢复此版本" (or Return) puts it
// back, its text now kept first; in the open note that is one edit ⌘Z takes
// back. A locked note's history can be read, not restored. The history is a
// folder of the test's own (`VersionHistory.path`).
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { versionHint } from "../history";
import { hm, versionTime } from "../time";
import { STAND_INS } from "./native";

/** The note's three texts: two versions, and the text it has. */
const FIRST = "第一版\n共同的一行";
const SECOND = "第二版\n共同的一行";
const THIRD = "第三版\n共同的一行";

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** A notes folder and a history beside it, with the note "计划": versions "第一版" and "第二版", its text "第三版". */
function setup(name: string) {
  const base = `/tmp/jot-history-${name}-${unique()}`;
  const dir = `${base}/Jot`;
  const history = `${base}/History`;
  const n = new Notes(dir);
  n.keepHistory(history);
  n.create("计划", FIRST);
  // The first change keeps the text before it; a version kept now keeps the second; the third is the note's.
  n.write("计划", SECOND);
  n.saveVersion("计划");
  n.write("计划", THIRD);
  const notes = () => {
    const again = new Notes(dir);
    again.keepHistory(history);
    return again;
  };
  return { dir, history, notes, body: () => notes().read("计划")?.body };
}

const openJot = (dir: string, history: string) =>
  open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: { "jot/native": { ...STAND_INS, "VersionHistory.path": history } },
  });

type App = Awaited<ReturnType<typeof openJot>>;

/** The text the history shows for the selected version. */
const shown = (app: App, body: string) => app.texts().includes(body);

/** ⌘K → "版本历史…" on the note in focus. */
async function openHistory(app: App) {
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:history");
  await app.press("id:action:history");
  await app.waitFor("id:history");
}

/** Searches for the note and selects its row. */
async function find(app: App, title: string) {
  await app.waitFor("id:search");
  await app.type("id:search", title);
  await app.waitFor(`id:row:${title}`);
}

// Outside the app the words are English.
test("the hint says what a version has that the note no longer has, else how it differs", () => {
  expect(versionHint("a\nb", "a\nb")).toBe("Same as now");
  expect(versionHint("a\nold line\nb", "a\nb")).toBe("old line");
  expect(versionHint("a", "a\nb\nc")).toBe("2 lines fewer than now");
  expect(versionHint("a\n\n  b", "a\nb")).toBe("Only the spacing differs");
  // A line written twice counts twice.
  expect(versionHint("x\nx", "x")).toBe("x");
});

test("a version's time says the day and the minute", () => {
  const now = new Date(2026, 10, 28, 15, 0).getTime();
  const today = new Date(2026, 10, 28, 14, 30);
  const yesterday = new Date(2026, 10, 27, 9, 5);
  expect(versionTime(today.getTime(), now)).toBe(`Today ${hm(today)}`);
  expect(versionTime(yesterday.getTime(), now)).toBe(`Yesterday ${hm(yesterday)}`);
  expect(versionTime(new Date(2025, 2, 2, 9, 5).getTime(), now)).toMatch(/2025/);
});

test("⌘K shows the note's versions newest first, the selected one's text beside them; Escape goes back to the list", async () => {
  const { dir, history } = setup("list");
  const app = await openJot(dir, history);
  await find(app, "计划");
  await openHistory(app);
  expect(app.texts()).toContain("版本历史");
  // Newest first, each with what it has that the note no longer has.
  await app.waitFor("id:version:1");
  expect(app.shows("id:version:2")).toBe(false);
  expect(app.texts().filter((s) => s === "第二版" || s === "第一版")).toEqual(["第二版", "第一版"]);
  expect(shown(app, SECOND)).toBe(true);

  // ↓ selects the older one; a press selects too.
  await app.keyboard.press("down");
  await app.waitUntil(() => shown(app, FIRST));
  await app.press("id:version:0");
  await app.waitUntil(() => shown(app, SECOND));

  await app.keyboard.press("escape");
  await app.waitFor("id:history", { state: "gone" });
  expect(app.shows("id:row:计划")).toBe(true);
  expect(app.shows("id:footer")).toBe(true);
  app.dispose();
});

test("Return restores the selected version from the list: the text it replaces goes to the history first", async () => {
  const { dir, history, notes, body } = setup("restore");
  const app = await openJot(dir, history);
  await find(app, "计划");
  await openHistory(app);
  await app.keyboard.press("down");
  await app.waitUntil(() => shown(app, FIRST));
  await app.keyboard.press("enter");
  await app.waitFor("id:history", { state: "gone" });
  await app.waitUntil(() => body() === FIRST);
  expect(app.texts().some((s) => /^已恢复 今天 .+ 的版本$/.test(s))).toBe(true);
  // The text it had is the newest version now.
  expect(notes().versions("计划").map((v) => v.body)).toEqual([THIRD, SECOND, FIRST]);
  app.dispose();
});

test("in the open note, restoring is one edit: ⌘Z takes it back", async () => {
  const { dir, history, body } = setup("editor");
  const app = await openJot(dir, history);
  await find(app, "计划");
  await app.submit("id:search");
  await app.waitFor("id:editor");
  await app.wait(300);
  await openHistory(app);
  // The open note stays under the history, hidden.
  await app.press("id:version:1");
  await app.waitUntil(() => shown(app, FIRST));
  await app.press("id:history-restore");
  await app.waitFor("id:history", { state: "gone" });
  await app.waitUntil(() => body() === FIRST);
  expect(app.shows("id:editor >> text:第一版")).toBe(true);

  // The keys are the note's again: one undo, and the text before the restore is back.
  await app.keyboard.press("mod+z");
  await app.waitUntil(() => body() === THIRD);
  app.dispose();
});

test("a locked note's history can be read, but restoring waits for it to be unlocked", async () => {
  const { dir, history, notes, body } = setup("locked");
  notes().lock("计划");
  const app = await openJot(dir, history);
  await find(app, "计划");
  await openHistory(app);
  await app.waitFor("id:history-locked");
  expect(app.texts()).toContain("解锁笔记后才能恢复");
  expect(shown(app, SECOND)).toBe(true);
  // The button is disabled (the harness refuses to press it), and Return does nothing.
  let refused = false;
  await app.press("id:history-restore").catch(() => {
    refused = true;
  });
  expect(refused).toBe(true);
  await app.keyboard.press("enter");
  await app.wait(200);
  expect(app.shows("id:history")).toBe(true);
  expect(body()).toBe(THIRD);
  app.dispose();
  notes().unlock("计划");
});

test("a note with no earlier versions says so", async () => {
  const base = `/tmp/jot-history-none-${unique()}`;
  new Notes(`${base}/Jot`).create("新笔记", "刚写");
  const app = await openJot(`${base}/Jot`, `${base}/History`);
  await find(app, "新笔记");
  await openHistory(app);
  await app.waitFor("id:history-empty");
  expect(app.texts()).toContain("还没有更早的版本");
  expect(app.shows("id:history-restore")).toBe(false);
  app.dispose();
});
