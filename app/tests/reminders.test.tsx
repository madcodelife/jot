// A reminder's sound: the to-do's notification plays Jot's chime (assets/reminder.wav), so the system's notification
// settings and Focus govern it; the island shows the reminder and plays nothing itself, nor as the user ticks it there
// (Jot's own sounds are for AI apps' writes: app/sounds.ts). The notifications are the test's (a stand-in for
// `Notifications.show`), so none reaches this Mac.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

const pad = (n: number) => String(n).padStart(2, "0");

/** The next whole minute at least a few seconds away, as a note writes it: a reminder due then fires while the test runs. */
function nextMinute(): string {
  const d = new Date(Date.now() + 5000);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Shown = { id?: string; title?: string; sound?: string | null };

test("a due to-do's notification plays Jot's chime, and the island nothing, nor a tick there", async () => {
  const dir = `/tmp/jot-test-chime-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  new Notes(dir).create("家", `- [ ] 交房租 ⏰ ${nextMinute()}`);
  const shown: Shown[] = [];
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: {
      "jot/native": { ...STAND_INS },
      nsh: { "Notifications.show": async (options: Shown) => void shown.push(options) },
    },
  });
  await app.waitFor("id:search");
  // Jot's reminders fire at the due time: within the next minute and some.
  await app.waitFor("id:island-check", { timeout: 70000 });
  await app.waitUntil(() => shown.length > 0);

  expect(shown.length).toBe(1);
  expect(shown[0].title).toBe("交房租");
  expect(shown[0].sound).toMatch(/(^|\/)reminder\.wav$/);
  const played = () => app.audio().filter((call) => call.command === "play");
  expect(played()).toEqual([]);

  await app.press("id:island-check");
  expect(new Notes(dir).read("家")?.body).toContain("- [x] 交房租");
  await app.wait(300);
  expect(played()).toEqual([]);
  app.dispose();
}, 90000);
