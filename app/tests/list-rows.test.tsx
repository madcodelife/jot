// The list's rows, headless: a semibold title with its time in the same line
// and the snippet under it, the selected row on a light accent fill (not a
// solid one) with its title in the accent's ink, today's to-dos as a card
// with a progress ring, and the recent list in date groups whose headers
// the keys and the pointer pass over. The app runs on a manual clock to see
// the notes a day or a month later; the date groups' edges (the week's
// start) are checked on the functions that draw them.
import { expect, open, test } from "nsh/test";
import { Notes, type NoteMeta } from "jot/native";
import type { ListRow } from "../store";
import { dayGroup } from "../time";
import { listItems } from "../ui/NoteList";
import { themeVars } from "../ui/themes";
import { STAND_INS } from "./native";

const DAY = 86_400_000;

const folder = (name: string) => `/tmp/jot-list-rows-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Opens Jot on `dir`; `later` moves the app's clock that far past the notes' times. */
async function openJot(dir: string, later = 0) {
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
}

type App = Awaited<ReturnType<typeof openJot>>;

const light = themeVars("default").cssVars.light as Record<string, string>;
/** A theme color as the app reports it: `#rrggbbaa`. */
const color = (name: string) => (light[name].length === 7 ? `${light[name]}ff` : light[name]);
const alpha = (rgba: string | null | undefined) => Number.parseInt((rgba ?? "#00000000").slice(7, 9), 16);
const selectedOf = (app: App, id: string) => app.accessibility(`id:${id}`)?.selected ?? false;

const pad = (n: number) => String(n).padStart(2, "0");
const written = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

test("a note's row: a semibold title with its time in the same line, the snippet across the row under them", async () => {
  const dir = folder("layout");
  new Notes(dir).create("周末聚餐", "周六晚上七点，带一瓶酒");
  const app = await openJot(dir);
  await app.waitFor("id:row:周末聚餐");
  const title = app.layout("id:row:周末聚餐 >> id:note-title")!;
  const time = app.layout("id:row:周末聚餐 >> id:note-time")!;
  const snippet = app.layout("id:row:周末聚餐 >> id:note-snippet")!;
  const row = app.layout("id:row:周末聚餐")!;
  expect(app.spanStyle("id:row:周末聚餐 >> id:note-title >> text:周末聚餐").fontWeight).toBeGreaterThanOrEqual(600);
  // The time sits in the title's line, at its end.
  expect(Math.abs(time.y + time.height / 2 - (title.y + title.height / 2))).toBeLessThan(3);
  expect(time.x).toBeGreaterThan(title.x);
  // The snippet is under them and reaches past where the time starts: nothing sits beside it.
  expect(snippet.y).toBeGreaterThan(title.y + title.height - 1);
  expect(snippet.x + snippet.width).toBeGreaterThan(time.x);
  expect(row.height).toBe(52);
  app.dispose();
});

test("the selected row has a light accent fill, its title in the accent's ink; the others and the snippet keep their colors", async () => {
  const dir = folder("selected");
  const n = new Notes(dir);
  n.create("购物清单", "牛奶、鸡蛋");
  n.create("周末聚餐", "周六晚上七点");
  const app = await openJot(dir);
  await app.waitFor("id:row:购物清单");
  // The latest note is first, and selected.
  expect(selectedOf(app, "row:周末聚餐")).toBe(true);
  const fill = app.viewStyle("id:row:周末聚餐")?.backgroundColor;
  // Not the solid accent: the accent's hue, well under half its strength.
  expect(fill?.slice(0, 7)).toBe(color("primary").slice(0, 7));
  expect(alpha(fill)).toBeGreaterThan(0);
  expect(alpha(fill)).toBeLessThan(0x40);
  expect(app.spanStyle("id:row:周末聚餐 >> id:note-title >> text:周末聚餐").color).toBe(color("selected-ink"));
  expect(app.spanStyle("id:row:周末聚餐 >> id:note-snippet >> text:周六晚上七点").color).toBe(color("selected-muted"));
  expect(app.spanStyle("id:row:购物清单 >> id:note-title >> text:购物清单").color).toBe(color("glass-fg"));
  expect(alpha(app.viewStyle("id:row:购物清单")?.backgroundColor)).toBe(0);

  // The sidebar beside an open note: the same light fill.
  await app.keyboard.press("enter");
  await app.waitFor("id:paper");
  expect(alpha(app.viewStyle("id:row:周末聚餐")?.backgroundColor)).toBeLessThan(0x40);
  expect(app.spanStyle("id:row:周末聚餐 >> id:note-title >> text:周末聚餐").color).toBe(color("selected-ink"));
  app.dispose();
});

