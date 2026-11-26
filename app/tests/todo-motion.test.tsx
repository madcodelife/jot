// To-dos with motion on (the other tests run with reduced motion): a tick in
// the to-do view, by its checkbox and by ⌘↩, which bursts, slides the row out
// and folds it away; a new due time, which moves the row to its group; and a
// reminder ticked in the island, which then closes. A step resolves once the
// app is quiet, so each test sees where the motion ends.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

const folder = (name: string) => `/tmp/jot-motion-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

const pad = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD HH:mm`, as a note writes a time after ⏰. */
const written = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

test("with motion, a ticked to-do slides out and folds away, and its group's count follows", async () => {
  const dir = folder("tick");
  new Notes(dir).create("买菜", "- [ ] 买咖啡豆\n- [ ] 买牛奶");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:买咖啡豆");
  expect(app.texts()).toContain("2");

  await app.press("id:check:买咖啡豆");
  expect(new Notes(dir).read("买菜")?.body).toContain("- [x] 买咖啡豆 ✅");
  await app.waitUntil(() => !app.shows("id:todo:买咖啡豆"));
  expect(app.shows("id:todo:买牛奶")).toBe(true);
  expect(app.texts()).toContain("1");
  expect(app.texts()).not.toContain("2");
  app.dispose();
});

test("with motion, ⌘↩ ticks the selected to-do the same way, and the last of a group takes its header with it", async () => {
  const dir = folder("key");
  new Notes(dir).create("账单", "- [ ] 交电费 ⏰ 2020-01-01 09:00\n- [ ] 买牛奶");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:交电费");
  expect(app.texts()).toContain("已过期");

  await app.keyboard.press("mod+enter");
  expect(new Notes(dir).read("账单")?.body).toContain("- [x] 交电费");
  await app.waitUntil(() => !app.shows("id:todo:交电费"));
  expect(app.texts()).not.toContain("已过期");
  expect(app.shows("id:todo:买牛奶")).toBe(true);
  app.dispose();
});

test("with motion, a new due time moves the row into its group, the empty group's header gone", async () => {
  const dir = folder("regroup");
  new Notes(dir).create("家", "- [ ] 交房租 ⏰ 2020-01-01 09:00\n- [ ] 买牛奶");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:交房租");

  await app.press("id:due:交房租");
  await app.waitFor("id:due-picker");
  await app.press("id:due-quick:tomorrow");
  await app.waitUntil(() => !app.shows("id:due-picker"));
  const d = new Date();
  const tomorrow = written(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0));
  expect(new Notes(dir).read("家")?.body).toBe(`- [ ] 交房租 ⏰ ${tomorrow}\n- [ ] 买牛奶`);

  await app.waitFor("text:明天");
  await app.waitUntil(() => !app.texts().includes("已过期"));
  // Under its new header, above the to-dos without a time.
  const header = app.layout("text:明天");
  const row = app.layout("id:todo:交房租");
  const other = app.layout("id:todo:买牛奶");
  expect(header && row && other).toBeTruthy();
  expect(row!.y).toBeGreaterThan(header!.y);
  expect(other!.y).toBeGreaterThan(row!.y);
  app.dispose();
});

/** The next whole minute at least a few seconds away, as a note writes it: a reminder due then fires while the test runs. */
function nextMinute(): string {
  const d = new Date(Date.now() + 5000);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  return written(d);
}

test("a reminder ticked in the island ticks the to-do, then the island closes", async () => {
  const dir = folder("island");
  new Notes(dir).create("家", `- [ ] 交房租 ⏰ ${nextMinute()}`);
  const app = await openJot(dir);
  await app.waitFor("id:search");
  // Jot's reminders fire at the due time: within the next minute and some.
  await app.waitFor("id:island-check", { timeout: 70000 });
  expect(app.texts()).toContain("交房租");

  // The press resolves once the app is quiet: the tick has played, the content lifted out and the island closed.
  await app.press("id:island-check");
  expect(new Notes(dir).read("家")?.body).toContain("- [x] 交房租");
  await app.waitUntil(() => !app.shows("id:island-check"));
  expect(app.texts()).not.toContain("已完成");
  app.dispose();
}, 90000);
