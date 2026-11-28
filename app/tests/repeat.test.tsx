// Repeating to-dos, headless: a repeat (` 🔁 every month`) on a to-do line is
// read, kept with its time and taken off with it; ticking a repeating to-do
// in the note (⌘↩) writes its next one above it in the same edit, which one
// undo takes back; a rule typed ("每月1号") becomes the file's form when the
// caret leaves the line, shown as a chip ("↻ 每月"); the picker takes the
// repeat away; the to-do view shows the rule and, ticked, the next one. Times
// are worked out from the clock the test runs at, as the store works them out.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { plainSnippet, taskLine, taskText, withDue, withoutRepeat } from "../tasks";
import { STAND_INS } from "./native";

const folder = (name: string) => `/tmp/jot-repeat-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const openJot = (dir: string) =>
  open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: { "jot/native": { ...STAND_INS } },
  });

const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** `YYYY-MM-DD HH:mm`, as a note writes a time after ⏰. */
const written = (d: Date) => `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The first `hour`:00 after now: today's, or tomorrow's once it is past (a daily to-do's next one). */
function nextDaily(hour: number) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0);
  return today > now ? today : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, 0);
}

/** The first 1st of a month at 09:00 after now (a monthly to-do's next one, due on the 1st). */
function nextFirst() {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 9, 0);
  return thisMonth > now ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0);
}

/** A folder with one note; the app opened on it, the note open in the editor with the caret at its end. */
async function openNote(name: string, title: string, body: string) {
  const dir = folder(name);
  new Notes(dir).create(title, body);
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", title);
  await app.submit("id:search");
  await app.waitFor("id:paper");
  await app.wait(500);
  await app.keyboard.press("mod+down");
  return { app, dir, body: () => new Notes(dir).read(title)?.body };
}

test("a repeat is read off the line, kept with a new time and taken off with the time", () => {
  const line = "- [ ] 交房租 ⏰ 2026-12-01 09:00 🔁 every month";
  expect(taskLine(line)?.repeat).toEqual({ start: 29, end: 43, rule: "month" });
  expect(taskText(line)).toBe("交房租");
  // Only the five rules: anything else stays words.
  expect(taskLine("- [ ] 交房租 🔁 every 2 weeks")?.repeat).toBe(null);
  expect(taskLine("- [ ] 交房租 🔁 every weekdays")?.repeat).toBe(null);
  expect(taskLine("- [ ] standup 🔁 every weekday")?.repeat?.rule).toBe("weekday");

  const friday = new Date(2026, 10, 20, 15, 0);
  expect(withDue(line, friday)).toBe("- [ ] 交房租 ⏰ 2026-11-20 15:00 🔁 every month");
  expect(withDue("- [ ] 交房租 🔁 every month", friday)).toBe("- [ ] 交房租 ⏰ 2026-11-20 15:00 🔁 every month");
  expect(withDue("- [ ] 🔁 every month", friday)).toBe("- [ ] ⏰ 2026-11-20 15:00 🔁 every month");
  expect(withDue(line, null)).toBe("- [ ] 交房租");
  expect(withDue("- [ ] ⏰ 2026-12-01 09:00 🔁 every month 交房租", null)).toBe("- [ ] 交房租");
  expect(withoutRepeat(line)).toBe("- [ ] 交房租 ⏰ 2026-12-01 09:00");
  expect(withoutRepeat("- [ ] 🔁 every day 吃药")).toBe("- [ ] 吃药");
  expect(withoutRepeat("- [ ] 吃药")).toBe("- [ ] 吃药");
  expect(plainSnippet(`${line} - [x] 吃药 🔁 every day ✅ 2026-11-13`)).toBe("○ 交房租 ✓ 吃药");
});

