// The list past its first rows, headless: it shows `T.size.listRows` notes
// and scrolls to the rest. The arrow keys go through every note, keeping the
// selected one in view; a new search starts at the top; with a note open the
// sidebar holds the same notes and scrolls too.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

const COUNT = 10;

async function openJot(count = COUNT) {
  const dir = `/tmp/jot-list-scroll-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const n = new Notes(dir);
  for (let i = 0; i < count; i++) n.create(`note ${i}`, `body ${i}`);
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: { "jot/native": { ...STAND_INS } },
  });
  await app.waitFor("id:search");
  return app;
}

type App = Awaited<ReturnType<typeof openJot>>;

/** The note rows top to bottom, whatever order the notes' times put them in. */
function rowsInOrder(app: App, count = COUNT) {
  return Array.from({ length: count }, (_, i) => `note ${i}`)
    .map((title) => ({ title, layout: app.layout(`id:row:${title}`)! }))
    .sort((a, b) => a.layout.y - b.layout.y);
}

/** Whether the row `title` shows whole in the list (not cut by the scroll view). */
const shown = (app: App, title: string) => {
  const l = app.layout(`id:row:${title}`);
  return l !== null && !l.clipped;
};

test("the list holds every note, shows six and scrolls to the rest with the arrow keys", async () => {
  const app = await openJot();
  await app.waitFor("id:row:note 0");
  const order = rowsInOrder(app).map((r) => r.title);
  expect(order.length).toBe(COUNT);
  // Six rows show; the panel does not grow past them.
  expect(order.slice(0, 6).every((t) => shown(app, t))).toBe(true);
  expect(shown(app, order[7])).toBe(false);
  const height = app.layout("id:panel")!.height;

  // Down to the eighth note: it scrolls into view, the first leaves it.
  for (let i = 0; i < 7; i++) await app.keyboard.press("down");
  expect(shown(app, order[7])).toBe(true);
  expect(shown(app, order[0])).toBe(false);
  expect(app.layout("id:panel")!.height).toBe(height);

  // On to the last, then round to the first: back at the top.
  for (let i = 0; i < 2; i++) await app.keyboard.press("down");
  expect(shown(app, order[COUNT - 1])).toBe(true);
  await app.keyboard.press("down");
  expect(shown(app, order[0])).toBe(true);
  // Up from the first wraps to the last, which scrolls into view.
  await app.keyboard.press("up");
  expect(shown(app, order[COUNT - 1])).toBe(true);

  // Return opens the selected (last) note.
  await app.keyboard.press("enter");
  await app.waitFor("id:paper");
  expect(app.texts()).toContain(order[COUNT - 1]);
  app.dispose();
});

test("a new search starts at the top of the list", async () => {
  const app = await openJot();
  await app.waitFor("id:row:note 0");
  const order = rowsInOrder(app).map((r) => r.title);
  for (let i = 0; i < 8; i++) await app.keyboard.press("down");
  expect(shown(app, order[0])).toBe(false);
  // Every note matches "note": the list starts over at its first row.
  await app.type("id:search", "note");
  await app.wait(100);
  const found = rowsInOrder(app);
  expect(shown(app, found[0].title)).toBe(true);
  app.dispose();
});

test("with a note open, the sidebar holds every note and scrolls", async () => {
  // More than the sidebar's height holds.
  const count = 16;
  const app = await openJot(count);
  await app.waitFor("id:row:note 0");
  const order = rowsInOrder(app, count).map((r) => r.title);
  await app.keyboard.press("enter");
  await app.waitFor("id:paper");
  const last = order[count - 1];
  expect(app.layout(`id:row:${last}`)).not.toBeNull();
  expect(shown(app, last)).toBe(false);
  await app.scroll("id:notes-scroll", 400);
  expect(shown(app, last)).toBe(true);
  app.dispose();
});
