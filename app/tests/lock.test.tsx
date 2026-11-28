// Locked notes and the AI apps' permission, headless. A locked note shows a
// padlock in its row and "已锁定" in its header (a click unlocks it); its text
// is read-only, ⌃X says to unlock it first, its to-dos cannot be ticked, and ⌘K
// offers "解锁" instead of "锁定" (and no "重命名"). A note locked outside the
// app (another Mac, an AI app's folder change) shows so as the folder changes.
// The settings' AI page has the switch that lets AI apps move notes to the
// Trash and rewrite them; the file it writes is a stand-in here.
//
// Each test unlocks its notes before it ends: a locked file (the system's flag)
// could not be deleted with its temporary folder otherwise.
import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

const folder = (name: string) => `/tmp/jot-lock-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** The permission's stand-in: no test reads or writes the machine's own settings file. */
function access(initial = false) {
  const calls: string[] = [];
  return {
    calls,
    modules: {
      "AiAccess.allowsTrashAndRewrite": initial,
      "AiAccess.set": (on: boolean, language: string) => {
        calls.push(`${on} ${language}`);
      },
    },
  };
}

const openJot = (dir: string, modules: Record<string, unknown> = access().modules) =>
  open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: {
      "jot/native": {
        ...STAND_INS,
        "Connections.server": "/Applications/Jot.app/Contents/MacOS/jot-mcp",
        "Connections.translocated": false,
        "Connections.clients": async () => [],
        "Connections.sync": async () => [],
        "Connections.generic": { command: "jot-mcp --dir /tmp/notes", json: "{}" },
        "Folder.icloud": { path: null, available: false },
        ...modules,
      },
    },
  });

type App = Awaited<ReturnType<typeof openJot>>;

/** Unlocks every note of the folder, so it can be deleted. */
function unlockAll(dir: string) {
  const n = new Notes(dir);
  for (const m of n.list()) if (m.locked) n.unlock(m.title);
}

/** Searches for `title` and selects its row. */
async function find(app: App, title: string) {
  await app.waitFor("id:search");
  await app.type("id:search", title);
  await app.waitFor(`id:row:${title}`);
}

test("⌘K locks the selected note: a padlock in its row, and it offers to unlock it instead", async () => {
  const dir = folder("actions");
  const n = new Notes(dir);
  n.create("护照", "号码 E123");
  n.create("购物", "牛奶");
  const app = await openJot(dir);
  await find(app, "护照");
  expect(app.shows("id:row:护照 >> id:note-locked")).toBe(false);

  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:lock");
  expect(app.shows("id:action:unlock")).toBe(false);
  await app.press("id:action:lock");
  await app.waitFor("id:row:护照 >> id:note-locked");
  expect(new Notes(dir).read("护照")?.meta.locked).toBe(true);
  expect(new Notes(dir).read("护照")?.body).toBe("号码 E123");
  expect(app.texts()).toContain("已锁定「护照」");

  // Locked: "Unlock" in place of "Lock", and no "Rename".
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:unlock");
  expect(app.shows("id:action:lock")).toBe(false);
  expect(app.shows("id:action:rename")).toBe(false);
  expect(app.shows("id:action:trash")).toBe(true);
  await app.press("id:action:unlock");
  await app.waitUntil(() => !app.shows("id:row:护照 >> id:note-locked"));
  expect(new Notes(dir).read("护照")?.meta.locked).toBe(false);
  expect(app.texts()).toContain("已解锁「护照」");
  app.dispose();
  unlockAll(dir);
});

test("⌃X on a locked note says to unlock it first, and the note stays", async () => {
  const dir = folder("trash");
  const n = new Notes(dir);
  n.create("合同", "第三条");
  n.lock("合同");
  const app = await openJot(dir);
  await find(app, "合同");
  await app.keyboard.press("ctrl+x");
  await app.waitFor("id:notice");
  expect(app.texts()).toContain("「合同」已锁定，解锁后才能移到废纸篓");
  expect(app.shows("id:row:合同")).toBe(true);
  expect(app.shows("id:trash-bar")).toBe(false);
  expect(new Notes(dir).read("合同")?.body).toBe("第三条");
  app.dispose();
  unlockAll(dir);
});

test("a locked note opens read-only, says so in its header, and a click there unlocks it", async () => {
  const dir = folder("paper");
  const n = new Notes(dir);
  n.create("日记", "第一行\n- [ ] 交房租");
  n.lock("日记");
  const app = await openJot(dir);
  await find(app, "日记");
  await app.submit("id:search");
  await app.waitFor("id:paper");
  await app.waitFor("id:paper-locked");
  expect(app.shows("id:paper-locked >> text:已锁定")).toBe(true);

  // Typing changes nothing, nor does a tick.
  await app.wait(400);
  await app.keyboard.press("mod+down");
  for (const key of ["x", "y", "enter"]) await app.keyboard.press(key);
  await app.keyboard.press("mod+enter");
  await app.wait(1000);
  expect(new Notes(dir).read("日记")?.body).toBe("第一行\n- [ ] 交房租");

  // A click on "Locked" unlocks it: the header says nothing more, and typing saves again.
  await app.press("id:paper-locked");
  await app.waitUntil(() => !app.shows("id:paper-locked"));
  expect(new Notes(dir).read("日记")?.meta.locked).toBe(false);
  await app.wait(300);
  await app.keyboard.press("mod+down");
  await app.keyboard.press("z");
  await app.waitUntil(() => new Notes(dir).read("日记")?.body === "第一行\n- [ ] 交房租z", { timeout: 3000 });
  app.dispose();
  unlockAll(dir);
});

test("a note locked outside the app shows a padlock as the folder changes", async () => {
  const dir = folder("outside");
  const n = new Notes(dir);
  n.create("密码提示", "问前台");
  const app = await openJot(dir);
  await find(app, "密码提示");
  expect(app.shows("id:row:密码提示 >> id:note-locked")).toBe(false);
  // Another program locks it (Jot on another Mac, through the same folder).
  new Notes(dir).lock("密码提示");
  await app.waitFor("id:row:密码提示 >> id:note-locked", { timeout: 4000 });
  new Notes(dir).unlock("密码提示");
  await app.waitUntil(() => !app.shows("id:row:密码提示 >> id:note-locked"), { timeout: 4000 });
  app.dispose();
  unlockAll(dir);
});

test("a locked note's to-do cannot be ticked in the to-do view: it says to unlock the note", async () => {
  const dir = folder("todo");
  const n = new Notes(dir);
  n.create("买菜", "- [ ] 买咖啡豆");
  n.lock("买菜");
  const app = await openJot(dir);
  await app.waitFor("id:search");
  await app.type("id:search", "待办");
  await app.waitFor("id:todo:买咖啡豆");
  await app.keyboard.press("mod+enter");
  await app.waitFor("id:notice");
  expect(app.texts()).toContain("「买菜」已锁定，解锁后才能改其中的待办");
  expect(new Notes(dir).read("买菜")?.body).toBe("- [ ] 买咖啡豆");
  expect(app.shows("id:todo:买咖啡豆")).toBe(true);
  app.dispose();
  unlockAll(dir);
});

/** ⌘, in the panel, then the AI page. */
async function openAiPage(app: App) {
  await app.waitFor("id:search");
  await app.keyboard.press("mod+,");
  await app.waitFor("id:settings");
  await app.press("id:settings-tab:ai");
  await app.waitFor("id:settings-pane:ai");
  await app.waitFor("id:settings-ai-access");
}

test("the AI page's switch lets AI apps move notes to the Trash and rewrite them; it starts off", async () => {
  const stand = access(false);
  const app = await openJot(folder("switch"), stand.modules);
  await openAiPage(app);
  expect(app.texts()).toContain("允许 AI 应用把笔记移到废纸篓和改写笔记");
  expect(app.texts()).toContain("它们移走的笔记会放进废纸篓，改写前的内容留在笔记的版本历史里，都可以找回。锁定的笔记不受影响。");
  await app.press("id:settings-ai-trash-rewrite");
  await app.waitUntil(() => stand.calls.length === 1);
  // On, with the language Jot shows (what a rewritten note's old version is named in).
  expect(stand.calls).toEqual(["true zh-Hans"]);
  await app.press("id:settings-ai-trash-rewrite");
  await app.waitUntil(() => stand.calls.length === 2);
  expect(stand.calls[1]).toBe("false zh-Hans");
  app.dispose();
});

test("the switch shows what the file says: on, a press turns it off", async () => {
  const on = access(true);
  const app = await openJot(folder("switch-on"), on.modules);
  await openAiPage(app);
  await app.press("id:settings-ai-trash-rewrite");
  await app.waitUntil(() => on.calls.length === 1);
  expect(on.calls).toEqual(["false zh-Hans"]);
  app.dispose();
});