test("⌘↩ on a repeating to-do writes its next one above it; one undo takes both back", async () => {
  const start = "- [ ] 吃药 ⏰ 2020-01-01 08:00 🔁 every day\n散文";
  const { app, body } = await openNote("tick", "吃药", start);
  await app.keyboard.press("up");
  await app.keyboard.press("mod+enter");
  // Long overdue: the next one is the first 08:00 to come, not a backlog of days.
  const expected = `- [ ] 吃药 ⏰ ${written(nextDaily(8))} 🔁 every day\n- [x] 吃药 ⏰ 2020-01-01 08:00 🔁 every day ✅ ${day(new Date())}\n散文`;
  await app.waitUntil(() => body() === expected, { timeout: 3000 });

  await app.keyboard.press("mod+z");
  await app.waitUntil(() => body() === start, { timeout: 3000 });
  app.dispose();
});

test("a rule typed on a to-do becomes the file's form as the caret leaves, and shows as a chip", async () => {
  const { app, body } = await openNote("phrase", "房租", "- [ ] 交房租 每月1号\n散文");
  await app.keyboard.press("up");
  await app.wait(100);
  await app.keyboard.press("down");
  const expected = `- [ ] 交房租 ⏰ ${written(nextFirst())} 🔁 every month\n散文`;
  await app.waitUntil(() => body() === expected, { timeout: 3000 });
  // Off the caret, the repeat is its words in the language shown.
  await app.waitUntil(() => app.texts().includes("↻ 每月"), { timeout: 3000 });
  app.dispose();
});

test("the picker shows a to-do's repeat and Remove Repeat takes it off, its time kept", async () => {
  const start = "- [ ] 交房租 ⏰ 2026-12-20 09:00 🔁 every month";
  const { app, body } = await openNote("remove", "房租", start);
  await app.keyboard.press("mod+shift+d");
  await app.waitFor("id:due-picker");
  for (const id of ["due-repeat", "due-remove-repeat", "due-remove"]) expect(app.shows(`id:${id}`)).toBe(true);
  expect(app.texts()).toContain("移除重复");
  await app.press("id:due-remove-repeat");
  await app.waitUntil(() => body() === "- [ ] 交房租 ⏰ 2026-12-20 09:00", { timeout: 3000 });

  // One undo puts it back.
  await app.keyboard.press("mod+z");
  await app.waitUntil(() => body() === start, { timeout: 3000 });

  // A to-do without a repeat has nothing of it in the picker.
  await app.keyboard.press("mod+shift+d");
  await app.waitFor("id:due-picker");
  await app.press("id:due-remove");
  await app.waitUntil(() => body() === "- [ ] 交房租", { timeout: 3000 });
  await app.keyboard.press("mod+shift+d");
  await app.waitFor("id:due-picker");
  expect(app.shows("id:due-remove-repeat")).toBe(false);
  app.dispose();
});

test("the to-do view shows the rule; ticked, the next one stays in the list", async () => {
  const dir = folder("view");
  new Notes(dir).create("家", "- [ ] 交房租 ⏰ 2020-01-01 09:00 🔁 every month\n- [ ] 买牛奶");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:交房租");
  expect(app.shows("id:repeat:交房租")).toBe(true);
  expect(app.shows("id:repeat:买牛奶")).toBe(false);

  await app.press("id:check:交房租");
  const ticked = `- [ ] 交房租 ⏰ ${written(nextFirst())} 🔁 every month\n- [x] 交房租 ⏰ 2020-01-01 09:00 🔁 every month ✅ ${day(new Date())}\n- [ ] 买牛奶`;
  await app.waitUntil(() => new Notes(dir).read("家")?.body === ticked, { timeout: 3000 });
  // Once the ticked row has folded away, the next one is still listed.
  await app.wait(2500);
  expect(app.shows("id:todo:交房租")).toBe(true);
  expect(app.shows("id:repeat:交房租")).toBe(true);

  // Its picker takes the repeat away through the store.
  await app.press("id:due:交房租");
  await app.waitFor("id:due-picker");
  await app.press("id:due-remove-repeat");
  await app.waitUntil(() => new Notes(dir).read("家")?.body?.startsWith(`- [ ] 交房租 ⏰ ${written(nextFirst())}\n`) ?? false, { timeout: 3000 });
  app.dispose();
});
