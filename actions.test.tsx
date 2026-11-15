// The row actions, headless: ⌃X moves the selected note to the system trash
// and ⌘Z takes it back while "Moved to the Trash" shows; ⌘K and a right
// click show the action panel; a note is renamed in its row. The notes that
// go to the trash are taken back before each test ends, so running them
// leaves the user's trash as it was.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";

const folder = (name: string) => `/tmp/jot-test-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const openJot = (dir: string) =>
  open("./App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: {
      "jot/native": {
        "Summon.isTrusted": true,
        "Summon.requestTrust": null,
        "Summon.onDoubleTap": null,
      },
    },
  });

/** A folder with two notes; a search narrows to one (their order in the list is the file system's mtimes). */
function twoNotes(name: string) {
  const dir = folder(name);
  const n = new Notes(dir);
  n.create("办公室 wifi", "密码在前台");
  n.create("护照到期", "明年五月");
  return dir;
}

test("⌃X moves the selected note to the trash, and ⌘Z brings it back selected", async () => {
  const dir = twoNotes("trash");
  const app = await openJot(dir);
  await app.waitFor("id:row:护照到期");
  await app.type("id:search", "护照");
  await app.waitFor("id:row:create");

  // The note is the first row of the search, selected.
  await app.keyboard.press("ctrl+x");
  await app.waitUntil(() => !app.shows("id:row:护照到期"));
  expect(new Notes(dir).read("护照到期")).toBeNull();
  expect(app.texts()).toContain("已移到废纸篓：「护照到期」");
  expect(app.shows("id:trash-undo")).toBe(true);

  await app.keyboard.press("mod+z");
  await app.waitFor("id:row:护照到期");
  expect(new Notes(dir).read("护照到期")?.body).toBe("明年五月");
  await app.waitUntil(() => !app.shows("id:trash-bar"));

  // It came back selected: ⌃X takes it again (and ⌘Z brings it back for good).
  await app.keyboard.press("ctrl+x");
  await app.waitUntil(() => !app.shows("id:row:护照到期"));
  expect(new Notes(dir).read("办公室 wifi")).not.toBeNull();
  await app.keyboard.press("mod+z");
  await app.waitFor("id:row:护照到期");
  app.dispose();
});

test("several notes trashed come back one ⌘Z at a time, the last first", async () => {
  const dir = twoNotes("stack");
  const app = await openJot(dir);
  await app.waitFor("id:row:护照到期");
  await app.type("id:search", "护照");
  await app.waitFor("id:row:create");
  await app.keyboard.press("ctrl+x");
  await app.waitUntil(() => !app.shows("id:row:护照到期"));
  await app.clear("id:search");
  await app.type("id:search", "办公室");
  await app.waitFor("id:row:办公室 wifi");
  await app.keyboard.press("ctrl+x");
  await app.waitUntil(() => !app.shows("id:row:办公室 wifi"));
  expect(app.texts()).toContain("已移到废纸篓：「办公室 wifi」等 2 条");

  await app.keyboard.press("mod+z");
  await app.waitFor("id:row:办公室 wifi");
  expect(app.shows("id:row:护照到期")).toBe(false);
  await app.press("id:trash-undo");
  await app.waitFor("id:row:护照到期");
  expect(new Notes(dir).list().length).toBe(2);
  app.dispose();
});

test("⌃X does nothing in the to-do view", async () => {
  const dir = folder("trash-todo");
  new Notes(dir).create("买菜", "- [ ] 买咖啡豆");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:买咖啡豆");

  await app.keyboard.press("ctrl+x");
  await app.wait(300);
  expect(new Notes(dir).read("买菜")).not.toBeNull();
  expect(app.shows("id:todo:买咖啡豆")).toBe(true);
  expect(app.shows("id:trash-bar")).toBe(false);
  app.dispose();
});

test("⌘K shows the selected note's actions, which typing filters; Escape closes it", async () => {
  const dir = twoNotes("actions");
  const app = await openJot(dir);
  await app.waitFor("id:row:护照到期");
  await app.type("id:search", "护照");
  await app.waitFor("id:row:create");

  await app.keyboard.press("mod+k");
  await app.waitFor("id:actions");
  for (const id of ["open", "reveal", "rename", "copy-title", "copy-body", "trash"]) expect(app.shows(`id:action:${id}`)).toBe(true);
  expect(app.texts()).toContain("移到废纸篓");

  await app.type("id:actions-filter", "复制");
  await app.waitUntil(() => !app.shows("id:action:trash"));
  expect(app.shows("id:action:copy-title")).toBe(true);
  expect(app.shows("id:action:copy-body")).toBe(true);

  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:actions"));
  // Escape closed the action panel only, not the Jot panel.
  expect(app.shows("id:search")).toBe(true);
  app.dispose();
});

test("the action panel's \"Move to Trash\" trashes the note, and Undo brings it back", async () => {
  const dir = twoNotes("actions-trash");
  const app = await openJot(dir);
  await app.waitFor("id:row:护照到期");
  await app.type("id:search", "护照");
  await app.waitFor("id:row:create");
  await app.keyboard.press("mod+k");
  await app.waitFor("id:actions");

  await app.type("id:actions-filter", "废纸篓");
  await app.waitUntil(() => !app.shows("id:action:open"));
  await app.submit("id:actions-filter");
  await app.waitUntil(() => !app.shows("id:actions") && !app.shows("id:row:护照到期"));
  expect(new Notes(dir).read("护照到期")).toBeNull();

  await app.press("id:trash-undo");
  await app.waitFor("id:row:护照到期");
  expect(new Notes(dir).read("护照到期")).not.toBeNull();
  app.dispose();
});

test("the to-do view's and the new-note row's actions have no trash", async () => {
  const dir = folder("actions-kinds");
  new Notes(dir).create("买菜", "- [ ] 买咖啡豆");
  const app = await openJot(dir);
  await app.waitFor("id:search");

  await app.type("id:search", "京都");
  await app.waitFor("id:row:create");
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:create");
  expect(app.shows("id:action:trash")).toBe(false);
  await app.keyboard.press("mod+k");
  await app.waitUntil(() => !app.shows("id:actions"));

  await app.clear("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:买咖啡豆");
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:tick");
  expect(app.shows("id:action:open-note")).toBe(true);
  expect(app.shows("id:action:trash")).toBe(false);
  app.dispose();
});

test("a right click on a row shows its actions; Rename edits the title in place", async () => {
  const dir = twoNotes("rename");
  const app = await openJot(dir);
  await app.waitFor("id:row:护照到期");

  await app.rightClick("id:row:护照到期");
  await app.waitFor("id:action:rename");
  await app.press("id:action:rename");
  await app.waitFor("id:rename");
  await app.clear("id:rename");
  await app.type("id:rename", "护照续签");
  await app.submit("id:rename");

  await app.waitFor("id:row:护照续签");
  const n = new Notes(dir);
  expect(n.read("护照到期")).toBeNull();
  expect(n.read("护照续签")?.body).toBe("明年五月");
  app.dispose();
});

test("Escape leaves a rename without changing the title", async () => {
  const dir = twoNotes("rename-cancel");
  const app = await openJot(dir);
  await app.waitFor("id:row:护照到期");
  await app.type("id:search", "护照");
  await app.waitFor("id:row:create");
  await app.keyboard.press("mod+r");
  await app.waitFor("id:rename");
  await app.type("id:rename", "不要");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:rename"));
  expect(app.shows("id:row:护照到期")).toBe(true);
  expect(app.shows("id:search")).toBe(true);
  expect(new Notes(dir).read("护照到期")).not.toBeNull();
  app.dispose();
});