test("an AI app's note shows the app with a dot in the agents' colors, in the title's line", async () => {
  const dir = folder("agent");
  new Notes(dir).create("命令", "---\nsource: cursor\n---\nls -la");
  const app = await openJot(dir);
  await app.waitFor("id:row:命令 >> id:note-agent");
  // The only row, selected: the agents' ink as it reads on the fill.
  expect(app.spanStyle("id:row:命令 >> id:note-agent >> text:Cursor").color).toBe(color("selected-agent"));
  const agent = app.layout("id:row:命令 >> id:note-agent")!;
  const title = app.layout("id:row:命令 >> id:note-title")!;
  expect(Math.abs(agent.y + agent.height / 2 - (title.y + title.height / 2))).toBeLessThan(3);
  app.dispose();
});

test("today's to-dos are a card: what is overdue in red, a ring of how many are done with the number left", async () => {
  const dir = folder("card");
  const soon = new Date(Date.now() + 3_600_000);
  // Past midnight the hour ahead is tomorrow's: keep it today.
  const at = soon.getDate() === new Date().getDate() ? soon : new Date(new Date().setHours(23, 59, 0, 0));
  new Notes(dir).create("今天", `- [ ] 交电费 ⏰ 2020-01-01 09:00\n- [ ] 寄快递 ⏰ ${written(at)}\n- [x] 买牛奶 ⏰ ${written(new Date(new Date().setHours(0, 0, 0, 0)))}`);
  const app = await openJot(dir);
  await app.waitFor("id:row:summary");
  expect(app.spanStyle("id:row:summary >> id:summary-late").color).toBe(color("selected-late"));
  expect(app.accessibility("id:summary-ring")?.label).toBe("今天 2 件，做完 1 件");
  expect(app.texts()).toContain("1");
  // A hairline around it, and room under it before the first note.
  const card = app.layout("id:row:summary")!;
  const header = app.layout("id:day:today")!;
  expect(header.y).toBeGreaterThan(card.y + card.height);
  app.dispose();
});

test("the recent list falls into date groups; a search, and the sidebar, do not", async () => {
  const dir = folder("groups");
  const n = new Notes(dir);
  n.create("账单", "- [ ] 交电费 ⏰ 2020-01-01 09:00");
  n.create("购物清单", "牛奶");
  let app = await openJot(dir);
  await app.waitFor("id:row:购物清单");
  expect(app.shows("id:day:today")).toBe(true);
  expect(app.texts()).toContain("今天");
  // Today's card is in no group: the header comes after it, before the first note.
  const header = app.layout("id:day:today")!;
  expect(header.y).toBeGreaterThan(app.layout("id:row:summary")!.y);
  expect(header.y).toBeLessThan(Math.min(app.layout("id:row:购物清单")!.y, app.layout("id:row:账单")!.y));
  expect(app.spanStyle("id:day:today >> text:今天").fontSize).toBe(11);
  expect(app.count("role:header")).toBe(1);

  await app.type("id:search", "清单");
  await app.waitFor("id:row:create");
  expect(app.shows("id:day:today")).toBe(false);
  await app.clear("id:search");
  await app.waitFor("id:day:today");

  await app.press("id:row:购物清单");
  await app.waitFor("id:paper");
  expect(app.shows("id:day:today")).toBe(false);
  app.dispose();

  // A day later the same notes are yesterday's; a month later, earlier ones.
  app = await openJot(dir, DAY);
  await app.waitFor("id:row:购物清单");
  expect(app.shows("id:day:yesterday")).toBe(true);
  expect(app.shows("id:day:today")).toBe(false);
  expect(app.texts()).toContain("昨天");
  app.dispose();
  app = await openJot(dir, 30 * DAY);
  await app.waitFor("id:row:购物清单");
  expect(app.shows("id:day:earlier")).toBe(true);
  expect(app.texts()).toContain("更早");
  app.dispose();
});

