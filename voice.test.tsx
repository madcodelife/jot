// Dictation, headless: NSH's fake recognizer stands in for the microphone
// (`app.hear` says the transcript so far, `app.endSpeech` ends the session).
// The panel's microphone types into the search field and Escape takes it
// back; the note's microphone types at its caret and saves the final words;
// a quick note is filed as a to-do when it says a time, else in the inbox
// (the filing is a pure function: the double press held is native, so the
// test calls what its end calls). Simplified Chinese, Jot's reference copy.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { fileQuickNote, todoText } from "./app/quicknote";
import { joinSpoken } from "./app/spoken";

/** A fresh, empty notes folder. */
const folder = (name: string) => `/tmp/jot-voice-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const openJot = (dir: string, storage: Record<string, string> = {}) =>
  open("./App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    localeSettings: { hourCycle: "h23" },
    storage: { "jot.dir": dir, ...storage },
    modules: {
      "jot/native": {
        "Summon.isTrusted": true,
        "Summon.requestTrust": null,
        "Summon.onDoubleTap": null,
        "Summon.onDoubleTapHold": null,
      },
    },
  });

test("the field's microphone: the words appear as they are heard, stay when it ends, and Return makes the note", async () => {
  const dir = folder("field");
  const app = await openJot(dir);
  await app.waitFor("id:voice-mic");

  await app.press("id:voice-mic");
  await app.waitFor("id:voice-pulse");
  expect(app.speechRequests()).toHaveLength(1);
  expect(app.speechRequests()[0]).toMatchObject({ lang: "zh-CN", interim: true });

  await app.hear("京都的");
  expect(app.value("id:search")).toBe("京都的");
  await app.hear("京都的拉面");
  expect(app.value("id:search")).toBe("京都的拉面");

  await app.endSpeech();
  await app.waitUntil(() => !app.shows("id:voice-pulse"));
  expect(app.value("id:search")).toBe("京都的拉面");

  await app.submit("id:search");
  await app.waitFor("id:paper-title");
  expect(new Notes(dir).read("京都的拉面")).not.toBeNull();
  app.dispose();
});

test("Escape while dictating into the field puts back what was typed, and the panel stays", async () => {
  const app = await openJot(folder("escape"));
  await app.waitFor("id:voice-mic");
  await app.type("id:search", "旧");

  await app.press("id:voice-mic");
  await app.hear("新的");
  expect(app.value("id:search")).toBe("旧新的");

  await app.keyboard.press("escape");
  await app.waitUntil(() => app.value("id:search") === "旧");
  expect(app.shows("id:voice-pulse")).toBe(false);
  expect(app.shows("id:panel")).toBe(true);
  app.dispose();
});

test("a failed session says why in the footer and keeps the field as it was", async () => {
  const app = await openJot(folder("denied"));
  await app.waitFor("id:voice-mic");
  await app.type("id:search", "旧");
  await app.press("id:voice-mic");
  await app.endSpeech("not-allowed");
  await app.waitFor("id:notice");
  expect(app.texts()).toContain("没有麦克风或语音识别权限");
  expect(app.value("id:search")).toBe("旧");
  app.dispose();
});

test("the note's microphone types at the caret, and the final words are saved", async () => {
  const dir = folder("editor");
  new Notes(dir).create("周记", "第一行");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "周记");
  await app.waitFor("id:row:周记");
  await app.submit("id:search");
  await app.waitFor("id:paper-mic");

  await app.press("id:paper-mic");
  await app.waitFor("id:paper-listening");
  await app.hear("今天很开心");
  await app.endSpeech();
  await app.waitUntil(() => !app.shows("id:paper-listening"));
  await app.waitUntil(() => (new Notes(dir).read("周记")?.body ?? "").includes("今天很开心"));
  const body = new Notes(dir).read("周记")!.body;
  expect(body).toContain("第一行");
  expect(body.replace("第一行", "")).toBe("今天很开心");
  app.dispose();
});

test("General shows the voice group: holding ⌥ to talk is on, and turning it off is kept", async () => {
  const app = await openJot(folder("settings"));
  await app.waitFor("id:search");
  await app.keyboard.press("mod+,");
  await app.waitFor("id:settings-voice");
  expect(app.texts()).toContain("按住 ⌥ 说话");
  expect(app.texts()).toContain("跟随 Jot 的语言");
  await app.press("id:settings-voice-hold");
  await app.waitUntil(() => app.storage()["jot.voice.hold"] === "0");
  app.dispose();
});

test("a quick note with a time is a to-do with its reminder; the lead-in and the phrase go", () => {
  const n = new Notes(folder("quick-todo"));
  const filed = fileQuickNote(n, "明天上午9点提醒我交房租", { inbox: "收件箱", when: { locale: "zh-Hans" }, now: new Date() });
  expect(filed).toMatchObject({ kind: "todo", text: "交房租" });
  expect(n.read("待办")?.body ?? "").toMatch(/- \[ \] 交房租 ⏰ \d{4}-\d\d-\d\d 09:00/);
  expect(n.read("收件箱")).toBeNull();
});

test("a quick note without a time is a line of the inbox, with when it was said", () => {
  const n = new Notes(folder("quick-inbox"));
  const at = new Date(2026, 10, 14, 8, 5);
  fileQuickNote(n, "买一个新键盘", { inbox: "收件箱", when: { locale: "zh-Hans" }, now: at });
  fileQuickNote(n, "给猫买粮", { inbox: "收件箱", when: { locale: "zh-Hans" }, now: at });
  const body = n.read("收件箱")?.body ?? "";
  expect(body).toContain("- 08:05 买一个新键盘");
  expect(body).toContain("- 08:05 给猫买粮");
  expect(n.todos()).toHaveLength(0);
});

test("spoken words join what is there as typed: a space between Latin words, none in CJK", () => {
  expect(joinSpoken("buy", "milk")).toBe("buy milk");
  expect(joinSpoken("buy ", "milk")).toBe("buy milk");
  expect(joinSpoken("旧", "新的")).toBe("旧新的");
  expect(joinSpoken("Jot", "笔记")).toBe("Jot笔记");
  expect(joinSpoken("", "hello")).toBe("hello");
  expect(todoText("明天，交房租。", 0, 2)).toBe("交房租");
  expect(todoText("remind me to call mom tomorrow", 22, 30)).toBe("call mom");
});
