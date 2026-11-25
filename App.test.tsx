// Jot's panel, headless: a notes folder of the test's own (`jot.dir` in the
// app's storage), the real notes store (`jot/native`'s `Notes`), and the
// double press standing in as granted. The panel shows itself on the first
// run, so the tests start with the search field in front of them.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";

/** A fresh, empty notes folder. */
const folder = (name: string) => `/tmp/jot-test-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Opens Jot on `dir`, as on its first run. */
const openJot = (dir: string) =>
  open("./App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    // Jot's reference copy is Simplified Chinese; the tests read it.
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

test("typing a title and Return makes a note, which search then finds", async () => {
  const dir = folder("create");
  const app = await openJot(dir);
  await app.waitFor("id:search");

  await app.type("id:search", "京都行程");
  await app.waitFor("id:row:create");
  expect(app.texts()).toContain("新建「京都行程」");

  await app.submit("id:search");
  await app.waitFor("id:paper-title");
  expect(app.texts()).toContain("京都行程");
  expect(new Notes(dir).read("京都行程")).not.toBeNull();

  // Escape goes back to the list; the note is there, and search finds it.
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:paper"));
  await app.clear("id:search");
  await app.type("id:search", "京都");
  await app.waitFor("id:row:京都行程");
  expect(app.shows("id:row:create")).toBe(true);
  app.dispose();
});

test("a to-do ticked in the to-do view is checked in its note", async () => {
  const dir = folder("todo");
  new Notes(dir).create("买菜", "- [ ] 买咖啡豆\n- [ ] 买牛奶");
  const app = await openJot(dir);
  await app.waitFor("id:search");

  await app.type("id:search", "待办");
  await app.waitFor("id:todo:买咖啡豆");
  expect(app.texts()).toContain("没有时间");

  await app.press("id:check:买咖啡豆");
  await app.waitUntil(() => (new Notes(dir).read("买菜")?.body ?? "").includes("- [x] 买咖啡豆 ✅"));
  // Its row folds away; the other stays.
  await app.waitUntil(() => !app.shows("id:todo:买咖啡豆"));
  expect(app.shows("id:todo:买牛奶")).toBe(true);
  app.dispose();
});

test("Escape steps back: from the to-do view to the notes, then hides the panel", async () => {
  const dir = folder("escape");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "/todo");
  await app.waitFor("id:todos-empty");

  await app.keyboard.press("escape");
  await app.waitUntil(() => app.value("id:search") === "");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:search"));
  app.dispose();
});

test("only notes an AI app wrote count as its arrivals: a clipped page's or a book's source is the user's", async () => {
  const dir = folder("source");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  const notes = new Notes(dir);
  // As a web clipper and a reading note write them, from outside Jot.
  notes.create("剪藏", '---\nsource: "https://example.com/a"\n---\n正文');
  notes.create("读书", "---\nsource: 某本书\n---\n摘抄");
  await app.waitFor("id:row:剪藏");
  await app.waitFor("id:row:读书");
  expect(app.count("id:note-agent")).toBe(0);
  expect(app.texts().some((s) => s.includes("example.com") || s.includes("某本书 ·"))).toBe(false);
  // The island says nothing of them.
  expect(app.texts().some((s) => s.includes("正在记到 Jot") || s.includes("已记下"))).toBe(false);

  // One an AI app wrote is shown as its.
  notes.create("命令", "---\nsource: cursor\n---\nls -la");
  await app.waitFor("id:row:命令");
  await app.waitUntil(() => app.count("id:note-agent") === 1);
  expect(app.texts()).toContain("Cursor");
  // The island shows it (so its silence above was not for want of an island).
  await app.waitUntil(() => app.texts().some((s) => s.startsWith("Cursor · ")));
  app.dispose();
});
