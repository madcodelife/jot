// Jot's own sound effects, headless (`app.audio()`: what the app asked of the speaker). They are for what AI apps do,
// as the island says it: a new note plays assets/new.wav as the island opens on it, a completed to-do assets/done.wav
// as its check pops in, once per island; every other write plays nothing, and so do the user's own ticks. The
// settings' "音效" switch turns them off and is kept, and so does macOS's "Play user interface sound effects"
// (`SoundEffects.systemAllows`, which the stand-ins give as on). AI apps' writes come through an activity log of the
// test's own, as in app/tests/island.test.tsx.
import { expect, open, test } from "nsh/test";
import { ActivityLog, Notes, type AgentAction } from "jot/native";
import { STAND_INS } from "./native";

/** A fresh notes folder, and an activity log beside it. */
const setup = (name: string) => {
  const base = `/tmp/jot-sounds-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return { dir: `${base}/Jot`, log: `${base}/Application Support/Jot/activity.jsonl` };
};

type Options = { storage?: Record<string, string>; native?: Record<string, unknown>; reducedMotion?: boolean };

const openJot = (dir: string, log: string, { storage = {}, native = {}, reducedMotion = true }: Options = {}) => {
  new Notes(dir);
  return open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion,
    locale: "zh-CN",
    storage: { "jot.dir": dir, ...storage },
    modules: { "jot/native": { ...STAND_INS, "ActivityLog.path": log, ...native } },
  });
};

type App = Awaited<ReturnType<typeof openJot>>;

/** A line of the log: Claude Code did `action` to the note `title` in `dir`. */
function wrote(log: string, dir: string, action: AgentAction, title: string) {
  ActivityLog.append(log, { at: "2026-11-26T14:30:05", dir, agent: "Claude Code", action, title, previous: null, inTrash: null });
}

/** The sounds played so far, by file name. */
const played = (app: App) => app.audio().filter((call) => call.command === "play").map((call) => call.src.split("/").pop());

const loaded = (app: App, name: string) => app.audio().some((call) => call.command === "load" && call.src.split("/").pop() === name);

/** The island showed `label` and has closed again. */
async function islandSays(app: App, label: string) {
  await app.waitUntil(() => app.texts().includes(label), { timeout: 5000 });
  await app.waitFor("id:island-write", { state: "gone", timeout: 5000 });
}

test("an AI app's new note plays the new-note sound once, as the island opens on it", async () => {
  const { dir, log } = setup("create");
  const app = await openJot(dir, log);
  await app.waitFor("id:search");
  expect(loaded(app, "new.wav") && loaded(app, "done.wav")).toBe(true);
  expect(played(app)).toEqual([]);

  wrote(log, dir, "create", "周会纪要");
  await app.waitUntil(() => app.texts().includes("Claude Code · 正在记到 Jot"));
  expect(played(app)).toEqual(["new.wav"]);
  // Saved, its check in: nothing more.
  await islandSays(app, "Claude Code · 已记下");
  expect(played(app)).toEqual(["new.wav"]);
  app.dispose();
});

test("an AI app's completed to-do plays the done sound once, as the check pops in; other writes play nothing", async () => {
  const { dir, log } = setup("complete");
  const app = await openJot(dir, log);
  await app.waitFor("id:search");

  wrote(log, dir, "append", "部署命令");
  await islandSays(app, "Claude Code · 追加到");
  expect(played(app)).toEqual([]);
  wrote(log, dir, "edit", "服务器");
  await islandSays(app, "Claude Code · 改了一处");
  expect(played(app)).toEqual([]);

  wrote(log, dir, "complete", "购物");
  await app.waitUntil(() => app.texts().includes("Claude Code · 勾选了一条待办"));
  await app.waitUntil(() => played(app).length > 0);
  expect(played(app)).toEqual(["done.wav"]);
  await app.waitFor("id:island-write", { state: "gone", timeout: 5000 });
  expect(played(app)).toEqual(["done.wav"]);
  app.dispose();
});

test("writes merged into one island play its sound once", async () => {
  const { dir, log } = setup("merge");
  // With motion, so an island holds long enough for the writes below to join it.
  const app = await openJot(dir, log, { reducedMotion: false });
  await app.waitFor("id:search");

  // A new note, then more to it: the new-note sound alone.
  wrote(log, dir, "create", "周报");
  wrote(log, dir, "todo", "周报");
  wrote(log, dir, "complete", "周报");
  await islandSays(app, "Claude Code · 已记下");
  expect(played(app)).toEqual(["new.wav"]);

  // An island whose check is in turns into a completed to-do: it plays then, once, and not again as it turns back
  // and forth.
  wrote(log, dir, "append", "待办");
  await app.waitUntil(() => app.texts().includes("Claude Code · 追加到"));
  // The avatar stops saying "writing" as the check pops in.
  await app.waitUntil(() => !app.shows("label:正在写"));
  expect(played(app)).toEqual(["new.wav"]);
  wrote(log, dir, "complete", "待办");
  await app.waitUntil(() => app.texts().includes("Claude Code · 勾选了一条待办"));
  expect(app.shows("label:正在写")).toBe(false);
  await app.waitUntil(() => played(app).length === 2);
  wrote(log, dir, "append", "待办");
  await app.waitUntil(() => app.texts().includes("Claude Code · 追加到"));
  wrote(log, dir, "complete", "待办");
  await app.waitUntil(() => app.texts().includes("Claude Code · 勾选了一条待办"));
  await app.waitFor("id:island-write", { state: "gone", timeout: 8000 });
  expect(played(app)).toEqual(["new.wav", "done.wav"]);
  app.dispose();
});

test("the user's own ticks play nothing: the to-do view and the open note", async () => {
  const { dir, log } = setup("user");
  new Notes(dir).create("买菜", "- [ ] 买咖啡豆\n- [ ] 买牛奶\n散文");
  const app = await openJot(dir, log);
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:买咖啡豆");
  await app.press("id:check:买咖啡豆");
  await app.waitUntil(() => new Notes(dir).read("买菜")?.body.includes("- [x] 买咖啡豆") ?? false);

  await app.clear("id:search");
  await app.type("id:search", "买菜");
  await app.waitFor("id:row:买菜");
  await app.submit("id:search");
  await app.waitFor("id:paper");
  // The caret off the to-do's line, so its box is drawn.
  await app.wait(500);
  await app.keyboard.press("mod+down");
  await app.waitFor("id:editor >> label:- [ ]");
  await app.press("id:editor >> label:- [ ]");
  await app.waitUntil(() => new Notes(dir).read("买菜")?.body.includes("- [x] 买牛奶") ?? false, { timeout: 3000 });
  expect(played(app)).toEqual([]);
  app.dispose();
});

test("the settings' switch turns the sound effects off, and it is kept", async () => {
  const { dir, log } = setup("switch");
  const app = await openJot(dir, log);
  await app.waitFor("id:search");
  await app.keyboard.press("mod+,");
  await app.waitFor("id:settings-sound-effects");
  expect(app.storage()["jot.soundEffects"]).toBeUndefined();
  await app.press("id:settings-sound-effects");
  await app.waitUntil(() => app.storage()["jot.soundEffects"] === "0");
  app.dispose();
});

test("with the switch off, an AI app's writes play nothing", async () => {
  const { dir, log } = setup("off");
  const app = await openJot(dir, log, { storage: { "jot.soundEffects": "0" } });
  await app.waitFor("id:search");
  wrote(log, dir, "complete", "购物");
  await islandSays(app, "Claude Code · 勾选了一条待办");
  expect(played(app)).toEqual([]);
  app.dispose();
});

test("with macOS's interface sound effects off, an AI app's writes play nothing", async () => {
  const { dir, log } = setup("system-off");
  const app = await openJot(dir, log, { native: { "SoundEffects.systemAllows": false } });
  await app.waitFor("id:search");
  wrote(log, dir, "create", "周会纪要");
  await islandSays(app, "Claude Code · 已记下");
  expect(played(app)).toEqual([]);
  app.dispose();
});