test("the arrow keys and the pointer pass over a date group's header", async () => {
  const dir = folder("keys");
  const n = new Notes(dir);
  n.create("账单", "- [ ] 交电费 ⏰ 2020-01-01 09:00");
  n.create("购物清单", "牛奶");
  const app = await openJot(dir);
  await app.waitFor("id:row:购物清单");
  expect(selectedOf(app, "row:summary")).toBe(true);
  // The header between today's card and the first note takes no step.
  await app.keyboard.press("down");
  expect(selectedOf(app, "row:summary")).toBe(false);
  const first = ["购物清单", "账单"].sort((a, b) => app.layout(`id:row:${a}`)!.y - app.layout(`id:row:${b}`)!.y)[0];
  expect(selectedOf(app, `row:${first}`)).toBe(true);
  await app.keyboard.press("up");
  expect(selectedOf(app, "row:summary")).toBe(true);
  // Nor does the pointer: over the header, the selection stays where it was.
  await app.hover("id:day:today");
  expect(selectedOf(app, "row:summary")).toBe(true);
  expect(app.accessibility("id:day:today")?.role).toBe("header");
  app.dispose();
});

test("the to-do view's selected row has the same light fill", async () => {
  const dir = folder("todo");
  new Notes(dir).create("买菜", "- [ ] 买咖啡豆\n- [ ] 买牛奶");
  const app = await openJot(dir);
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:买咖啡豆");
  const fill = app.viewStyle("id:todo:买咖啡豆")?.backgroundColor;
  expect(alpha(fill)).toBeGreaterThan(0);
  expect(alpha(fill)).toBeLessThan(0x40);
  expect(app.spanStyle("id:todo:买咖啡豆 >> text:买咖啡豆").color).toBe(color("selected-ink"));
  app.dispose();
});

/** A note's row as the list holds it. */
const noteRow = (title: string, modified: number, index: number, leaving = false): ListRow => ({
  row: { kind: "note", meta: { title, modified, preview: "", downloading: false, locked: false } as NoteMeta, snippet: "", terms: [] },
  index: leaving ? -1 : index,
  leaving,
});

test("a note's date group: today, yesterday, earlier this week (from the week's first day), then earlier", () => {
  // Thursday 26 November 2026, in the afternoon.
  const now = new Date(2026, 10, 26, 15, 0).getTime();
  const on = (day: number, hour = 9) => new Date(2026, 10, day, hour, 0).getTime();
  expect(dayGroup(on(26, 0), now)).toBe("today");
  expect(dayGroup(on(26, 23), now)).toBe("today");
  expect(dayGroup(on(25, 23), now)).toBe("yesterday");
  expect(dayGroup(on(25, 0), now)).toBe("yesterday");
  // Weeks from Monday: the 23rd is this week's, Sunday the 22nd the last week's.
  expect(dayGroup(on(23), now, 1)).toBe("week");
  expect(dayGroup(on(22), now, 1)).toBe("earlier");
  // Weeks from Sunday: the 22nd is this week's too.
  expect(dayGroup(on(22), now, 7)).toBe("week");
  expect(dayGroup(on(21), now, 7)).toBe("earlier");
  // On the week's first day, yesterday is still yesterday.
  const monday = new Date(2026, 10, 23, 10, 0).getTime();
  expect(dayGroup(on(22), monday, 1)).toBe("yesterday");
  expect(dayGroup(on(21), monday, 1)).toBe("earlier");
});

test("the list's items: a header before each date group's first note, none for today's card, none with a query", () => {
  const now = new Date(2026, 10, 26, 15, 0).getTime();
  const rows: ListRow[] = [
    { row: { kind: "summary" }, index: 0, leaving: false },
    noteRow("a", now - 60_000, 1),
    noteRow("b", now - 3_600_000, 2),
    noteRow("c", now - 1.2 * DAY, 3),
    // Leaving: it keeps its group (and its header) while it slides out.
    noteRow("d", now - 2 * DAY, -1, true),
    noteRow("e", now - 40 * DAY, 4),
  ];
  const shape = listItems(rows, true, now, 1).map((i) => (i.kind === "day" ? `[${i.group}@${i.next}]` : i.item.row.kind === "note" ? i.item.row.meta.title : i.item.row.kind));
  expect(shape).toEqual(["summary", "[today@1]", "a", "b", "[yesterday@3]", "c", "[week@4]", "d", "[earlier@4]", "e"]);
  // The rows keep their indexes: what the keys and the selection count.
  const indexes = listItems(rows, true, now, 1).flatMap((i) => (i.kind === "row" ? [i.item.index] : []));
  expect(indexes).toEqual([0, 1, 2, 3, -1, 4]);
  expect(listItems(rows, false, now, 1).every((i) => i.kind === "row")).toBe(true);
});
