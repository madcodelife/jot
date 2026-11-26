// Jot's own sound effects, headless (`app.audio()`: what the app asked of the speaker): a to-do the user ticks plays
// assets/done.wav once, as the check is drawn, in the to-do view and in the open note; unticking plays nothing, nor a
// locked note's to-do. The settings' "音效" switch turns them off and is kept, and so does macOS's "Play user
// interface sound effects" (`SoundEffects.systemAllows`, which the stand-ins give as on).
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

const folder = (name: string) => `/tmp/jot-sounds-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const openJot = (dir: string, storage: Record<string, string> = {}, native: Record<string, unknown> = {}) =>
  open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir, ...storage },
    modules: { "jot/native": { ...STAND_INS, ...native } },
  });

type App = Awaited<ReturnType<typeof openJot>>;

/** The sounds played so far, by file name. */
const played = (app: App) => app.audio().filter((call) => call.command === "play").map((call) => call.src.split("/").pop());

/** The to-do view, with the to-do `text` in it. */
async function todoView(app: App, text: string) {
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor(`id:todo:${text}`);
}

test("ticking a to-do in the to-do view plays the done sound once, loaded ahead", async () => {
  const dir = folder("view");
  new Notes(dir).create("买菜", "- [ ] 买咖啡豆\n- [ ] 买牛奶");
  const app = await openJot(dir);
  await todoView(app, "买咖啡豆");
  expect(app.audio().some((call) => call.command === "load" && /(^|\/)done\.wav$/.test(call.src))).toBe(true);
  expect(played(app)).toEqual([]);

  await app.press("id:check:买咖啡豆");
  expect(played(app)).toEqual(["done.wav"]);
  // Its row folds away later, without a sound of its own.
  await app.waitUntil(() => !app.shows("id:todo:买咖啡豆"));
  expect(played(app)).toEqual(["done.wav"]);
  // ⌘↩ ticks the selected one, with one more.
  await app.keyboard.press("mod+enter");
  expect(new Notes(dir).read("买菜")?.body).toContain("- [x] 买牛奶");
  expect(played(app)).toEqual(["done.wav", "done.wav"]);
  app.dispose();
});

test("a to-do's box in the open note plays the sound as it ticks, and nothing as it unticks", async () => {
  const dir = folder("paper");
  new Notes(dir).create("勾选框", "- [ ] 交房租\n散文");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "勾选框");
  await app.submit("id:search");
  await app.waitFor("id:paper");
  // The caret off the to-do's line, so its box is drawn.
  await app.wait(500);
  await app.keyboard.press("mod+down");
  await app.waitFor("id:editor >> label:- [ ]");

  await app.press("id:editor >> label:- [ ]");
  expect(played(app)).toEqual(["done.wav"]);
  // Apart, so the second press is not a double click; then saved.
  await app.wait(1000);
  expect(new Notes(dir).read("勾选框")?.body).toMatch(/^- \[x\] 交房租/);
  await app.press("id:editor >> label:- [x]");
  await app.wait(1000);
  expect(new Notes(dir).read("勾选框")?.body).toBe("- [ ] 交房租\n散文");
  expect(played(app)).toEqual(["done.wav"]);
  app.dispose();
});

test("a locked note's to-do stays unticked, without a sound", async () => {
  const dir = folder("locked");
  const n = new Notes(dir);
  n.create("合同", "- [ ] 签字");
  n.lock("合同");
  const app = await openJot(dir);
  await todoView(app, "签字");
  await app.press("id:check:签字");
  expect(new Notes(dir).read("合同")?.body).toBe("- [ ] 签字");
  expect(played(app)).toEqual([]);
  app.dispose();
  n.unlock("合同");
});

test("the settings' switch turns the sound effects off, and it is kept", async () => {
  const dir = folder("switch");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.keyboard.press("mod+,");
  await app.waitFor("id:settings-sound-effects");
  expect(app.storage()["jot.soundEffects"]).toBeUndefined();
  await app.press("id:settings-sound-effects");
  await app.waitUntil(() => app.storage()["jot.soundEffects"] === "0");
  app.dispose();
});

test("with the switch off, a tick plays nothing", async () => {
  const dir = folder("off");
  new Notes(dir).create("买菜", "- [ ] 买咖啡豆");
  const app = await openJot(dir, { "jot.soundEffects": "0" });
  await todoView(app, "买咖啡豆");
  await app.press("id:check:买咖啡豆");
  expect(new Notes(dir).read("买菜")?.body).toContain("- [x] 买咖啡豆");
  expect(played(app)).toEqual([]);
  app.dispose();
});

test("with macOS's interface sound effects off, a tick plays nothing", async () => {
  const dir = folder("system-off");
  new Notes(dir).create("买菜", "- [ ] 买咖啡豆");
  const app = await openJot(dir, {}, { "SoundEffects.systemAllows": false });
  await todoView(app, "买咖啡豆");
  await app.press("id:check:买咖啡豆");
  expect(new Notes(dir).read("买菜")?.body).toContain("- [x] 买咖啡豆");
  expect(played(app)).toEqual([]);
  app.dispose();
});
