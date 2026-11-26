// The list's rows with motion on (the other tests run with reduced motion).
// A step resolves once the app is quiet, so each test sees where the motion
// ends: a note moved to the trash goes at once, its row having played its
// exit (it slides left as it fades) before it left; ⌘Z drops the row back
// in, whole and selected; a note new in the folder drops in; typing filters
// the rows with nothing left fading. Headless tests read a view's opacity,
// not its transforms. The notes trashed are taken back before each test
// ends, so the user's trash stays as it was.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

const folder = (name: string) => `/tmp/jot-list-motion-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const openJot = (dir: string) =>
  open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: false,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: { "jot/native": { ...STAND_INS } },
  });

/** A folder with `titles`, the last one newest (first in the list). */
function notes(name: string, titles: string[]) {
  const dir = folder(name);
  const n = new Notes(dir);
  for (const title of titles) n.create(title, `${title} 的内容`);
  return dir;
}

type App = Awaited<ReturnType<typeof openJot>>;
const opacity = (app: App, id: string) => app.viewStyle(`id:${id}`)?.opacity;
const node = (app: App, id: string) => app.accessibility(`id:${id}`);

test("with motion, ⌃X moves the note to the trash at once and its row goes; ⌘Z drops it back in, selected", async () => {
  const dir = notes("exit", ["办公室 wifi", "护照到期"]);
  const app = await openJot(dir);
  await app.waitFor("id:row:护照到期");
  await app.type("id:search", "护照");
  await app.waitFor("id:row:create");
  const first = app.layout("id:row:护照到期")!.y;

  await app.keyboard.press("ctrl+x");
  expect(new Notes(dir).read("护照到期")).toBeNull();
  expect(app.texts()).toContain("已移到废纸篓：「护照到期」");
  await app.waitUntil(() => !app.shows("id:row:护照到期"));
  // The selection moved to the row after it, which closed the gap.
  expect(node(app, "row:create")?.selected).toBe(true);
  expect(app.layout("id:row:create")!.y).toBe(first);

  await app.keyboard.press("mod+z");
  await app.waitFor("id:row:护照到期");
  expect(new Notes(dir).read("护照到期")?.body).toBe("护照到期 的内容");
  expect(opacity(app, "row:护照到期")).toBe(1);
  expect(node(app, "row:护照到期")?.selected).toBe(true);
  expect(node(app, "row:护照到期")?.disabled).toBe(false);
  expect(app.layout("id:row:护照到期")!.y).toBeLessThan(app.layout("id:row:create")!.y);
  app.dispose();
});

test("with motion, ⌃X on note after note trashes each, the selection following, and ⌘Z brings them back the last first", async () => {
  const dir = notes("several", ["买菜", "办公室 wifi", "护照到期"]);
  const app = await openJot(dir);
  await app.waitFor("id:row:护照到期");
  expect(node(app, "row:护照到期")?.selected).toBe(true);

  await app.keyboard.press("ctrl+x");
  expect(node(app, "row:办公室 wifi")?.selected).toBe(true);
  await app.keyboard.press("ctrl+x");
  expect(new Notes(dir).list().map((m) => m.title)).toEqual(["买菜"]);
  expect(app.texts()).toContain("已移到废纸篓：「办公室 wifi」等 2 条");
  await app.waitUntil(() => !app.shows("id:row:护照到期") && !app.shows("id:row:办公室 wifi"));
  expect(node(app, "row:买菜")?.selected).toBe(true);
  expect(opacity(app, "row:买菜")).toBe(1);

  await app.keyboard.press("mod+z");
  await app.waitFor("id:row:办公室 wifi");
  expect(node(app, "row:办公室 wifi")?.selected).toBe(true);
  expect(app.shows("id:row:护照到期")).toBe(false);
  await app.keyboard.press("mod+z");
  await app.waitFor("id:row:护照到期");
  expect(node(app, "row:护照到期")?.selected).toBe(true);
  for (const id of ["row:护照到期", "row:办公室 wifi", "row:买菜"]) expect(opacity(app, id)).toBe(1);
  expect(new Notes(dir).list().length).toBe(3);
  app.dispose();
});

test("with motion, a note another program writes into the folder drops into the list", async () => {
  const dir = notes("arrive", ["办公室 wifi"]);
  const app = await openJot(dir);
  await app.waitFor("id:row:办公室 wifi");

  new Notes(dir).create("周末计划", "爬山");
  await app.waitFor("id:row:周末计划");
  expect(opacity(app, "row:周末计划")).toBe(1);
  expect(opacity(app, "row:办公室 wifi")).toBe(1);
  expect(app.layout("id:row:周末计划")!.y).toBeLessThan(app.layout("id:row:办公室 wifi")!.y);
  app.dispose();
});

test("with motion, typing filters the rows at once, with nothing left fading", async () => {
  const dir = notes("typing", ["办公室 wifi", "护照到期"]);
  const app = await openJot(dir);
  await app.waitFor("id:row:护照到期");

  await app.type("id:search", "护照");
  expect(app.shows("id:row:办公室 wifi")).toBe(false);
  expect(opacity(app, "row:护照到期")).toBe(1);
  expect(opacity(app, "row:create")).toBe(1);
  expect(node(app, "row:护照到期")?.disabled).toBe(false);

  await app.clear("id:search");
  expect(app.shows("id:row:办公室 wifi")).toBe(true);
  expect(app.shows("id:row:create")).toBe(false);
  expect(opacity(app, "row:办公室 wifi")).toBe(1);
  expect(opacity(app, "row:护照到期")).toBe(1);
  app.dispose();
});
