// The reminder time picker, headless: opened from a time chip in the open
// note, from ⇧⌘D on a to-do line, from a due label in the to-do view and
// from ⌘K there; a quick time, a custom one (the time field and ⌘↩), the
// keyboard (↓ Return), "Remove Reminder" and Escape. Times are worked out
// from the clock the test runs at, as the picker works them out.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { withDue } from "../tasks";
import { quickChoices } from "../time";

const folder = (name: string) => `/tmp/jot-due-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const openJot = (dir: string) =>
  open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: { "jot/native": { "Summon.isTrusted": true, "Summon.requestTrust": null, "Summon.onDoubleTap": null } },
  });

const pad = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD HH:mm`, as a note writes a time after ⏰. */
const written = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** Tomorrow at 09:00, the quick choice "明天上午" (the default time for a date alone). */
function tomorrowMorning() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0);
}

/** A folder with one note; the app opened on it, the note open in the editor. */
async function openNote(name: string, title: string, body: string) {
  const dir = folder(name);
  new Notes(dir).create(title, body);
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", title);
  await app.submit("id:search");
  await app.waitFor("id:editor");
  await app.wait(300);
  return { app, dir, body: () => new Notes(dir).read(title)?.body };
}

test("a reminder is set, moved and removed on the line, wherever it is written", () => {
  const friday = new Date(2026, 10, 20, 15, 0);
  expect(withDue("- [ ] 交房租", friday)).toBe("- [ ] 交房租 ⏰ 2026-11-20 15:00");
  expect(withDue("- [ ] 交房租 ⏰ 2026-11-14 09:00", friday)).toBe("- [ ] 交房租 ⏰ 2026-11-20 15:00");
  expect(withDue("- [ ] 交 ⏰ 2026-11-14 09:00 房租", friday)).toBe("- [ ] 交 ⏰ 2026-11-20 15:00 房租");
  expect(withDue("- [ ] ⏰ 2026-11-14 09:00 房租", friday)).toBe("- [ ] ⏰ 2026-11-20 15:00 房租");
  expect(withDue("- [x] 交房租 ✅ 2026-11-13", friday)).toBe("- [x] 交房租 ⏰ 2026-11-20 15:00 ✅ 2026-11-13");
  expect(withDue("- [ ] 交房租 ⏰ 2026-11-14 09:00", null)).toBe("- [ ] 交房租");
  expect(withDue("- [ ] 交 ⏰ 2026-11-14 09:00 房租", null)).toBe("- [ ] 交 房租");
  expect(withDue("- [ ] ⏰ 2026-11-14 09:00 房租", null)).toBe("- [ ] 房租");
  expect(withDue("- [ ] 交房租", null)).toBe("- [ ] 交房租");
  expect(withDue("交房租", friday)).toBe("交房租");
});

test("the quick choices are the times still to come, each once", () => {
  const ids = (now: Date) => quickChoices(now).map((c) => `${c.id} ${written(c.at)}`);
  // Monday morning: all four.
  expect(ids(new Date(2026, 10, 16, 10, 30, 45))).toEqual([
    "hour 2026-11-16 11:30",
    "tonight 2026-11-16 20:00",
    "tomorrow 2026-11-17 09:00",
    "monday 2026-11-23 09:00",
  ]);
  // New Year's Eve, late: this evening has passed; the rest are in the new year.
  expect(ids(new Date(2026, 11, 31, 21, 0))).toEqual(["hour 2026-12-31 22:00", "tomorrow 2027-01-01 09:00", "monday 2027-01-04 09:00"]);
  // Sunday night: next Monday morning is tomorrow morning, shown once.
  expect(ids(new Date(2026, 10, 22, 21, 0))).toEqual(["hour 2026-11-22 22:00", "tomorrow 2026-11-23 09:00"]);
  // The settings' time for a date alone.
  expect(quickChoices(new Date(2026, 10, 16, 10, 30), "08:15").map((c) => written(c.at))[2]).toBe("2026-11-17 08:15");
});

test("pressing the time chip in the note opens the picker, and a quick time is written on the line", async () => {
  const { app, body } = await openNote("chip", "房租", "- [ ] 房租 ⏰ 2026-11-20 09:00");
  await app.press("id:editor >> text:- [ ] 房租 ⏰ 2026-11-20 09:00");
  await app.waitFor("id:due-picker");
  // What it has, the quick times, the calendar and the time field, and "Remove Reminder".
  for (const id of ["due-current", "due-quick:tomorrow", "due-calendar", "due-time", "due-set", "due-remove"]) expect(app.shows(`id:${id}`)).toBe(true);
  expect(app.texts()).toContain("移除提醒");

  await app.press("id:due-quick:tomorrow");
  await app.waitUntil(() => !app.shows("id:due-picker"));
  const expected = `- [ ] 房租 ⏰ ${written(tomorrowMorning())}`;
  await app.waitUntil(() => body() === expected);
  expect(app.shows("id:paper")).toBe(true);
  app.dispose();
});

test("⇧⌘D on a to-do line opens the picker; ⌘↩ sets the time typed, and undo takes it back", async () => {
  const { app, body } = await openNote("keys", "开会", "- [ ] 开会");
  await app.keyboard.press("mod+shift+d");
  await app.waitFor("id:due-picker");
  // No reminder yet: nothing to remove.
  expect(app.shows("id:due-remove")).toBe(false);
  expect(app.texts()).toContain("没有提醒");

  await app.press("id:due-time >> text:09");
  await app.keyboard.press("1");
  await app.keyboard.press("8");
  await app.keyboard.press("mod+enter");
  await app.waitUntil(() => !app.shows("id:due-picker"));
  // The calendar starts on the next morning to come: today before 09:00, else tomorrow.
  const now = new Date();
  const day = now.getHours() < 9 ? now : tomorrowMorning();
  const expected = `- [ ] 开会 ⏰ ${written(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 0))}`;
  await app.waitUntil(() => body() === expected);

  // The keys went back to the note: one undo takes the time off again.
  await app.keyboard.press("mod+z");
  await app.waitUntil(() => body() === "- [ ] 开会");
  app.dispose();
});

test("the picker opens with the first choice focused: ↓ and Return pick the next one", async () => {
  const { app, body } = await openNote("arrows", "遛狗", "- [ ] 遛狗");
  await app.keyboard.press("mod+shift+d");
  await app.waitFor("id:due-picker");
  await app.wait(50);
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  await app.waitUntil(() => !app.shows("id:due-picker"));
  const second = quickChoices(new Date())[1].at;
  await app.waitUntil(() => body() === `- [ ] 遛狗 ⏰ ${written(second)}`);
  app.dispose();
});

test("Remove Reminder takes the time off the line; Escape closes the picker and changes nothing", async () => {
  const { app, body } = await openNote("remove", "房租", "- [ ] 房租 ⏰ 2026-11-20 09:00");
  await app.press("id:editor >> text:- [ ] 房租 ⏰ 2026-11-20 09:00");
  await app.waitFor("id:due-picker");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:due-picker"));
  // Escape closed the picker, not the note.
  expect(app.shows("id:paper")).toBe(true);
  await app.wait(400);
  expect(body()).toBe("- [ ] 房租 ⏰ 2026-11-20 09:00");

  await app.press("id:editor >> text:- [ ] 房租 ⏰ 2026-11-20 09:00");
  await app.waitFor("id:due-picker");
  await app.press("id:due-remove");
  await app.waitUntil(() => body() === "- [ ] 房租");
  app.dispose();
});

test("the due label in the to-do view opens the picker; the time goes to the note through the store", async () => {
  const dir = folder("label");
  new Notes(dir).create("家", "- [ ] 交房租 ⏰ 2026-11-20 09:00\n- [ ] 买牛奶");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:交房租");

  await app.press("id:due:交房租");
  await app.waitFor("id:due-picker");
  await app.press("id:due-quick:tomorrow");
  await app.waitUntil(() => !app.shows("id:due-picker"));
  const tomorrow = written(tomorrowMorning());
  expect(new Notes(dir).read("家")?.body).toBe(`- [ ] 交房租 ⏰ ${tomorrow}\n- [ ] 买牛奶`);
  // Still the to-do view, the row now under "明天".
  await app.waitFor("text:明天");
  expect(app.shows("id:todo:交房租")).toBe(true);

  // Escape closes the picker and leaves the to-do view as it was.
  await app.press("id:due:交房租");
  await app.waitFor("id:due-picker");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:due-picker"));
  expect(app.shows("id:todo:交房租")).toBe(true);
  app.dispose();
});

test("⌘K on a to-do row offers Reminder Time… and Remove Reminder, and Add Reminder… once it has none", async () => {
  const dir = folder("actions");
  new Notes(dir).create("家", "- [ ] 交房租 ⏰ 2026-11-20 09:00\n- [ ] 买牛奶");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:交房租");

  // The first row (交房租, with a time) is selected.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:actions");
  expect(app.texts()).toContain("提醒时间…");
  expect(app.shows("id:action:due-remove")).toBe(true);
  await app.press("id:action:due-remove");
  await app.waitUntil(() => new Notes(dir).read("家")?.body === "- [ ] 交房租\n- [ ] 买牛奶");

  // The selection followed it into "没有时间": ⌘K now adds one, and the picker opens from there.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:actions");
  expect(app.texts()).toContain("添加提醒…");
  expect(app.shows("id:action:due-remove")).toBe(false);
  await app.press("id:action:due");
  await app.waitFor("id:due-picker");
  await app.press("id:due-quick:tomorrow");
  await app.waitUntil(() => new Notes(dir).read("家")?.body === `- [ ] 交房租 ⏰ ${written(tomorrowMorning())}\n- [ ] 买牛奶`);
  app.dispose();
});
